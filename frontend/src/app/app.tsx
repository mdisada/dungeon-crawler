import './app.css'

import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { ThemeToggle } from '@/components/ui/theme-toggle'
import { AuthScreen, SignOutButton, useSession } from '@/features/auth'
import { HomePage } from '@/features/home'
import { NewCampaignPage } from '@/features/new-campaign'

function App() {
  const { session, isLoading } = useSession()

  return (
    <BrowserRouter>
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
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/campaigns/new" element={<NewCampaignPage />} />
            </Routes>
          ) : (
            <AuthScreen />
          )}
        </main>

        <footer className="py-6 text-sm">Dungeon Crawler — built for the table.</footer>
      </div>
    </BrowserRouter>
  )
}

export default App
