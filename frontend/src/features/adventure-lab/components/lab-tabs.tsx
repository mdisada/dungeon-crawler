interface LabTabsProps<T extends string> {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
}

/** A minimal underline tab bar shared by the sidebar (Generate/Runs) and main pane (the 3 views). */
export function LabTabs<T extends string>({ tabs, active, onChange }: LabTabsProps<T>) {
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`px-3 py-1.5 text-sm capitalize ${
            active === tab ? 'border-b-2 border-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
