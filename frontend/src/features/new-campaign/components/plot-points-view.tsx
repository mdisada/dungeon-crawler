import type { PlotPoint } from '../types'

type Props = {
  plotPoints: PlotPoint[]
}

export function PlotPointsView({ plotPoints }: Props) {
  return (
    <div className="flex flex-col gap-4 text-left">
      {plotPoints.map((point, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-base font-medium">
            {index + 1}. {point.title}
          </h3>
          <p className="mt-1 text-sm">{point.summary}</p>
        </div>
      ))}
    </div>
  )
}
