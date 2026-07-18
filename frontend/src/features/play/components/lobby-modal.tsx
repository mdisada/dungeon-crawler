import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { regenInvite } from '../api/session'
import { useLobby } from '../hooks/use-lobby'
import type { MemberAdventure, PlayRole } from '../types'

interface LobbyModalProps {
  adventure: MemberAdventure
  userId: string
  role: PlayRole
  isSpectator: boolean
}

/**
 * F05 SS3: the waiting-area modal over the dimmed adventure page. Presence, character pick +
 * lock, ready flow, DM start gate (server-enforced; the button mirrors it), invite link.
 */
export function LobbyModal({ adventure, userId, role, isSpectator }: LobbyModalProps) {
  const lobby = useLobby(adventure.id, userId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviteCode, setInviteCode] = useState(adventure.inviteCode)
  const [copied, setCopied] = useState(false)

  const me = lobby.members.find((m) => m.userId === userId)
  const isDm = role === 'dm'
  const mayStart = adventure.mode === 'assist' ? isDm : adventure.creatorId === userId
  const readyCount = lobby.members.filter((m) => m.role === 'player' && !m.spectator && m.ready && m.characterId).length

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const inviteUrl = `${window.location.origin}/join/${inviteCode}`

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-label="Adventure lobby" className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-semibold">{adventure.title || 'Adventure lobby'}</h2>
        <p className="text-sm text-muted-foreground">
          {adventure.minPlayers}–{adventure.maxPlayers} players · {readyCount} ready
          {isSpectator && ' · spectating until the DM admits you'}
        </p>

        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        {lobby.warning && <p className="mt-2 text-sm text-amber-600">{lobby.warning}</p>}

        <section className="mt-4" aria-label="Party">
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Party</h3>
          <ul className="flex flex-col gap-2">
            {lobby.members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 rounded-lg border p-2">
                <span
                  className={cn('h-2.5 w-2.5 shrink-0 rounded-full', member.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
                  title={member.online ? 'Online' : 'Offline'}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.role === 'dm' ? 'DM' : member.characterName ?? 'Choosing character…'}
                    {member.userId === userId && ' (you)'}
                    {member.spectator && ' · spectator'}
                  </p>
                  {member.characterName && member.role === 'player' && (
                    <p className="truncate text-xs text-muted-foreground">
                      {member.characterClass} · level {member.characterLevel}
                    </p>
                  )}
                </div>
                {member.role === 'player' && !member.spectator && (
                  <span className={cn('rounded px-2 py-0.5 text-xs', member.ready ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                    {member.ready ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {me?.role === 'player' && !isSpectator && (
          <section className="mt-4" aria-label="Character selection">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Your character</h3>
            {lobby.ownCharacters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No complete characters yet — create one on the Characters page first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {lobby.ownCharacters.map((character) => {
                  const lockedElsewhere =
                    character.lockedAdventureId !== null && character.lockedAdventureId !== adventure.id
                  const isPicked = me.characterId === character.id
                  return (
                    <button
                      key={character.id}
                      type="button"
                      disabled={busy || lockedElsewhere}
                      onClick={() => void run(() => lobby.pick(isPicked ? null : character.id))}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        isPicked ? 'border-primary bg-primary/10' : 'hover:bg-accent',
                        lockedElsewhere && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="font-medium">{character.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {character.classKey} · level {character.level}
                        {lockedElsewhere && ' · locked to another adventure'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="mt-3">
              <Button
                disabled={busy || (!me.ready && !me.characterId)}
                variant={me.ready ? 'outline' : 'default'}
                onClick={() => void run(() => lobby.toggleReady(!me.ready))}
              >
                {me.ready ? 'Not ready' : 'Ready'}
              </Button>
            </div>
          </section>
        )}

        {isDm && (
          <section className="mt-4 flex flex-col gap-2" aria-label="Invite">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">Invite players</h3>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{inviteUrl}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void run(async () => setInviteCode((await regenInvite(adventure.id)).invite_code))}
              >
                New link
              </Button>
            </div>
          </section>
        )}

        {mayStart && (
          <div className="mt-6 flex justify-end">
            <Button
              disabled={busy || readyCount < adventure.minPlayers}
              onClick={() => void run(lobby.start)}
            >
              {readyCount < adventure.minPlayers
                ? `Waiting for ${adventure.minPlayers - readyCount} more ready player(s)`
                : 'Start Session'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
