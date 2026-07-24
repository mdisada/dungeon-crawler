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

async function requestCloudTts(text: string, voice: string, model: string | undefined): Promise<Blob> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'tts',
      agent_role: 'user_direct',
      ...(model ? { model } : {}),
      payload: { input: text, voice, response_format: 'mp3' },
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
        // Cloning uses the clip itself; a preset id is just a name the engine knows.
        voicePath: voice.kind === 'profile' ? voice.profile.storagePath : null,
        voiceId: voice.kind === 'preset' ? voice.voiceId : null,
      },
      onProgress: (event) => onProgress?.(event.stage),
    })
    return { chunks: data.chunks, marks }
  }

  // Cloud cloning is not possible: OpenRouter's /audio/speech takes a preset voice slug, and
  // Voxtral's cloning endpoint (audio.voices.create) isn't proxied. Fail loudly rather than
  // sending a clip URL that returns "Provider returned 404".
  if (voice.kind === 'profile') {
    throw new Error(
      'Voice cloning is only available on the local route. On OpenRouter, pick a preset voice ' +
        '(e.g. en_paul_neutral).',
    )
  }

  const startedAt = performance.now()
  onProgress?.('generating')
  const blob = await requestCloudTts(text, voice.voiceId, model)
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
