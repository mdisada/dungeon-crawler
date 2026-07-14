"""Prompt building and JSON schemas for the text-to-puzzle compiler.

Puzzles are authored only at campaign creation (wizard): detected from the plot text, picked
from templates, or compiled from a creator's description. A puzzle definition is a small
signals -> gates -> effects machine (see the building-blocks block below) that the live-play
engine (campaign/puzzle_engine.py) executes mechanically, with free-text attempts falling
through to an LLM referee. Everything here is authoring-time; play-time prompts join this
module in a later phase.
"""

# Ordered simple -> complex; `seed` pre-fills the compiler description for describe-your-own.
# sliding-blocks is deliberately absent: it's the one classic archetype needing movable-element
# physics and position-based win conditions, deferred to v2.
ARCHETYPES = [
    {"id": "riddle", "label": "Riddle", "presentation": "text",
     "seed": "A guardian poses a riddle; players must speak the correct answer aloud."},
    {"id": "cipher", "label": "Cipher", "presentation": "text",
     "seed": "A coded message must be deciphered; the key is hidden in nearby clues."},
    {"id": "truth-liar", "label": "Truth-teller & liar", "presentation": "text",
     "seed": "Two guardians, one always lies and one always tells the truth; players may question them, then must choose."},
    {"id": "cursed-choice", "label": "Cursed choice", "presentation": "text",
     "seed": "Several doors or offerings, each exacting a different price; there is no free option."},
    {"id": "trading-chain", "label": "Trading chain", "presentation": "text",
     "seed": "A chain of characters who each want something another one holds; satisfy them all to earn the prize."},
    {"id": "pressure-plates", "label": "Pressure plates", "presentation": "map",
     "seed": "Floor plates that must be held down in the right combination to open the way."},
    {"id": "lever-combination", "label": "Lever combination", "presentation": "map",
     "seed": "A bank of levers that must be set to the correct positions; clues hint at the combination."},
    {"id": "sequence", "label": "Sequence", "presentation": "map",
     "seed": "Objects that must be activated in a specific order; a mistake resets the progress."},
    {"id": "elemental-altars", "label": "Elemental altars", "presentation": "map",
     "seed": "Altars of fire, water, earth and air that must be attuned in the right order."},
    {"id": "skill-gauntlet", "label": "Skill gauntlet", "presentation": "map",
     "seed": "Physical obstacles gated by ability checks - a stuck door, a crumbling ledge, a chasm jump."},
    {"id": "light-beams", "label": "Light beams", "presentation": "map",
     "seed": "Rotatable mirrors that must be oriented so a light beam reaches its target."},
    {"id": "timed-escape", "label": "Timed escape", "presentation": "map",
     "seed": "The room is closing in; players have a limited number of attempts to find the way out."},
    {"id": "contraption", "label": "Contraption", "presentation": "map",
     "seed": "A multi-stage mechanism where each solved part unlocks or changes the next."},
    {"id": "custom", "label": "Custom", "presentation": "text", "seed": ""},
]

ELEMENT_KINDS = [
    "lever", "dial", "plate", "door", "inscription", "item", "mechanism", "npc", "marker",
]

# --- strict-schema fragments -------------------------------------------------------------------
# OpenRouter strict mode requires additionalProperties:false and every property listed in
# `required`; optional fields are expressed as nullable types instead. Effects are one flat
# object with nullable params (rather than a union of shapes) for the same reason.

_EFFECT_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": ["narrate", "set-state", "reveal-element", "reveal-hint",
                     "ai-instruction", "solve", "fail"],
        },
        "text": {"type": ["string", "null"]},         # narrate
        "elementId": {"type": ["string", "null"]},    # set-state | reveal-element
        "state": {"type": ["string", "null"]},        # set-state
        "instruction": {"type": ["string", "null"]},  # ai-instruction
    },
    "required": ["type", "text", "elementId", "state", "instruction"],
    "additionalProperties": False,
}

_EFFECTS_ARRAY = {"type": "array", "items": _EFFECT_SCHEMA}

