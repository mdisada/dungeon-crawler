"""Prompt building for live session narration (the DM-review turn loop) and the short branch
options shown before a full draft is generated."""
from campaign.world_knowledge import load_world_knowledge

_HISTORY_TURNS = 5

BRANCH_OPTIONS_JSON_SCHEMA = {
    "name": "branch_options",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "options": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["options"],
        "additionalProperties": False,
    },
}


def _world_knowledge_block() -> str:
    knowledge = load_world_knowledge()
    return f"### WORLD KNOWLEDGE\n{knowledge}\n### END WORLD KNOWLEDGE\n\n" if knowledge else ""


def _npc_block(npcs: list[dict]) -> str:
    if not npcs:
        return ""
    lines = []
    for npc in npcs:
        detail = ", ".join(
            part for part in (
                npc.get("personality"),
                npc.get("currentStatus"),
                f"motivated by {npc['motivations']}" if npc.get("motivations") else None,
            ) if part
        )
        lines.append(f"- {npc['name']}: {detail}" if detail else f"- {npc['name']}")
    return "### KNOWN NPCS (portray consistently)\n" + "\n".join(lines) + "\n\n"


def _lore_block(lore: list[dict]) -> str:
    if not lore:
        return ""
    lines = [f"- {entry['title']}: {entry['content']}" for entry in lore]
    return "### ESTABLISHED WORLD LORE (do not contradict)\n" + "\n".join(lines) + "\n\n"


def _pacing_block(turns_since_plot_point: int, next_plot_point: dict | None) -> str:
    if next_plot_point is None:
        return ""
    if turns_since_plot_point < 4:
        urgency = "Gently"
    elif turns_since_plot_point < 8:
        urgency = "Noticeably"
    else:
        urgency = "Decisively — find a way to bring the story to it very soon"
    return (
        f"### PACING\nIt's been {turns_since_plot_point} turn(s) since the story last reached a "
        f"major plot point. {urgency} steer events toward the next one — "
        f"\"{next_plot_point['title']}\": {next_plot_point['summary']}\n\n"
    )


def _story_so_far_block(turns: list[dict]) -> str:
    if not turns:
        return "This is the opening of the session — nothing has happened yet."

    def describe(turn: dict) -> str:
        speaker = "Player" if turn["author"] == "player" else "DM"
        return f"[Turn {turn['turnIndex'] + 1} - {speaker}] {turn['content']}"

    history = "\n\n".join(describe(turn) for turn in turns[-_HISTORY_TURNS:])
    return f"Story so far:\n{history}"


def build_narration_system_prompt(
    campaign: dict,
    npcs: list[dict] | None = None,
    lore: list[dict] | None = None,
    turns_since_plot_point: int = 0,
    next_plot_point: dict | None = None,
) -> str:
    return (
        "You are the Dungeon Master narrating a live tabletop RPG session for a group of "
        "players.\n\n"
        f"{_world_knowledge_block()}"
        f"{_npc_block(npcs or [])}"
        f"{_lore_block(lore or [])}"
        f"{_pacing_block(turns_since_plot_point, next_plot_point)}"
        f"Campaign premise:\n{campaign['plot']}\n\n"
        "Write the next narration beat: 1-2 short paragraphs, no more than about 5 sentences "
        "total, second person ('you'), vivid but concise, ending at a natural moment for the "
        "players to respond. Respond with plain text only, no headings, no JSON."
    )


def build_narration_user_prompt(turns: list[dict], feedback: str | None = None) -> str:
    if not turns:
        base = "This is the opening of the session. Set the scene and start the story."
    else:
        base = (
            f"{_story_so_far_block(turns)}\n\n"
            "Continue the story with the next narration beat, responding to the player's latest "
            "action if there is one."
        )

    if feedback:
        base += f"\n\nDM guidance for this draft — follow it closely: {feedback}"

    return base


def build_transition_narration_prompt(
    campaign: dict,
    turns: list[dict],
    npcs: list[dict] | None = None,
    lore: list[dict] | None = None,
) -> str:
    """A few sentences of pure scene-continuing ambience — no plot progression, no new events or
    characters — spoken while the real next narration beat is still being drafted, so the player
    isn't sitting in silence. See session_handlers.make_handle_generate_turn.
    """
    return (
        "You are the Dungeon Master narrating a live tabletop RPG session for a group of "
        "players. The real next story beat is still being written — for now, fill the moment "
        "with pure atmosphere.\n\n"
        f"{_world_knowledge_block()}"
        f"{_npc_block(npcs or [])}"
        f"{_lore_block(lore or [])}"
        f"Campaign premise:\n{campaign['plot']}\n\n"
        f"{_story_so_far_block(turns)}\n\n"
        "Write 2-3 short sentences of pure ambient description of the current scene — sounds, "
        "light, weather, small background movement, the party's immediate surroundings. Do NOT "
        "advance the plot, introduce new events, new characters, or dialogue, or resolve "
        "anything. Second person ('you'), vivid but brief. Respond with plain text only, no "
        "headings, no JSON."
    )


def build_branch_options_prompt(
    campaign: dict,
    turns: list[dict],
    npcs: list[dict] | None = None,
    lore: list[dict] | None = None,
    turns_since_plot_point: int = 0,
    next_plot_point: dict | None = None,
) -> str:
    """A handful of short, single-sentence directions the story could go next — shown to the DM
    as quick-pick options before a full narration draft is generated for whichever one (or the
    DM's own free-typed direction) they choose. Deliberately not full prose.
    """
    return (
        "You are helping a Dungeon Master keep a live tabletop RPG session moving, without "
        "railroading the players.\n\n"
        f"{_world_knowledge_block()}"
        f"{_npc_block(npcs or [])}"
        f"{_lore_block(lore or [])}"
        f"{_pacing_block(turns_since_plot_point, next_plot_point)}"
        f"Campaign premise:\n{campaign['plot']}\n\n"
        f"{_story_so_far_block(turns)}\n\n"
        "Propose 2-4 short options for what could plausibly happen next — one sentence each, no "
        "more. Make them meaningfully different from each other (a fight, a social angle, a "
        "puzzle/complication, a quiet lead, etc, as fits the scene), and grounded in what's "
        "actually happened so far. The DM will pick one, edit it, or ignore all of them, so keep "
        "each option a suggestion, not a committed script. Respond with JSON only, matching the "
        "provided schema. No prose outside the JSON."
    )
