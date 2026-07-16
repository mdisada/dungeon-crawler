# F11 — Progression System

**Depends on:** F2 (sheets), F8 (progression loops), F9 (combat outcomes)
**Depended on by:** F8 (threshold events feed the Ingredient Pool), Encounter Budget accuracy

## 1. Purpose

All the "getting somewhere" loops: XP/leveling per SRD, loot/equipment flow, and the renown & piety systems with threshold unlocks that feed back into story content.

## 2. XP & leveling

- **Awards (Progression Engine):** combat XP = SRD monster XP ÷ party size (allied NPCs excluded from the divisor — they help, players earn), adjusted by the active difficulty modifier (Story −25%, Deadly +15%). Non-combat XP: objective completion grants a chapter-scaled award (default: milestone-equivalent, table by level & chapter weight); DM discretionary awards via console (logged).
- **Level-up:** XP threshold crossed → player sidebar badge + level-up flow at the next downtime/rest (never mid-combat): HP increase (average or roll — player choice), new class features from SRD tables auto-applied, spell selection UI where the class requires choices, ASI at SRD levels (+2/+1+1 picker; feats out of scope v1).
- Full-AI: same flow; the level-up moment is announced by the Narrator at scene boundaries.

## 3. Equipment & loot

- **Loot sources:** encounter specs carry loot tables (Encounter Designer, Budget-validated by treasure-per-CR guidance); ingredient items; NPC gifts (F10 proposed_actions); DM grants.
- **Distribution:** loot drops to a **party stash** panel (post-combat modal / downtime tab); players claim items (contested claims: DM assigns in assist; round-robin priority in full-AI). `award_item`/`remove_item` tools are the only mutation path.
- **Equipment effects:** items as data — equip slots, AC/attack/damage modifiers consumed by engines; attunement (max 3) for flagged items; consumables decrement on use.
- **Shops (downtime):** location-linked inventories (generated once per location from SRD price lists, cached); buy/sell at list/half-list; gold on the character sheet.
- **Party assets (shared-stakes resources):** items or favors flagged `party_asset: true` — the single revivify scroll, a patron's one favor per chapter, the key that opens exactly one vault. They live in the party stash (not on a sheet) and consuming one requires a **second**: the initiating player's use prompts the other players; at least one other player must confirm within 30s (DM breaks ties/deadlocks in assist; in full-AI, majority-or-timeout-defers). The friction is the point — party assets create the group decision moments where cooperation actually happens. Encounter Designer/loot tables place ~1 party asset per chapter.

## 4. Renown

```
config: { thresholds: [{score, tier_name, unlocks: [ingredient_spec|flag|access]}] }
state:  { party_score int, per_pc jsonb? }
```

- Party-level score (v1; per-PC deferred). Awards: core-loop completion (+2 backbone, +1 minor), objective completion (+3), notable public deeds tagged by the Summarizer → proposal for DM confirmation (+1, assist) / auto with cap 1/session (full-AI).
- Threshold crossing → Progression Engine emits `threshold_crossed` event → auto-instantiates the tier's unlock ingredients into the Ingredient Pool (new areas admit the party, invitations arrive, better quests surface) → Hook Weaver plants them. This is the concrete renown→story feedback line.

## 5. Piety (optional per adventure; on by default for applicable settings)

- Character opt-in: pick a deity at character-select-for-adventure time (adventure guide may define a pantheon; otherwise SRD-generic domains).
- **Award table (deterministic):** `deity_domain × action_tag → delta`. Action tags come from the Summarizer's event tagging (e.g. `mercy_shown`, `enemy_slain_in_duel`, `oath_kept`, `undead_destroyed`). Example: War domain: duel victory +2, retreat −1; Justice domain: freeing the wrongly imprisoned +2.
- Thresholds (3/10/25/50) grant SRD-safe boons (defined per domain as data: skill blessing, 1/day ability, minor magic item via the loot path). From tier 2 upward, boons are deliberately **ally-targeted** where the domain allows — a blessing castable only on someone else, a 1/day intercession that saves an ally, an aura that shields adjacent companions — so power growth is itself cooperative (min_players = 1: ally-targeted boons apply to allied NPCs). Falling piety (domain-contrary acts) can strip the top boon — proposal in assist, auto in full-AI with Narrator acknowledgment.

## 6. Personal progression loops

- Sourced from character backstories at first session (Hook Weaver pass, F5): e.g. "find the beast that killed her brother" → `progression_loops (kind: personal)` with 3–4 milestone flags.
- Milestones advance via quest flags / ingredient discovery; each advance triggers a Hook Weaver placement so personal content keeps surfacing inside whatever loop is active. Completion grants a personal reward (item, title, disposition boost) + renown.

## 7. UI surfaces

- Player sidebar: XP bar in the footer; Background tab gains Renown tier + Piety score/boons when active.
- DM sidebar Overview: party renown tier, per-PC piety glance, pending discretionary-award button.
- Level-up modal; post-combat loot modal; downtime shop panel.

## 8. Acceptance criteria

- [ ] XP awards match SRD tables across difficulty settings (fixtures); level-up applies exact SRD features for all classes at levels 1–5 (v1 supported band — raise later).
- [ ] Loot only enters sheets via award_item; attunement cap enforced.
- [ ] Renown threshold crossing instantiates unlock ingredients exactly once (idempotency test).
- [ ] Piety deltas follow the table; contrary-act boon-strip flows through proposals in assist.
- [ ] Personal loop milestones surface as hooks within 1 session of becoming reachable.
- [ ] Party asset consumption requires a second from another player; tie/timeout paths verified in both modes; asset decrements exactly once under concurrent confirm race.
- [ ] Ally-targeted boons cannot self-target (engine validation); in solo mode they target allied NPCs.

## 9. Open questions

- Supported level band at launch: 1–5 recommended (feature/spell surface area grows steeply after).
- Party vs individual renown — revisit after playtests.