_GATE_SCHEMA = {
    "anyOf": [
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["element-state", "skill-check"]},
                "elementId": {"type": ["string", "null"]},  # element-state
                "state": {"type": ["string", "null"]},      # element-state
                "skill": {"type": ["string", "null"]},      # skill-check
                "dc": {"type": ["integer", "null"]},        # skill-check
            },
            "required": ["kind", "elementId", "state", "skill", "dc"],
            "additionalProperties": False,
        },
        {"type": "null"},
    ],
}

_POSITION_SCHEMA = {
    "anyOf": [
        {
            "type": "object",
            "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
            "required": ["x", "y"],
            "additionalProperties": False,
        },
        {"type": "null"},
    ],
}

_TILE_TRIGGER_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "on": {"type": "string", "enum": ["enter", "exit"]},
        "x": {"type": "integer"},
        "y": {"type": "integer"},
        "requires": _GATE_SCHEMA,
        "effects": _EFFECTS_ARRAY,
        "onFail": _EFFECTS_ARRAY,
        "once": {"type": "boolean"},
        "hidden": {"type": "boolean"},
    },
    "required": ["id", "on", "x", "y", "requires", "effects", "onFail", "once", "hidden"],
    "additionalProperties": False,
}

_INTERACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "label": {"type": "string"},
        "requires": _GATE_SCHEMA,
        "effects": _EFFECTS_ARRAY,
        "onFail": _EFFECTS_ARRAY,
    },
    "required": ["id", "label", "requires", "effects", "onFail"],
    "additionalProperties": False,
}

_STATE_TRIGGER_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "when": {
            "type": "object",
            "properties": {"elementId": {"type": "string"}, "state": {"type": "string"}},
            "required": ["elementId", "state"],
            "additionalProperties": False,
        },
        "effects": _EFFECTS_ARRAY,
        "once": {"type": "boolean"},
    },
    "required": ["id", "when", "effects", "once"],
    "additionalProperties": False,
}

_ELEMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "kind": {"type": "string", "enum": ELEMENT_KINDS},
        "description": {"type": "string"},
        "position": _POSITION_SCHEMA,
        "hidden": {"type": "boolean"},
        "states": {"type": "array", "items": {"type": "string"}},
        "initialState": {"type": ["string", "null"]},
        "interactions": {"type": "array", "items": _INTERACTION_SCHEMA},
        "revealText": {"type": ["string", "null"]},
    },
    "required": ["id", "name", "kind", "description", "position", "hidden", "states",
                 "initialState", "interactions", "revealText"],
    "additionalProperties": False,
}

_GRID_SCHEMA = {
    "anyOf": [
        {
            "type": "object",
            "properties": {
                "width": {"type": "integer"},
                "height": {"type": "integer"},
                "imageUrl": {"type": ["string", "null"]},
                "blockedTiles": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
                        "required": ["x", "y"],
                        "additionalProperties": False,
                    },
                },
                "tileTriggers": {"type": "array", "items": _TILE_TRIGGER_SCHEMA},
            },
            "required": ["width", "height", "imageUrl", "blockedTiles", "tileTriggers"],
            "additionalProperties": False,
        },
        {"type": "null"},
    ],
}

_WIN_CONDITION_SCHEMA = {
    "type": "object",
    "properties": {
        "requiredStates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"elementId": {"type": "string"}, "state": {"type": "string"}},
                "required": ["elementId", "state"],
                "additionalProperties": False,
            },
        },
        "sequence": {
            "anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "elementIds": {"type": "array", "items": {"type": "string"}},
                        "resetOnMistake": {"type": "boolean"},
                    },
                    "required": ["elementIds", "resetOnMistake"],
                    "additionalProperties": False,
                },
                {"type": "null"},
            ],
        },
        "solutionText": {"type": ["string", "null"]},
    },
    "required": ["requiredStates", "sequence", "solutionText"],
    "additionalProperties": False,
}

