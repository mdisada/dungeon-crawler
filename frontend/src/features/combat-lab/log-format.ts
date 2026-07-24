// Pure CombatEvent -> log line rendering (roll breakdowns per F09 SS7). Returns null for
// events that would only add noise (turn_end).

import type { CombatEvent, DamageBreakdown, RollBreakdown } from '@rules/combat'

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function rollText(roll: RollBreakdown): string {
  const adv = roll.advantage === 'advantage' ? ' adv' : roll.advantage === 'disadvantage' ? ' dis' : ''
  const mods = roll.mods.filter((m) => m.value !== 0).map((m) => signed(m.value)).join('')
  return `d20[${roll.dice.join('/')}]${adv}${mods} = ${roll.total}`
}

function damageText(damage: DamageBreakdown): string {
  const bonus = damage.bonus === 0 ? '' : signed(damage.bonus)
  const mult = damage.mult === 1 ? '' : ` x${damage.mult}`
  return `${damage.rolls.length}d${damage.sides}(${damage.rolls.join('+')})${bonus}${mult} = ${damage.total}`
}

export function formatEvent(event: CombatEvent, name: (id: string) => string): string | null {
  switch (event.kind) {
    case 'combat_start':
      return `Combat started -- ${event.difficulty} difficulty`
    case 'initiative':
      return `Initiative: ${event.order.map((o) => `${o.name} ${o.roll.total}`).join(', ')}`
    case 'round_start':
      return `=== Round ${event.round} ===`
    case 'turn_start':
      return `>> ${event.name}'s turn`
    case 'turn_skip':
      return `${event.name} is ${event.reason} -- turn skipped`
    case 'move':
      return `${name(event.id)} moves ${event.cost} sq (${event.remaining} left)`
    case 'attack': {
      const oa = event.reaction ? ' (opportunity)' : ''
      const dmg = event.damage ? `; ${damageText(event.damage)}` : ''
      return `${name(event.attackerId)} -> ${name(event.targetId)}: ${event.attackName}${oa} ${rollText(event.roll)} vs AC ${event.targetAc} -- ${event.outcome.toUpperCase()}${dmg}`
    }
    case 'damage': {
      const temp = event.hp.temp > 0 ? ` +${event.hp.temp} temp` : ''
      return `${name(event.id)} takes ${event.amount} (${event.hp.current}/${event.hp.max}${temp})`
    }
    case 'heal':
      return `${name(event.id)} heals ${event.amount} (${event.hp.current}/${event.hp.max})`
    case 'spell_cast': {
      const shape = event.area.shape === 'single' ? '' : ` [${event.area.shape}]`
      const who = event.targets.length > 0 ? event.targets.map((t) => t.name).join(', ') : 'no one'
      return `${event.casterName} casts ${event.spellName}${shape} -> ${who}`
    }
    case 'save':
      return `${event.name} ${event.ability.toUpperCase()} save ${rollText(event.roll)} vs DC ${event.dc} -- ${event.success ? 'SAVED' : 'FAILED'}`
    case 'down':
      return `${event.name} is ${event.result === 'dead' ? 'slain' : 'down (unconscious)'}!`
    case 'action': {
      const labels = {
        dodge: 'takes the Dodge action',
        dash: 'takes the Dash action',
        disengage: 'takes the Disengage action',
        stand_up: 'stands up',
      } as const
      return `${name(event.id)} ${labels[event.action]}`
    }
    case 'edit':
    case 'difficulty':
      return event.note
    case 'turn_end':
      return null
    case 'combat_end':
      return `*** Combat over -- ${event.winner} wins ***`
  }
}
