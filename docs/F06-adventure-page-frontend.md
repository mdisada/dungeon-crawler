# F6 — Adventure Page (Live Play Frontend)

**Depends on:** F1, F2, F4, F5; renders state owned by F7–F10
**Depended on by:** all live-play features (as their view layer)

## 1. Purpose
The single live-play screen. Pure derived UI: everything renders from broadcast state (`scene.mode`, combat state, dialogue state, player state). No gameplay decisions live in this layer.

## 2. Layout
```
┌──────────────────────────────────────────────┬──────────┐
│ Header: Day N · Adventure/Session title · 🔊 │          │
├──────────────────────────────────────────────┤ Sidebar  │
│                                              │ (DM or   │
│                Main Window                   │  Player) │
│         (mode-dependent renderer)            │          │
│                                              │          │
└──────────────────────────────────────────────┴──────────┘
```
- **Header:** in-game day (from World Clock), adventure + session title, volume popover (narration / music / SFX sliders, mute).
- **Sidebar:** DM sidebar if `member.role='dm'` (assist mode creator); Player sidebar otherwise (full-AI creators are players).
- Responsive: sidebar collapses to a drawer < 1024px.

## 3. Main window renderers (switch on `scene.mode`)

### 3.1 `battle` / `puzzle` — Tactical map
- Roll20-style: 1024×1024 map image under a 32×32 grid overlay; pan/zoom (wheel + drag).
- Tokens: character/NPC token crops, draggable **only** by their controller (player: own token on own turn within movement range; DM: any token anytime). Drag emits a `move_intent`; the server validates (Grid Engine) and broadcasts the committed position — client shows optimistic move with snap-back on rejection.
- Overlays: movement range highlight (active token), AoE templates (when targeting), initiative ribbon (top: token portraits in order, active glows), floating damage/heal numbers, condition icons on tokens, obstacle shading.
- Turn banner: "Kaelen's turn" with action economy pips (Action / Bonus / Move / Reaction).

### 3.2 `narration` — Cinematic
- Full-bleed location background with slow Ken Burns pan (CSS transform loop; direction/duration from a small per-image config).
- Subtitles: bottom-third, word-synced-ish reveal driven by TTS playback progress (sentence-level granularity is sufficient); history accessible via scroll-up.
- Music layer per Immersion selection; narration TTS ducked over music (music −8dB while voice active).

### 3.3 `roleplay` — Visual novel
- Background: location image (static or subtle pan).
- Half-body portraits: speaking NPC(s) left/right, active speaker full-opacity + slight scale, others dimmed. Player characters represented by portrait thumbnails along the bottom edge.
- Bottom text box: speaker name plate + streamed dialogue text; TTS plays as text streams (F12 pipeline).
- Player input row: free-text action/say field + quick buttons (Say / Do / Roll) → submits intents to F7.

### 3.4 `downtime`
Simple parchment-style log view with input row (shopping, rest, banter). Low priority; can alias to roleplay renderer in v1.

**Rule:** background XOR map — enforced upstream by Scene Manager state (`scene.active_visual: 'background'|'map'`), the client never decides.

## 4. Player sidebar
- **Header:** current objective (revealed title only — e.g. "Find Jennefer").
- **Footer (persistent character strip):** avatar, name, class & level, race, alignment, XP, current/temp HP bar.
- **Tabs** (auto-switch: Combat becomes primary tab when `scene.mode='battle'`, Ability & Skills otherwise; manual override respected until mode changes):
  - **Ability & Skills:** ability scores + modifiers, saving throws, skill list with modifiers (tap a skill → prefills a roll intent, resolved server-side).
  - **Combat:** AC, speed, initiative mod, current/temp HP, attacks & spellcasting list (tap spell → detail popup: level, range, components, effect, cast button when legal), equipment.
  - **Background:** personality traits, features & traits, proficiencies & languages, "Show full image" (full-body portrait modal).

## 5. DM sidebar (assist mode)
- **Overview tab:**
  - Objectives checklist (checkboxes reflect predicate state; manual check = override → confirm dialog → logs an override event).
  - **Start Encounter** launcher: `Social` (pick NPC(s) from guide, or "generic on the fly" → F10), `Battle` (pick encounter spec or build quick from templates → opens map, "Roll initiative" CTA), `Environment` (opens map without initiative — traps/exploration).
  - Players status (HP, conditions, connection), NPC status (present NPCs, disposition arrows).
  - Session log (scrolling event log, filter: all / rolls / narration / proposals).
- **Combat tab** (visible only during battle): initiative list with drag reorder, difficulty slider (F9), add-combatant, per-token HP/condition quick edits, end-combat.
- **Dice Roll tab:** free dice bar (`2d6+3`), advantage toggle, public/hidden toggle, recent rolls.
- **Immersion tab:** music picker (Storage `music/` bucket, play/stop/volume), background picker (location images), map picker — selecting background hides map and vice versa (sends the Scene Manager `active_visual` intent).
- **Proposal tray** (docked bottom of sidebar, all tabs): live AI proposals with option chips + edit affordance (the F7 console surface).

## 6. State subscription
One Realtime channel per adventure: `game:{adventure_id}` carrying typed state-diff messages `{domain: 'scene'|'combat'|'dialogue'|'players'|'objectives'|'proposals', diff}`. Client store (Zustand) applies diffs; full-state resync endpoint on reconnect/late-join. Proposals domain delivered only to DM-role clients (separate channel `dm:{adventure_id}` with RLS-checked join).

## 7. Acceptance criteria
- [ ] Mode transitions (narration→roleplay→battle) render correctly from state diffs alone with no client-side inference.
- [ ] Token drag validation round-trip < 300ms p50; snap-back on illegal move.
- [ ] Subtitles track TTS within one sentence; volume controls affect the correct layers.
- [ ] Player sidebar tab auto-switch on combat start/end.
- [ ] DM-only data (hidden descriptions, proposals) never reaches player clients (network-level test).
- [ ] Reconnect resyncs to identical state (hash check).
