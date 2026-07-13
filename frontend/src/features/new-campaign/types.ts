export type CampaignType = 'one-shot' | 'multi-chapter'

// Setup form state. minChapters/maxChapters/minSessionsPerChapter/maxSessionsPerChapter only
// matter when campaignType is 'multi-chapter' — the backend picks one exact count within those
// bounds and tells the model that exact number (models don't reliably honour a range). For
// 'one-shot' the backend ignores these fields entirely and always generates 1 chapter, 1 session.
export type CampaignSetup = {
  model: string
  plot: string
  campaignType: CampaignType
  minChapters: number
  maxChapters: number
  minSessionsPerChapter: number
  maxSessionsPerChapter: number
}

// Outline shape (camelCase mirrors the backend JSON schema exactly)
export type SessionOutline = {
  hook: string
  conflictClimax: string
  cliffhanger: string
}

export type ChapterOutline = {
  title: string
  bigGoal: string
  twists: string[]
  sessions: SessionOutline[]
}

export type CampaignOutline = {
  chapters: ChapterOutline[]
}

// Client-side lock state, kept separate from CampaignOutline since that type mirrors the
// backend/LLM JSON schema exactly. Locking a chapter cascades to (freezes) all its sessions;
// session-level locks stay independently toggleable underneath for when the chapter is unlocked.
export type ChapterLocks = {
  locked: boolean
  sessions: boolean[]
}

export type OutlineLocks = {
  chapters: ChapterLocks[]
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

export type OutlineGeneratedResponse = {
  jobId: string
  error?: string
  outline: CampaignOutline
  cost: number
  chapterCount: number
  sessionsPerChapter: number
}

export type CampaignSavedResponse = {
  jobId: string
  error?: string
  campaignId: number
}

// Same response shape for a fresh generate and a partial regenerate.
export type OutlineRegeneratedResponse = OutlineGeneratedResponse
