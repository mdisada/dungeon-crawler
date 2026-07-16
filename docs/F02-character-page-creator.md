# F2 — Character Page & Creator

**Depends on:** F1
**Depended on by:** F5 (character selection), F6 (sidebar), F9 (combat stats), F10 (roleplay portraits)

## 1. Purpose
Create, view, and edit player characters following SRD 5.2.1 rules, with a freeform uniqueness layer and a generated image set (full-body → avatar / map token / half-body portrait).

## 2. Routes & layout
- `/characters` — **Character Select.** Right sidebar: scrollable list of the user's characters (avatar + name + class/level) + "New Character" button. Main panel: overview of the selected character (statistics, background, portrait, "Edit" button).
- `/characters/new` and `/characters/:id/edit` — **Character Creator** (full-page wizard). Editing loads the saved draft into the same wizard.

## 3. Creator wizard steps
State machine; progress bar; every step persists to a `draft` jsonb column so users can resume.

1. **Race** — dropdown from `srd_races` (traits auto-applied, shown read-only below the picker).
2. **Class** — dropdown from `srd_classes`; shows hit die, proficiencies, level-1 features. v1: level 1 start only (adventure can grant starting level later via Progression Engine).
3. **Ability scores** — method toggle: Standard Array (default), Point Buy (validated), Manual (free with warning badge "unbalanced"). Racial bonuses applied automatically and shown as `15 (+2)`.
4. **Background** — SRD background dropdown → skill/tool proficiencies, equipment picks.
5. **Skills & equipment** — class skill choices (checkbox list limited to allowed count); starting equipment options (A/B choice lists per SRD class).
6. **Personality & description** — alignment picker; **freeform textarea** ("Anything that makes this character unique — quirks, history, appearance, voice"); structured physical fields (age, height, hair, eyes) optional.
7. **Portrait** — see §4.
8. **Review & save** — computed sheet preview (AC, HP, saves, skill modifiers — all via Progression/Check engine functions, never duplicated in UI code); Save → Supabase.

Derived stats are computed by shared TypeScript functions in `packages/rules` (same code the engines use) so sheet math has one implementation.

## 4. Portrait pipeline
1. **Prompt assembly:** structured description + freeform text + race/class/equipment → image prompt (template, user-editable before generating).
2. **Generate** button → Job Queue `kind: image` (Nano Banana 2 Lite), target aspect 9:16 full-body. Regenerate allowed; history of last 5 kept in storage.
3. **Cropping tool:** the chosen full-body image loads into a pan/zoom canvas with three fixed mask overlays selected by tab:
   - **Avatar** — 256×256 circle-safe square (UI use)
   - **Token** — square export rendered at 256×256 but designed for 32×32 grid display (crisp downscale, circular frame + class-color ring)
   - **Half-body portrait** — 768×1024 (VN roleplay layout)
   For each mask: user pans/scales, clicks "Set", client renders the crop to canvas and uploads to Storage.
4. **Testing mode:** placeholder assets (`/placeholders/{avatar|token|portrait|fullbody}.png`) injected when image gen disabled by env flag.

## 5. Data model
```
characters:
  id, user_id, name, race, class, level int default 1, alignment,
  abilities jsonb {str,dex,con,int,wis,cha},        -- base scores pre-racial
  background_id, skill_proficiencies text[], tool_proficiencies text[],
  equipment jsonb[],                                 -- item refs + custom items
  hp_max, hp_current, hp_temp, xp int default 0,
  personality jsonb {traits, ideals, bonds, flaws},
  freeform_text text,                                -- the uniqueness textbox
  physical jsonb {age,height,hair,eyes,description},
  background_narrative text,                         -- generated: merges freeform + physical into prose (LLM, user-editable)
  images jsonb {fullbody_url, avatar_url, token_url, portrait_url},
  persistent_conditions jsonb[],                     -- curses, exhaustion (survive sessions)
  draft jsonb, is_complete boolean, created_at, updated_at

srd_races / srd_classes / srd_backgrounds / srd_items / srd_spells:
  seeded from SRD 5.2.1 JSON at migration time; read-only.
```
Storage: `characters/{character_id}/{fullbody|avatar|token|portrait}.png` (+ `history/`).

**`background_narrative`:** on save, a one-shot LLM call (agent_role `user_direct`) merges freeform text + physical description + mechanical background into 2–3 paragraphs. Shown in the Background tab in play and fed to agents as the character's identity context. User can edit or regenerate.

## 6. Character overview panel
Header: portrait, name, race/class/level/alignment. Body: ability block with modifiers, HP/AC, skills, equipment list, background narrative, image set thumbnails. Footer: Edit, Duplicate, Delete (confirm dialog; blocked if character is locked into an active adventure — see F5).

## 7. Acceptance criteria
- [ ] A complete SRD-legal level-1 character can be created start-to-finish in < 5 min with no free-text required except a name.
- [ ] Point Buy validation rejects illegal spends; Standard Array prevents duplicates.
- [ ] Derived stats (AC, HP, save/skill mods) match SRD hand-calculated fixtures (unit tests in `packages/rules`).
- [ ] All three crops export at correct dimensions and render correctly in their UI targets (navbar-scale avatar, 32px map tile, VN portrait).
- [ ] Draft resume works across sessions/devices.
- [ ] Placeholder mode functions with image gen disabled.

## 8. Open questions
- Multiclassing: out of scope v1 (single class).
- Custom homebrew races/classes: out of scope v1; schema's jsonb traits leave the door open.
