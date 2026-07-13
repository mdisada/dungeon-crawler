import type { PlotPoint, PlotPointLocks } from './types'

export function buildDefaultLocks(plotPoints: PlotPoint[]): PlotPointLocks {
  return plotPoints.map(() => false)
}
