const sections = [
  {
    title: 'New campaign',
    description: 'Start a new AI-run session from scratch.',
  },
  {
    title: 'Your campaigns',
    description: 'Campaigns you have created or joined will show up here.',
  },
  {
    title: 'Your characters',
    description: 'Characters you have created will show up here.',
  },
]

export function HomePage() {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <div>
        <h1>Welcome back</h1>
        <p className="text-lg">Pick up a campaign, start a new one, or manage your characters.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
        {sections.map((section) => (
          <div key={section.title} className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-base">{section.title}</h2>
            <p className="text-sm text-muted-foreground">{section.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
