export function CostBadge({ cost }: { cost: number }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      Cost: ${cost.toFixed(4)}
    </span>
  )
}
