export const CAMPAIGN_BUILDER_TOPIC = 'campaign-builder'

export const TIMEOUTS = {
  listModels: 10_000,
  generatePlot: 30_000,
  generateOutline: 90_000,
  regenerateOutline: 90_000,
  saveCampaign: 15_000,
} as const
