import { Link } from 'react-router-dom'

const sections = [
  {
    title: 'New campaign',
    description: 'Start a new AI-run session from scratch.',
    to: '/campaigns/new',
  },
  {
    title: 'Your campaigns',
    description: 'Campaigns you have created or joined will show up here.',
    to: null,
  },
  {
    title: 'Your characters',
    description: 'Characters you have created will show up here.',
    to: null,
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
        {sections.map((section) => {
          const cardClassName = 'rounded-lg border border-border bg-card p-4'
          const content = (
            <>
              <h2 className="text-base">{section.title}</h2>
              <p className="text-sm text-muted-foreground">{section.description}</p>
            </>
          )

          return section.to ? (
            <Link
              key={section.title}
              to={section.to}
              className={`${cardClassName} transition-colors hover:border-ring hover:bg-accent`}
            >
              {content}
            </Link>
          ) : (
            <div key={section.title} className={cardClassName}>
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
