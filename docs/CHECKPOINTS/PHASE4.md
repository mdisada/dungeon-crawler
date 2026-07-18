=== CHECKPOINT: F05 + F06 — Lobby, Session Lifecycle & Live-Play Frontend (Phase 4) ===

BUILT:

- **Migrations (applied live; CI still re-applies from scratch):**
  - `20260718110000_create_adventure_members.sql` — `adventure_members` (role/character/ready/
    spectator, client-READ-only), security-definer `is_adventure_member`/`is_adventure_dm`
    helpers, `characters.locked_adventure_id` + party read policy, `adventures` gains
    `invite_code` (16-char URL-safe, regenerable), `title`, `party_profile`, `demo`; the
    `member_adventures` security-definer view (member-safe columns only — players never select
    `adventures` raw, so plot_idea/meta_loop stay creator-side); member read policies on
    adventure-media + character-image storage; new private `music` bucket (DM write, member read).
  - `20260718110100_create_sessions_state.sql` — `sessions`, `checkpoints` (auto/manual, last
    20 autos kept), `session_summaries`, `adventure_state` (jsonb GameState + `state_version`,
    service-role-writes-only, select DM-only), append-only `event_log`.
  - `20260718110200_realtime_authorization.sql` — private-channel policies on
    `realtime.messages`: `game:{id}` member receive, `dm:{id}` DM receive, `lobby:{id}` member
    presence send+receive; malformed topics fail closed.
  - (Also shipped the stray Phase 3b `20260718100000_add_npc_stat_block.sql`, which had been
    authored but never pushed.)
- **GameState contract in `packages/rules/src/state/`** (canonical; mirrored to
  `supabase/functions/_shared/state/` — the sync script + CI check now cover both mirrors):
  typed domains (scene/dialogue/combat/players/objectives/session/dm), RFC-7386-style
  merge-patch `applyDiff` shared verbatim by server and clients, stable-stringify + FNV-1a
  `hashState` for checkpoint/resync identity, `validateMove`/`moveDiff` (bounds, obstacles,
  occupancy, controller, turn, Chebyshev movement budget; DM moves free), deterministic
  `computePartyProfile` (skills/tools/classes union + pillar strengths), and the scripted
  9-step demo walk (narration → roleplay → battle → victory → downtime) as `buildDemoScript`.
- **`session` edge function (deployed)** — the Session Manager and Phase 4's single writer.
  Actions: `activate` (creator membership + title derivation + state bootstrap), `join`
  (invite code, capacity cap excluding the DM, spectator when a session is live),
  `pick_character` (atomic lock — one character, one active adventure), `ready`, `admit`,
  `leave` (unlocks), `regen_invite`, `start_session` (server-side min-ready-players gate,
  session row, first-session pass = party profile + coop affinity binding via the F04
  `bindCoopSet`, recap, start checkpoint), `end_session` (final checkpoint, Summarizer job,
  end card with XP 0 + creator-only cost), `checkpoint`/`restore_checkpoint` (players get a
  resync signal), `resync` (role-filtered: `dm` domain stripped for players), `move_intent`
  (server-validated, committed diff broadcast, snap-back on rejection), `set_scene` (Immersion
  tab: background XOR map + music), `demo_step` (drives the scripted walk; auto-checkpoints on
  mode transitions). Every state write is optimistic-locked on `state_version` and fans out
  per-domain diffs (`game:` vs `dm:` channels). Recap uses the `narrator` role, summaries the
  `summarizer` role; `demo=true` adventures use canned text (zero spend), and LLM failure
  never blocks start/end (graceful fallback).
- **Frontend `features/play/`** at `/adventures/:id/play` (+ `/join/:code`): full-screen play
  layout — header (in-game day, title/session, connection dot, volume popover with
  narration/music/sfx sliders + mute, audio-unlock affordance), lobby modal over the dimmed
  table (presence dots, character pick with lock/level-warning handling, ready flow, DM invite
  link copy/regenerate, gated Start Session button mirroring the server rule), three renderers
  switched purely on `scene.mode` (narration: Ken Burns background + timed sentence-reveal
  subtitles + scroll-up history; roleplay: VN layout with side-staged half-body portraits,
  speaker dimming, name-plate text box, PC thumbnails, disabled Say/Do/Roll row until F07;
  battle: pan/zoom 32x32 map, controller-gated draggable tokens with optimistic move +
  snap-back, movement-range highlight, initiative ribbon, turn banner with economy pips,
  condition badges, obstacle shading, keyboard arrow-move for a11y; downtime: parchment log),
  fx layer (floating damage/heal numbers, banners), player sidebar (current objective header;
  Ability & Skills / Combat / Background tabs with auto-switch to Combat in battle; persistent
  character strip with HP bar — sheet derived live from `@rules/character` + SRD rows), DM
  sidebar (Overview: objectives checklist incl. hidden, player status, spectator admit,
  checkpoint/restore with confirm, demo driver button, session log; Combat: read-only
  initiative/HP/conditions; Dice: local NdM+K bar with advantage; Immersion:
  background/map/music pickers driving `set_scene`; docked proposal-tray scaffold), session-end
  summary card, reconnect resync + version-gap resync, spectator banner state. Home page now
  lists your adventures (member view) with status chips; the guide page's Start Adventure CTA
  now activates + opens the lobby on a valid guide.
