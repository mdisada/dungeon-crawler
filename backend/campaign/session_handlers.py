"""Async request handlers for the live campaign-session realtime channels.

Split from campaign/manager.py (which owns the pre-session outline-builder flow): these handlers
serve the "open campaign" loop — listing a user's campaigns, loading one, the short branch-option
menu, and the AI-drafts / DM-reviews-and-publishes turn cycle.
"""
import asyncio
import json

import supabase_storage
import tts
from campaign import storage
from campaign.extraction import (
    LORE_EXTRACTION_JSON_SCHEMA,
    NPC_EXTRACTION_JSON_SCHEMA,
    build_lore_extraction_prompt,
    build_npc_extraction_prompt,
)
from campaign.narration import (
    BRANCH_OPTIONS_JSON_SCHEMA,
    build_branch_options_prompt,
    build_narration_system_prompt,
    build_narration_user_prompt,
    build_puzzle_start_narration_prompt,
    build_transition_narration_prompt,
)
from config.tts import audio_bucket_name
from llm.manager import ask
from timing import time_job

# How many recent turns the auto-extraction step scans for new NPCs/lore — same window narration
# uses for "story so far" context.
_EXTRACTION_HISTORY_TURNS = 5

# Serializes NPC/lore auto-extraction per campaign so two turns publishing in quick succession
# can't both decide the same new NPC "doesn't exist yet" and insert it twice. Lazily populated,
# never cleaned up — fine for a single-DM scaffold with a handful of concurrent campaigns.
_extraction_locks: dict[int, asyncio.Lock] = {}


async def handle_list_campaigns(data: dict) -> dict:
    user_id = data["userId"]
    campaigns = await asyncio.to_thread(storage.list_campaigns_for_user, user_id)
    return {"userId": user_id, "campaigns": campaigns}


async def handle_get_campaign(data: dict) -> dict:
    campaign_id = data["campaignId"]
    campaign = await asyncio.to_thread(storage.get_campaign, campaign_id)
    return {"campaignId": campaign_id, "campaign": campaign}


async def handle_list_turns(data: dict) -> dict:
    campaign_id = data["campaignId"]
    turns = await asyncio.to_thread(storage.list_turns, campaign_id)
    return {"campaignId": campaign_id, "turns": turns}


async def handle_list_puzzles(data: dict) -> dict:
    """The DM's puzzle picker only offers puzzles not yet triggered this campaign — 'ready' ones,
    per campaign/storage.py's puzzles.status lifecycle."""
    campaign_id = data["campaignId"]
    puzzles = await asyncio.to_thread(storage.list_puzzles, campaign_id)
    available = [p for p in puzzles if p["status"] == "ready"]
    return {"campaignId": campaign_id, "puzzles": available}


async def _load_narration_context(campaign_id: int) -> dict:
    """Shared read-side context for both the short branch-option menu and a full narration
    draft: the campaign, recent turns, known NPCs/lore, and the pacing signal (turns since the
    last resolved major plot point, and which plot point is next).
    """
    campaign = await asyncio.to_thread(storage.get_campaign, campaign_id)
    if campaign is None:
        raise ValueError(f"Campaign {campaign_id} not found")

    turns = await asyncio.to_thread(storage.list_turns, campaign_id)
    npcs = await asyncio.to_thread(storage.list_npcs, campaign_id)
    lore = await asyncio.to_thread(storage.list_lore, campaign_id)
    turns_since_plot_point = await asyncio.to_thread(storage.turns_since_last_plot_point, campaign_id)
    next_plot_point = await asyncio.to_thread(storage.get_current_plot_point, campaign_id)

    return {
        "campaign": campaign,
        "turns": turns,
        "npcs": npcs,
        "lore": lore,
        "turns_since_plot_point": turns_since_plot_point,
        "next_plot_point": next_plot_point,
    }


async def _generate_branch_options(campaign_id: int) -> list[str]:
    """Shared by the DM's manual branch-options request and the auto-suggestion triggered after
    a player's turn is published (see make_handle_publish_turn)."""
    ctx = await _load_narration_context(campaign_id)

    system_prompt = build_branch_options_prompt(
        ctx["campaign"], ctx["turns"], ctx["npcs"], ctx["lore"],
        ctx["turns_since_plot_point"], ctx["next_plot_point"],
    )
    result, _ = await asyncio.to_thread(
        ask, ctx["campaign"]["model"], "Propose the options now.", "campaign-branch-options",
        system_prompt, BRANCH_OPTIONS_JSON_SCHEMA,
    )
    return json.loads(result).get("options", [])


