/**
 * Writes the three lines a voice is auditioned on for one NPC.
 *
 * Casting a voice from a generic sample tells you the timbre and nothing else - every voice sounds
 * plausible reading a neutral line. Hearing a candidate say something *this character* would say is
 * the actual decision, and it is the only signal available before committing.
 *
 * Runs once per NPC and is cached on the row: the lines have to be STABLE, because narration audio
 * is content-addressed on (text + voice + engine), so a line that changed per press would miss the
 * cache and pay for synthesis on every click.
 *
 * Any failure returns null and the picker falls back to the generic set, which is what it used
 * before this existed.
 */

import { callEdgeFunction } from '@/lib/edge-function'
import type { Npc } from '../types'

const SYSTEM_PROMPT = [
  'You write audition lines for a voice actor trying out for one character in a tabletop RPG.',
  '',
  'Write exactly three lines that this character speaks, in first person, in their own voice.',
  'They are heard one after another by someone choosing between voices, so they must contrast:',
  '  1. neutral - how this character talks on an ordinary day',
  '  2. heated - angry, urgent, or refusing; short sentences',
  '  3. wry, quiet or resigned - the other end of their range',
  '',
  'Rules:',
  '- 10 to 20 words each. They are spoken aloud, so they must be easy to say.',
  '- Each line must stand alone. No reply to an unheard question, no "as I said", no pronouns',
  '  pointing at people the listener has not met.',
  '- Speech only. No stage directions, no quotation marks, no character name, no narration.',
  '- Do not mention being a voice, an audition, a game, dice or a player.',
  '- Keep their vocabulary and register. A dock hand and a court archivist do not sound alike.',
  '',
  'Answer with JSON only: {"lines": ["...", "...", "..."]}',
].join('\n')

/** personality is free-form jsonb; read the fields the guide editor actually writes. */
function trait(personality: Record<string, unknown>, key: string): string {
  const value = personality[key]
  return typeof value === 'string' ? value.trim() : ''
}

function describe(npc: Npc): string {
  return [
    `Name: ${npc.name}`,
    npc.role ? `Role: ${npc.role}` : '',
    npc.faction ? `Faction: ${npc.faction}` : '',
    trait(npc.personality, 'traits') ? `Traits: ${trait(npc.personality, 'traits')}` : '',
    trait(npc.personality, 'wants') ? `Wants: ${trait(npc.personality, 'wants')}` : '',
    npc.description ? `Description: ${npc.description}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Three in-character lines, or null when the model is unavailable or unhelpful. */
export async function writeVoiceSampleLines(npc: Npc): Promise<string[] | null> {
  const source = describe(npc)
  if (!source.trim()) return null

  try {
    const res = await callEdgeFunction('ai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'text',
        agent_role: 'voice_caster',
        stream: false,
        payload: {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: source },
          ],
          // A ceiling, not a spend - you are billed for what comes back. Sized so this survives a
          // model_map override onto a REASONING model, which burns its budget thinking before it
          // emits a single visible token: measured 2026-08-01, gpt-5.6-luna spent 316-401 tokens
          // reasoning about these three lines, so a 250 cap returned content: null every time.
          max_tokens: 1000,
        },
      }),
    })
    if (!res.ok) return null

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content?.trim()
    if (!content) return null

    // Models like to wrap JSON in a fenced block; take the object and ignore the packaging.
    const objectText = /\{[\s\S]*\}/.exec(content)?.[0]
    if (!objectText) return null
    const parsed = JSON.parse(objectText) as { lines?: unknown }
    if (!Array.isArray(parsed.lines)) return null

    const lines = parsed.lines
      .filter((line): line is string => typeof line === 'string')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      // A refusal, an empty string or a paragraph is not an audition line. The bounds are wide
      // enough to allow a model that ignored the word count but tight enough to catch prose.
      .filter((line) => line.length >= 15 && line.length <= 220)

    return lines.length === 3 ? lines : null
  } catch {
    return null
  }
}
