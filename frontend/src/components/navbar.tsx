import { Link } from 'react-router-dom'

import { ThemeToggle } from '@/components/ui/theme-toggle'
import { SignOutButton, useSession } from '@/features/auth'
import { useAiCredit, useUserSettings, useWorkerStatus } from '@/features/settings'

const WORKER_STATUS_DOT = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
} as const

export function Navbar() {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  const creditUsd = useAiCredit()
  const { state } = useUserSettings(userId ?? '')
  const workerStatus = useWorkerStatus(userId)
  const isLocalMode = state.status === 'ready' && state.settings.provider === 'local'

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b py-4 sm:py-5">
      <Link to="/" className="text-lg font-semibold tracking-tight text-foreground">
        Dungeon Crawler
      </Link>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-5">
        <span className="text-sm text-muted-foreground">
          Credit: {creditUsd === null ? '—' : `$${creditUsd.toFixed(2)}`}
        </span>
        {isLocalMode && (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span
              className={`h-2 w-2 rounded-full ${WORKER_STATUS_DOT[workerStatus ?? 'red']}`}
              aria-hidden="true"
            />
            Local worker
          </span>
        )}
        <Link
          to="/characters"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Characters
        </Link>
        <Link
          to="/settings"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Settings
        </Link>
        {session && <SignOutButton />}
        <ThemeToggle />
      </nav>
    </header>
  )
}
