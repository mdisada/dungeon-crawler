"""Async request handlers for the campaign-builder realtime channel."""
import asyncio
import json
import random

from campaign import storage
from campaign.outline import (
    OUTLINE_JSON_SCHEMA,
    build_outline_system_prompt,
    build_plot_system_prompt,
    build_regenerate_system_prompt,
    validate_outline_counts,
)
from config.llm_models import ollama_models, openrouter_models
from llm import ollama
from llm.manager import ask

ONE_SHOT_CHAPTER_COUNT = 1
ONE_SHOT_SESSIONS_PER_CHAPTER = 1

# Models don't reliably honour array-length bounds via prompt alone (and strict JSON schema
# can't portably enforce minItems/maxItems), so on a count mismatch we retry a couple of times,
# feeding the specific problem back to the model, before giving up.
_MAX_OUTLINE_ATTEMPTS = 3


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


def _resolve_counts(data: dict) -> tuple[int, int]:
    """Picks one exact chapter count and one exact sessions-per-chapter count for this
    generation, instead of handing the model a range (which it doesn't reliably respect).
    """
    if data.get("campaignType") == "one-shot":
        return ONE_SHOT_CHAPTER_COUNT, ONE_SHOT_SESSIONS_PER_CHAPTER

    chapter_count = random.randint(data["minChapters"], data["maxChapters"])
    sessions_per_chapter = random.randint(data["minSessionsPerChapter"], data["maxSessionsPerChapter"])
    return chapter_count, sessions_per_chapter


async def _run_outline_attempts(
    model: str,
    system_prompt: str,
    base_prompt: str,
    expected_chapters: int,
    sessions_per_chapter: int,
) -> tuple[dict, float]:
    """Shared retry loop for both a fresh outline and a partial regenerate — see
    _MAX_OUTLINE_ATTEMPTS above for why this retries at all.
    """
    total_cost = 0.0
    last_error = "outline generation failed"

    for attempt in range(_MAX_OUTLINE_ATTEMPTS):
        user_prompt = base_prompt
        if attempt > 0:
            user_prompt += (
                f"\n\nYour previous attempt was rejected: {last_error} "
                "Regenerate the outline and follow the chapter and session counts exactly."
            )

        result, cost = await asyncio.to_thread(
            ask, model, user_prompt, "campaign-outline", system_prompt, OUTLINE_JSON_SCHEMA
        )
        total_cost += cost

        try:
            outline = json.loads(result)
        except json.JSONDecodeError as e:
            last_error = f"the response was not valid JSON ({e})."
            continue

        count_error = validate_outline_counts(outline, expected_chapters, sessions_per_chapter)
        if count_error is None:
            return outline, total_cost

        last_error = count_error

    raise RuntimeError(f"{last_error} (after {_MAX_OUTLINE_ATTEMPTS} attempts)")


async def handle_generate_outline(data: dict) -> dict:
    model = data["model"]
    plot = data["plot"]
    chapter_count, sessions_per_chapter = _resolve_counts(data)

    system_prompt = build_outline_system_prompt(chapter_count, sessions_per_chapter)
    base_prompt = f"Campaign plot:\n{plot}\n\nGenerate the full campaign outline now."

    outline, cost = await _run_outline_attempts(
        model, system_prompt, base_prompt, chapter_count, sessions_per_chapter
    )
    return {
        "outline": outline,
        "cost": cost,
        "chapterCount": chapter_count,
        "sessionsPerChapter": sessions_per_chapter,
    }


async def handle_regenerate_outline(data: dict) -> dict:
    model = data["model"]
    plot = data["plot"]
    outline = data["outline"]
    chapter_count = data["chapterCount"]
    sessions_per_chapter = data["sessionsPerChapter"]
    chapter_locks = data["locks"]["chapters"]

    chapters = outline["chapters"]
    unlocked_indices = [i for i, cl in enumerate(chapter_locks) if not cl["locked"]]

    if not unlocked_indices:
        return {
            "outline": outline,
            "cost": 0.0,
            "chapterCount": chapter_count,
            "sessionsPerChapter": sessions_per_chapter,
        }

    system_prompt = build_regenerate_system_prompt(
        chapter_count, sessions_per_chapter, chapters, chapter_locks, unlocked_indices
    )
    base_prompt = f"Campaign plot:\n{plot}\n\nGenerate the missing chapters now."

    result, cost = await _run_outline_attempts(
        model, system_prompt, base_prompt, len(unlocked_indices), sessions_per_chapter
    )

    merged = list(chapters)
    for slot, chapter_index in enumerate(unlocked_indices):
        new_chapter = result["chapters"][slot]
        session_locks = chapter_locks[chapter_index]["sessions"]
        original_sessions = chapters[chapter_index]["sessions"]
        for session_index, locked in enumerate(session_locks):
            if locked:
                new_chapter["sessions"][session_index] = original_sessions[session_index]
        merged[chapter_index] = new_chapter

    return {
        "outline": {"chapters": merged},
        "cost": cost,
        "chapterCount": chapter_count,
        "sessionsPerChapter": sessions_per_chapter,
    }


async def handle_save_campaign(data: dict) -> dict:
    campaign_id = await asyncio.to_thread(
        storage.save_campaign,
        data["userId"],
        data["model"],
        data["plot"],
        data["outline"],
        data["campaignType"],
        data["chapterCount"],
        data["sessionsPerChapter"],
        data.get("plotCost", 0.0),
        data.get("outlineCost", 0.0),
        data.get("locks"),
    )
    return {"campaignId": campaign_id}
