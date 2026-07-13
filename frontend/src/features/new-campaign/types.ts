export type CampaignType = 'one-shot' | 'multi-chapter'

// Setup form state.
export type CampaignSetup = {
  model: string
  plot: string
  campaignType: CampaignType
}

// A rough, high-level story beat (camelCase mirrors the backend JSON schema exactly). No
// exact-count requirement and no hook/climax/cliffhanger sub-structure — everything between
// these points is generated dynamically during play, not pre-written here.
export type PlotPoint = {
  title: string
  summary: string
}

// Client-side lock state, kept separate from PlotPoint[] since that mirrors the backend/LLM
// JSON schema exactly. A flat array parallel to the plot points array — locking freezes a plot
// point so "regenerate unlocked" leaves it untouched.
export type PlotPointLocks = boolean[]

export type PlotDraftSource = 'written' | 'generated' | 'improved'

export type PlotDraft = {
  id: number
  content: string
  source: PlotDraftSource
  createdAt: string
}

// Realtime response payloads (each carries jobId + optional error, added by the backend)
export type ModelsListResponse = {
  jobId: string
  error?: string
  openrouterModels: string[]
  ollamaModels: string[]
  ollamaAvailable: boolean
}

export type PlotGeneratedResponse = {
  jobId: string
  error?: string
  plot: string
  cost: number
}

export type PlotImprovedResponse = {
  jobId: string
  error?: string
  plot: string
  cost: number
}

export type PlotPointsGeneratedResponse = {
  jobId: string
  error?: string
  plotPoints: PlotPoint[]
  cost: number
}

// Same response shape for a fresh generate and a partial regenerate.
export type PlotPointsRegeneratedResponse = PlotPointsGeneratedResponse

export type CampaignSavedResponse = {
  jobId: string
  error?: string
  campaignId: number
}

export type PlotDraftSavedResponse = {
  jobId: string
  error?: string
  draft: PlotDraft
}

export type PlotDraftsListedResponse = {
  jobId: string
  error?: string
  drafts: PlotDraft[]
}
