"""Pure puzzle-definition/state logic — no I/O, no LLM, no realtime.

Phase 1 ships only definition validation (the compile retry loop feeds these errors back to
the model). Live-play state transitions (moves, triggers, win evaluation) join this module in
later phases.
"""

_PLATE_STATES = ["pressed", "released"]


def _grid_contains(grid: dict, x: int, y: int) -> bool:
    return 0 <= x < grid["width"] and 0 <= y < grid["height"]


def _is_blocked(grid: dict, x: int, y: int) -> bool:
    return any(tile["x"] == x and tile["y"] == y for tile in grid["blockedTiles"])


def _validate_effects(effects: list[dict], where: str, elements_by_id: dict, errors: list[str]) -> None:
    for effect in effects:
        kind = effect.get("type")
        if kind == "narrate" and not effect.get("text"):
            errors.append(f"{where}: narrate effect is missing `text`")
        elif kind == "ai-instruction" and not effect.get("instruction"):
            errors.append(f"{where}: ai-instruction effect is missing `instruction`")
        elif kind in ("set-state", "reveal-element"):
            element = elements_by_id.get(effect.get("elementId"))
            if element is None:
                errors.append(f"{where}: {kind} targets unknown element '{effect.get('elementId')}'")
            elif kind == "set-state":
                if effect.get("state") not in element["states"]:
                    errors.append(
                        f"{where}: set-state puts '{element['id']}' into undeclared state "
                        f"'{effect.get('state')}'"
                    )
                elif element["kind"] == "plate":
                    errors.append(
                        f"{where}: set-state targets plate '{element['id']}' — plate state is "
                        "derived from token occupancy"
                    )


def _validate_gate(gate: dict | None, where: str, elements_by_id: dict, errors: list[str]) -> None:
    if gate is None:
        return
    if gate["kind"] == "element-state":
        element = elements_by_id.get(gate.get("elementId"))
        if element is None:
            errors.append(f"{where}: gate references unknown element '{gate.get('elementId')}'")
        elif gate.get("state") not in element["states"]:
            errors.append(
                f"{where}: gate requires '{gate.get('elementId')}' in undeclared state "
                f"'{gate.get('state')}'"
            )
    elif gate["kind"] == "skill-check":
        if not gate.get("skill") or gate.get("dc") is None:
            errors.append(f"{where}: skill-check gate needs both `skill` and `dc`")
        elif not 1 <= gate["dc"] <= 30:
            errors.append(f"{where}: skill-check dc {gate['dc']} is outside 1-30")


