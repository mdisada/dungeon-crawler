export type CampaignType = 'one-shot' | 'multi-chapter'

export type CampaignSummary = {
  id: number
  userId: string
  title: string | null
  plot: string
  model: string
  campaignType: CampaignType
  createdAt: string
}

export type TurnAuthor = 'dm' | 'player'

export type AudioChunk = {
  url: string
  isNewParagraph: boolean
}

export type Turn = {
  id: number
  turnIndex: number
  content: string
  author: TurnAuthor
  audioChunks: AudioChunk[] | null
  createdAt: string
}

// Realtime response payloads (each carries jobId + optional error, added by the backend)
export type CampaignsListedResponse = {
  jobId: string
  error?: string
  userId: string
  campaigns: CampaignSummary[]
}

export type CampaignFetchedResponse = {
  jobId: string
  error?: string
  campaignId: number
  campaign: CampaignSummary | null
}

export type TurnsListedResponse = {
  jobId: string
  error?: string
  campaignId: number
  turns: Turn[]
}

export type TurnDraftedResponse = {
  jobId: string
  error?: string
  campaignId: number
  content: string
}

export type BranchOptionsResponse = {
  jobId: string
  error?: string
  campaignId: number
  options: string[]
}

export type TurnPublishedAckResponse = {
  jobId: string
  error?: string
  campaignId: number
  turn: Turn
}

export type PublishTurnPayload = {
  campaignId: number
  content: string
  author: TurnAuthor
}

// Broadcasts on the campaign-live topic (no jobId — every subscriber receives them, not just a requester)
export type TurnPublishedEvent = {
  campaignId: number
  turn: Turn
}

// Pushed after a player's turn auto-triggers a fresh batch of branch-option suggestions on the
// backend (see make_handle_publish_turn) — distinct from BranchOptionsResponse, which is the ack
// for the DM's own manual generate-branch-options request.
export type BranchOptionsEvent = {
  campaignId: number
  options?: string[]
  error?: string
}

// Live narration audio, pushed while the DM is generating/deciding on the next turn (not tied to
// publish-turn's ack) — see use-live-narration-audio.ts. jobId scopes chunks to one generation
// request; narration-generation-started resets any in-progress playback before chunks arrive.
export type NarrationGenerationStartedEvent = {
  campaignId: number
  jobId: string
}

export type NarrationAudioChunkEvent = {
  campaignId: number
  jobId: string
  kind: 'transition' | 'narration' | 'plot'
  sentenceIndex: number
  isNewParagraph: boolean
  audioUrl: string
}

// Ack for narrate-plot — only confirms the plot read-through started; the audio itself arrives
// as kind "plot" narration-audio-chunk broadcasts on campaign-live.
export type PlotNarrationStartedResponse = {
  jobId: string
  error?: string
  campaignId: number
}

// Pushed once a published turn's replayable audio finishes generating in the background (see
// backend/campaign/session_handlers.py's _persist_narration_audio) — turn-published fires before
// this is ready, so clients update the matching turn in place when this arrives.
export type TurnAudioReadyEvent = {
  campaignId: number
  turnId: number
  audioChunks: AudioChunk[]
}
