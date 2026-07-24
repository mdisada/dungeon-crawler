import './app.css'

import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { Navbar } from '@/components/navbar'
import { AdventureLabPage } from '@/features/adventure-lab'
import { AdventurePage, NewAdventurePage } from '@/features/adventures'
import { AssetsLabPage } from '@/features/assets-lab'
import { AuthScreen, useSession } from '@/features/auth'
import { CharacterCreatorPage, CharactersPage } from '@/features/characters'
import { CombatLabPage } from '@/features/combat-lab'
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

        <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col items-center px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
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
              <Route path="/combat-lab" element={<CombatLabPage />} />
              <Route path="/adventure-lab" element={<AdventureLabPage />} />
              <Route path="/assets-lab" element={<AssetsLabPage />} />
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
