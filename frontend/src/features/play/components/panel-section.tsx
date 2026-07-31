interface PanelSectionProps {
  title: string
  /** Badge in the summary row - omitted for sections with nothing to count. */
  count?: number
  children: React.ReactNode
}

/** Collapsible section of a pinned overlay panel (the DM overview and the player objectives). */
export function PanelSection({ title, count, children }: PanelSectionProps) {
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground [&::-webkit-details-marker]:hidden">
        <svg
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {title}
        {count != null && (
          <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium normal-case tabular-nums">
            {count}
          </span>
        )}
      </summary>
      <div className="mt-1.5 pl-[1.125rem]">{children}</div>
    </details>
  )
}