async def handle_generate_branch_options(data: dict) -> dict:
    campaign_id = data["campaignId"]
    options = await _generate_branch_options(campaign_id)
    return {"campaignId": campaign_id, "options": options}


async def _generate_narration(
    campaign_id: int, feedback: str | None = None, ctx: dict | None = None
) -> str:
    """Shared by the DM's manual "Generate AI turn"/"Regenerate with feedback" actions and the
    automatic draft triggered after a player's turn is published (see make_handle_publish_turn).
    `feedback` is also the DM's escape hatch to ignore the branch-option menu entirely and steer
    the draft in a direction of their own choosing. `ctx` lets a caller that already loaded the
    narration context (see make_handle_generate_turn, which also needs it for the transition
    narration) pass it in rather than loading it twice.
    """
    if ctx is None:
        ctx = await _load_narration_context(campaign_id)

    system_prompt = build_narration_system_prompt(
        ctx["campaign"], ctx["npcs"], ctx["lore"], ctx["turns_since_plot_point"], ctx["next_plot_point"],
    )
    user_prompt = build_narration_user_prompt(ctx["turns"], feedback)

    content, _ = await asyncio.to_thread(
        ask, ctx["campaign"]["model"], user_prompt, "campaign-narration", system_prompt
    )
    return content.strip()


async def _tts_sentences(text: str, path_prefix: str, on_chunk=None) -> list[dict]:
    """Splits `text` into sentences, TTS+uploads each one in order (Opus, one file per sentence
    — this is what lets playback start almost immediately instead of waiting for the whole turn),
    and returns the resulting chunk list (`{url, isNewParagraph}`). If `on_chunk` is given, it's
    called with `(index, chunk)` as soon as each chunk is ready (draft-time live streaming — see
    make_handle_generate_turn); if omitted, chunks are just collected silently (publish-time
    persistence — see _persist_narration_audio).
    """
    if not tts.tts_enabled:
        return []

    chunks = []
    for i, (sentence, is_new_paragraph) in enumerate(tts.split_into_sentences(text)):
        audio = await asyncio.to_thread(tts.generate_sentence_audio, sentence)
        url = await asyncio.to_thread(
            supabase_storage.upload_audio, audio_bucket_name, f"{path_prefix}/{i}.opus", audio
        )
        chunk = {"url": url, "isNewParagraph": is_new_paragraph}
        chunks.append(chunk)
        if on_chunk:
            await on_chunk(i, chunk)
    return chunks


async def _stream_transition_narration(live_channel, campaign_id: int, job_id: str, ctx: dict) -> None:
    """Fire-and-forget: a few sentences of pure scene-continuing ambience, generated and streamed
    to campaign-live while the real narration draft is still being written (see
    make_handle_generate_turn), so the player isn't sitting in silence. Never persisted — this
    isn't canon content, just filler for the wait.
    """
    try:
        system_prompt = build_transition_narration_prompt(
            ctx["campaign"], ctx["turns"], ctx["npcs"], ctx["lore"]
        )
        text, _ = await asyncio.to_thread(
            ask, ctx["campaign"]["model"], "Describe the moment.",
            "campaign-transition-narration", system_prompt,
        )

        async def broadcast_chunk(i: int, chunk: dict) -> None:
            await live_channel.send_broadcast("narration-audio-chunk", {
                "campaignId": campaign_id, "jobId": job_id, "kind": "transition",
                "sentenceIndex": i, "isNewParagraph": chunk["isNewParagraph"],
                "audioUrl": chunk["url"],
            })

        with time_job(f"generate-transition-audio {job_id}"):
            await _tts_sentences(text.strip(), f"drafts/{job_id}/transition", on_chunk=broadcast_chunk)
    except Exception as e:
        print(f"Transition narration failed for campaign {campaign_id}: {e}")


async def _stream_narration_audio(live_channel, campaign_id: int, job_id: str, content: str) -> None:
    """Fire-and-forget: streams the real narration draft's sentence audio to campaign-live as
    each one is ready. The first sentence is always flagged isNewParagraph so the
    transition -> narration handoff on the frontend reads as a deliberate beat, not a splice.
    """
    try:
        async def broadcast_chunk(i: int, chunk: dict) -> None:
            await live_channel.send_broadcast("narration-audio-chunk", {
                "campaignId": campaign_id, "jobId": job_id, "kind": "narration",
                "sentenceIndex": i, "isNewParagraph": chunk["isNewParagraph"] or i == 0,
                "audioUrl": chunk["url"],
            })

        with time_job(f"generate-narration-audio {job_id}"):
            await _tts_sentences(content, f"drafts/{job_id}/narration", on_chunk=broadcast_chunk)
    except Exception as e:
        print(f"Narration audio streaming failed for campaign {campaign_id}: {e}")


