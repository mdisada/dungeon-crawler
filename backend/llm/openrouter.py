"""
openrouter.py

Minimal helper for calling models through OpenRouter.

Usage:
    from openrouter import run

    result, cost = run("openai/gpt-4o-mini", "Say hello in French.")
    print(result)
    print(f"Cost: ${cost:.6f}")

Setup:
    1. pip install requests python-dotenv
    2. Create a .env file next to this script (or anywhere in the cwd) with:
           OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
"""

import os
import requests
from dotenv import load_dotenv

# Load variables from a .env file into the environment
load_dotenv()

API_URL = "https://openrouter.ai/api/v1/chat/completions"


def run(
        model: str, 
        user_prompt: str, 
        system_prompt: str | None = None, 
        schema: dict | None = None
    ) -> tuple[str, float]:
    """
    Send a prompt to the given model via OpenRouter and return the response.

    Args:
        model: OpenRouter model identifier, e.g. "openai/gpt-4o-mini",
               "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct".
        prompt: The user prompt to send.
        **kwargs: Optional extra parameters passed through to the API
                  (e.g. temperature=0.7, max_tokens=500, system="...").

    Returns:
        (result, cost) tuple:
            result: str  - the model's text response
            cost:   float - the cost of the request in USD (0.0 if unavailable)

    Raises:
        RuntimeError: if the API key is missing or the request fails.
    """
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY not found. Make sure it's set in your .env file."
        )

    messages = []

    if system_prompt:
        messages.append({
            "role": "system", 
            "content": [{
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type":"ephemeral"}
                }]
            })

    messages.append({"role": "user", "content": user_prompt})

    payload = {
        "model": model,
        "messages": messages,
        "usage": {"include": True},
    }
    
    if schema:
        payload["response_format"] =  {
            "type": "json_schema",
            "json_schema": schema
        }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    response = requests.post(API_URL, headers=headers, json=payload, timeout=120)

    if response.status_code != 200:
        raise RuntimeError(
            f"OpenRouter API error {response.status_code}: {response.text}"
        )

    data = response.json()

    if "error" in data:
        raise RuntimeError(f"OpenRouter API error: {data['error']}")

    try:
        result = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"Unexpected response format: {data}") from e

    cost = 0.0
    usage = data.get("usage")
    if usage and "cost" in usage:
        cost = float(usage["cost"])

    return result, cost

