// The simulated player: a cheap LLM that READS the actual narration and replies at a chosen
// quality level. The old harness replayed a canned genre-neutral list, which can never follow
// a thread, accept an offer it was actually made, or get lost the way real players do - the
// three behaviours the lab exists to observe.
import { env } from './shared.mjs'

const QUALITY_PROMPTS = {
  poor:
    'You are a distracted, low-effort player. Reply with ONE short message: 1-6 words, ' +
    'lowercase, maybe a typo, vague ("ok", "i look around", "who is that", "idk"). Ask a ' +
    'question instead of acting about half the time. Never describe a specific plan.',
  mediocre:
    'You are a casually engaged player. Reply with ONE plausible but generic sentence - you ' +
    'follow the DM\'s lead without much initiative ("I ask him about the lighthouse", "we head ' +
    'inside carefully"). No bold moves, no creative approaches.',
  good:
    'You are an engaged, decisive player. Reply with ONE specific action or line of dialogue ' +
    'that engages directly with what is in front of the party and moves toward the current ' +
    'goal. Be concrete and physical. Commit to choices; accept reasonable offers.',
  // Adversarial persona for exercising the Progress Director's rescue rungs. It ACCEPTS the
  // opening offer (otherwise the story never starts and the objective ladder is unreachable),
  // then refuses to advance anything - so turnsSinceProgress climbs without interruption.
  stall:
    'You are testing a game engine by REFUSING TO MAKE PROGRESS. Rules, in order: ' +
    '(1) If the party has an open quest offer that has not been accepted, reply with a plain ' +
    'acceptance like "we accept" - once only. ' +
    '(2) Otherwise, reply with ONE short idle non-action: hesitate, wonder aloud, wait, look ' +
    'at nothing in particular, mutter, or restate what someone just said. ' +
    'NEVER search, examine, travel, attack, open, take, ask a question that advances anything, ' +
    'or commit to any plan. Never engage the thing the DM is pointing you at. Stay in character ' +
    'as a distracted, dithering adventurer - but produce NO progress whatsoever.',
}

/** 'mixed' samples per turn so a single run contains the whole spectrum, like a real table. */
export function pickQuality(setting, rng) {
  if (setting !== 'mixed') return setting
  const roll = rng()
  if (roll < 0.3) return 'poor'
  if (roll < 0.7) return 'mediocre'
  return 'good'
}

/**
 * One player turn. Returns { text, quality, tokens, costUsd } - cost read from OpenRouter's
 * usage accounting so the lab's spend guard sees player-agent spend too, not just the
 * system's usage_log rows.
 */
export async function generatePlayerTurn({ model, quality, characterName, lines, pendingOffer }) {
  const transcript = lines
    .slice(-10)
    .map((l) => `${l.speaker ?? 'DM'}: ${l.text}`)
    .join('\n')
  const messages = [
    { role: 'system', content:
      `${QUALITY_PROMPTS[quality]}\n\nYou are playing ${characterName} in a D&D game. ` +
      'Output ONLY the message you type into the game chat - no quotes, no name prefix, no markdown.' },
    { role: 'user', content:
      `Recent game transcript:\n${transcript}\n` +
      (pendingOffer ? `\nThe party has an open quest offer: "${pendingOffer}".\n` : '') +
      '\nYour next message:' },
  ]

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openRouterKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 80, usage: { include: true } }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`player agent call failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`)

  const raw = body.choices?.[0]?.message?.content ?? ''
  // One line, unquoted - a model that narrates two paragraphs is not a player.
  const text = raw.trim().split('\n')[0].replace(/^["']|["']$/g, '').slice(0, 200) || 'ok'
  return {
    text,
    quality,
    tokens: (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0),
    costUsd: Number(body.usage?.cost ?? 0),
  }
}
