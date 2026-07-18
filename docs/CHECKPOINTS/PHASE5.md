=== CHECKPOINT: F07 + F10 — Live Orchestration & Social Encounters, Full-AI-first (Phase 5) ===

BUILT:

- **Migration `20260718130000_create_orchestration.sql` (applied live):** `proposals` (F07 SS4
  shape: type/payload/options/approval_mode/status/decision/context_refs/blocking, DM-only
  select), `npc_dispositions` (per NPC per PC, -10..+10, DM-only select), `npc_interactions`
  (scene-end memory, DM-only select), `npcs.generated` flag, and a backfill patching existing
  GameState rows with the new dialogue/dm fields.
- **`packages/rules/src/play/`** (canonical; mirrored to `_shared/play` — `src/character` is
  now mirrored too for server-side skill math): deterministic Action Router (fast path never
  reaches an LLM; say splits dialogue/free-chat), Check Engine (seeded RNG, advantage, DC
  clamped 5-25 server-side, bounded social DC table with ±2 disposition adjust, SRD half-pass
  group rule, enable/bonus assist effects, prompt windows), social guardrails (disposition
  clamps + bands, opening -2/-4 sizing + self-consume block, reveal gate, conservative
  proposed-action policy), and boundary parsers for every agent output (clamped, rejecting,
  composition-guarded — an assist skill nobody has is downgraded).
- **The `session` function is now also F07's Adventure Manager** (same single-writer seat; a
  `commitDiffs` wrapper retries on optimistic-lock conflicts). New actions: `player_intent`
  (route → fast-path roll / free chat / Adjudicator flow / F10 say pipeline / `dm_command`
  world-fact overrides), `roll_pending`, `claim_assist`, `resolve_pending` (client-swept,
  server-validated deadlines — edge functions have no timers), `narrate_next` (options mode →
  auto-pick option 1 in full-AI → full narration; both stages logged as proposals),
  `start_social`, `end_encounter` (interaction memory per staged NPC), `generic_npc`,
  `decide_proposal` (assist accept/edit/reject server-side; console UI is Phase 10).
- **Proposal pipeline, one code path one flag:** every ruling, NPC reply, and narration writes
  a `proposals` row — `auto_applied` in full-AI, `pending` + dm-channel notify for assist-mode
  `needs_dm` short-circuits; stale pending proposals expire (5 min) as play moves on; the dm
  GameState domain carries a bounded read-only tray.
- **Consistency Manager (F07 SS6):** deterministic dead/absent-NPC scan first, then the
  FlashLite LLM pass (non-demo); on violation one constrained regeneration, then the minimal
  mechanical fallback + an incident event.
- **F10 say pipeline:** classifier (influence/insight/plain — plain talk never rolls), social
  DCs from the bounded table + per-PC disposition, openings (insight success → different-PC
  DC reduction, auto-consumed server-side, cooperation events logged), server-side reveal gate
  (placement + condition + affinity binding — model requests are filtered, blocks logged),
  disposition deltas clamped ±2 with reasons, directed address (`addressedCharacterId`
  highlights the thumbnail; canned + prompt guidance target the quietest PC), NPC proposed
  actions under the conservative auto policy, scene-end Summarizer distillation into
  `npc_interactions`.
- **Frontend `features/play/`:** IntentInputRow overlay (Say/Do free text, explicit-skill Roll,
  opening chips hidden from their unlocker, "DM is thinking" indicator, error surface) on
  narration/roleplay/downtime; CheckPrompt overlay (solo roll button, group progress chips,
  assist Help button, countdown + expiry sweep); player-sidebar skills are now tap-to-roll;
  DM sidebar gains a Story tab (Narrate next with options display, social-scene NPC picker,
  End encounter, Generic NPC, world-fact dead/alive/absent override) and a live read-only
  proposal tray; VN thumbnails highlight the addressed PC.
- **Demo adventures run every agent canned** (pattern-keyed, adversarial fixtures included) so
  scripted walkthroughs and the whole integration suite spend $0.
- **Deviations from spec/plan (nothing silent — full detail in `docs/DECISIONS.md` 2026-07-18):**
  - **TTS deferred to Phase 8:** `voice_profiles` has no provider-side voice (the Mistral
    Voices API integration is F12 scope and was never built), so this phase's "listen to
    streaming TTS" task cannot run yet; it moves to Phase 8.
  - Braided intents (F07 SS3.4) + the loop-mismatch streak flag need F8 beats — Phase 6.
  - Objective completion predicate evaluation moves to Phase 6 with F08's story loop.
  - Conversation State + the pending-check stash (incl. hidden DCs) live in the dm GameState
    domain, not a table; verified stripped from player resyncs.
  - Full-AI narration options auto-pick option 1 (F14 auto policy); human picks are Phase 10.
  - Prompt deadlines are client-triggered + server-validated (no serverless timers).
  - Reveal conditions are free text, so any passed check on the utterance satisfies a
    condition (an insight success can unlock a persuasion-worded condition).
  - Multi-NPC crosstalk and "Ask the table" stay v1.1 stubs per spec.

AI TESTS:

- `packages/rules`: **179/179 pass**, `tsc --noEmit` clean — new play suite: router
  classification (fast-path kinds, explicit vs bare rolls, dialogue vs chat), DC clamping incl.
  NaN/Infinity, social DC table + disposition adjust, deterministic seeded rolls +
  advantage/disadvantage bounds, group half-pass rule (incl. empty group), assist
  enable/bonus/unclaimed variants, prompt-window expiry math, disposition/delta clamps + bands,
  opening sizing/self-consume/skill-scoping, reveal gate (discovered/foreign-NPC/location/
  condition/affinity + adversarial filter), proposed-action auto policy, and every LLM-output
  parser (clamping, rejection, composition guard, malformed-degrades-to-conversation).
