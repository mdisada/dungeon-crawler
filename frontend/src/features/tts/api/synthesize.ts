import { env } from '@/config/env'
import { sendAssetJob } from '@/lib/asset-job'
import { assetPath, uploadAsset } from '@/lib/asset-storage'
import { callEdgeFunction } from '@/lib/edge-function'
import { encodeWav } from '../normalize-clip'
import type { SynthesizeArgs, TtsResult } from '../types'

// There is no placeholder audio asset the way there are placeholder images, so placeholder mode
// synthesizes half a second of silence. It still exercises every caller's playback path without
// spending credit, and is unmistakably not a real result.
function placeholderAudio(): string {
  return URL.createObjectURL(encodeWav(new Float32Array(8_000), 16_000))
}

// Normalized voice payload -- ai-proxy interprets it per the resolved provider (model): a Fish
// engine clones `voiceProfileId` or uses `voiceId` as a reference_id; Voxtral uses `voiceId` as a
// preset slug and rejects a profile. The client doesn't need to know which provider is active.
type CloudVoicePayload =
  | { voiceProfileId: string; voiceStoragePath: string }
  | { voiceId: string }
  | Record<string, never>

async function requestCloudTts(
  text: string,
  voicePayload: CloudVoicePayload,
  model: string | undefined,
): Promise<Blob> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'tts',
      agent_role: 'user_direct',
      ...(model ? { model } : {}),
      payload: { input: text, response_format: 'mp3', ...voicePayload },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ai-proxy tts request failed: ${res.status} ${detail}`)
  }
  return res.blob()
}

/**
 * Synthesizes `text` and returns the resulting audio as Storage paths.
 *
 * The two routes deliberately keep their production shapes: the local worker chunks narration so
 * playback can start early, OpenRouter returns a single file. Callers that only want playback can
 * concatenate the chunk list; the lab reads the stage marks to compare time-to-first-audio
 * against total time, which is where the two approaches actually differ.
 */
export async function synthesize({
  userId,
  jobId,
  route,
  text,
  voice,
  model,
  usePlaceholder,
  onProgress,
}: SynthesizeArgs): Promise<TtsResult> {
  if (usePlaceholder ?? env.placeholderMedia) {
    return { chunks: [placeholderAudio()], marks: [{ stage: 'done', atMs: 0 }] }
  }

  if (route === 'local') {
    const { data, marks } = await sendAssetJob<{ chunks: string[] }>({
      userId,
      requestEvent: 'generate-tts',
      jobId,
      payload: {
        text,
        // Cloning uses the clip itself; a preset id is just a name the engine knows; neither
        // (default) lets the worker use its configured narrator voice.
        voicePath: voice.kind === 'profile' ? voice.profile.storagePath : null,
        voiceId: voice.kind === 'preset' ? voice.voiceId : null,
      },
      onProgress: (event) => onProgress?.(event.stage),
    })
    return { chunks: data.chunks, marks }
  }

  // A clip profile clones on Fish (the default cloud provider) and errors on Voxtral -- ai-proxy
  // enforces that per model, so the client just forwards the selection either way. 'default' sends
  // no voice fields: Fish uses its built-in voice.
  const voicePayload: CloudVoicePayload =
    voice.kind === 'profile'
      ? { voiceProfileId: voice.profile.id, voiceStoragePath: voice.profile.storagePath }
      : voice.kind === 'preset'
        ? { voiceId: voice.voiceId }
        : {}

  const startedAt = performance.now()
  onProgress?.('generating')
  const blob = await requestCloudTts(text, voicePayload, model)
  const generatedAtMs = performance.now() - startedAt

  onProgress?.('uploading')
  const path = await uploadAsset(assetPath(userId, 'audio', jobId, 'mp3'), blob)
  return {
    chunks: [path],
    marks: [
      { stage: 'generating', atMs: 0 },
      // One file means first audio and last audio are the same moment - that is the finding,
      // not a gap in the data.
      { stage: 'chunk', atMs: generatedAtMs },
      { stage: 'uploading', atMs: generatedAtMs },
      { stage: 'done', atMs: performance.now() - startedAt },
    ],
  }
}