_DEFINITION_PROPERTIES = {
    "title": {"type": "string"},
    "presentation": {"type": "string", "enum": ["map", "text"]},
    "archetype": {"type": "string"},
    "description": {"type": "string"},
    "dmNotes": {"type": "string"},
    "grid": _GRID_SCHEMA,
    "elements": {"type": "array", "items": _ELEMENT_SCHEMA},
    "stateTriggers": {"type": "array", "items": _STATE_TRIGGER_SCHEMA},
    "winCondition": _WIN_CONDITION_SCHEMA,
    "hints": {"type": "array", "items": {"type": "string"}},
    "maxAttempts": {"type": ["integer", "null"]},
    "successText": {"type": "string"},
    "failText": {"type": ["string", "null"]},
}

_DEFINITION_OBJECT_SCHEMA = {
    "type": "object",
    "properties": _DEFINITION_PROPERTIES,
    "required": list(_DEFINITION_PROPERTIES),
    "additionalProperties": False,
}

PUZZLE_DEFINITION_JSON_SCHEMA = {
    "name": "puzzle_definition",
    "strict": True,
    "schema": _DEFINITION_OBJECT_SCHEMA,
}

PUZZLE_DETECTION_JSON_SCHEMA = {
    "name": "puzzle_detection",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "puzzles": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        # 0-based index into the plot-point list shown in the prompt; null when
                        # the puzzle isn't tied to a specific beat.
                        "plotPointIndex": {"type": ["integer", "null"]},
                        "puzzle": _DEFINITION_OBJECT_SCHEMA,
                    },
                    "required": ["plotPointIndex", "puzzle"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["puzzles"],
        "additionalProperties": False,
    },
}


def _building_blocks_block() -> str:
    """The shared rulebook both authoring prompts teach from — the whole puzzle system compiles
    to this one small vocabulary, so keep the rules here and nowhere else.
    """
    return (
        "### PUZZLE BUILDING BLOCKS\n"
        "A puzzle is a set of ELEMENTS (levers, plates, doors, inscriptions, NPCs, ...) wired\n"
        "together with TRIGGERS that fire EFFECTS:\n"
        "- Tile triggers (map puzzles only): fire when a player token enters/exits a grid square\n"
        "  (traps, weight-sensitive floors).\n"
        "- Interactions: labeled actions players choose when clicking an element ('Pull the\n"
        "  lever') — each fires its effects.\n"
        "- State triggers: fire when an element enters a given state — use these to chain\n"
        "  reactions (lever down -> door opens).\n"
        "Effects (the ONLY vocabulary available; irrelevant params must be null):\n"
        "- narrate: show pre-written flavor text (set `text`).\n"
        "- set-state: put an element into one of its declared states (set `elementId`, `state`).\n"
        "- reveal-element: unhide a hidden element (set `elementId`).\n"
        "- reveal-hint: unlock the next progressive hint.\n"
        "- ai-instruction: hand the game's AI referee a pre-written instruction to improvise\n"
        "  from (set `instruction`, e.g. 'Narrate a dart trap firing from the wall; frightening\n"
        "  but no lasting harm').\n"
        "- solve / fail: end the puzzle in success or failure.\n"
        "Gates: any tile trigger or interaction may set `requires` — either an element-state\n"
        "check {kind: 'element-state', elementId, state} or a skill check {kind: 'skill-check',\n"
        "skill, dc} resolved by a d20 roll. When the gate fails, the `onFail` effects fire\n"
        "instead of `effects`.\n"
        "Win: the puzzle is solved when every winCondition.requiredStates entry holds AND the\n"
        "optional ordered `sequence` has been completed; a `solve` effect also ends it, as does\n"
        "the AI referee accepting a free-text answer. For riddle-style puzzles leave\n"
        "requiredStates empty and put the expected answer in winCondition.solutionText.\n"
        "Hard rules:\n"
        "- presentation 'text': `grid` MUST be null and every element `position` MUST be null.\n"
        "- presentation 'map': `grid` MUST be provided (keep it small, at most 12x12; set\n"
        "  imageUrl to null — the creator attaches a map image later); element positions must\n"
        "  lie inside the grid and off blockedTiles.\n"
        "- plate elements must declare exactly the states ['pressed', 'released'] with\n"
        "  initialState 'released'; a plate's state is derived from token occupancy — never\n"
        "  target a plate with set-state.\n"
        "- every elementId/state referenced anywhere must point at a declared element and one\n"
        "  of its declared states; every id must be a unique lowercase slug.\n"
        "- give 1-3 progressive `hints`, vaguest first.\n"
        "- `description` is read aloud to the players when the puzzle starts; `dmNotes` and\n"
        "  `solutionText` stay hidden from them.\n"
        "### END PUZZLE BUILDING BLOCKS\n"
    )