async def handle_generate_puzzle_start(data: dict) -> dict:
    """DM-triggered: drafts the transition narration into a puzzle the DM picked from the
    available list (see handle_list_puzzles). Feeds the same draft/review/publish UI as a normal
    turn — the puzzle is only marked started once the DM actually publishes it (see
    make_handle_publish_turn).
    """
    campaign_id = data["campaignId"]
    puzzle_id = data["puzzleId"]

    puzzle = await asyncio.to_thread(storage.get_puzzle, puzzle_id)
    if puzzle is None or puzzle["campaignId"] != campaign_id:
        raise ValueError(f"Puzzle {puzzle_id} not found for campaign {campaign_id}")

    ctx = await _load_narration_context(campaign_id)
    system_prompt = build_puzzle_start_narration_prompt(
        ctx["campaign"], ctx["turns"], puzzle, ctx["npcs"], ctx["lore"]
    )
    content, _ = await asyncio.to_thread(
        ask, ctx["campaign"]["model"], "Narrate the puzzle's opening now.",
        "campaign-puzzle-start", system_prompt,
    )
    return {"campaignId": campaign_id, "puzzleId": puzzle_id, "content": content.strip()}


def make_handle_generate_turn(live_channel):
    """generate-turn needs live_channel (in addition to the ack this handler's return value sends
    back on the request/response channel it's registered on) to stream narration audio as it's
    generated — see _stream_transition_narration/_stream_narration_audio. The transition and main
    draft are generated concurrently (asyncio.create_task alongside the awaited
    _generate_narration call) so the short, fast transition narration is ready to start playing
    almost immediately while the slower main draft is still being written.
    """
    async def handle_generate_turn(data: dict) -> dict:
        campaign_id = data["campaignId"]
        job_id = data.get("jobId")

        await live_channel.send_broadcast(
            "narration-generation-started", {"campaignId": campaign_id, "jobId": job_id}
        )

        ctx = await _load_narration_context(campaign_id)
        asyncio.create_task(_stream_transition_narration(live_channel, campaign_id, job_id, ctx))

        content = await _generate_narration(campaign_id, data.get("feedback"), ctx=ctx)
        asyncio.create_task(_stream_narration_audio(live_channel, campaign_id, job_id, content))

        return {"campaignId": campaign_id, "content": content}

    return handle_generate_turn


def make_handle_publish_turn(live_channel):
    """publish-turn needs to broadcast on the separate campaign-live topic (so campaign/player
    pages that are passively subscribed there pick it up), in addition to the ack this handler's
    return value sends back to the caller on the request/response channel it was registered on.

    A player's own turn is auto-published — the DM only reviews/edits the AI's narration, not the
    player's stated action — so publishing a player turn also kicks off a fresh batch of short
    branch-option suggestions for the DM to pick from (or write their own direction) before the
    full narration draft is generated. That generation runs as a background task rather than
    being awaited here, so the player's own publish-turn ack returns immediately instead of
    waiting out an LLM call; the DM's page picks up the options once they're broadcast. This does
    mean that generation isn't serialized through the job queue like every other LLM call —
    acceptable for a single-DM scaffold, worth revisiting if concurrent generations ever become a
    real risk.

    NPC/lore auto-extraction fires for every published turn regardless of author (also
    backgrounded) — DM-authored prose introduces new named characters/lore at least as often as a
    player's terse action line does, so it doesn't get the player-only gate the narration draft does.

    DM turns also get their narration audio persisted here (also backgrounded) — see
    _persist_narration_audio. This re-runs TTS over the final published content rather than
    reusing the chunks already streamed live during drafting (see make_handle_generate_turn),
    since the DM may have edited the draft before publishing; it also deliberately doesn't
    rebroadcast narration-audio-chunk, since the player already heard the live draft-time pass —
    this pass is only so the turn has replayable audio in history afterward.

    A puzzle-start draft (see handle_generate_puzzle_start) carries the triggering puzzleId along
    for publish — only here, once the DM has actually sent it to players, does the puzzle flip
    from 'ready' to 'published' and a puzzle-started event go out, so a discarded/regenerated
    draft never uses up the puzzle.
    """
    async def handle_publish_turn(data: dict) -> dict:
        campaign_id = data["campaignId"]
        content = data["content"]
        author = data.get("author", "dm")
        puzzle_id = data.get("puzzleId")

        turn = await asyncio.to_thread(storage.add_turn, campaign_id, content, author)
        await live_channel.send_broadcast("turn-published", {"campaignId": campaign_id, "turn": turn})

        if puzzle_id is not None:
            await asyncio.to_thread(storage.set_puzzle_status, puzzle_id, "published")
            await live_channel.send_broadcast(
                "puzzle-started", {"campaignId": campaign_id, "puzzleId": puzzle_id, "turn": turn}
            )

        asyncio.create_task(_auto_extract_npcs_and_lore(campaign_id))
        if author == "player":
            asyncio.create_task(_auto_suggest_branch_options(live_channel, campaign_id))
        if author == "dm":
            asyncio.create_task(_persist_narration_audio(campaign_id, turn))

        return {"campaignId": campaign_id, "turn": turn}

    return handle_publish_turn