def validate_definition(definition: dict) -> list[str]:
    """Returns a list of human-readable problems; empty means the definition is playable.
    Structural shape (types, required keys) is already enforced by the strict JSON schema —
    this checks the semantics the schema can't express (cross-references, grid bounds, plate
    rules).
    """
    errors: list[str] = []
    grid = definition["grid"]
    presentation = definition["presentation"]

    if presentation == "map" and grid is None:
        errors.append("map puzzle has no grid")
    if presentation == "text" and grid is not None:
        errors.append("text puzzle must not have a grid")
    if grid is not None and (grid["width"] < 1 or grid["height"] < 1 or grid["width"] > 20 or grid["height"] > 20):
        errors.append("grid must be between 1x1 and 20x20")

    elements_by_id: dict[str, dict] = {}
    for element in definition["elements"]:
        if element["id"] in elements_by_id:
            errors.append(f"duplicate element id '{element['id']}'")
        elements_by_id[element["id"]] = element

    seen_trigger_ids: set[str] = set()

    for element in definition["elements"]:
        where = f"element '{element['id']}'"
        if element["initialState"] is not None and element["initialState"] not in element["states"]:
            errors.append(f"{where}: initialState '{element['initialState']}' not in declared states")
        if element["states"] and element["initialState"] is None:
            errors.append(f"{where}: declares states but no initialState")
        if element["kind"] == "plate":
            if sorted(element["states"]) != sorted(_PLATE_STATES):
                errors.append(f"{where}: plates must declare exactly the states {_PLATE_STATES}")
            elif element["initialState"] != "released":
                errors.append(f"{where}: plates must start 'released'")
            if presentation == "text":
                errors.append(f"{where}: plates need a map (token occupancy drives them)")
            elif element["position"] is None:
                errors.append(f"{where}: plates must have a position")

        position = element["position"]
        if presentation == "text" and position is not None:
            errors.append(f"{where}: text puzzles must not position elements")
        if position is not None and grid is not None:
            if not _grid_contains(grid, position["x"], position["y"]):
                errors.append(f"{where}: position ({position['x']},{position['y']}) is outside the grid")
            elif _is_blocked(grid, position["x"], position["y"]):
                errors.append(f"{where}: position ({position['x']},{position['y']}) is on a blocked tile")

        for interaction in element["interactions"]:
            interaction_where = f"{where} interaction '{interaction['id']}'"
            if interaction["id"] in seen_trigger_ids:
                errors.append(f"duplicate trigger/interaction id '{interaction['id']}'")
            seen_trigger_ids.add(interaction["id"])
            _validate_gate(interaction["requires"], interaction_where, elements_by_id, errors)
            _validate_effects(interaction["effects"], interaction_where, elements_by_id, errors)
            _validate_effects(interaction["onFail"], interaction_where, elements_by_id, errors)
            if interaction["requires"] is None and interaction["onFail"]:
                errors.append(f"{interaction_where}: has onFail effects but no gate")

    if grid is not None:
        for trigger in grid["tileTriggers"]:
            where = f"tile trigger '{trigger['id']}'"
            if trigger["id"] in seen_trigger_ids:
                errors.append(f"duplicate trigger/interaction id '{trigger['id']}'")
            seen_trigger_ids.add(trigger["id"])
            if not _grid_contains(grid, trigger["x"], trigger["y"]):
                errors.append(f"{where}: tile ({trigger['x']},{trigger['y']}) is outside the grid")
            _validate_gate(trigger["requires"], where, elements_by_id, errors)
            _validate_effects(trigger["effects"], where, elements_by_id, errors)
            _validate_effects(trigger["onFail"], where, elements_by_id, errors)

    for trigger in definition["stateTriggers"]:
        where = f"state trigger '{trigger['id']}'"
        if trigger["id"] in seen_trigger_ids:
            errors.append(f"duplicate trigger/interaction id '{trigger['id']}'")
        seen_trigger_ids.add(trigger["id"])
        when = trigger["when"]
        element = elements_by_id.get(when["elementId"])
        if element is None:
            errors.append(f"{where}: watches unknown element '{when['elementId']}'")
        elif when["state"] not in element["states"]:
            errors.append(f"{where}: watches undeclared state '{when['state']}' of '{when['elementId']}'")
        _validate_effects(trigger["effects"], where, elements_by_id, errors)

    win = definition["winCondition"]
    for required in win["requiredStates"]:
        element = elements_by_id.get(required["elementId"])
        if element is None:
            errors.append(f"winCondition requires unknown element '{required['elementId']}'")
        elif required["state"] not in element["states"]:
            errors.append(
                f"winCondition requires '{required['elementId']}' in undeclared state "
                f"'{required['state']}'"
            )
    if win["sequence"] is not None:
        for element_id in win["sequence"]["elementIds"]:
            if element_id not in elements_by_id:
                errors.append(f"winCondition sequence references unknown element '{element_id}'")

    solvable = (
        win["requiredStates"]
        or win["sequence"] is not None
        or win["solutionText"]
        or _has_solve_effect(definition)
    )
    if not solvable:
        errors.append(
            "puzzle has no way to be solved: give it requiredStates, a sequence, a "
            "solutionText, or a solve effect"
        )

    if definition["maxAttempts"] is not None and definition["maxAttempts"] < 1:
        errors.append("maxAttempts must be null or at least 1")

    return errors


def _has_solve_effect(definition: dict) -> bool:
    def effects_have_solve(effects: list[dict]) -> bool:
        return any(effect["type"] == "solve" for effect in effects)

    for element in definition["elements"]:
        for interaction in element["interactions"]:
            if effects_have_solve(interaction["effects"]) or effects_have_solve(interaction["onFail"]):
                return True
    if definition["grid"] is not None:
        for trigger in definition["grid"]["tileTriggers"]:
            if effects_have_solve(trigger["effects"]) or effects_have_solve(trigger["onFail"]):
                return True
    return any(effects_have_solve(trigger["effects"]) for trigger in definition["stateTriggers"])
