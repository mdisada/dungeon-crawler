"""Prompt building for extracting NPCs and world lore mentioned in campaign text.

Used at two call sites with the same shape — a block of text to scan and a list of names/titles
already on record, so the model returns only new or meaningfully distinct entries:
  - campaign/manager.py, once at campaign save, scanning the initial plot text.
  - campaign/session_handlers.py, after every published turn, scanning recent turn content.
"""

NPC_EXTRACTION_JSON_SCHEMA = {
    "name": "npc_extraction",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "npcs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "personality": {"type": "string"},
                        "backstory": {"type": "string"},
                        "motivations": {"type": "string"},
                        "currentStatus": {"type": "string"},
                        "secrets": {"type": "string"},
                    },
                    "required": [
                        "name", "personality", "backstory", "motivations", "currentStatus", "secrets",
                    ],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["npcs"],
        "additionalProperties": False,
    },
}

LORE_EXTRACTION_JSON_SCHEMA = {
    "name": "lore_extraction",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "lore": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "category": {
                            "type": "string",
                            "enum": ["location", "faction", "item", "history", "rule"],
                        },
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["category", "title", "content"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["lore"],
        "additionalProperties": False,
    },
}


def build_npc_extraction_prompt(source_text: str, known_names: list[str]) -> str:
    known_block = (
        f"Already on record (do not recreate these, only genuinely new named characters): "
        f"{', '.join(known_names)}.\n\n"
        if known_names else ""
    )
    return (
        "You are extracting named non-player characters from tabletop RPG text, to build "
        "persistent background so they can be portrayed consistently later.\n\n"
        f"{known_block}"
        f"### TEXT\n{source_text}\n### END TEXT\n\n"
        "List every NEW named NPC actually introduced in this text — skip player characters, "
        "skip unnamed/generic background figures, skip anyone already on record above. For each, "
        "infer a short personality, backstory, motivations, current status (alive/dead, location, "
        "mood), and any secret not yet revealed to players that would help a dungeon master react "
        "to them consistently. If nothing new, return an empty list. Respond with JSON only, "
        "matching the provided schema."
    )


def build_lore_extraction_prompt(source_text: str, known_titles: list[str]) -> str:
    known_block = (
        f"Already on record (do not recreate these, only genuinely new facts): "
        f"{', '.join(known_titles)}.\n\n"
        if known_titles else ""
    )
    return (
        "You are extracting established world lore from tabletop RPG text, to keep locations, "
        "factions, items, history, and rules consistent across future sessions.\n\n"
        f"{known_block}"
        f"### TEXT\n{source_text}\n### END TEXT\n\n"
        "List every NEW concrete, reusable world fact actually established in this text (a "
        "location, faction, item, historical event, or rule) — skip vague scene-setting color "
        "that doesn't fix any lasting detail, skip anything already on record above. If nothing "
        "new, return an empty list. Respond with JSON only, matching the provided schema."
    )