- **SEED_DEMO:** `supabase/seed/seed-demo-adventure.mjs` (fixture guide content incl. a mapped
  location and trap-worded hidden descriptions; `demo=true`) + the existing demo characters
  seeder — both run against the live project for your account, so a ready-to-walk demo
  adventure is waiting on Home.
- **Deviations from spec (nothing silent):**
  - F06 SS6 names Zustand for the client store; per the standing no-Zustand decision the play
    page uses a page-scoped context + the same shared `applyDiffs` the server runs.
  - F05 SS3's first-session pass applies coop bindings/profile directly instead of as DM
    proposals (proposal tray is F07, Phase 5); the backstory-hook/interlock LLM half of the
    Hook Weaver pass is deferred to Phase 6 (F08 SS6) — `backstoryTags` stays empty.
  - F05 SS4.2's 10-minute auto-checkpoint has no serverless timer home until F07's loop;
    auto-checkpoints currently fire on scene-mode transitions and session start/end.
  - F05 SS5 disconnect handling (combat turn auto-delay, AI-play offer) needs real combat
    turns — Phase 5/7. Presence loss already does not remove members.
  - Adventure-completion character unlock has no trigger yet (nothing completes adventures
    before F08); leave/unlock works.
  - Player sidebar: skill tap-to-roll, attacks/spells detail, and AC derivation are stubs
    pending F07/F09/F11; DM Combat tab is read-only until F09.
  - `adventures.title` is a new column no spec defined (nothing had a display title);
    derived from chapter 1 at activation, creator-editable later.

AI TESTS:

- `packages/rules`: **137/137 pass** (`tsc --noEmit` clean) — new state suite: merge-patch
  semantics (recursive merge, array replace, null delete), nullable-domain clears, scripted
  mode-transition sequences, two-client hash convergence, move validation (in-range cost,
  out-of-bounds/obstacle/occupied/not-your-token/off-turn/over-budget rejections, DM
  free-move), moveDiff commit + budget decrement, party profile (union/dedupe, pillar scoring,
  deterministic late-joiner recompute, empty-party), demo script (mode walk, token spawns +
  initiative, background XOR map on battle end, objective progression, determinism).
- `frontend`: `tsc -b` 0 errors, `eslint .` 0 errors, `npm run build` clean, **39/39 tests**
  — new renderer suite drives the real scripted diff sequences through the actual components
  (narration bg + line, VN name plates, battle tokens/ribbon/banner, controller gating incl.
  DM-can-drag-all, combat-clear → downtime) plus dice parser/roller bounds.
- **`tests/integration/session-live.mjs` — 43/43 checks PASS against the deployed function +
  live DB**: activate; join capacity cap (2nd player rejected at max_players=1, DM excluded);
  bogus invite 404; membership RLS (member reads, non-member zero rows, forged
  insert/update denied, `adventure_state` select denied to players); character locking (lock
  set, same character refused in a second active adventure, leave unlocks); ready-without-
  character rejected; min-player start gate; player-cannot-start/checkpoint; first-session
  party profile written; **DM isolation** (player resync `dm: null`, hidden-description trap
  words absent from the full player payload, hidden objectives invisible, non-member resync
  404, player denied on `dm:{id}` channel, non-member denied on `game:{id}`); member receives
  `state_diff` broadcasts from the demo driver; **checkpoint restore reproduces
  byte-identical state (stable-stringify equality) with `state_version` still advancing**;
  session end persists a summary. Throwaway users, self-cleaning.
- Migrations `20260718110000-110200` applied live (`db push`; schema verified by query);
  `session` function deployed via `--use-api`; `sync-guide-shared.mjs --check` green for both
  mirrors; demo adventure + demo characters seeded live for your account.

COULD NOT VERIFY:

