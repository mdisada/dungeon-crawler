export const CAMPAIGN_BUILDER_TOPIC = 'campaign-builder'

export const TIMEOUTS = {
  listModels: 10_000,
  generatePlot: 30_000,
  improvePlot: 30_000,
  generatePlotPoints: 90_000,
  regeneratePlotPoints: 90_000,
  saveCampaign: 15_000,
  savePlotDraft: 10_000,
  listPlotDrafts: 10_000,
  detectPuzzles: 90_000,
} as const
