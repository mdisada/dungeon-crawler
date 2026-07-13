"""Async request handlers for the live campaign-session realtime channels.

Split from campaign/manager.py (which owns the pre-session outline-builder flow): these handlers
serve the "open campaign" loop — listing a user's campaigns, loading one, the short branch-option
menu, and the AI-drafts / DM-reviews-and-publishes turn cycle.
"""
import asyncio
import json

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
)
from llm.manager import ask

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


async def handle_generate_branch_options(data: dict) -> dict:
    campaign_id = data["campaignId"]
    ctx = await _load_narration_context(campaign_id)

    system_prompt = build_branch_options_prompt(
        ctx["campaign"], ctx["turns"], ctx["npcs"], ctx["lore"],
        ctx["turns_since_plot_point"], ctx["next_plot_point"],
    )
    result, cost = await asyncio.to_thread(
        ask, ctx["campaign"]["model"], "Propose the options now.", "campaign-branch-options",
        system_prompt, BRANCH_OPTIONS_JSON_SCHEMA,
    )
    options = json.loads(result).get("options", [])
    return {"campaignId": campaign_id, "options": options, "cost": cost}


async def _generate_narration(campaign_id: int, feedback: str | None = None) -> str:
    """Shared by the DM's manual "Generate AI turn"/"Regenerate with feedback" actions and the
    automatic draft triggered after a player's turn is published (see make_handle_publish_turn).
    `feedback` is also the DM's escape hatch to ignore the branch-option menu entirely and steer
    the draft in a direction of their own choosing.
    """
    ctx = await _load_narration_context(campaign_id)

    system_prompt = build_narration_system_prompt(
        ctx["campaign"], ctx["npcs"], ctx["lore"], ctx["turns_since_plot_point"], ctx["next_plot_point"],
    )
    user_prompt = build_narration_user_prompt(ctx["turns"], feedback)

    content, _ = await asyncio.to_thread(
        ask, ctx["campaign"]["model"], user_prompt, "campaign-narration", system_prompt
    )
    return content.strip()


async def handle_generate_turn(data: dict) -> dict:
    campaign_id = data["campaignId"]
    content = await _generate_narration(campaign_id, data.get("feedback"))
    return {"campaignId": campaign_id, "content": content}


def make_handle_publish_turn(live_channel):
    """publish-turn needs to broadcast on the separate campaign-live topic (so campaign/player
    pages that are passively subscribed there pick it up), in addition to the ack this handler's
    return value sends back to the caller on the request/response channel it was registered on.

    A player's own turn is auto-published — the DM only reviews/edits the AI's narration, not the
    player's stated action — so publishing a player turn also kicks off the next AI draft. That
    generation runs as a background task rather than being awaited here, so the player's own
    publish-turn ack returns immediately instead of waiting out an LLM call; the DM's page picks
    up the draft once it's broadcast. This does mean that draft generation isn't serialized
    through the job queue like every other LLM call — acceptable for a single-DM scaffold, worth
    revisiting if concurrent generations ever become a real risk.

    NPC/lore auto-extraction fires for every published turn regardless of author (also
    backgrounded) — DM-authored prose introduces new named characters/lore at least as often as a
    player's terse action line does, so it doesn't get the player-only gate the narration draft does.
    """
    async def handle_publish_turn(data: dict) -> dict:
        campaign_id = data["campaignId"]
        content = data["content"]
        author = data.get("author", "dm")

        turn = await asyncio.to_thread(storage.add_turn, campaign_id, content, author)
        await live_channel.send_broadcast("turn-published", {"campaignId": campaign_id, "turn": turn})

        asyncio.create_task(_auto_extract_npcs_and_lore(campaign_id))
        if author == "player":
            asyncio.create_task(_auto_draft_next_turn(live_channel, campaign_id))

        return {"campaignId": campaign_id, "turn": turn}

    return handle_publish_turn


async def _auto_draft_next_turn(live_channel, campaign_id: int) -> None:
    try:
        content = await _generate_narration(campaign_id)
        await live_channel.send_broadcast("turn-drafted", {"campaignId": campaign_id, "content": content})
    except Exception as e:
        await live_channel.send_broadcast("turn-drafted", {"campaignId": campaign_id, "error": str(e)})


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
