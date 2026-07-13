import './app.css'

import { ThemeToggle } from '@/components/ui/theme-toggle'
import { AuthScreen, SignOutButton, useSession } from '@/features/auth'

function App() {
  const { session, isLoading } = useSession()

  return (
    <div id="app">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-medium text-[var(--text-h)]">Dungeon Crawler</span>
        <div className="flex items-center gap-2">
          {session && <SignOutButton />}
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-16 py-16">
        {isLoading ? null : session ? (
          <div className="max-w-2xl">
            <h1>Your next campaign, run by AI</h1>
            <p className="text-lg">
              An AI dungeon master  ready to
              narrate, referee, and voice a full tabletop session.
            </p>
          </div>
        ) : (
          <AuthScreen />
        )}
      </main>

      <footer className="py-6 text-sm">Dungeon Crawler — built for the table.</footer>
    </div>
  )
}

export default App
