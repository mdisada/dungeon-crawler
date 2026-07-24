import type { ImagePreset, ImagePresetKey } from './types'

/**
 * Use-case presets (F12 §3). The two routes consume this differently on purpose:
 *
 * - OpenRouter: the browser appends `promptSuffix` and always requests 1024x1024. The hosted
 *   models give little reliable control beyond the prompt, so framing has to live in the words.
 * - Local: only the `key` goes over the wire; the worker maps it to a ComfyUI workflow, where
 *   real resolution/steps/LoRA control exists (backend/image.py).
 *
 * That split is why the suffix carries the framing rather than an aspect ratio: `base_char`
 * must still yield a croppable head-to-toe figure inside a square.
 */
export const IMAGE_PRESETS: Record<ImagePresetKey, ImagePreset> = {
  base_char: {
    key: 'base_char',
    label: 'Base character',
    description: 'Full-body source image the token, avatar and portrait crops come from.',
    promptSuffix:
      'full body visible from head to toe, standing neutral pose, centered in frame, ' +
      'plain uncluttered background, painterly fantasy illustration',
    maxReferences: 0,
  },
  avatar_char: {
    key: 'avatar_char',
    label: 'Visual-novel avatar',
    description: 'Head-and-shoulders bust for dialogue. Reference the base character.',
    promptSuffix:
      'head and shoulders portrait facing the viewer, clear facial expression, ' +
      'plain background, painterly fantasy illustration',
    maxReferences: 1,
  },
  cutscene: {
    key: 'cutscene',
    label: 'Cutscene',
    description: 'A described moment. Reference the characters and the location.',
    promptSuffix:
      'cinematic scene illustration, dramatic lighting, characters in the environment, ' +
      'painterly fantasy illustration',
    maxReferences: 3,
  },
  background: {
    key: 'background',
    label: 'Location background',
    description: 'Establishing shot of a place, no characters.',
    promptSuffix:
      'wide establishing shot of the location, no characters present, atmospheric lighting, ' +
      'painterly fantasy illustration',
    maxReferences: 0,
  },
  map: {
    key: 'map',
    label: 'Battle map',
    description: 'Top-down tactical map. Reference the location background.',
    promptSuffix:
      'top-down orthographic tactical battle map, even lighting, no characters, ' +
      'clear traversable floor and distinct obstacles',
    maxReferences: 1,
  },
}

export const IMAGE_PRESET_KEYS = Object.keys(IMAGE_PRESETS) as ImagePresetKey[]

export function composePrompt(preset: ImagePresetKey, prompt: string): string {
  return [prompt.trim(), IMAGE_PRESETS[preset].promptSuffix].filter(Boolean).join(', ')
}
