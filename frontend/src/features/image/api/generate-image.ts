import { env } from '@/config/env'
import { sendAssetJob } from '@/lib/asset-job'
import { assetPath, getAssetUrl, uploadAsset, uploadReference } from '@/lib/asset-storage'
import { callEdgeFunction } from '@/lib/edge-function'
import { composePrompt, IMAGE_PRESETS } from '../presets'
import type { GenerateImageArgs, ImagePresetKey, ImageResult } from '../types'

// OpenRouter gives no reliable dimension control, so every cloud image is square and the preset
// does its work through the prompt instead (see presets.ts). ComfyUI workflows on the local
// route are free to use whatever resolution the preset calls for.
const CLOUD_IMAGE_SIZE = 1024

const PLACEHOLDER_BY_PRESET: Record<ImagePresetKey, string> = {
  base_char: '/placeholders/fullbody.png',
  avatar_char: '/placeholders/avatar.png',
  cutscene: '/placeholders/background.png',
  background: '/placeholders/background.png',
  map: '/placeholders/map.png',
}

interface OpenRouterImageResponse {
  data?: { url?: string; b64_json?: string }[]
}

function shouldUsePlaceholder(explicit: boolean | undefined): boolean {
  return explicit ?? env.placeholderMedia
}

async function toBlob(source: { url?: string; b64_json?: string }): Promise<Blob> {
  if (source.b64_json) {
    const bytes = Uint8Array.from(atob(source.b64_json), (char) => char.charCodeAt(0))
    return new Blob([bytes], { type: 'image/png' })
  }
  if (!source.url) throw new Error('ai-proxy image response had no image data')
  const res = await fetch(source.url)
  if (!res.ok) throw new Error(`Could not download generated image: ${res.status}`)
  return res.blob()
}

async function requestCloudImage(
  prompt: string,
  model: string | undefined,
  referenceUrls: string[],
): Promise<Blob> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'image',
      agent_role: 'user_direct',
      ...(model ? { model } : {}),
      payload: {
        prompt,
        size: `${CLOUD_IMAGE_SIZE}x${CLOUD_IMAGE_SIZE}`,
        output_format: 'png',
        ...(referenceUrls.length > 0
          ? { input_references: referenceUrls.map((url) => ({ type: 'image_url', image_url: { url } })) }
          : {}),
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ai-proxy image request failed: ${res.status} ${text}`)
  }
  const json = (await res.json()) as OpenRouterImageResponse
  const first = json.data?.[0]
  if (!first) throw new Error('ai-proxy image response had no image data')
  return toBlob(first)
}

/** Uploads a picked file so both routes can reach it: signed URL for OpenRouter, path for the worker. */
export async function uploadImageReference(userId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  return uploadReference(userId, file, extension)
}

export async function generateImage({
  userId,
  jobId,
  route,
  preset,
  prompt,
  references = [],
  model,
  usePlaceholder,
  onProgress,
}: GenerateImageArgs): Promise<ImageResult> {
  if (shouldUsePlaceholder(usePlaceholder)) {
    return { storagePath: PLACEHOLDER_BY_PRESET[preset], marks: [{ stage: 'done', atMs: 0 }] }
  }

  const allowed = references.slice(0, IMAGE_PRESETS[preset].maxReferences)

  if (route === 'local') {
    const { data, marks } = await sendAssetJob<{ storagePath: string }>({
      userId,
      requestEvent: 'generate-image',
      jobId,
      // Only the preset key crosses the wire - the worker owns what it means.
      payload: { preset, prompt, references: allowed },
      onProgress: (event) => onProgress?.(event.stage),
    })
    return { storagePath: data.storagePath, marks }
  }

  const startedAt = performance.now()
  const referenceUrls = await Promise.all(allowed.map((path) => getAssetUrl(path)))
  onProgress?.('generating')
  const blob = await requestCloudImage(composePrompt(preset, prompt), model, referenceUrls)
  const generatedAtMs = performance.now() - startedAt
  onProgress?.('uploading')

  const path = await uploadAsset(assetPath(userId, 'image', jobId, 'png'), blob)
  return {
    storagePath: path,
    // Same stage vocabulary as the worker, so cloud and local rows are comparable and the
    // cloud route's extra upload leg stays visible rather than hidden inside one total.
    marks: [
      { stage: 'generating', atMs: 0 },
      { stage: 'uploading', atMs: generatedAtMs },
      { stage: 'done', atMs: performance.now() - startedAt },
    ],
  }
}

/** Image-to-image: the current image becomes the reference and the instruction replaces the prompt. */
export async function editImage(
  args: Omit<GenerateImageArgs, 'references'> & { sourcePath: string; instruction: string },
): Promise<ImageResult> {
  const { sourcePath, instruction, ...rest } = args
  if (shouldUsePlaceholder(rest.usePlaceholder)) {
    return { storagePath: PLACEHOLDER_BY_PRESET[rest.preset], marks: [{ stage: 'done', atMs: 0 }] }
  }

  if (rest.route === 'local') {
    const { data, marks } = await sendAssetJob<{ storagePath: string }>({
      userId: rest.userId,
      requestEvent: 'generate-image',
      jobId: rest.jobId,
      payload: { preset: rest.preset, prompt: instruction, references: [sourcePath], isEdit: true },
      onProgress: (event) => rest.onProgress?.(event.stage),
    })
    return { storagePath: data.storagePath, marks }
  }

  const startedAt = performance.now()
  const referenceUrl = await getAssetUrl(sourcePath)
  rest.onProgress?.('generating')
  // No preset suffix here: an edit instruction describes a change to an existing image, and
  // re-appending the framing clause fights the reference rather than reinforcing it.
  const blob = await requestCloudImage(instruction, rest.model, [referenceUrl])
  const generatedAtMs = performance.now() - startedAt
  rest.onProgress?.('uploading')

  const path = await uploadAsset(assetPath(rest.userId, 'image', rest.jobId, 'png'), blob)
  return {
    storagePath: path,
    marks: [
      { stage: 'generating', atMs: 0 },
      { stage: 'uploading', atMs: generatedAtMs },
      { stage: 'done', atMs: performance.now() - startedAt },
    ],
  }
}
