import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { cn } from '@/lib/utils'

import { getMemberAdventure } from '../api/lobby'
import { useGameState } from '../hooks/use-game-state'
import { useMusic } from '../hooks/use-music'
import type { MemberAdventure } from '../types'
import { BattleMap } from './battle-map'
import { DmSidebar } from './dm-sidebar'
import { DowntimeView } from './downtime-view'
import { FxLayer } from './fx-layer'
import { LobbyModal } from './lobby-modal'
import { NarrationView } from './narration-view'
import { PlayerSidebar } from './player-sidebar'
import { PlayHeader } from './play-header'
import type { VolumeLevels } from './play-header'
import { PlayProvider } from './play-context'
import { RoleplayView } from './roleplay-view'
import { SessionEndedCard } from './session-ended-card'

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; adventure: MemberAdventure }

const VOLUME_KEY = 'play-volumes'

function loadVolumes(): VolumeLevels {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw) return JSON.parse(raw) as VolumeLevels
  } catch {
    // fall through to defaults
  }
  return { narration: 0.9, music: 0.5, sfx: 0.7, muted: false }
}

/** F06: the live-play screen. Everything below the header renders from broadcast state. */
export function PlayPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useSession()
  const [page, setPage] = useState<PageState>({ status: 'loading' })

  useEffect(() => {
    if (!id || !user) return
    let cancelled = false
    getMemberAdventure(id)
      .then((adventure) => {
        if (cancelled) return
        if (!adventure) setPage({ status: 'error', message: 'Adventure not found (are you a member?)' })
        else setPage({ status: 'ready', adventure })
      })
      .catch((err: unknown) => {
        if (!cancelled) setPage({ status: 'error', message: err instanceof Error ? err.message : 'Failed to open adventure' })
      })
    return () => {
      cancelled = true
    }
  }, [id, user])

  if (!id || !user) return null
  if (page.status === 'loading') return <p className="p-8 text-muted-foreground">Opening adventure…</p>
  if (page.status === 'error')
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p className="text-destructive">{page.message}</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to home
        </Link>
      </div>
    )

  // Pre-play statuses belong to the creator flows (wizard draft page / guide editor).
  const { adventure } = page
  if (adventure.status === 'generating' || adventure.status === 'guide_ready') {
    return <Navigate to={`/adventures/${adventure.id}/guide`} replace />
  }
  if (adventure.status !== 'active' && adventure.status !== 'completed') {
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p className="text-muted-foreground">This adventure is still being set up.</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to home
        </Link>
      </div>
    )
  }

  return <PlayScreen adventure={adventure} userId={user.id} />
}

function PlayScreen({ adventure, userId }: { adventure: MemberAdventure; userId: string }) {
  const game = useGameState(adventure.id)
  const [volumes, setVolumes] = useState<VolumeLevels>(loadVolumes)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes))
  }, [volumes])

  const musicTrack = game.status === 'ready' ? game.state.scene.musicTrack : null
  const music = useMusic(adventure.id, musicTrack, volumes.muted ? 0 : volumes.music)

  if (game.status === 'connecting')
    return <p className="p-8 text-muted-foreground">Connecting to the table…</p>
  if (game.status === 'error')
    return (
      <div className="flex flex-col items-center gap-3 p-8">
        <p className="text-destructive">{game.message}</p>
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          Back to home
        </Link>
      </div>
    )

  const { state } = game
  const inLobby = state.session.status !== 'active'

  const renderer = () => {
    if ((state.scene.mode === 'battle' || state.scene.mode === 'puzzle') && state.combat) {
      return <BattleMap combat={state.combat} />
    }
    if (state.scene.mode === 'roleplay') {
      return <RoleplayView scene={state.scene} dialogue={state.dialogue} players={state.players} isSpectator={game.spectator} />
    }
    if (state.scene.mode === 'downtime') return <DowntimeView dialogue={state.dialogue} />
    return <NarrationView scene={state.scene} dialogue={state.dialogue} />
  }

  return (
    <PlayProvider
      adventure={adventure}
      userId={userId}
      state={state}
      version={game.version}
      role={game.role}
      isSpectator={game.spectator}
      connection={game.connection}
      fx={game.fx}
    >
      <div className="fixed inset-0 z-30 flex flex-col bg-background">
        <PlayHeader
          volumes={volumes}
          onVolumesChange={setVolumes}
          needsAudioUnlock={music.needsUnlock}
          onAudioUnlock={music.unlock}
        />
        <div className="relative flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1">
            {renderer()}
            <FxLayer fx={game.fx} />
            {inLobby && !game.endedCard && (
              <LobbyModal adventure={adventure} userId={userId} role={game.role} isSpectator={game.spectator} />
            )}
            {game.endedCard && <SessionEndedCard card={game.endedCard} onDismiss={game.dismissEndedCard} />}
          </main>

          {/* Sidebar: fixed column >=1024px, slide-over drawer below (F06 SS2). */}
          <aside
            className={cn(
              'w-80 shrink-0 border-l bg-card lg:static lg:block',
              drawerOpen
                ? 'fixed inset-y-0 right-0 z-50 block shadow-2xl'
                : 'hidden',
            )}
          >
            {game.role === 'dm' ? <DmSidebar /> : <PlayerSidebar />}
          </aside>
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-3 right-3 z-40 lg:hidden"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? 'Close panel' : game.role === 'dm' ? 'DM panel' : 'Character'}
          </Button>
        </div>
      </div>
    </PlayProvider>
  )
}
