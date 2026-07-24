import type { Cell } from '@rules/combat'

import type { EditorTool, Spawns } from './types'

export interface PaintTarget {
  obstacles: Cell[]
  spawns: Spawns
}

const without = (list: Cell[], [x, y]: Cell) => list.filter(([a, b]) => a !== x || b !== y)

/** Sets a single role on a cell, clearing any other role it held (roles are mutually exclusive). */
export function applyPaint<T extends PaintTarget>(target: T, cell: Cell, tool: EditorTool): T {
  const obstacles = without(target.obstacles, cell)
  const party = without(target.spawns.party, cell)
  const enemy = without(target.spawns.enemy, cell)
  if (tool === 'obstacle') obstacles.push(cell)
  else if (tool === 'party') party.push(cell)
  else if (tool === 'enemy') enemy.push(cell)
  return { ...target, obstacles, spawns: { party, enemy } }
}
