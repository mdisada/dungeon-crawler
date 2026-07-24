# F12 — Asset & Immersion Pipeline

**Depends on:** F1 (gateway, local worker contract)
**Depended on by:** F2, F4, F6, F10 (all media consumers)

## 1. Purpose

The async media backbone: job queue, image generation, streaming TTS, voice profile management, and music/background playback.

## 2. Job Queue

> **Assets Lab slice (2026-07-24) — what actually shipped first.** The DB-backed `jobs` table and
> the cron/on-insert dispatcher below are **not built yet**. The lab (F12 §3-4 image + TTS) ships
> a lighter transport: the image/tts feature APIs pick the route per request (`openrouter` |
> `local`) instead of reading `user_settings.provider`, so comparing routes never reroutes the
> app. Local jobs go over a per-user `assets:{user_id}` Realtime broadcast channel to
> `backend/assets.py`; the worker uploads results to the private `assets` bucket and broadcasts
> `asset-progress {jobId, stage}` then `asset-result {jobId, storagePath|chunks|error}` — a
> **storage pointer, not the streamed chunks** F01 §5 first specified (broadcast can't carry the
> bytes). ai-proxy accepts an allowlisted client `model` for image/tts only
> (`_shared/media-models.ts`). The `jobs` table + priorities below remain the target for the
> live/guide-time pipeline. See `DECISIONS.md` 2026-07-24.

```text
jobs: id, user_id, adventure_id?, kind ('image'|'tts'|'tts_stream'|'embedding'|'llm_batch'),
      payload jsonb, status ('queued'|'running'|'done'|'failed'|'cancelled'),
      priority int, result jsonb?, error?, attempts int, created_at, updated_at
```

- Dispatcher (edge function on a short cron + on-insert trigger) routes by provider setting: OpenRouter path (direct call from the function) or local worker channel (F1 §5). Retries: 2 with backoff; poison jobs → failed + F15 incident.
- Priorities: live TTS (0) > live narration images? n/a > guide-time generation (5) > re-embeds (9). Live-path TTS actually bypasses the queue (§4.2) — the queue handles everything that can tolerate seconds.
- Client subscribes to `jobs:{adventure_id}` for progress (guide-generation progress bars, image spinners).

## 3. Image generation

> **Assets Lab preset registry (2026-07-24):** the client-side entry is
> `frontend/src/features/image` with a preset key registry (`base_char`, `avatar_char`,
> `cutscene`, `background`, `map`). On the **OpenRouter** route the preset only appends a
> prompt suffix and every image is **1024×1024** (hosted models give no reliable dimension
> control), so `base_char`'s suffix carries "full body, head to toe, centered" framing and
> `TokenCropTool`'s default crop was re-tuned for a square source. On the **local** route only
> the preset *key* crosses the wire; the worker (`backend/image.py`) owns resolution and the
> ComfyUI workflow (stubbed in slice 1). The 9:16 / 16:9 / 1:1 targets below are the local-route
> intent once those workflows exist.

- Single entry: `queue_image(prompt, type, target)` — types: `character_fullbody` (9:16), `npc_fullbody` (9:16), `location_background` (16:9, 1920×1080), `battle_map` (1:1, 1024×1024 with top-down prompt template + post-composited grid).
- Prompt templates per type (style consistency: one adventure-level style string appended, set in guide settings, default "painterly fantasy illustration").
- Results → Storage (`adventures/{id}/...` or `characters/{id}/...`), history kept (last 3–5), DB row updated with URL.
- Env flag `PLACEHOLDER_MEDIA=true` short-circuits to placeholder assets (dev/test).

## 4. TTS

> **Default cloud TTS is Fish Audio (2026-07-24), not Voxtral.** `ai-proxy` routes to Fish
> (`api.fish.audio/v1/tts`, engine in the `model:` header) for model ids `s1`/`s2-pro`/`s2.1-pro`/
> `s2.1-pro-free`, else to OpenRouter/Voxtral. Fish **clones from an uploaded clip** (registered as
> a Fish voice model once, `reference_id` cached on `voice_profiles.fish_reference_id`), so the
> cloud route can clone — unlike Voxtral. Key is the edge secret `FISH_AUDIO_API_KEY`. Fish returns
> no cost, so its usage_log rows have null cost. See `DECISIONS.md` 2026-07-24.

### 4.1 Voice profiles

```text
voice_profiles: id, owner_user_id?, scope ('user'|'adventure'|'system'),
                name, clip_url (3–30s reference), created_at
```

- Upload (any scene: narrator picker, NPC editor): client records/uploads WAV/MP3 → Storage `voices/` → profile row. System pool: 6–8 stock generic profiles seeded for on-the-fly NPCs. "Preview" synthesizes a fixed sample line.
- Voxtral zero-shot cloning uses the clip directly as the voice prompt per request — no training step.