- **True multi-client feel** — two real browsers/devices staying in sync through all modes
  (the integration suite proves the transport + isolation, not the experience).
- **The three renderers' look & feel** — VN portrait staging, Ken Burns pacing, map
  pan/zoom/drag ergonomics, drawer behavior < 1024px. This phase's design review is the big
  visual one; these layouts are last-cheap to change now.
- Phone (especially iOS Safari) rendering + the audio-unlock gesture; music playback needs a
  real uploaded file (bucket is ready, none uploaded).
- Presence latency on real networks (< 2s criterion) — verified only same-machine.
- Lobby with a genuinely full party (4 players), and late-join spectator → admit mid-battle
  UX (server flow is tested; the human feel isn't).
- No Deno-level typecheck of the edge function (no local Deno, per the Phase 1 decision) —
  the API bundler accepted it and the 43-check live suite exercised every action.
- Recap/summarizer prose quality on a real (non-demo) adventure — demo uses canned text; a
  real run costs ~$0.001-0.01 per session boundary.

YOUR TESTS:

- [ ] Home shows "Demo: The Hollowbrook Vanishings" — open it, hit **Start Adventure** (guide
      page) and confirm the lobby modal appears over the dimmed table.
- [ ] Pick a demo character, toggle **Ready**, hit **Start Session** — recap narration renders
      over the background with the timed subtitle reveal.
- [ ] **Two-browser test (task 1):** join from a second account via the invite link, watch the
      presence dot go green in the first browser (< 2s?), pick + ready, and confirm Start
      only unblocks at min players.
- [ ] Walk the demo with **Demo: next step** (DM sidebar, Overview) through all 9 steps:
      narration → roleplay (portraits swap sides, speaker dims) → battle (map + tokens +
      initiative + turn banner + "Roll initiative!" banner) → victory → downtime. Both
      browsers should track every step without refreshing.
- [ ] In battle: drag your own token inside the highlighted range (it commits), then onto a
      red obstacle square or past your movement (snap-back + reason toast). As DM, drag any
      token. Try arrow keys on a focused token.
- [ ] DM Overview: objectives list shows the hidden one in italics (and the player's sidebar
      does NOT); create a **Checkpoint**, advance a demo step, **Restore** it — confirm the
      confirm-step, and that the player view snaps back too.
- [ ] Player sidebar: tabs auto-switch to Combat when battle starts and back after; check the
      derived sheet numbers (saves/skills/mods) against the demo character; HP strip renders.
- [ ] Dice tab: roll `2d6+3`, flip advantage/disadvantage, confirm bounds and history.
- [ ] Immersion tab: flip background ↔ map (both clients follow); upload an mp3 to Storage
      `music/{adventure-id}/` in Studio, hit Play, test the volume popover + mute and the
      "Enable audio" unlock if it appears.
- [ ] End the session — the summary card shows on both clients (XP 0, cost only for you);
      dismissing lands back in the lobby.
- [ ] Try picking the same character in a second active adventure (create/activate another,
      or trust the red error) — expect the "locked to another adventure" rejection. Then
      leave with the second account and confirm its character unlocks.
- [ ] **Phone test (task 2):** open the play page on your phone — renderers, the sidebar
      drawer button, and the audio unlock gesture.
- [ ] DM: regenerate the invite link ("New link") and confirm the old URL now fails.

YOUR TASKS:

- [ ] A second account (or a friend) for the two-browser lobby/sync test — multi-device
      testing is on the standing "only you can do this" list.
- [ ] Phone testing (iOS Safari especially, if available).
- [ ] Optional: drop 1-2 CC0/licensed music files into Storage `music/{demo-adventure-id}/`
      so the music layer test is real.

DESIGN REVIEW:

- [ ] **VN layout (last-cheap here):** portrait staging left/right with active-speaker
      scale+dim, name plate on the text box, PC thumbnails along the bottom — approved, or
      reposition before Phase 5 builds dialogue on top of it?
- [ ] **Map usability:** wheel-zoom centered on cursor + drag-pan + drag-to-move tokens with
      snap-back — right feel? Token size (1 cell) and range highlight readable at your
      resolution?
- [ ] **Sidebar density:** player tabs and DM Overview both pack a lot — anything the header
      should surface instead (e.g. current objective on the DM side), anything to drop?
- [ ] **Full-screen play:** the play page covers the navbar entirely (immersive fixed layout;
      leaving is via Home links in error states / ending the session). OK, or do you want a
      persistent exit affordance in the header?

GATE: reply PASS / PASS WITH NOTES / CHANGES
