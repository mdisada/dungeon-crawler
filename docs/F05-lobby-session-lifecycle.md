# F5 — Lobby & Session Lifecycle

**Depends on:** F1, F2, F4
**Depended on by:** F6, F7, F13

## 1. Purpose

Get the right people and characters into an adventure, and define the session lifecycle: start (with recap), checkpoints, and end (with summarization).

## 2. Membership & invites

```text
adventure_members: adventure_id, user_id, role ('dm'|'player'),
                   character_id?, joined_at, unique(adventure_id,user_id)
```

- Invite link `/join/:invite_code` (code on the adventure row, regenerable). Joining inserts a `player` row (capped at `max_players`; DM excluded from count).
- RLS: adventure content readable by members; DM-only tables (hidden descriptions, proposals) readable by `role='dm'` and the creator.

## 3. Lobby (waiting area)

Opening an `active` adventure from Home shows a **modal lobby** over the (dimmed) adventure page:

- Member list with presence (Supabase Realtime presence channel `lobby:{adventure_id}`): avatar, name, picked character, ready check.
- **Character selection:** each player picks from their own complete characters. Pick locks the character to this adventure (`characters.locked_adventure_id`) — no simultaneous use in two adventures; unlocked on adventure completion/leave. Level compatibility warning if character level deviates from adventure's expected level (informational, DM can waive).
- Ready flow: players toggle Ready. **Start Session** button enabled for the DM (assist) or the creator (full-AI) when `ready_count ≥ min_players`. Late joiners after start enter a "spectate until DM admits" state; DM admit inserts them into the scene at the next narration break.
- First-ever session: before start, Hook Weaver runs its deferred pass — reads the actual selected characters' backstories and (1) fills the backstory hook slots from F4 Stage 6, (2) computes the **party composition profile** (skills/proficiencies, pillar strengths, backstory tags — stored on the adventure row, recomputed on membership change; consumed by Encounter Designer, Ingredient Generator, Beat Planner, and NPC Agent), (3) **binds cooperative `reveals_to` affinities** to concrete distinct characters (F4 §4.1; unbindable → `any_pc`), and (4) weaves **backstory interlocks** across ≥ 2 characters where the material allows (F8 §6). All as proposals to the DM console in assist; auto in full-AI.

## 4. Session lifecycle

```text
sessions: id, adventure_id, index, started_at, ended_at?,
          start_checkpoint_id, end_summary_id?
checkpoints: id, adventure_id, session_id, created_at, label?,
             state_snapshot jsonb    -- full serialized adventure state
```

### 4.1 Session start

1. Adventure Manager loads authoritative state (latest checkpoint or guide-initial state).
2. **Recap:** Summarizer output from previous session end → Narrator renders a "Previously on…" recap (≤ 120 words) → narration mode with TTS. First session: renders the adventure premise instead (from plot, spoiler-safe — hidden descriptions excluded).
3. Scene Manager enters the appropriate mode (resume mid-combat restores Combat State from checkpoint).

### 4.2 Checkpoints

- Automatic: on every encounter end, scene-mode transition, and every 10 minutes of active play (debounced — skip if no state diff since last).
- Manual: DM sidebar "Checkpoint" button with optional label.
- Retention: last 20 automatic + all manual. Restore is DM-only, session-paused action with confirm ("players will resync").

### 4.3 Session end

DM "End Session" (or full-AI: creator, or auto after N minutes of no connected players):

1. Final checkpoint.
2. Summarizer job: session event log → structured summary (events, NPC state changes, promises made, items gained, objective progress) + embedding (F13).
3. Members see an end-of-session card: summary, XP gained, cost this session (creator only).

## 5. Disconnect handling

- Presence loss ≠ leave. A disconnected player's character remains; in combat, their turns auto-delay to end of round twice, then the DM console offers: skip / AI-play this turn (Tactician with `controller: ai` temporarily) / pause.
- Full-AI mode: auto "AI-play after 60s" with a client-visible countdown.

## 6. Acceptance criteria

- [ ] Lobby presence updates < 2s across clients; capacity and min-player gating enforced server-side, not just in UI.
- [ ] Character locking prevents the same character in two active adventures.
- [ ] Recap generates from the previous summary and never leaks hidden descriptions (test: seeded adventure with trap words in hidden text).
- [ ] Checkpoint restore reproduces identical state (hash comparison test on serialized snapshot).
- [ ] Late join and disconnect flows work mid-combat without desync.
- [ ] First-session pass produces a composition profile, binds coop affinities to distinct PCs, and recomputes correctly when a late joiner is admitted.
