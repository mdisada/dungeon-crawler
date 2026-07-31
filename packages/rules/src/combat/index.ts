export { attackAdvantage, attackAdvantageDetail } from './attack.ts'
export type { AdvantageReason } from './attack.ts'
export { predictOpportunityAttacks } from './queries.ts'
export { expectedDamage, formatDiceExpr, parseDiceExpr } from './dice.ts'
export { DIFFICULTY_PRESETS, scaledHpMax, STANDARD_DIFFICULTY } from './difficulty.ts'
export {
  activeCombatant, createCombat, editCombatant, resolveAction, setDifficulty,
} from './engine.ts'
export type { CombatantPatch, CombatSetup } from './engine.ts'
export { characterToSetup, npcStatBlockToSetup } from './convert.ts'
export type { PartyMemberInput } from './convert.ts'
export {
  bossNpcStateForOutcome, buildManifest, DEFAULT_PARTY_MORALE, deriveResult, fightIsOver,
  manifestToSetup, resolveDifficulty,
} from './manifest.ts'
export type {
  BossOutcome, BuildManifestInput, CombatManifest, CombatResult, ManifestBeatSpec, ManifestEnemyGroup,
  ManifestMapInput, ManifestNpcRow,
} from './manifest.ts'
export { MONSTER_FIXTURES, monsterSetup } from './fixtures.ts'
export type { MonsterFixture } from './fixtures.ts'
export { indexSrdMonsters, srdLookupNames, srdMonsterToSetup } from './srd-monsters.ts'
export type { SrdMonsterRow } from './srd-monsters.ts'
export {
  blockedCells, cellKey, chebyshev, DEFAULT_BOUNDS, findPath, gridBounds, inBounds, lineOfSight,
  reachableCells,
} from './grid.ts'
export type { Cell, GridBounds } from './grid.ts'
export { chooseAutoAction, runAutoTurn } from './heuristic.ts'
export { DEFAULT_TURN_CAP, runFight, simSeeds, simulate, sweepDifficulty } from './sim.ts'
export type { FightOutcome, RunRecord, SimOptions, SimSummary, Stats } from './sim.ts'
export { resolveCast, spellAffects, spellArea, spellTargets } from './spells.ts'
export { findSpell, SPELL_LIBRARY } from './spell-library.ts'
export { CombatError } from './types.ts'
export type {
  AbilityKey, AttackSpec, Combatant, CombatAction, CombatantHp, CombatantSetup, CombatEngineState,
  CombatEvent, CombatSide, ConditionName, DamageBreakdown, DiceExpr, DifficultySetting,
  EngineResult, RollBreakdown, SaveModifiers, SpellArea, SpellSpec, TurnEconomy,
} from './types.ts'
export { ABILITY_KEYS } from './types.ts'
export { combatStateFromEngine } from './to-scene.ts'
export type { ToSceneOptions } from './to-scene.ts'
