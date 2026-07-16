# F3 — Adventure Creation Wizard

**Depends on:** F1
**Depended on by:** F4 (guide generation consumes wizard output), F5

## 1. Purpose
Capture the minimum creative and structural inputs needed to generate an Adventure Guide: mode, player bounds, adventure type, and a plot idea the user can iterate on with AI help.

## 2. Route & flow
`/adventures/new` — single page, four sections top-to-bottom, one primary CTA at the end ("Generate Adventure Guide"). All inputs persist to a draft row immediately (autosave, debounced 1s) so nothing is lost.

## 3. Sections

### 3.1 Mode select
Two cards, radio behavior:
- **Full-AI DM** — "The AI runs everything: narration, rulings, story progression. No human DM." Badge: lists v1 limitations (no dungeon puzzles, difficulty fixed at creation).
- **AI-Assist** — "You are the Dungeon Master. The AI drafts; you approve, edit, or override." Creator is recorded as `dm_user_id`; during play they get the DM sidebar instead of the Player sidebar.

### 3.2 Players
Min/max steppers. Constraints: `1 ≤ min ≤ max ≤ 8`. DM not counted. Helper text explains the lobby won't start below min and closes at max.

### 3.3 Adventure type
- **One-shot** — "A single self-contained adventure, told in one session."
- **Multi-chapter** — "A full campaign guided by a handful of major quests, spanning many sessions." Reveals a compact dual-range input: `Chapters: [min ▢] – [max ▢]` (bounds 2–12; single slider with two handles, shadcn). The Story Director treats this as a target range, committing the final count during generation.

### 3.4 Plot idea
- Large textarea (autosize, max ~2,000 chars).
- **Context-sensitive AI button** (right of textarea):
  - Empty → **"Generate plot"** — Story Director produces a 3–6 sentence premise (genre, hook, stakes, tone) respecting the chosen type/chapter range.
  - Non-empty → **"Improve plot"** — rewrites the user's text: sharpens hook and stakes, keeps the user's nouns and intent, similar length. Never silently replaces — result lands in the textarea as a new undo state.
- **Undo / redo** small icon buttons. Implementation: client-side snapshot stack (push on: AI generate/improve, manual blur with changes); persisted in the draft row as `plot_history jsonb[]` capped at 25 entries.
- **Previous ideas** small dropdown button: lists distinct plot texts from the user's other adventure drafts/completed adventures (`SELECT plot_idea FROM adventures WHERE user_id = ...`), click inserts (as a new undo state).

### 3.5 CTA
"Generate Adventure Guide" — validates (mode, players, type set; plot idea non-empty — if empty, prompt: "Generate a plot first, or write one"), sets `status: generating`, navigates to the Adventure Guide page (F4) which shows pipeline progress.

## 4. Data model
```
adventures:
  id, creator_id, dm_user_id?,            -- dm = creator when mode='assist'
  mode ('full_ai'|'assist'),
  min_players int, max_players int,
  type ('one_shot'|'multi_chapter'),
  chapters_min int?, chapters_max int?,   -- null for one_shot
  plot_idea text, plot_history jsonb[],
  status ('draft'|'generating'|'guide_ready'|'active'|'completed'|'archived'),
  narrator_voice_id?,                     -- set in F4
  difficulty_setting jsonb?,              -- Full-AI: fixed at creation (F9 modifier set)
  created_at, updated_at
```

## 5. LLM contracts

**Generate plot** (`agent_role: story_director`):
```
Input:  { type, chapters_min?, chapters_max?, inspiration: null }
Output: { plot: string }   // 3–6 sentences: premise, hook, stakes, tone
```

**Improve plot:**
```
Input:  { type, chapters_min?, chapters_max?, current_plot: string }
Output: { plot: string }   // preserve user's named entities and core intent
Constraint: output must retain every proper noun from input unless clearly misspelled.
```

## 6. Acceptance criteria
- [ ] Draft autosaves; reload restores all fields including undo history.
- [ ] Generate/Improve button label and behavior switch on textarea emptiness.
- [ ] Undo/redo traverses AI and manual states correctly; redo cleared on new edit.
- [ ] Previous-ideas dropdown only shows the current user's plots.
- [ ] Multi-chapter range input rejects min>max; one-shot hides chapter inputs and nulls them.
- [ ] Full-AI mode requires a difficulty selection (default "Standard") before CTA enables.

## 7. Open questions
- Genre/tone presets (chips: "grimdark", "heroic", "mystery"...) — nice-to-have, feeds Story Director; defer unless cheap.