- `frontend`: `tsc -b` 0 errors, `eslint .` 0 errors, `npm run build` clean, **46/46 tests** —
  new suite renders IntentInputRow + CheckPrompt inside a real PlayProvider (idle/locked
  states, opening-chip visibility rules, solo/waiting/group/assist prompt variants).
- **`tests/integration/orchestration-live.mjs` — 68/68 checks PASS against the deployed
  function + live DB, $0 spend (usage_log asserted 0 at the end):** fast-path roll + free chat
  with zero LLM calls; state_version race (two concurrent intents, both lines commit); social
  staging permissions; plain conversation with no roll; **adversarial reveal gate** ("tell me
  your secret" makes the canned NPC request everything — unconditioned ingredient revealed,
  condition-locked and wrong-PC-bound blocked, blocks logged); insight → opening emit →
  **self-consume blocked** (opening survives the unlocker's own attempt, hidden DC unchanged)
  → cross-PC consume (DC lowered by exactly dcMod, cooperation event logged); generic NPC
  created/staged/flagged; end_encounter writes interaction memory per staged NPC and clears
  scene state; group check (first roller waits, double-roll 409, completion applies half-pass);
  assist slot (self-claim 403, second-PC claim → primary prompt or fail-forward); expiry
  sweep (409 before deadline, auto-roll after); dead-NPC narration deterministically blocked →
  mechanical fallback + incident logged; players cannot dm_command/narrate_next/read
  proposals/dispositions/interactions; player resync never contains the dm domain or the
  pending stash; proposal lifecycle (auto_applied audit rows for ruling/npc_reply/narration,
  pending decide round-trip, **expired proposals cannot be applied**).
- Phase 4 regression: `tests/integration/session-live.mjs` re-run — **43/43 PASS**.
- Migration applied live via `db push`; `session` deployed via `--use-api`;
  `sync-guide-shared.mjs --check` green across all four mirrors.

COULD NOT VERIFY:

- **Everything real-LLM.** The live suite runs entirely on canned demo agents. Adjudicator
  ruling quality, NPC dialogue tone (is MiMo right?), narration prose, JSON-schema compliance
  of the real models under these new prompts, and end-to-end latency vs the 4s target all need
  your authorized paid session (~$1-3).
- The **feel** of the check-prompt flow at a real table: whether 20s/15s windows are right,
  whether cooperation prompts read as invitations or nagging, whether auto-applied rulings
  feel fair without a human backstop.
- Two-browser cooperation UX (group prompts appearing simultaneously, assist claim racing,
  opening chips on the other player's screen) — transport is proven, the experience is not.
- TTS (deferred to Phase 8 — see deviations).
- Whether the Story tab + proposal tray layout works at your resolution (sidebar density was
  already flagged provisional in Phase 4).

YOUR TESTS:

- [x] On the demo adventure (free): start a session, type a `do` like "I climb the old wall"
      — the check prompt appears with a countdown; Roll resolves it and a narration line lands.
- [x] Demo: type "We all sneak past together" with both browsers in — both players get the
      group prompt, both roll, the half-pass result narrates. Let one window lapse instead and
      confirm the auto-roll sweep.
- [x] Demo: "I brace and hold the gate shut!" — the other player sees the Help button; claim
      it and confirm the primary roll follows (or the fail-forward narration).
- [x] Demo, Story tab: stage an NPC ("Start scene"), say something plain (no roll happens),
      then "tell me your secret" — the NPC replies; anything it isn't entitled to reveal shows
      up as `reveal_blocked` events (visible in the event log), not in the dialogue.
- [x] Demo: as player 2, "I study her face for what she hides" until the insight lands — the
      opening chip appears on the OTHER player's input row (never your own); their next
      persuasion consumes it.
- [x] Demo, Story tab: create a Generic NPC ("shopkeeper"), talk to them, End encounter —
      scene returns to narration.
- [x] Demo, Story tab: mark any guide NPC dead under "World facts", then `do` "I call out to
      <that NPC's name>" — the narration degrades to the mechanical fallback line
      (consistency block working).
- [x] Tap a skill in your player sidebar — the fast-path roll line appears for everyone.
- [x] **The real one (paid, ~$1-3 — say go before running):** a 30-60 min solo session on your
      generated adventure with real models: free-text actions, influence checks, "Narrate the
      next story" from the Story tab, one generic NPC; note every moment the AI felt slow or
      wrong, then skim the proposal tray/log for calls you'd have rejected.
- [x] **Two-player 15 min (paid, small):** one group check, one assisted check, one
      insight→opening handoff, and confirm the NPC addresses the quieter player at least once.

YOUR TASKS:

- [x] Authorize the paid solo session + two-player test above (~$1-4 total, your OpenRouter
      key), with a second account or a friend for the cooperation half.
- [x] While playing, note latency per free-text action (the 4s target) — this feeds the
      merge-Adjudicator+Narrator decision (F07 open question).

DESIGN REVIEW:

- [x] Latency verdict vs the 4s target: merge Adjudicator+Narrator for simple cases, or keep
      the two-call pipeline?
- [x] NPC dialogue tone with real models: is MiMo the right npc_agent/narrator, or reroute in
      Settings and record the model-map decision?
- [x] Check-prompt ergonomics: are the 20s solo/group and 15s assist windows right? Should
      idle players auto-roll silently instead of showing the sweep?
- [x] The auto-applied proposal tray (read-only list, newest first): is this the audit surface
      you want to grow into the Phase 10 console, or should it live somewhere else?

GATE: PASS
