export interface LabPlot {
  key: string
  title: string
  idea: string
}

export interface LabRunConfig {
  mode: 'new' | 'existing'
  plot?: LabPlot
  adventure_id?: string
  type: 'one_shot' | 'multi_chapter'
  party_size: number
  quality: 'poor' | 'mediocre' | 'good' | 'mixed'
  turns: number
  budget_usd: number
  model: string
}

export interface LabRun {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  config: LabRunConfig
  adventure_id: string | null
  spent_usd: number
  summary: Record<string, unknown> | null
  error: string | null
  log_path: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

// Deliberately generic - the page renders whatever {phase, fn, label, detail} rows the runner
// emits, so changes to the adventure-creation or play flow never require frontend changes.
// New phases, functions, and event kinds flow through without touching this feature.
export interface LabRunEvent {
  id: number
  run_id: string
  phase: string
  fn: string
  label: string
  detail: Record<string, unknown>
  duration_ms: number | null
  created_at: string
}

export interface LabComment {
  id: string
  run_id: string
  event_id: number | null
  body: string
  created_at: string
}

/** A lab-generated adventure a new run can replay without paying for generation again. */
export interface ReusableAdventure {
  adventureId: string
  title: string
}

// Same premise set the paid playtest harness rotates through - varied loop archetypes so the
// pipeline is pushed at different templates, not one mystery over and over.
//
// Every premise here must suit ADVENTURERS - people with weapons, races and skills - so each one
// can carry a real fight. A pure court-intrigue premise ("steel settles nothing here") was
// dropped 2026-07-24: it generated coherent stories, but for a party of adventurers rather than
// lawyers it is the wrong game. Political and social pressure still belong INSIDE these premises
// (the guild in the heist, the magistrate in the escort) - just not as a whole adventure.
export const GENRE_PLOTS: LabPlot[] = [
  { key: 'murder', title: 'The Ashfall Inheritance', idea: 'In a mountain mining town, the mine owner is found dead the night before he was to sign away the deed. Everyone in the household had reason to want him gone. The party must work out who killed him before the thaw brings the magistrate.' },
  { key: 'heist', title: 'The Tidewater Vault', idea: 'A merchant guild keeps its ledgers in a tidal vault that floods twice a day. The party has one low tide to get in, find the manifest that proves the guild is selling conscripts, and get out before the water returns.' },
  { key: 'siege', title: 'The Last Bell of Karrow', idea: 'A frontier monastery has three days before a warband arrives. The monks will not abandon their library, the villagers want to flee, and the walls have one breach nobody will admit to. The party must decide what is defended and what is lost.' },
  { key: 'dungeon', title: 'Below the Sunken Chapel', idea: 'Floodwater has opened a stair beneath a ruined chapel. Something down there has been taking livestock, and the last party sent to look never came back up. The party goes down to find out what happened to them.' },
  { key: 'escort', title: 'The Long Road to Emberfall', idea: 'A witness who can testify against a city magistrate must reach the assizes eight days away. Three factions want them silenced, the witness does not want to go, and the safest road is the one the party cannot afford to take.' },
  { key: 'expedition', title: 'The Cartographer\'s Debt', idea: 'A survey company paid for a map of the drowned valley and got back three dead surveyors and a blank chart. The party must reach four separate sites - a flooded mill, a boundary stone, a shepherd\'s hut and the old weir - and work out what the survey found that was worth killing over. Nothing can be learned from the camp.' },
  { key: 'horror', title: 'The Wintering House', idea: 'A remote house where a family overwintered and only the youngest daughter walked out. She tells the party what happened inside, and her account changes. The house is still there, and so is whatever she left behind.' },
  { key: 'plague', title: 'The Quarantine at Vennhold', idea: 'A river town has been sealed by order of the crown. Inside, the sick outnumber the well and the physician is rationing a cure that will not stretch. The party carry the only writ that can open the gate, and everyone wants it for a different reason.' },
]

export const DEFAULT_RUN_CONFIG: LabRunConfig = {
  mode: 'new',
  plot: GENRE_PLOTS[0],
  type: 'one_shot',
  party_size: 1,
  quality: 'mixed',
  turns: 24,
  budget_usd: 0.75,
  model: 'google/gemini-2.5-flash-lite',
}
