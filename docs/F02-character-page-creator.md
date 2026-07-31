# F2 — Character Page & Creator

**Depends on:** F1
**Depended on by:** F5 (character selection), F6 (sidebar), F9 (combat stats), F10 (roleplay portraits)

## 1. Purpose

Create, view, and edit player characters following SRD 5.2.1 rules, with a freeform uniqueness layer and a generated image set (original → background-removed base → map token / half-body portrait).

## 2. Routes & layout

- `/characters` — **Character Select.** Right sidebar: scrollable list of the user's characters (avatar + name + class/level) + "New Character" button. Main panel: overview of the selected character (statistics, background, portrait, "Edit" button).
- `/characters/new` and `/characters/:id/edit` — **Character Creator** (full-page wizard). Editing loads the saved draft into the same wizard.

## 3. Creator wizard steps

State machine; progress bar; every step persists to a `draft` jsonb column so users can resume.

1. **Race** — dropdown from `srd_races`; Size/Speed summary line + remaining traits read-only below the picker.
2. **Class & skills** — dropdown from `srd_classes`; shows hit die, saving throws, and the parsed Core Traits rows (primary ability, weapon/armor training). The class's **skill proficiency choices are made here** (checkbox cards with one-line skill descriptions, limited to the allowed count; "Choose any N" classes offer all 18 skills). v1: level 1 start only (adventure can grant starting level later via Progression Engine). *(Revised 2026-07-17: skills moved here from the old "Skills & equipment" step — choosing skills right after the class is more natural.)*
3. **Ability scores** — method toggle: Standard Array (default, pre-assigned in descending order so the step starts valid; picking a value swaps it with the ability holding it), Point Buy (validated), Manual (free with warning badge "unbalanced"). These set the six **base** scores. Ability-score *bonuses* are applied by the active ruleset (see step 4 for `srd-5.2.1`), and the final score is shown as `15 (+2)`.
4. **Background** — SRD background dropdown → detail cards for skill proficiencies (with one-line descriptions), tool proficiency, and the **Origin feat with its full benefits text** (from `srd_feats`; feat *mechanics* remain out of v1 scope), plus (in `srd-5.2.1`) the **ability-score increase**: the background lists three abilities; the player assigns **+2 / +1** or **+1 / +1 / +1** among them (validated). If a background-granted skill collides with a class pick, the player picks a replacement skill (SRD 2024 rule).

   > **Ruleset note.** In the 2024 SRD 5.2.1 data this project ingested, **species grant no ability-score increase** — the increase comes from the background (above). The older "racial bonus" model belongs to a different ruleset. The wizard reads the ASI source from the character's `ruleset` (default `srd-5.2.1`); other rulesets can be added later (see §9) without changing the step flow. See `docs/DECISIONS.md` (2026-07-17, "F2 build").
5. **Equipment** — starting-equipment choices, one radio group per source: the class's options (A/B/C from its Core Traits) and the background's options (A/B). *(Revised 2026-07-17: equipment got its own step when skills moved into the class step.)*
6. **Personality & description** — alignment picker; suggestion chips (quirks / history hooks / appearance notes, incl. race-specific ones) that append into the **freeform textarea** ("Anything that makes this character unique"); structured physical fields (age, height, hair, eyes) **pre-rolled randomly from race-appropriate ranges** (elf/dwarf lifespans ≠ human, per-race height and hair/eye palettes) with a "Randomize for race" reroll, all editable; **voice choice** — default narrator voice or a custom uploaded audio clip (stored with the character now; actual voice cloning lands with the F12 audio pipeline, Phase 3).
7. **Portrait** — see §4.
8. **Review & save** — computed sheet preview (AC, HP, saves, skill modifiers — all via Progression/Check engine functions, never duplicated in UI code); Save → Supabase.

Derived stats are computed by shared TypeScript functions in `packages/rules` (same code the engines use) so sheet math has one implementation.

## 4. Portrait pipeline

Revised 2026-07-17 per Phase 2 review: auto-generate + iterative edit + single-crop derivation.
Revised again 2026-07-31: the crops come off a background-removed cutout, and `avatar` is gone.

The set is a chain — `original` → `base` → {`portrait`, `token`} — so the cutout runs once per
generation and everything downstream is a crop of it.

