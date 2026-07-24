import type { AssetJobMark, AssetStage } from '@/lib/asset-job'

export type ImagePresetKey = 'base_char' | 'avatar_char' | 'cutscene' | 'background' | 'map'

export interface ImagePreset {
  key: ImagePresetKey
  label: string
  description: string
  /** Appended to the user's prompt on the OpenRouter route only. */
  promptSuffix: string
  /** 0 means this preset is the start of a chain and takes no reference image. */
  maxReferences: number
}

export type AssetRoute = 'openrouter' | 'local'

export interface GenerateImageArgs {
  userId: string
  jobId: string
  route: AssetRoute
  preset: ImagePresetKey
  prompt: string
  /** Storage paths in the assets bucket (see uploadImageReference). */
  references?: string[]
  /** Allowlisted OpenRouter model; omitted falls back to user_settings.image_model. */
  model?: string
  /** Lab escape hatch: features honour env.placeholderMedia unless told otherwise. */
  usePlaceholder?: boolean
  onProgress?: (stage: AssetStage) => void
}

export interface ImageResult {
  /** Path in the assets bucket, or a /placeholders/... public path in placeholder mode. */
  storagePath: string
  marks: AssetJobMark[]
}
