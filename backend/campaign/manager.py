"""Async request handlers for the campaign-builder realtime channel."""
import asyncio
import json

from campaign import storage
from campaign.extraction import (
    LORE_EXTRACTION_JSON_SCHEMA,
    NPC_EXTRACTION_JSON_SCHEMA,
    build_lore_extraction_prompt,
    build_npc_extraction_prompt,
)
from campaign.plot import (
    build_improve_plot_system_prompt,
    build_plot_system_prompt,
    build_title_system_prompt,
)
from campaign.plot_points import (
    PLOT_POINTS_JSON_SCHEMA,
    build_plot_points_system_prompt,
    build_regenerate_plot_points_system_prompt,
)
from config.llm_models import ollama_models, openrouter_models
from llm import ollama
from llm.manager import ask

# Models don't always return valid JSON on the first try — retry a couple of times before
# giving up. Unlike the old exact-count outline this replaces, there's no count to violate
# anymore, so this only guards against malformed JSON.
_MAX_PLOT_POINTS_ATTEMPTS = 3


async def handle_list_models(data: dict) -> dict:
    ollama_available = await asyncio.to_thread(ollama.is_available)
    return {
        "openrouterModels": openrouter_models,
        "ollamaModels": ollama_models,
        "ollamaAvailable": ollama_available,
    }


async def handle_generate_plot(data: dict) -> dict:
    model = data["model"]
    result, cost = await asyncio.to_thread(
        ask,
        model,
        "Generate a plot idea for a new campaign.",
        "campaign-plot",
        build_plot_system_prompt(),
    )
    return {"plot": result.strip(), "cost": cost}


async def handle_improve_plot(data: dict) -> dict:
    model = data["model"]
    plot = data["plot"]
    result, cost = await asyncio.to_thread(
        ask,
        model,
        "Improve the draft plot idea now.",
        "campaign-plot-improve",
        build_improve_plot_system_prompt(plot),
    )
    return {"plot": result.strip(), "cost": cost}


async def _run_plot_points_attempts(
    model: str, system_prompt: str, base_prompt: str
) -> tuple[dict, float]:
    """Retry loop for both a fresh plot-point guide and a partial regenerate — see
    _MAX_PLOT_POINTS_ATTEMPTS above for why this retries at all.
    """
    total_cost = 0.0
    last_error = "plot point generation failed"

    for attempt in range(_MAX_PLOT_POINTS_ATTEMPTS):
        user_prompt = base_prompt
        if attempt > 0:
            user_prompt += f"\n\nYour previous attempt was rejected: {last_error} Try again."

        result, cost = await asyncio.to_thread(
            ask, model, user_prompt, "campaign-plot-points", system_prompt, PLOT_POINTS_JSON_SCHEMA
        )
        total_cost += cost

        try:
            return json.loads(result), total_cost
        except json.JSONDecodeError as e:
            last_error = f"the response was not valid JSON ({e})."

    raise RuntimeError(f"{last_error} (after {_MAX_PLOT_POINTS_ATTEMPTS} attempts)")


async def handle_generate_plot_points(data: dict) -> dict:
    model = data["model"]
    plot = data["plot"]
    campaign_type = data["campaignType"]

    system_prompt = build_plot_points_system_prompt(campaign_type)
    base_prompt = f"Campaign plot:\n{plot}\n\nGenerate the major plot points now."

    result, cost = await _run_plot_points_attempts(model, system_prompt, base_prompt)
    return {"plotPoints": result["majorPlotPoints"], "cost": cost}


async def handle_regenerate_plot_points(data: dict) -> dict:
    model = data["model"]
    plot = data["plot"]
    plot_points = data["plotPoints"]
    locks = data["locks"]  # flat bool[] parallel to plotPoints — locking is client-side only

    unlocked_indices = [i for i, locked in enumerate(locks) if not locked]
    if not unlocked_indices:
        return {"plotPoints": plot_points, "cost": 0.0}

    system_prompt = build_regenerate_plot_points_system_prompt(plot_points, locks, unlocked_indices)
    base_prompt = f"Campaign plot:\n{plot}\n\nGenerate the missing plot points now."

    result, cost = await _run_plot_points_attempts(model, system_prompt, base_prompt)

    merged = list(plot_points)
    for slot, point_index in enumerate(unlocked_indices):
        merged[point_index] = result["majorPlotPoints"][slot]

    return {"plotPoints": merged, "cost": cost}


async def _seed_npcs_and_lore(campaign_id: int, model: str, plot: str) -> None:
    """Best-effort: pregenerates NPCs/lore explicitly mentioned in the initial plot text so they
    exist before play starts. Extraction failures shouldn't block campaign creation — this is an
    enrichment step, not part of the campaign record itself.
    """
    try:
        npc_result, _ = await asyncio.to_thread(
            ask, model, "Extract now.", "campaign-npc-extraction",
            build_npc_extraction_prompt(plot, []), NPC_EXTRACTION_JSON_SCHEMA,
        )
        for npc in json.loads(npc_result).get("npcs", []):
            await asyncio.to_thread(
                storage.add_npc, campaign_id, npc["name"], "setup",
                personality=npc.get("personality", ""),
                backstory=npc.get("backstory", ""),
                motivations=npc.get("motivations", ""),
                current_status=npc.get("currentStatus", ""),
                secrets=npc.get("secrets", ""),
            )
    except Exception as e:
        print(f"NPC seeding failed for campaign {campaign_id}: {e}")

    try:
        lore_result, _ = await asyncio.to_thread(
            ask, model, "Extract now.", "campaign-lore-extraction",
            build_lore_extraction_prompt(plot, []), LORE_EXTRACTION_JSON_SCHEMA,
        )
        for entry in json.loads(lore_result).get("lore", []):
            await asyncio.to_thread(
                storage.add_lore,
                campaign_id, entry["category"], entry["title"], entry["content"], "setup",
            )
    except Exception as e:
        print(f"Lore seeding failed for campaign {campaign_id}: {e}")


async def handle_save_campaign(data: dict) -> dict:
    model = data["model"]
    plot = data["plot"]

    title, title_cost = await asyncio.to_thread(
        ask, model, "Write the campaign title now.", "campaign-title", build_title_system_prompt(plot),
    )

    campaign_id = await asyncio.to_thread(
        storage.save_campaign,
        data["userId"],
        model,
        title.strip(),
        plot,
        data["campaignType"],
        data["plotPoints"],
        data.get("plotCost", 0.0) + title_cost,
        data.get("generationCost", 0.0),
    )
    await _seed_npcs_and_lore(campaign_id, model, plot)
    return {"campaignId": campaign_id}


async def handle_save_plot_draft(data: dict) -> dict:
    draft = await asyncio.to_thread(
        storage.add_plot_draft, data["userId"], data["content"], data["source"]
    )
    return {"draft": draft}


async def handle_list_plot_drafts(data: dict) -> dict:
    drafts = await asyncio.to_thread(storage.list_plot_drafts, data["userId"])
    return {"drafts": drafts}
