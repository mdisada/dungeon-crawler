"""Prompt building for the campaign plot idea textarea: generating one from scratch, and
improving an existing draft in place."""
from campaign.world_knowledge import load_world_knowledge


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


def build_improve_plot_system_prompt(current_plot: str) -> str:
    return (
        "You are a creative writing assistant improving a dungeon master's draft campaign plot "
        "idea for a narrative tabletop RPG. Keep their core premise and intent intact — sharpen "
        "the writing, add texture and stakes, and fix vagueness, but don't replace their idea "
        "with a different one.\n\n"
        f"{_world_knowledge_block()}"
        f"### DRAFT TO IMPROVE\n{current_plot}\n### END DRAFT\n\n"
        "Write the improved 2-4 sentence plot idea. Respond with plain text only, no headings, "
        "no JSON, no commentary about what you changed."
    )
