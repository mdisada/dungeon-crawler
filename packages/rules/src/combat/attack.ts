// Attack resolution (F09 SS4.1/SS7): advantage calculus, d20 vs AC with crit/fumble, damage
// with temp-HP absorption, down-state transitions, and the end-of-combat check. Mutates the
// engine's working copy of state and appends events; only engine.ts calls in here.

import type { Rng } from '../play/rng.ts'
import { rollD20, rollDiceExpr } from './dice.ts'
import { chebyshev } from './grid.ts'
import type {
  AttackSpec, Combatant, CombatEngineState, CombatEvent, DamageBreakdown, RollBreakdown,
} from './types.ts'

function conscious(c: Combatant): boolean {
  return !c.dead && !c.conditions.includes('unconscious')
}

/** Living, conscious opponent within melee reach - imposes disadvantage on ranged attacks. */
function inEnemyReach(state: CombatEngineState, c: Combatant): boolean {
  return state.combatants.some(
    (other) => other.side !== c.side && conscious(other) && chebyshev(other, c) === 1,
  )
}

export interface AdvantageReason {
  dir: 'adv' | 'dis'
  label: string
}

/** Advantage state plus every contributing 5e reason - the UI forecast shows the why. */
export function attackAdvantageDetail(
  state: CombatEngineState,
  attacker: Combatant,
  target: Combatant,
  attack: AttackSpec,
): { advantage: 'none' | 'advantage' | 'disadvantage'; reasons: AdvantageReason[] } {
  const melee = attack.kind === 'melee'
  const reasons: AdvantageReason[] = []
  if (target.conditions.includes('prone')) {
    reasons.push(melee ? { dir: 'adv', label: 'target prone (melee)' } : { dir: 'dis', label: 'target prone (ranged)' })
  }
  if (target.conditions.includes('unconscious')) reasons.push({ dir: 'adv', label: 'target unconscious' })
  if (attacker.conditions.includes('prone')) reasons.push({ dir: 'dis', label: 'you are prone' })
  if (target.dodging) reasons.push({ dir: 'dis', label: 'target is dodging' })
  if (!melee && inEnemyReach(state, attacker)) reasons.push({ dir: 'dis', label: 'enemy within melee reach' })
  if (!melee && chebyshev(attacker, target) > attack.range) reasons.push({ dir: 'dis', label: 'beyond normal range' })
  const adv = reasons.some((r) => r.dir === 'adv')
  const dis = reasons.some((r) => r.dir === 'dis')
  return { advantage: adv === dis ? 'none' : adv ? 'advantage' : 'disadvantage', reasons }
}

export function attackAdvantage(
  state: CombatEngineState,
  attacker: Combatant,
  target: Combatant,
  attack: AttackSpec,
): 'none' | 'advantage' | 'disadvantage' {
  return attackAdvantageDetail(state, attacker, target, attack).advantage
}

export function resolveAttack(
  state: CombatEngineState,
  attacker: Combatant,
  target: Combatant,
  attack: AttackSpec,
  reaction: boolean,
  rng: Rng,
  events: CombatEvent[],
): void {
  const advantage = attackAdvantage(state, attacker, target, attack)
  const { dice, used } = rollD20(rng, advantage)

  const mods: { label: string; value: number }[] = [{ label: 'to hit', value: attack.toHit }]
  if (attacker.side === 'enemy' && state.difficulty.toHit !== 0) {
    mods.push({ label: `difficulty (${state.difficulty.name})`, value: state.difficulty.toHit })
  }
  const total = used + mods.reduce((a, m) => a + m.value, 0)
  const roll: RollBreakdown = { dice, used, mods, total, advantage }

  let outcome: 'crit' | 'hit' | 'miss'
  if (used === 1) outcome = 'miss'
  else if (used === 20) outcome = 'crit'
  else outcome = total >= target.ac ? 'hit' : 'miss'
  // Melee hits on an unconscious target are automatic crits (SRD).
  if (outcome === 'hit' && attack.kind === 'melee' && target.conditions.includes('unconscious')) {
    outcome = 'crit'
  }

  let damage: DamageBreakdown | null = null
  if (outcome !== 'miss') {
    const extraDice = outcome === 'crit' ? attack.damage.count : 0
    const { rolls, sum } = rollDiceExpr(rng, attack.damage, extraDice)
    const mult = attacker.side === 'enemy' ? state.difficulty.dmgMult : 1
    const dealt = Math.max(0, Math.round((sum + attack.damage.bonus) * mult))
    damage = { rolls, sides: attack.damage.sides, bonus: attack.damage.bonus, mult, total: dealt }
  }

  events.push({
    kind: 'attack',
    attackerId: attacker.id,
    targetId: target.id,
    attackName: attack.name,
    reaction,
    roll,
    targetAc: target.ac,
    outcome,
    damage,
  })

  if (damage && damage.total > 0) applyDamage(state, target, damage.total, events)
}

export function applyDamage(
  state: CombatEngineState,
  target: Combatant,
  amount: number,
  events: CombatEvent[],
): void {
  const wasUp = target.hp.current > 0
  const fromTemp = Math.min(target.hp.temp, amount)
  target.hp.temp -= fromTemp
  target.hp.current = Math.max(0, target.hp.current - (amount - fromTemp))
  events.push({ kind: 'damage', id: target.id, amount, hp: { ...target.hp } })

  if (wasUp && target.hp.current === 0) {
    target.dodging = false
    target.disengaged = false
    if (target.kind === 'npc') {
      target.dead = true
    } else if (!target.conditions.includes('unconscious')) {
      target.conditions.push('unconscious')
    }
    events.push({
      kind: 'down',
      id: target.id,
      name: target.name,
      result: target.kind === 'npc' ? 'dead' : 'unconscious',
    })
    checkCombatEnd(state, events)
  }
}

/** Healing (F09 SS4.1): restores HP up to max; revives a downed but not-dead combatant. */
export function applyHeal(target: Combatant, amount: number, events: CombatEvent[]): void {
  if (target.dead || amount <= 0) return
  const revived = target.hp.current === 0
  target.hp.current = Math.min(target.hp.max, target.hp.current + amount)
  if (revived && target.hp.current > 0) {
    target.conditions = target.conditions.filter((c) => c !== 'unconscious')
  }
  events.push({ kind: 'heal', id: target.id, amount, hp: { ...target.hp } })
}

/** A side with no conscious living combatant loses (all-unconscious counts as defeated). */
export function checkCombatEnd(state: CombatEngineState, events: CombatEvent[]): void {
  if (state.status !== 'active') return
  const partyUp = state.combatants.some((c) => c.side === 'party' && conscious(c))
  const enemyUp = state.combatants.some((c) => c.side === 'enemy' && conscious(c))
  if (partyUp && enemyUp) return
  state.status = 'ended'
  state.winner = partyUp ? 'party' : 'enemy'
  events.push({ kind: 'combat_end', winner: state.winner })
}

export { conscious }
