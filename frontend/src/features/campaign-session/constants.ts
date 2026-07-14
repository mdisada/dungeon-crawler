// One topic per action, not a single shared 'campaign-session' topic — campaign/DM pages fire
// get-campaign and list-turns concurrently on mount, and sendRealtimeRequest tears down any
// existing channel on a topic before opening its own, so two concurrent requests on the same
// topic would race and kill each other's channel.
export const TOPICS = {
  listCampaigns: 'campaign-session-list-campaigns',
  getCampaign: 'campaign-session-get-campaign',
  listTurns: 'campaign-session-list-turns',
  generateBranchOptions: 'campaign-session-generate-branch-options',
  generateTurn: 'campaign-session-generate-turn',
  publishTurn: 'campaign-session-publish-turn',
  narratePlot: 'campaign-session-narrate-plot',
} as const

export const CAMPAIGN_LIVE_TOPIC = 'campaign-live'

export const TIMEOUTS = {
  listCampaigns: 10_000,
  getCampaign: 10_000,
  listTurns: 10_000,
  generateBranchOptions: 30_000,
  generateTurn: 60_000,
  publishTurn: 10_000,
  // Ack only confirms the read-through started — the audio itself streams over campaign-live.
  narratePlot: 10_000,
} as const

// Only this account may open the debug player page, and only for campaigns it created itself —
// lets one developer run DM + player views side by side before real multiplayer joins exist.
export const DEBUG_PLAYER_EMAIL = 'mig.isada@gmail.com'
