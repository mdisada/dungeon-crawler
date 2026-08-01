export { JoinPage } from './components/join-page'
export { PlayPage } from './components/play-page'
export { listMemberAdventures } from './api/lobby'
// Shared with the F04 guide editor: its Start Adventure CTA opens the lobby (F05).
export { activateAdventure } from './api/session'
export { deleteAdventure } from './api/delete-adventure'
// Shared with the TTS lab, which drives the real text box through the real chunker so what it
// measures is what play will do - a simulation of either would be measuring the simulation.
export { SceneTextBox } from './components/scene-text-box'
export {
  chunkSentences,
  REVEAL_MAX_CHARS,
  settledBoxCount,
  splitNarration,
  splitSentences,
} from './sentences'
export type { NarrationSplit, NarrationUnits } from './sentences'
export type { MemberAdventure } from './types'
