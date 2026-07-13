export type CampaignType = 'one-shot' | 'multi-chapter'

export type CampaignSummary = {
  id: number
  userId: string
  plot: string
  model: string
  campaignType: CampaignType
  createdAt: string
}

export type TurnAuthor = 'dm' | 'player'

export type Turn = {
  id: number
  turnIndex: number
  content: string
  author: TurnAuthor
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

// Pushed after a player's turn auto-triggers the next AI draft on the backend (see
// make_handle_publish_turn) — distinct from TurnDraftedResponse, which is the ack for the DM's
// own manual generate-turn request.
export type TurnDraftedEvent = {
  campaignId: number
  content?: string
  error?: string
}
