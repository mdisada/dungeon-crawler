"""
ollama.py

Minimal helper for calling models through a local Ollama server.

Usage:
    from ollama import run, is_available

    if is_available():
        result, cost = run("gemma4:e4b", "Say hello in French.")
        print(result)

Setup:
    1. Install Ollama: https://ollama.com
    2. pip install requests python-dotenv
    3. (Optional) set OLLAMA_HOST in your .env file if the server isn't at
       the default http://localhost:11434
"""

import os
import requests
from dotenv import load_dotenv

# Load variables from a .env file into the environment
load_dotenv()

DEFAULT_HOST = "http://localhost:11434"


def _host() -> str:
    return os.getenv("OLLAMA_HOST", DEFAULT_HOST).rstrip("/")


def is_available(timeout: float = 0.5) -> bool:
    """
    Check whether a local Ollama server is installed and running.

    Use this to decide whether Ollama can be used as the active LLM backend
    (e.g. it's typically only reachable on a desktop where Ollama runs
    locally, not on a laptop where it isn't installed/running).

    Args:
        timeout: How long to wait for the server to respond, in seconds.
                 Kept short since this is meant to be a quick availability
                 check, not a network call worth waiting on.

    Returns:
        True if the Ollama server responded, False otherwise (not installed,
        not running, or unreachable).
    """
    try:
        response = requests.get(f"{_host()}/api/tags", timeout=timeout)
        return response.status_code == 200
    except requests.exceptions.RequestException:
        return False


def run(model: str, prompt: str, **kwargs) -> tuple[str, float]:
    """
    Send a prompt to the given model via a local Ollama server and return
    the response.

    Args:
        model: Ollama model identifier, e.g. "gemma4:e4b", "qwen3.5:9b".
        prompt: The user prompt to send.
        **kwargs: Optional extra parameters passed through to the API
                  (e.g. options={"temperature": 0.7}, system="...",
                  schema=<OpenRouter-envelope JSON schema dict>).

    Returns:
        (result, cost) tuple:
            result: str   - the model's text response
            cost:   float - always 0.0, since local Ollama calls are free

    Raises:
        RuntimeError: if the server is unreachable or the request fails.
    """
    messages = []
    system = kwargs.pop("system", None)
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    schema = kwargs.pop("schema", None)

    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        **kwargs,
    }

    if schema:
        payload["format"] = schema.get("schema", schema)

    try:
        response = requests.post(
            f"{_host()}/api/chat", json=payload, timeout=120
        )
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Could not reach Ollama server at {_host()}: {e}") from e

    if response.status_code != 200:
        raise RuntimeError(f"Ollama API error {response.status_code}: {response.text}")

    data = response.json()

    if "error" in data:
        raise RuntimeError(f"Ollama API error: {data['error']}")

    try:
        result = data["message"]["content"]
    except KeyError as e:
        raise RuntimeError(f"Unexpected response format: {data}") from e

    return result, 0.0
