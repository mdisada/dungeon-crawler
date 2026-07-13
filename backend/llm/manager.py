import json, os

from llm import ollama
from llm.openrouter import run as run_openrouter
from config.llm_models import openrouter_models, ollama_models
from config.file_paths import usage_log_path

def _track_usage(purpose, model, cost):

    os.makedirs(os.path.dirname(usage_log_path), exist_ok=True)

    if os.path.exists(usage_log_path):
        with open(usage_log_path, "r", encoding="utf-8") as f:
            try:
                usage = json.load(f)
            except json.JSONDecodeError:
                usage = {}
    else:
        usage = {}

    purpose_usage = usage.setdefault(purpose, {})
    purpose_usage[model] = purpose_usage.get(model, 0.0) + cost

    with open(usage_log_path, "w", encoding="utf-8") as f:
        json.dump(usage, f, indent=2)

def ask(model: str, user_prompt: str,  purpose: str, system_prompt: str | None = None, schema: dict | None = None):
    if model in ollama_models:
        if ollama.is_available():
            result, cost = ollama.run(model, user_prompt, system=system_prompt, schema=schema)
        else:
            result, cost = run_openrouter(openrouter_models[0], user_prompt, system_prompt, schema)
    elif model in openrouter_models:
        result, cost = run_openrouter(model, user_prompt, system_prompt, schema)
    else:
        result = f"ERROR: Model {model} not found in llm list"
        cost = 0.0

    print(result)
    print(f"Cost: ${cost:.6f}")

    _track_usage(purpose, model, cost)

    return result, cost
