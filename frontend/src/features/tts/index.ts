export { requestNarration } from './api/narrate'
export { previewVoice } from './api/preview-voice'
export type { VoicePreview } from './api/preview-voice'
export { synthesize } from './api/synthesize'
export { settledCount } from './narration-state'
export type { NarrationChunkState, NarrationState } from './narration-state'
export { useNarrationAudio } from './hooks/use-narration-audio'
export {
  deleteVoiceProfile,
  getVoiceClipUrl,
  listVoiceProfiles,
  uploadVoiceProfile,
} from './api/voice-profiles'
export { useSynthesis } from './hooks/use-synthesis'
export type { TtsRunOutcome } from './hooks/use-synthesis'
export { useVoiceProfiles } from './hooks/use-voice-profiles'
export { normalizeVoiceClip } from './normalize-clip'
export type {
  NarrateArgs,
  NarrationAudio,
  NarrationPlan,
  SynthesizeArgs,
  TtsResult,
  UseNarrationAudioArgs,
  VoiceProfile,
  VoiceSelection,
} from './types'
export { DEFAULT_FISH_MODEL, FISH_MODELS, isFishModel } from './fish-voices'
export type { FishModel } from './fish-voices'
export { DEFAULT_VOXTRAL_VOICE, VOXTRAL_VOICES } from './voxtral-voices'
export type { VoxtralVoice } from './voxtral-voices'
