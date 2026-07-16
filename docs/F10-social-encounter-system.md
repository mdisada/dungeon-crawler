# F10 — Social Encounter System

**Depends on:** F4 (NPCs, voices), F6 (VN renderer), F7 (pipeline), F12 (TTS streaming)
**Depended on by:** F8 (hooks delivered through dialogue), F13 (interaction memory)

## 1. Purpose

Visual-novel-style roleplay scenes: NPC dialogue driven by the NPC Agent, social ability checks, immediate streaming TTS, on-the-fly NPC creation, and disposition tracking.

## 2. Scene setup

- Entry: DM launcher "Social" (pick 1–3 NPCs from the guide or generate generic), or naturally via Scene Manager (players approach an NPC in narration/exploration), or full-AI transition.
- Scene Manager → `mode: roleplay`; VN layout loads (background = current location, NPC portraits, player thumbnails).

## 3. Dialogue turn cycle

1. Player submits `say` (spoken words) or `do` (action) intent from the input row. Multiple players may queue; the Conversation State serializes (FIFO with DM reorder in assist).
2. **Social check detection:** the Adjudicator classifies whether the utterance is an influence attempt (persuade/deceive/intimidate) or information-seeking (insight) vs. plain conversation. Influence attempts → check spec `{skill, dc}` where DC derives from NPC disposition + ask magnitude (bounded table, not free LLM choice: trivial 8 / reasonable 12 / costly 16 / against-nature 20, ±2 disposition adjust) → Check Engine → result becomes context for the NPC's reply. Plain conversation skips checks entirely — no roll-for-everything.
3. **NPC Agent invocation** (one call per responding NPC):

```
Input:  { npc {personality, description, faction, disposition_to_each_pc,
              interaction_memory (top-k), knowledge (linked ingredients:
              what this NPC knows/can reveal, with reveal conditions)},
          conversation_state (topic stack, revealed-this-scene),
          player_utterance + check_result?,
          active hooks (Hook Weaver seeds to work in naturally),
          scene context }
Output: { dialogue: string, tone: string,
          address_pc?: character_id,              -- direct a question/demand at a specific PC (§3.7)
          reveals: [ingredient_id...],            -- validated against reveal conditions
          opening?: { unlocked_by: character_id, skill, dc_mod: -2 | -4 },   -- social opening (§3.7)
          disposition_delta: int (-2..+2) + reason,
          proposed_actions?: [{type: 'join_combat'|'leave'|'give_item'|'canonize_theory', payload}] }
```

4. **Guardrails:** `reveals` filtered server-side — an NPC cannot reveal an ingredient whose placement condition is unmet (e.g. requires successful DC 16 persuasion). Disposition deltas clamped and applied via `update_npc_disposition`. `proposed_actions` become proposals (assist) or conservative autos (full-AI: give_item/leave auto; join_combat auto only if the NPC's tactics profile allows; canonize per F8 §5).
2. **Broadcast + TTS:** dialogue streams to the text box; TTS fires per completed sentence with the NPC's voice profile, audio chunks stream to clients (F12). Subtitle/portrait active-speaker states follow audio playback.
3. Consistency pass (F7 §6) runs on the dialogue draft before broadcast (fact checks only; tone is free).

### 3.7 Differential engagement (min_players > 1)

NPCs engage players *differentially*, turning social scenes into team play rather than a single spokesperson's minigame:

- **Directed address:** the NPC Agent may set `address_pc` — a question, demand, or aside aimed at a specific PC other than the last speaker, chosen by per-PC disposition, relevance (backstory tags, class), and the Variety Manager's `spotlight` flag (quiet players get addressed). The VN renderer highlights the addressed PC's thumbnail; the prompt instructs the agent to do this naturally, roughly every 3–5 exchanges, never as an interrogation of an absent player (idle PCs are described, not put on the spot).
- **Per-PC negotiation demands:** disposition is already per-PC — an NPC may trust the dwarf but stonewall the party face, or demand something *from a named character* ("I'll talk, but only if *she* vouches for me"). Encoded via the personality sheet + disposition context, no new mechanics.
- **Social openings (insight → influence handoff):** a successful information-seeking check (typically Insight) by PC A can emit an `opening` — a single-use, scene-scoped DC reduction (−2, or −4 on success by 5+) on a linked influence attempt **by a different PC**. Server-validated: the opening's `unlocked_by` PC cannot consume it themselves; expires at scene end. Shown as a subtle chip on other players' input rows ("Opening: he's hiding grief — Persuasion eased"). Consumption logs a cooperation event (F15).
Guardrail: openings and directed address are rewards and invitations, never gates — any influence attempt remains legal without them.

## 4. On-the-fly generic NPCs

DM console "Generic NPC" (or Adjudicator flags "player is talking to an unnamed shopkeeper"):

```
Input:  { role_hint ("shopkeeper","guard"...), location, scene context }
Output: { name, one_line_personality, disposition_default, voice: pick-from-generic-pool }
```

- Creates a lightweight `npcs` row (`role: 'npc'`, generated flag), placeholder portrait from a silhouette set keyed to role, voice from a pre-seeded generic voice-profile pool (6–8 stock profiles in Storage).
- Assist: appears as an instant proposal (one-tap accept, editable name). Promotable to a full NPC later in the guide editor.

## 5. Disposition model

Per NPC per PC: integer −10..+10 with labeled bands (hostile ≤ −6, unfriendly, neutral, friendly, devoted ≥ +6). Affects: social DC adjust (§3.2), NPC Agent tone context, willingness thresholds for `proposed_actions` (an NPC won't `join_combat` below friendly unless paid/coerced — encoded in tactics/personality data). All changes logged with reasons (visible in DM sidebar NPC status).

## 6. Ending the scene

DM "End encounter" or natural exit (players leave / NPC leaves via proposed action) → Conversation State distilled: Summarizer writes an interaction-memory entry per participating NPC (what was said, promised, revealed, disposition trajectory) → F13 embedding → Scene Manager transitions.

## 7. Acceptance criteria

- [ ] Plain conversation produces zero dice rolls; influence attempts produce exactly one check with a table-derived DC.
- [ ] An NPC cannot reveal a gated ingredient without its condition met (adversarial prompt test: player says "tell me the secret" — reveal blocked server-side even if the model tries).
- [ ] TTS begins within 1.5s of first sentence completion; multi-sentence replies play gapless.
- [ ] Generic NPC creation → first line of dialogue in < 8s (assist, one-tap accept).
- [ ] Disposition deltas clamp, persist, and adjust subsequent DCs.
- [ ] Interaction memory entry exists after scene end and is retrieved on the NPC's next appearance (recall test: NPC references a promise from a prior session).
- [ ] Opening flow: PC A's Insight success emits an opening; PC B's Persuasion consumes the DC reduction; PC A cannot self-consume; opening expires at scene end (server-validated fixtures).
- [ ] Directed address: in a seeded 3-PC scene with one silent player, the NPC addresses the silent PC within 5 exchanges; idle/disconnected PCs are never put on the spot.

## 8. Open questions

- Multi-NPC crosstalk (NPCs talking to each other): v1 allows DM-triggered "NPCs converse" (round-robin 2–3 exchanges); automatic crosstalk deferred.
- Player-to-player in-character chat: rendered in the text box without NPC invocation — free.
