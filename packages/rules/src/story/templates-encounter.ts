// The encounter TEMPLATE library (overhaul Phase 4).
//
// Why this exists: Phase 4 gives every objective a code-authored "guaranteed route" - a rescue
// encounter the director can always open so the spine is never unadvanceable. The obvious
// implementation (one generic skill challenge per objective) would make every rescue read the
// same, which is exactly the "generic gameplay" risk the owner flagged. Tabletop's answer is
// the random table: not free invention, and not one shape either - a curated menu of shapes
// with a twist axis that forces each instance to differ.
//
// So: code owns the mechanical SKELETON (what the numbers are, how it paces, how it can end);
// the LLM only picks a template from the menu and writes the fiction over it. Every template
// carries a required twist axis, so even a rescue encounter has a reason to be tense.

export const TWIST_AXES = ['timer', 'terrain', 'moral_choice', 'secondary_objective'] as const
export type TwistAxis = (typeof TWIST_AXES)[number]

export type TemplateKind = 'skill_challenge' | 'social' | 'puzzle' | 'combat'

export interface EncounterTemplate {
  key: string
  kind: TemplateKind
  /** One line the Encounter Designer skins - what this shape IS, mechanically. */
  shape: string
  /** Mechanical skeleton the engine instantiates. Code owns these numbers. */
  params: Record<string, unknown>
  /** Twist axes that fit this shape - the designer must fill exactly one. */
  twists: readonly TwistAxis[]
}

/**
 * Twelve shapes across the three playable kinds (combat stays a placeholder until F09, so its
 * templates are declared but never selected). Deliberately small: a menu nobody can hold in
 * their head is a menu the model picks from at random.
 */
export const ENCOUNTER_TEMPLATES: readonly EncounterTemplate[] = [
  // --- skill challenges: the workhorse, and the shape a rescue route usually takes ---
  {
    key: 'chase',
    kind: 'skill_challenge',
    shape: 'a pursuit where ground is lost on every failure and the quarry is always a step ahead',
    params: { needed_successes: 3, max_failures: 2, escalating: true },
    twists: ['terrain', 'timer'],
  },
  {
    key: 'infiltration',
    kind: 'skill_challenge',
    shape: 'getting somewhere unseen, where noise accumulates and a failure raises the alarm level',
    params: { needed_successes: 3, max_failures: 2, escalating: false },
    twists: ['timer', 'secondary_objective'],
  },
  {
    key: 'ritual',
    kind: 'skill_challenge',
    shape: 'sustaining or disrupting something that takes time, where interruptions cost progress',
    params: { needed_successes: 4, max_failures: 2, escalating: false },
    twists: ['timer', 'moral_choice'],
  },
  {
    key: 'endurance',
    kind: 'skill_challenge',
    shape: 'surviving a hostile stretch - cold, depth, pressure - where the environment is the antagonist',
    params: { needed_successes: 3, max_failures: 3, escalating: true },
    twists: ['terrain', 'secondary_objective'],
  },
  {
    key: 'investigation_sweep',
    kind: 'skill_challenge',
    shape: 'searching a place thoroughly before something forces the party to leave it',
    params: { needed_successes: 2, max_failures: 2, escalating: false },
    twists: ['timer', 'secondary_objective'],
  },
  // --- social: the pillar the Sunken Chapel guide could not host at all ---
  {
    key: 'interrogation',
    kind: 'social',
    shape: 'prying something out of someone who has a reason not to say it',
    params: { exchange_limit: 6 },
    twists: ['moral_choice', 'timer'],
  },
  {
    key: 'negotiation',
    kind: 'social',
    shape: 'trading something for something, where both sides have a walk-away point',
    params: { exchange_limit: 6 },
    twists: ['moral_choice', 'secondary_objective'],
  },
  {
    key: 'rally',
    kind: 'social',
    shape: 'moving frightened or hostile people to act, against their instinct to do nothing',
    params: { exchange_limit: 5 },
    twists: ['timer', 'moral_choice'],
  },
  {
    key: 'deception',
    kind: 'social',
    shape: 'passing as something the party is not, where each question risks the mask',
    params: { exchange_limit: 5 },
    twists: ['secondary_objective', 'timer'],
  },
  // --- puzzles ---
  {
    key: 'mechanism',
    kind: 'puzzle',
    shape: 'a physical device whose logic must be worked out from what it does',
    params: { max_attempts: 3 },
    twists: ['timer', 'terrain'],
  },
  {
    key: 'riddle_lock',
    kind: 'puzzle',
    shape: 'a barrier that opens to the right answer, with the answer recoverable from the fiction',
    params: { max_attempts: 3 },
    twists: ['secondary_objective', 'moral_choice'],
  },
  {
    key: 'environmental',
    kind: 'puzzle',
    shape: 'a place that must be reshaped - water, light, weight - rather than answered',
    params: { max_attempts: 4 },
    twists: ['terrain', 'timer'],
  },
  // --- combat: declared for F09; the placeholder engine never selects these yet ---
  {
    key: 'ambush',
    kind: 'combat',
    shape: 'a fight the party did not choose, opening from a disadvantage',
    params: {},
    twists: ['terrain', 'timer'],
  },
  {
    key: 'holdout',
    kind: 'combat',
    shape: 'holding a position for a set time against numbers',
    params: {},
    twists: ['timer', 'secondary_objective'],
  },
] as const

export function templatesForKind(kind: TemplateKind): EncounterTemplate[] {
  return ENCOUNTER_TEMPLATES.filter((t) => t.kind === kind)
}

export function templateByKey(key: string): EncounterTemplate | null {
  return ENCOUNTER_TEMPLATES.find((t) => t.key === key) ?? null
}

/**
 * Menu for a schema enum, minus templates used recently. Anti-repeat is the variety half of
 * the anti-generic answer: the same shape twice running reads as a system with one idea, and
 * `recentEncounterKinds` already proved kind-level variety is not enough on its own.
 */
export function templateMenu(kind: TemplateKind, recentKeys: readonly string[] = []): string[] {
  const all = templatesForKind(kind)
  if (all.length === 0) return []
  const fresh = all.filter((t) => !recentKeys.includes(t.key))
  // Never return empty: exhausting the menu means repeat is unavoidable, and a beat with no
  // template is worse than a repeated one.
  return (fresh.length > 0 ? fresh : all).map((t) => t.key)
}

/**
 * Picks deterministically when no LLM is in the loop (the guaranteed route at guide time, and
 * the demo path). `seed` is any stable string - the objective id - so the same objective keeps
 * the same rescue shape across regenerations, and different objectives get different ones.
 */
export function pickTemplate(kind: TemplateKind, seed: string): EncounterTemplate | null {
  const options = templatesForKind(kind)
  if (options.length === 0) return null
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return options[Math.abs(h) % options.length]
}

/** The instruction fragment a designer/narrator gets for a chosen template. */
export function templateGuidance(template: EncounterTemplate, twist: TwistAxis): string {
  const twistText: Record<TwistAxis, string> = {
    timer: 'something runs out while they work - name it and make its progress visible',
    terrain: 'the place itself fights them - name the specific feature that does',
    moral_choice: 'succeeding fully costs something they would rather not give up - name it',
    secondary_objective: 'something else is worth grabbing on the way, and reaching for it risks the main goal',
  }
  return `Shape: ${template.shape}. Twist (${twist}): ${twistText[twist]}.`
}