async def _persist_narration_audio(campaign_id: int, turn: dict) -> None:
    try:
        with time_job(f"persist-narration-audio {turn['id']}"):
            chunks = await _tts_sentences(turn["content"], f"{campaign_id}/{turn['id']}")
        await asyncio.to_thread(storage.set_turn_audio_chunks, turn["id"], chunks)
    except Exception as e:
        print(f"Narration audio persistence failed for turn {turn['id']}: {e}")


async def _auto_suggest_branch_options(live_channel, campaign_id: int) -> None:
    try:
        options = await _generate_branch_options(campaign_id)
        await live_channel.send_broadcast("branch-options-generated", {"campaignId": campaign_id, "options": options})
    except Exception as e:
        await live_channel.send_broadcast("branch-options-generated", {"campaignId": campaign_id, "error": str(e)})


def _extraction_lock(campaign_id: int) -> asyncio.Lock:
    lock = _extraction_locks.get(campaign_id)
    if lock is None:
        lock = asyncio.Lock()
        _extraction_locks[campaign_id] = lock
    return lock


async def _auto_extract_npcs_and_lore(campaign_id: int) -> None:
    """Fire-and-forget after every published turn. Serialized per campaign (see
    _extraction_locks) so two turns publishing in quick succession can't both decide the same new
    NPC "doesn't exist yet" and insert it twice; re-reading known npcs/lore fresh inside the lock
    and telling the model about them (same "don't contradict what's fixed" pattern
    plot_points.build_regenerate_plot_points_system_prompt uses for locked plot points) is the
    primary guard. The npcs(campaign_id, name) uniqueness constraint is only a backstop — see
    storage.add_npc.
    """
    try:
        async with _extraction_lock(campaign_id):
            campaign = await asyncio.to_thread(storage.get_campaign, campaign_id)
            if campaign is None:
                return

            turns = await asyncio.to_thread(storage.list_turns, campaign_id)
            recent_text = "\n\n".join(t["content"] for t in turns[-_EXTRACTION_HISTORY_TURNS:])
            if not recent_text.strip():
                return

            known_npcs = await asyncio.to_thread(storage.list_npcs, campaign_id)
            known_lore = await asyncio.to_thread(storage.list_lore, campaign_id)

            npc_result, _ = await asyncio.to_thread(
                ask, campaign["model"], "Extract now.", "campaign-npc-extraction",
                build_npc_extraction_prompt(recent_text, [n["name"] for n in known_npcs]),
                NPC_EXTRACTION_JSON_SCHEMA,
            )
            for npc in json.loads(npc_result).get("npcs", []):
                await asyncio.to_thread(
                    storage.add_npc, campaign_id, npc["name"], "auto",
                    personality=npc.get("personality", ""),
                    backstory=npc.get("backstory", ""),
                    motivations=npc.get("motivations", ""),
                    current_status=npc.get("currentStatus", ""),
                    secrets=npc.get("secrets", ""),
                )

            lore_result, _ = await asyncio.to_thread(
                ask, campaign["model"], "Extract now.", "campaign-lore-extraction",
                build_lore_extraction_prompt(recent_text, [entry["title"] for entry in known_lore]),
                LORE_EXTRACTION_JSON_SCHEMA,
            )
            for entry in json.loads(lore_result).get("lore", []):
                await asyncio.to_thread(
                    storage.add_lore,
                    campaign_id, entry["category"], entry["title"], entry["content"], "auto",
                )
    except Exception as e:
        print(f"NPC/lore auto-extraction failed for campaign {campaign_id}: {e}")
