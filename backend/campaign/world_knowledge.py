"""Loads static world-building lore to ground campaign generation prompts."""
import os

WORLD_KNOWLEDGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "world_knowledge")


def load_world_knowledge() -> str:
    if not os.path.isdir(WORLD_KNOWLEDGE_DIR):
        return ""

    filenames = sorted(
        f for f in os.listdir(WORLD_KNOWLEDGE_DIR) if f.endswith((".md", ".txt"))
    )

    sections = []
    for filename in filenames:
        with open(os.path.join(WORLD_KNOWLEDGE_DIR, filename), "r", encoding="utf-8") as f:
            content = f.read().strip()
        if content:
            sections.append(f"## {filename}\n\n{content}")

    return "\n\n".join(sections)