def _archetype_block(archetype: str) -> str:
    entry = next((a for a in ARCHETYPES if a["id"] == archetype), None)
    if entry is None or entry["id"] == "custom":
        return ""
    return (
        f"The creator picked the '{entry['label']}' archetype "
        f"(typical presentation: {entry['presentation']}): {entry['seed']}\n\n"
    )


def build_compile_puzzle_system_prompt(archetype: str, presentation_hint: str | None) -> str:
    presentation_block = (
        f"The creator wants a '{presentation_hint}' puzzle — use that presentation.\n\n"
        if presentation_hint
        else "Choose the presentation ('map' or 'text') that best fits the idea.\n\n"
    )
    return (
        "You are compiling a puzzle for a narrative tabletop RPG campaign into a structured,\n"
        "machine-runnable definition. The creator describes the puzzle in plain language; you\n"
        "express it exactly using the building blocks below — nothing outside that vocabulary\n"
        "can be executed by the game engine.\n\n"
        f"{_building_blocks_block()}\n"
        f"{_archetype_block(archetype)}"
        f"{presentation_block}"
        "Keep the puzzle self-contained and solvable from the information the players can\n"
        "reach. Respond with JSON only, matching the provided schema. No prose outside the JSON."
    )


def build_compile_puzzle_user_prompt(
    description: str,
    existing_definition_json: str | None,
    feedback: str | None,
    campaign_plot: str | None,
) -> str:
    parts = []
    if campaign_plot:
        parts.append(f"Campaign premise (match its tone and setting):\n{campaign_plot}")
    if existing_definition_json:
        parts.append(
            "Current puzzle definition (revise it, keeping what still fits):\n"
            + existing_definition_json
        )
        if feedback:
            parts.append(f"Creator feedback to apply:\n{feedback}")
    if description:
        parts.append(f"Puzzle idea:\n{description}")
    parts.append("Compile the puzzle definition now.")
    return "\n\n".join(parts)


def build_detect_puzzles_system_prompt() -> str:
    return (
        "You are reading the premise and story guide of a narrative tabletop RPG campaign,\n"
        "looking for puzzles the author has already implied or requested — a riddle-sealed\n"
        "vault, a trapped corridor, a mechanism that must be solved. Compile each one into a\n"
        "structured, machine-runnable definition using the building blocks below.\n\n"
        f"{_building_blocks_block()}\n"
        "Only surface puzzles the text clearly calls for — do NOT invent puzzles to pad the\n"
        "list; an empty list is a perfectly good answer. For each puzzle set plotPointIndex to\n"
        "the 0-based index of the plot point it belongs to, or null if it isn't tied to a\n"
        "specific beat. Respond with JSON only, matching the provided schema. No prose outside\n"
        "the JSON."
    )


def build_detect_puzzles_user_prompt(plot: str, plot_points: list[dict]) -> str:
    points_block = "\n".join(
        f"{i}. {point['title']}: {point['summary']}" for i, point in enumerate(plot_points)
    )
    return (
        f"Campaign plot:\n{plot}\n\n"
        f"Major plot points (0-based indices):\n{points_block}\n\n"
        "Detect and compile the implied puzzles now."
    )
