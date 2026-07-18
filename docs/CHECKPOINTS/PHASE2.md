=== CHECKPOINT: F02 — Character Page & Creator ===

BUILT:

- SRD data layer: `srd_races` (9 species) + `srd_backgrounds` (4 backgrounds — Acolyte, Criminal,
  Sage, Soldier; this is all the free Open5e SRD 5.2.1 content contains) migrated, seeded, and
  applied live. `srd_weapons`/`srd_armor` (flagged "not yet applied" at the end of Phase 0) also
  landed as part of this push.
- `characters` table + owner-only RLS (select/insert/update/delete) + a private `characters`
  Storage bucket with owner-scoped policies, migrated and applied live.
- First real `packages/rules` engine: `character/abilities.ts`, `ability-generation.ts`,
  `character-math.ts` (proficiency bonus, AC, HP, saving throws, skill modifiers) — 36 tests
  passing, including 3 hand-calculated golden fixtures (Fighter+Soldier, Wizard+Sage,
  Rogue+Criminal) covering both background ASI split types. CI's `rules` job now runs typecheck +
  test instead of just `npm ci` (this was pre-flagged in the Phase 0 gate as the exact trigger for
  this change — "add both once the first engine lands" — but it is a `.github/workflows/ci.yml`
  edit, flagging per CLAUDE.md's CI-file rule rather than treating that prior sign-off as blanket).
- `frontend/src/features/characters/`: Character Select (`/characters`, `/characters/:id`) with a
  sidebar + overview panel; full 8-step Creator wizard (`/characters/new`,
  `/characters/:id/edit`) with autosave-to-draft (debounced, resumes on reload); a pan/zoom crop
  tool (Avatar 256x256, Token 256x256, Half-body Portrait 768x1024); Edit/Duplicate/Delete
  (confirm dialog).
- Two new shared UI primitives (`components/ui/dialog.tsx`, `progress.tsx`), wrapping
  `@base-ui/react` the same way `select.tsx`/`tabs.tsx` already do.
- Placeholder media: 4 real PNGs at `frontend/public/placeholders/{fullbody,avatar,token,
  portrait}.png` at spec-correct dimensions, gated by `VITE_PLACEHOLDER_MEDIA` (set `true` in
  `.env.local`) — required from Phase 2 onward per `DEVELOPMENT-PLAN.md` §1.3.
- `supabase/seed/seed-demo-characters.mjs` + 2 demo characters (Kaelen Ashford — Human Fighter/
  Soldier; Wren Nightingale — Elf Wizard/Sage) seeded live for your account, so there's always
  something to test against.
- `tests/integration/rls-characters.mjs` (new, mirrors `rls-cross-user.mjs`'s pattern).

Deviations from spec (flagged, not silent):

- **Ability-score model changed from spec (2024 SRD, not 2014).** Resolved with you at the start
  of this build — see `docs/DECISIONS.md` 2026-07-17 "F2 build" and the updated
  `docs/F02-character-page-creator.md` §3. Species grant no ability bonus; backgrounds grant
  +2/+1 or +1/+1/+1. A `ruleset` seam was added (`characters.ruleset`, `packages/rules` functions
  take a `ruleset` param) but only `srd-5.2.1` is implemented.
- **Class skill-choice/equipment lists are best-effort parsed from SRD prose**, not structured
  fields — Open5e embeds them in a markdown table inside each class's "Core `<Class>` Traits"
  feature. 11 of 12 base classes have this feature; **Cleric does not** (a real gap in the seeded
  data, not a parsing bug — verified against the raw API response). The wizard falls back to
  "not available, choose manually" messaging for Cleric.
- **`equipment` column stores the choice reference, not resolved items.** Starting equipment is
  offered as background-granted A/B prose choices (and class A/B/C choices where parseable), and
  the character row stores which letter was picked (`[{ source: 'background', choice: 'A' }]`),
  not an itemized inventory resolved against `srd_items`/`srd_weapons`/`srd_armor`.
- **Portrait Storage is private + signed-URL, not public.** Images are stored as paths and
  resolved to short-lived (1hr) signed URLs at render time via `useCharacterImageUrl` — more
  correct for owner-only content than a public bucket, but wasn't explicitly asked for; flagging
  the choice.
- **Duplicate Character copies image references, not Storage objects** — a duplicated character
  points at the same Storage paths as the original until its own portraits are regenerated/
  re-cropped (noted in `api/duplicate-character.ts`).
- **Crop tool has no pan/zoom clamping** — you can zoom below "cover" scale or pan the image fully
  out of frame; a simplification, not a bug, given the time budget.
- Root CLAUDE.md's `frontend/CLAUDE.md` "No routing yet" note is stale (F01 already added
  `react-router-dom` + `/settings`); `/characters` routes were added the same way.

AI TESTS:

- `packages/rules`: `npm run typecheck` (0 errors), `npm test` — 36/36 pass (2 suites: golden
  fixtures + ability-generation edge cases — Standard Array duplicate rejection, Point Buy
  over/under-budget rejection, background ASI split validation for both the +2/+1 and +1/+1/+1
  shapes and their invalid variants).
- `frontend`: `npx tsc -b` (0 errors), `npx eslint .` (0 errors — including fixing several
  `react-hooks/set-state-in-effect` and "ref accessed during render" violations this project's
  stricter React Compiler lint rules caught in my first draft of the new hooks; the fixed
  versions use discriminated-union state initialized via `useState`'s initial value, matching the
  existing `useUserSettings` pattern), `npm run test` — 11/11 pass (pre-existing suite; **no new
  component tests were added for the wizard/crop tool** — see COULD NOT VERIFY), `npm run build`
  clean (production build succeeds).
- Migrations: `supabase db push --dry-run` clean before each apply; applied live; verified via a
  live SQL query in Studio: `srd_races` = 9, `srd_backgrounds` = 4, `srd_weapons` = 77,
  `srd_armor` = 25, `characters` table exists (0 rows before seeding).
- `tests/integration/rls-characters.mjs` — PASS. Two throwaway users via the Admin API: user A's
  insert succeeds and is readable by A; user B's select/update/delete of A's character each
  affect zero rows; B's attempt to insert a character claiming `user_id = A` is rejected; A's row
  is confirmed unmodified afterward.
- Demo character seeding verified live: both rows exist with correct race/class/background
  foreign keys and HP that matches `packages/rules` math by hand (Kaelen: D10 + Con 14 (+2) = 12;
  Wren: D6 + Con 13 (+1) = 7).

COULD NOT VERIFY:

- No RTL/component tests were written for the new wizard steps, crop tool, or overview panel —
  only `packages/rules`' engine math has test coverage. This is a real gap, not an oversight I'm
  hiding: flagging so you can weigh it against Phase 2's time budget.
- Real image generation — everything above was built and tested with
  `VITE_PLACEHOLDER_MEDIA=true`, per your "Placeholder-first" answer. The `ai-proxy kind: image`
  request/response handling is wired against the documented OpenRouter contract but has not been
  exercised against a real model.
- Crop tool ergonomics (pan/zoom feel, whether the canvas math is pixel-correct end-to-end in a
  real browser) — verified by code review and the math the "Set" button runs, not by driving it
  myself in a browser.
- Whether the 8-step wizard feels long or any two steps are merge candidates — a taste call
  `DEVELOPMENT-PLAN.md` explicitly reserves for you at this phase.
- Whether the best-effort prose-parsed skill/equipment lists read correctly for every one of the
  11 classes that have them — I spot-checked Fighter, Wizard, and Rogue only.
- Draft resume across a real reload — the autosave/load code path was reviewed, not manually
  driven (open wizard, fill some steps, refresh, confirm state restored).

YOUR TESTS:

- [x] `npm run dev` in `frontend/`, sign in, go to `/characters` — confirm Kaelen Ashford and Wren
      Nightingale appear in the sidebar with placeholder avatars.
- [x] Click Kaelen Ashford — confirm AC 12, HP 12/12, ability scores + modifiers, skills
      (Athletics, Intimidation), and the background narrative paragraph all display.
- [x] Click "New Character" and walk the full wizard start to finish (any race/class/background) —
      confirm every step's Next button enables/disables correctly as you fill it in.
- [x] On the Portrait step, click Generate (should return instantly, no real API call), then on
      each of the 3 crop tabs drag to pan and use the zoom slider, then click Set — confirm Next
      enables only once all 3 are set.
- [x] On Review & Save, click Generate next to Background Narrative — confirm it calls the real
      ai-proxy (this spends a tiny amount of real credit) and prose appears.
- [x] Click Save Character — confirm you land on the new character's overview page.
- [x] Start a second new character, complete Race + Class, then refresh the browser tab — confirm
      the wizard resumes on the Ability Scores step rather than restarting.
- [x] From an existing character's overview, click Duplicate — confirm a "(Copy)" character
      appears in the sidebar.
- [x] From a character's overview, click Delete, confirm in the dialog — confirm it disappears
      from the sidebar.
- [x] In the wizard's Ability Scores step, try Point Buy (confirm going over 27 points blocks
      Next) and Manual (confirm the "Unbalanced" warning always shows but doesn't block Next).
- [x] In the hosted Supabase Studio, confirm a `characters` row exists with `is_complete = true`
      for the character you just saved.
- [x] Run `node tests/integration/rls-characters.mjs` from the repo root yourself and confirm it
      prints `PASS`.

YOUR TASKS:

- [x] When you're ready to judge real portrait generation quality (not required to gate this
      phase, per your "Placeholder-first" answer), tell me and I'll flip
      `VITE_PLACEHOLDER_MEDIA` off locally and confirm the estimated cost before running any real
      generations.
- [x] Confirm `mig.isada@gmail.com` is the account you want demo characters seeded against (that's
      what I used, found via the live `auth.users` table) — say if you use a different one
      day-to-day and I'll reseed.

DESIGN REVIEW:

- [x] The ability-score model is strictly 2024 SRD now (background grants +2/+1 or +1/+1/+1,
      species grants none) per your build-forward answer — does the wizard's Background step
      present this the way you pictured?
- [x] Only 4 backgrounds exist in the free SRD content (Acolyte, Criminal, Sage, Soldier). Fine to
      ship with just these 4, or do you want a 5th "Custom Background" freeform option added
      before this gates?
- [x] Cleric has no parseable skill-choice/equipment data (real gap in the source, not a bug) —
      acceptable to ship with "choose manually" messaging for that one class, or worth me
      hand-writing its table as a one-off before gating?
- [x] Is the 8-step wizard still right now that it's built, or does anything look like a merge
      candidate? (`DEVELOPMENT-PLAN.md` calls this "cheap to change now, expensive after F6.")

GATE: PASS