1. **Auto-generate on step entry:** the wizard already holds the full description by this step, so the first portrait generates automatically from an assembled prompt (race, class, background, physical fields, freeform text) — no button press. `kind: image` (the account's default image model, Krea 2 Medium Turbo), 9:16 full-body. Later image-to-image edits of that portrait pin Nano Banana 2 Lite, since they send the current image as a reference.
2. **Iterative editing:** below the generated image, a text box ("describe a change") sends the **current image + edit text** back through the images endpoint as an image-to-image edit (`input_references`). "Regenerate from scratch" re-runs step 1. The result is stored as **`original`**, and a new original clears the crops derived from the previous one.
3. **Background removal:** `original` → **`base`**, a transparent-background cutout produced in the browser by `features/characters/chroma-key.ts` — colour keying, no model, ~150 ms. The prompt asks for a flat chroma-green backdrop precisely so this is arithmetic rather than inference; the keyer decides at subpixel resolution on disputed pixels, un-mixes the edge and de-spills the rim. A failed or unkeyable cutout is surfaced but not fatal — the crop tool falls back to `original`.
4. **Single-crop derivation:** the user frames **only the token** (head/face) in a pan/zoom circle mask, cropping `base`. Because the token rect tells us where the head is, the client derives the other crop from it — **half-body portrait** 768×1024 (3:4, head in the upper fifth, extending down the torso), transparent. The **token** 256×256 is the same rect over a flat fill the player picks; the colour is baked into the PNG and kept in `images.tokenBackground` so it can be re-baked from `base`.
5. **Testing mode:** placeholder assets (`/placeholders/{avatar|token|portrait|fullbody}.png`) injected when image gen disabled by env flag (`VITE_PLACEHOLDER_MEDIA`); placeholder runs skip background removal.

## 5. Data model

```text
characters:
  id, user_id, name, race, class, level int default 1, alignment,
  ruleset text not null default 'srd-5.2.1',         -- edition the char was authored under (§9)
  abilities jsonb {str,dex,con,int,wis,cha},         -- BASE scores, pre-ASI (source of truth)
  ability_bonuses jsonb {str,dex,...},               -- the chosen ASI assignment (from background in srd-5.2.1)
  background_id, skill_proficiencies text[], tool_proficiencies text[],
  equipment jsonb[],                                 -- item refs + custom items (records the A/B pick)
  hp_max, hp_current, hp_temp, xp int default 0,
  personality jsonb {traits, ideals, bonds, flaws},
  freeform_text text,                                -- the uniqueness textbox
  physical jsonb {age,height,hair,eyes,description},
  voice jsonb {source: default|clip, clipPath},      -- narration voice choice; cloning is F12 (Phase 3)
  background_narrative text,                         -- generated: merges freeform + physical into prose (LLM, user-editable)
  images jsonb {originalUrl, baseUrl, portraitUrl, tokenUrl, tokenBackground},  -- pre-2026-07-31 rows also carry fullbodyUrl/avatarUrl
  persistent_conditions jsonb[],                     -- curses, exhaustion (survive sessions)
  draft jsonb, is_complete boolean, created_at, updated_at

srd_races / srd_classes / srd_backgrounds / srd_items / srd_spells / srd_feats:
  seeded from SRD 5.2.1 JSON at migration time; read-only.
```

Storage: `characters/{character_id}/{original|base|portrait|token}.png` (+ `history/`,
`voice-sample.*` for the uploaded voice clip).

**`background_narrative`:** on save, a one-shot LLM call (agent_role `user_direct`) merges freeform text + physical description + mechanical background into 2–3 paragraphs. Shown in the Background tab in play and fed to agents as the character's identity context. User can edit or regenerate.

## 6. Character overview panel

Header: portrait, name, race/class/level/alignment. Body: ability block with modifiers, HP/AC, skills, equipment list, background narrative, image set thumbnails. Footer: Edit, Duplicate, Delete (confirm dialog; blocked if character is locked into an active adventure — see F5).

## 7. Acceptance criteria

- [ ] A complete SRD-legal level-1 character can be created start-to-finish in < 5 min with no free-text required except a name.
- [ ] Point Buy validation rejects illegal spends; Standard Array prevents duplicates.
- [ ] Derived stats (AC, HP, save/skill mods) match SRD hand-calculated fixtures (unit tests in `packages/rules`).
- [ ] Both crops export at correct dimensions and render correctly in their UI targets (32px map tile, VN portrait), and the token's chosen fill is visible behind the cutout.
- [ ] Draft resume works across sessions/devices.
- [ ] Placeholder mode functions with image gen disabled.

## 8. Open questions

- Multiclassing: out of scope v1 (single class).
- Custom homebrew races/classes: out of scope v1; schema's jsonb traits leave the door open.

## 9. Ruleset portability & NPC structure (design seams — v1 builds the seam, not the extras)

**Ruleset.** A character is not tied to one rules edition. `characters.ruleset` records the edition
it was authored under (default `srd-5.2.1`, matching the SRD tables' `source` column). Derived stats
(AC, HP, saves, skill mods, ASI application) are **never frozen into the row** — they are recomputed
on demand by the `packages/rules` functions, which take a `ruleset` argument. The row therefore
stores the **raw authoring choices** (base scores, chosen ASI assignment, species/background/class
keys, chosen proficiencies, equipment picks) — enough to re-derive the sheet under a different
ruleset. This lets a character be taken into an adventure that runs a different rules source and be
recomputed rather than migrated. v1 implements only `srd-5.2.1`; the eventual **F03 adventure wizard
exposes ruleset selection**, and adventures may each carry different rules/data. Cross-ruleset
re-derivation may surface gaps (e.g. a future 2014-style ruleset that expects racial ASI where the
character has none) — the stored shape must not foreclose adding those rulesets, but resolving them
is future work.

**NPCs.** NPCs reuse this same character/statblock shape so they can be **combat-ready** (F09) and,
when the adventure allows, **playable** (F05/F06). An NPC is a character-shaped record with the same
abilities / HP / AC / skills / equipment / images fields, re-derivable via the same `packages/rules`
functions, distinguished by an owner/kind marker (e.g. `is_npc` / `controlled_by` = the AI/DM rather
than a player user_id).

**Built in F04 (Phase 3b): the lightweight NPC combat block.** `npcs.stat_block` (F04 §5.2) is the
first cut of this seam. Rather than the full PC authoring surface (class, spells, equipment picks),
an NPC carries a combat *archetype* + challenge rating, and
`packages/rules/src/guide/npc-stats.ts` (`deriveNpcStatBlock`) derives the same combat-relevant
numbers a character sheet exposes — abilities, AC, HP, proficiency bonus, save/skill modifiers, a
signature attack — with the same ruleset-invariant 5e math as `character/character-math.ts` (the
formulas are re-declared there because the guide module is mirrored into the edge bundle, which
doesn't get the character module). Fuller parity (equipment, spells, playable NPCs, `controlled_by`)
remains **future work for F07/F09/F10**; this keeps NPCs in the same statblock shape without
front-loading the whole character surface.