> **Assets Lab (2026-07-24):** voice clip list/upload/normalize/preview live in
> `frontend/src/features/tts` (guide keeps only narrator *assignment*). Clips are **normalized
> client-side to 16 kHz mono WAV and cropped to 15s** before upload (`normalize-clip.ts`) for the
> local Chatterbox backend's `audio_prompt_path`. The old 3–30s hard bound becomes: 3s minimum
> still rejects, 30s ceiling auto-crops. Local synthesis stays chunked (one Opus file per ~200
> chars) per §4.2; OpenRouter returns a single mp3.
>
> **Cloning is local-only — corrected 2026-07-24 (verified against the live API).** OpenRouter's
> `/audio/speech` takes a **preset voice slug** (`{lang}_{name}_{style}`, e.g. `en_paul_neutral`,
> `fr_marie_neutral`), NOT a reference clip. Voxtral's zero-shot cloning is a separate Mistral
> endpoint (`audio.voices.create`: base64 sample → `voice_id`) that OpenRouter does **not** proxy
> (`/api/v1/audio/voices` → 404). So the earlier claim in §4.1 ("cloning uses the clip directly as
> the voice prompt per request") holds only for the **local Chatterbox** path. On the OpenRouter
> route the lab offers preset slugs (`voxtral-voices.ts`, curated + free-text); passing a clip URL
> as `voice` returns "Provider returned 404" — which is the bug this note documents. Kokoro (CPU)
> also has no cloning; the worker reports `cloning: false` and the lab greys it out.

### 4.2 Live streaming path (dialogue & live narration)

Latency budget: first audio ≤ 1.5s after first sentence completes.

```text
LLM token stream ──► sentence segmenter (client-visible text immediately)
      │ per sentence
      ▼
edge fn /tts-stream (Voxtral, format: pcm, stream: true)   ── verify OpenRouter
      │ chunked PCM                                            stream passthrough;
      ▼                                                        else Mistral-direct
client AudioWorklet player: per-speaker chunk queue,
gapless scheduling, music ducking (−8dB while voice active)
```

- Sentence segmentation server-side (abbreviation-safe splitter); sentences pipeline concurrently but **play strictly in order**.
- PCM for live; long pre-generated narration (recaps, premise) synthesized ahead as mp3 → Storage → simple `<audio>` playback with caching.
- Interruption: publishing new narration or scene change cancels the current stream cleanly (fade 200ms).
- Subtitles: text revealed per sentence as its audio starts (F6 sync contract).

### 4.3 Cost & caching

TTS cost per character tracked in usage_log; identical (text, voice) pairs within an adventure hit a synthesis cache (hash-keyed Storage lookup) — recaps and repeated stock lines become free.

## 5. Music & ambience

- Storage bucket `music/` (adventure-scoped uploads + a small CC0 starter pack seeded at install: tavern, travel, combat, mystery, boss).
- DM Immersion tab: pick/play/stop/volume; loop by default; crossfade 2s on change. Selection broadcast in Scene State so all clients play in sync (start timestamp offset sync, tolerance ±500ms — good enough for background music).
- Full-AI: Scene Manager maps scene mode + loop type → track tag (battle→combat, boss phase→boss, mystery loop→mystery); picks any track with the tag.
- Autoplay policy: first user gesture unlocks audio (standard interaction gate on session join).

## 6. Background rendering

- Location background images with Ken Burns pan (F6): per-image pan config auto-derived (safe-zone detection deferred — v1 random gentle direction, 40s loop).
- Preloading: Scene Manager announces the *likely next* location (Beat Planner hint) → client prefetches its background and map.

## 7. Acceptance criteria

- [ ] Queue survives function restarts (status-based recovery); retries and poison handling verified.
- [ ] All four image types generate to correct dimensions and land in Storage + DB.
- [ ] Live TTS: p50 first-audio ≤ 1.5s, p95 ≤ 3s; multi-sentence gapless; order preserved under concurrent synthesis.
- [ ] Stream cancellation on scene change leaves no orphan audio.
- [ ] Voice upload → profile → preview → NPC assignment end-to-end.
- [ ] Music sync within ±500ms across two clients; ducking works.
- [ ] Placeholder mode covers every media call path.

## 8. Open questions

- ~~OpenRouter TTS stream passthrough (F1 §3.2 validation task)~~ **Resolved 2026-07-24:**
  OpenRouter `/audio/speech` works with Voxtral Mini TTS using a preset **voice slug** and returns
  a single audio file (mp3/pcm) — it is not a cloning path (see §4.1 correction). Mistral-direct is
  only needed if per-sentence PCM streaming is required for the live path; the lab uses the single-
  file response.
- Client audio on iOS Safari (AudioWorklet + autoplay quirks) — spike early.
