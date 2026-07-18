# F1 — Auth, Settings & AI Connectivity

**Depends on:** nothing (foundation)
**Depended on by:** all features

## 1. Purpose
User identity, per-user configuration, and the single gateway through which every AI call (text, image, TTS, embeddings) flows — whether served by OpenRouter or the user's local Python server.

## 2. Auth
- Supabase Auth: email/password. **OAuth (Google, Discord) deferred to backlog for v1** — see
  `docs/DECISIONS.md` 2026-07-16. Because there's no OAuth identity layer as a second factor,
  protected-route/page guards carry more weight than they would otherwise — see that entry.
- Row-Level Security on every table: users read/write own rows; adventure content readable by adventure members (see `adventure_members` in F5).
- `profiles` table: `id (fk auth.users)`, `display_name`, `avatar_url`, `created_at`.

## 3. AI Gateway (Edge Function `ai-proxy`)

### 3.1 Design
Single Supabase Edge Function that all clients call. Responsibilities:
1. Verify Supabase JWT.
2. Resolve the model for the requested `agent_role` from the caller's settings (fall back to system defaults).
3. Route to provider: OpenRouter (default) or reject with `LOCAL_MODE` if the user has local mode active (client then goes through the Job Queue instead — §5).
4. Stream the provider response through to the client (SSE passthrough for text; chunked audio for TTS).
5. Record usage into `usage_log` (fire-and-forget after stream completes).

### 3.2 API
```
POST /functions/v1/ai-proxy
{
  "kind": "text | tts | image | embedding",
  "agent_role": "narrator | adjudicator | ... | user_direct",
  "adventure_id": "uuid | null",
  "payload": { /* provider-shaped request minus model + key */ },
  "stream": true
}
```
- Server injects `model` (from role map) and `Authorization` (from edge secret `OPENROUTER_API_KEY`).
- **Streaming validation task (build-time):** confirm OpenRouter streams Voxtral audio chunks rather than buffering. If buffered, add a second secret `MISTRAL_API_KEY` and route `kind: tts` directly to Mistral's audio endpoint. The client contract does not change.
- Structured-output requests pass `response_format: json_schema`; the proxy retries once on parse failure before returning an error envelope.

### 3.3 Key handling
- Default: platform key in edge secret. Optional per-user key: users may store *their own* OpenRouter key encrypted in `user_api_keys` (pgsodium) — still server-side, still proxied.
- **BYO-key-in-localStorage fallback** exists only behind Settings → Advanced → "I understand this key is exposed to browser scripts" toggle; UI links to OpenRouter per-key spend limits. Not the default path.

### 3.4 Usage tracking
```
usage_log: id, user_id, adventure_id?, agent_role, model, kind,
           prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at
```
- Navbar meter: remaining OpenRouter credit (edge function `GET /ai-credit`, polls OpenRouter key endpoint, cached 60s) + session spend (sum of `usage_log` since session start, via Realtime-updated Postgres view).
- Adventure detail shows lifetime cost per adventure.

## 4. Settings Page

Sections:
1. **Provider** — radio: `OpenRouter (cloud)` / `Local server`. Local shows connection state + "how to run the worker" help.
2. **Model map** — table of agent roles → model dropdown (curated list: MiMo-V2.5, DeepSeek V4 Flash, DeepSeek V4 Pro, Gemini 2.5 FlashLite, Mistral Nemo). "Reset to defaults" button. Stored in `user_settings.model_map (jsonb)`.
3. **Media models** — TTS model (Voxtral Mini TTS default), image model (Nano Banana 2 Lite default), embedding model (fixed: Qwen3-Embedding 8B — changing it invalidates existing vectors; show warning + "re-embed" job trigger if ever changed).
4. **API keys** — own OpenRouter key (server-stored) management; Advanced localStorage fallback.
5. **Audio** — default volumes (narration / music / SFX), autoplay policy note.

```
user_settings: user_id pk, provider ('openrouter'|'local'), model_map jsonb,
               tts_model, image_model, byok_local_storage boolean, updated_at
```

## 5. Local Server Mode (v2-ready contract, v1 stub)

- Local Python worker authenticates with a **worker token** (generated in Settings, hashed in `worker_tokens`), then subscribes to Realtime channel `jobs:{user_id}`.
- Heartbeat every 10s → `worker_status` table → navbar indicator: green (heartbeat <30s), yellow (30–90s), red/hidden (none).
- Job contract identical to OpenRouter path: the Job Queue (F12) publishes `{job_id, kind, agent_role, payload}`; worker replies on `jobs:{user_id}:results` with streamed chunks `{job_id, seq, chunk}` and terminal `{job_id, done, usage?}`.
- v1 ships: token generation, heartbeat/indicator, and the message contract documented — no worker implementation required to launch.

## 6. Navbar (global component)
- Left: app logo/nav. Right cluster: usage meter (credit remaining + session spend, click → usage popover), local-server indicator (only in local mode), profile menu.

## 7. Acceptance criteria
- [ ] Unauthenticated users see only login; RLS verified by tests attempting cross-user reads.
- [ ] A text call with `agent_role: narrator` uses the user's mapped model; changing the map changes the model on next call without redeploy.
- [ ] Streamed narration reaches the client with first token < 2s p50.
- [ ] TTS streaming path validated (OpenRouter passthrough or Mistral-direct fallback chosen and documented).
- [ ] `usage_log` rows appear for every call; navbar spend updates within 5s.
- [ ] Local worker heartbeat drives the indicator through all three states.
- [ ] No API key ever appears in client bundles, network payloads from the client, or localStorage (unless Advanced toggle is on).

## 8. Open questions
- Rate limiting per user on the proxy (recommend: token bucket in edge function, 60 req/min default).
- Whether adventure creators subsidize player AI costs or each player's calls bill to their own key — v1: **all AI calls in an adventure bill to the creator** (simplest; only the DM/system triggers generation anyway).
