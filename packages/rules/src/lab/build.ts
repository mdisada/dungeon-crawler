// Groups a playthrough's raw events into per-turn cards and collects the anomalies into an
// Issues list. A "turn" spans from one player action (intent_submitted) to the next; everything
// before the first action is the setup/generation card. Pure - the endpoint calls it, the UI
// renders turns (curated rows), a raw toggle (every event), and the Issues panel (rows the
// explainer marked warn/issue).

import { explainEvent } from './explain.ts'
import type { ExplainContext, LaymanRow, PlayEvent } from './explain.ts'

export interface Turn {
  index: number
  label: string
  /** The player's input that opened this turn; null for the setup card. */
  player: string | null
  playerRoute: string | null
  at: string
  rows: LaymanRow[]
  /** Every event in this turn, for the raw toggle. */
  raw: PlayEvent[]
  issueCount: number
}

export interface Issue {
  eventId: number
  turnIndex: number
  severity: 'warn' | 'issue'
  text: string
}

export interface Playthrough {
  turns: Turn[]
  issues: Issue[]
  eventCount: number
}

const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
const preview = (t: string): string => {
  const clean = t.replace(/\s+/g, ' ').trim()
  return clean.length > 70 ? `${clean.slice(0, 70)}…` : clean
}

export function buildPlaythrough(events: PlayEvent[], ctx: ExplainContext): Playthrough {
  const turns: Turn[] = []
  const issues: Issue[] = []
  let playerTurns = 0
  let prevNarration = ''

  const open = (label: string, player: string | null, route: string | null, at: string): Turn => {
    const turn: Turn = { index: turns.length, label, player, playerRoute: route, at, rows: [], raw: [], issueCount: 0 }
    turns.push(turn)
    return turn
  }
  let current = open('Setup & session start', null, null, events[0]?.created_at ?? '')

  for (const event of events) {
    if (event.type === 'intent_submitted') {
      playerTurns++
      const p = event.payload ?? {}
      current = open(
        `Turn ${playerTurns}`,
        typeof p.text === 'string' ? p.text : null,
        typeof p.route === 'string' ? p.route : null,
        event.created_at,
      )
      current.raw.push(event)
      continue
    }
    current.raw.push(event)
    const row = explainEvent(event, ctx)
    if (!row) continue

    // Duplicate scene-entry (the arrival-narrated-twice bug we found): consecutive narration with
    // the same opening is a travel-arrival + encounter-open double beat. Flag it as an anomaly.
    if (event.type === 'narration_published') {
      const here = norm(String(event.payload?.text ?? ''))
      if (here && here === prevNarration) {
        row.severity = 'warn'
        row.icon = '⚠️'
        row.text = `Duplicate narration — the scene text was repeated: "${preview(String(event.payload?.text ?? ''))}"`
      }
      prevNarration = here
    }

    current.rows.push(row)
    if (row.severity === 'issue' || row.severity === 'warn') {
      current.issueCount++
      issues.push({ eventId: row.eventId, turnIndex: current.index, severity: row.severity, text: row.text })
    }
  }

  return { turns, issues, eventCount: events.length }
}
