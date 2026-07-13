"""Prompt building, JSON schema, and bounds validation for campaign outline generation."""
from campaign.world_knowledge import load_world_knowledge

OUTLINE_JSON_SCHEMA = {
    "name": "campaign_outline",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "chapters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "bigGoal": {"type": "string"},
                        "twists": {"type": "array", "items": {"type": "string"}},
                        "sessions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "hook": {"type": "string"},
                                    "conflictClimax": {"type": "string"},
                                    "cliffhanger": {"type": "string"},
                                },
                                "required": ["hook", "conflictClimax", "cliffhanger"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["title", "bigGoal", "twists", "sessions"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["chapters"],
        "additionalProperties": False,
    },
}


def _world_knowledge_block() -> str:
    knowledge = load_world_knowledge()
    if not knowledge:
        return ""
    return f"### WORLD KNOWLEDGE\n{knowledge}\n### END WORLD KNOWLEDGE\n\n"


def build_plot_system_prompt() -> str:
    return (
        "You are a creative writing assistant generating a campaign plot idea for a narrative tabletop RPG.\n\n"
        f"{_world_knowledge_block()}"
        "Write a 2-4 sentence plot idea grounded in the world knowledge above (if any is given). "
        "Respond with plain text only, no headings, no JSON."
    )


def _plural(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def build_outline_system_prompt(chapter_count: int, sessions_per_chapter: int) -> str:
    """chapter_count and sessions_per_chapter are exact, precomputed counts (see
    campaign/manager.py's _resolve_counts) — never a range. Models don't reliably honour
    "between X and Y" instructions, so the caller picks one number and this prompt states it
    as a hard requirement.

    A one-shot is chapter_count == 1 and sessions_per_chapter == 1. It's still stored using the
    same chapters/sessions schema (see campaign/storage.py), but the model is told to write it
    as a single self-contained story rather than a "campaign" — no chapter/session framing that
    would leak into the generated text.
    """
    if chapter_count == 1 and sessions_per_chapter == 1:
        return (
            "You are generating a one-shot adventure outline for a narrative tabletop RPG — a "
            "single self-contained story told in one session, not a multi-part campaign.\n\n"
            f"{_world_knowledge_block()}"
            "Structure rules:\n"
            "- The outline has one title, one big goal that drives the story, and a list of "
            "twists or turns.\n"
            "- It has a hook that opens the session, a dilemma/conflict/climax describing its "
            "central tension, and a cliffhanger or natural stopping point that closes it.\n\n"
            "Respond with JSON only, matching the provided schema. No prose outside the JSON."
        )

    return (
        "You are generating a full campaign outline for a narrative tabletop RPG.\n\n"
        f"{_world_knowledge_block()}"
        "Structure rules:\n"
        "- The outline is a list of chapters.\n"
        "- Each chapter has a title, one big goal that drives the chapter, a list of twists "
        "or turns, and a list of sessions.\n"
        "- Each session has a hook that opens it, a dilemma/conflict/climax describing its "
        "central tension, and a cliffhanger or natural stopping point that closes it.\n\n"
        "Count requirements (STRICT — the outline will be rejected if these are not followed "
        "exactly):\n"
        f"- Generate exactly {_plural(chapter_count, 'chapter')}. Not more, not fewer.\n"
        f"- Every single chapter must have exactly {_plural(sessions_per_chapter, 'session')} "
        "— not more, not fewer.\n\n"
        "Respond with JSON only, matching the provided schema. No prose outside the JSON."
    )


def _describe_chapter(chapter_number: int, chapter: dict, session_locks: list[bool]) -> str:
    lines = [f"Chapter {chapter_number}: {chapter['title']}", f"Big goal: {chapter['bigGoal']}"]
    if chapter.get("twists"):
        lines.append("Twists: " + "; ".join(chapter["twists"]))
    for session_index, session in enumerate(chapter.get("sessions", [])):
        tag = " (FIXED — do not contradict)" if session_locks[session_index] else ""
        lines.append(
            f"  Session {session_index + 1}{tag}: hook={session['hook']!r} "
            f"conflict/climax={session['conflictClimax']!r} cliffhanger={session['cliffhanger']!r}"
        )
    return "\n".join(lines)


def build_regenerate_system_prompt(
    chapter_count: int,
    sessions_per_chapter: int,
    chapters: list[dict],
    chapter_locks: list[dict],
    unlocked_indices: list[int],
) -> str:
    """Prompt for regenerating only the unlocked chapters of an existing outline.

    Locked chapters (and locked sessions within an otherwise-unlocked chapter) are described as
    fixed continuity context — the caller enforces they're never overwritten by splicing the
    original content back in after generation, this prompt is only there to keep the newly
    written material narratively consistent with what's already fixed.
    """
    locked_descriptions = [
        _describe_chapter(i + 1, chapters[i], chapter_locks[i]["sessions"])
        for i in range(len(chapters))
        if chapter_locks[i]["locked"]
    ]
    fixed_sessions_context = [
        _describe_chapter(i + 1, chapters[i], chapter_locks[i]["sessions"])
        for i in unlocked_indices
        if any(chapter_locks[i]["sessions"])
    ]

    context_block = ""
    if locked_descriptions:
        context_block += (
            "### ALREADY-FINALIZED CHAPTERS (fixed — do not rewrite, use only for continuity)\n"
            + "\n\n".join(locked_descriptions)
            + "\n### END FINALIZED CHAPTERS\n\n"
        )
    if fixed_sessions_context:
        context_block += (
            "### CHAPTERS BEING REVISED WITH SOME FIXED SESSIONS (sessions marked FIXED above "
            "must not be contradicted; you may still rewrite the chapter's other fields)\n"
            + "\n\n".join(fixed_sessions_context)
            + "\n### END\n\n"
        )

    slot_numbers = ", ".join(str(i + 1) for i in unlocked_indices)

    return (
        "You are revising an existing campaign outline for a narrative tabletop RPG. Some "
        "chapters are already finalized; you are writing replacements only for the remaining "
        "chapters, keeping them consistent with what's already fixed.\n\n"
        f"{_world_knowledge_block()}"
        f"{context_block}"
        "Structure rules:\n"
        "- Each chapter has a title, one big goal that drives the chapter, a list of twists "
        "or turns, and a list of sessions.\n"
        "- Each session has a hook that opens it, a dilemma/conflict/climax describing its "
        "central tension, and a cliffhanger or natural stopping point that closes it.\n\n"
        "Count requirements (STRICT — the outline will be rejected if these are not followed "
        "exactly):\n"
        f"- The full campaign has {_plural(chapter_count, 'chapter')} total; you are writing "
        f"replacements for chapter slot(s) {slot_numbers} only. Output exactly "
        f"{_plural(len(unlocked_indices), 'chapter')}, in that order.\n"
        f"- Every chapter you write must have exactly {_plural(sessions_per_chapter, 'session')} "
        "— not more, not fewer.\n\n"
        "Respond with JSON only, matching the provided schema. No prose outside the JSON."
    )


def validate_outline_counts(outline: dict, chapter_count: int, sessions_per_chapter: int) -> str | None:
    """Returns an error message if the outline doesn't match the exact requested counts, else None."""
    chapters = outline.get("chapters", [])

    if len(chapters) != chapter_count:
        return f"Generated outline has {len(chapters)} chapters, expected exactly {chapter_count}."

    for index, chapter in enumerate(chapters):
        sessions = chapter.get("sessions", [])
        if len(sessions) != sessions_per_chapter:
            return (
                f"Chapter {index + 1} ('{chapter.get('title', '?')}') has {len(sessions)} "
                f"sessions, expected exactly {sessions_per_chapter}."
            )

    return None
