import './app.css'

import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { Navbar } from '@/components/navbar'
import { AdventurePage, NewAdventurePage } from '@/features/adventures'
import { AuthScreen, useSession } from '@/features/auth'
import { CharacterCreatorPage, CharactersPage } from '@/features/characters'
import { GuidePage } from '@/features/guide'
import { HomePage } from '@/features/home'
import { JoinPage, PlayPage } from '@/features/play'
import { SettingsPage } from '@/features/settings'

function App() {
  const { session, isLoading } = useSession()

  return (
    <BrowserRouter>
      <div id="app">
        {session && <Navbar />}

        <main className="flex w-full flex-1 flex-col items-center py-8 sm:py-12">
          {isLoading ? null : session ? (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/characters" element={<CharactersPage />} />
              <Route path="/characters/new" element={<CharacterCreatorPage />} />
              <Route path="/characters/:id/edit" element={<CharacterCreatorPage />} />
              <Route path="/characters/:id" element={<CharactersPage />} />
              <Route path="/adventures/new" element={<NewAdventurePage />} />
              <Route path="/adventures/:id" element={<AdventurePage />} />
              <Route path="/adventures/:id/guide" element={<GuidePage />} />
              <Route path="/adventures/:id/play" element={<PlayPage />} />
              <Route path="/join/:code" element={<JoinPage />} />
            </Routes>
          ) : (
            <AuthScreen />
          )}
        </main>

        <footer className="py-6 text-center text-sm text-muted-foreground">
          Dungeon Crawler — built for the table.
        </footer>
      </div>
    </BrowserRouter>
  )
}

export default App
