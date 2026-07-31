/** An adventure that has entered play at least once, so it has state worth replaying. */
export interface ReplayableAdventure {
  id: string
  title: string
  status: string
  mode: 'full_ai' | 'assist' | null
  createdAt: string
}

/** One authored battle, addressed by the objective that owns it (how the engine resolves a fight). */
export interface ReplayBattle {
  objectiveId: string
  objectiveTitle: string
  encounterId: string
  label: string
  hasMap: boolean
}

/** The slice of live state the dev panel reads back after each command. */
export interface ReplayStatus {
  sessionStatus: string
  sceneMode: string
  encounterLabel: string | null
  combatActive: boolean
  round: number | null
  version: number
}
