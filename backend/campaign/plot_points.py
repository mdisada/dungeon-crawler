"""Prompt building and JSON schema for the campaign's major-plot-point story guide.

This is deliberately loose compared to the old chapter/session outline it replaces: no
exact-count requirement, no big_goal/twists/session sub-structure. It's a rough sequence of major
beats used to steer live play (see campaign/narration.py's branch-option prompt) — everything
between these points (fights, puzzles, roleplay, minor twists) is generated dynamically during a
session, not pre-written here.
"""
from campaign.world_knowledge import load_world_knowledge

PLOT_POINTS_JSON_SCHEMA = {
    "name": "campaign_plot_points",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "majorPlotPoints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "summary": {"type": "string"},
                    },
                    "required": ["title", "summary"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["majorPlotPoints"],
        "additionalProperties": False,
    },
}


def _world_knowledge_block() -> str:
    knowledge = load_world_knowledge()
    if not knowledge:
        return ""
    return f"### WORLD KNOWLEDGE\n{knowledge}\n### END WORLD KNOWLEDGE\n\n"


def build_plot_points_system_prompt(campaign_type: str) -> str:
    """campaign_type is a length hint only ('one-shot' vs 'multi-chapter') — there's no exact
    count requirement anymore; the model decides how many major beats the story actually needs.
    """
    length_hint = (
        "This is a one-shot: a single self-contained session, so keep the guide short — often "
        "just one or two major beats (e.g. the inciting incident and the climax)."
        if campaign_type == "one-shot"
        else "This is a multi-chapter campaign, so the guide can span several major beats across "
        "many sessions."
    )

    return (
        "You are sketching the rough, high-level story guide for a narrative tabletop RPG "
        "campaign — NOT a detailed script. This guide exists only to keep a dungeon master "
        "oriented on where the story is headed; everything between these beats (fights, "
        "puzzles, roleplay, minor twists) is improvised live at the table, not written here.\n\n"
        f"{_world_knowledge_block()}"
        f"{length_hint}\n\n"
        "For each major plot point, give a short title and a 1-3 sentence summary of what the "
        "beat is and why it matters — not a rigid hook/climax/cliffhanger script, just enough to "
        "steer improvisation toward it. Order them roughly chronologically. Respond with JSON "
        "only, matching the provided schema. No prose outside the JSON."
    )


def _describe_plot_point(number: int, point: dict, locked: bool) -> str:
    tag = " (FIXED — do not contradict)" if locked else ""
    return f"{number}. {point['title']}{tag}: {point['summary']}"


def build_regenerate_plot_points_system_prompt(
    plot_points: list[dict],
    locks: list[bool],
    unlocked_indices: list[int],
) -> str:
    """Prompt for regenerating only the unlocked plot points of an existing guide — locked ones
    are described as fixed continuity context; the caller enforces they're never overwritten by
    splicing the original content back in after generation (see
    campaign/manager.py's handle_regenerate_plot_points).
    """
    locked_descriptions = [
        _describe_plot_point(i + 1, plot_points[i], True)
        for i in range(len(plot_points))
        if locks[i]
    ]

    context_block = ""
    if locked_descriptions:
        context_block = (
            "### ALREADY-FINALIZED PLOT POINTS (fixed — do not rewrite, use only for continuity)\n"
            + "\n".join(locked_descriptions)
            + "\n### END FINALIZED PLOT POINTS\n\n"
        )

    slot_numbers = ", ".join(str(i + 1) for i in unlocked_indices)

    return (
        "You are revising an existing major-plot-point story guide for a narrative tabletop RPG. "
        "Some plot points are already finalized; you are writing replacements only for the "
        "remaining ones, keeping them consistent with what's already fixed.\n\n"
        f"{_world_knowledge_block()}"
        f"{context_block}"
        f"The full guide has {len(plot_points)} plot point(s) total; you are writing "
        f"replacements for slot(s) {slot_numbers} only. Output exactly {len(unlocked_indices)} "
        "plot point(s), in that order, each with a short title and a 1-3 sentence summary.\n\n"
        "Respond with JSON only, matching the provided schema. No prose outside the JSON."
    )
