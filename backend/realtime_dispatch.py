"""Generic request/response dispatcher for Supabase Realtime broadcast channels.

Generalizes the on_broadcast -> asyncio.create_task -> time_job -> send_broadcast pattern
used by tests/realtime_signal.py so a single channel can register multiple request/response
handler pairs.
"""
import asyncio
from typing import Awaitable, Callable

from timing import time_job

Handler = Callable[[dict], Awaitable[dict]]


def register_handler(channel, request_event: str, response_event: str, handler: Handler) -> None:
    """Run each incoming request immediately in its own task (no queueing)."""
    def on_request(broadcast: dict) -> None:
        asyncio.create_task(run_and_reply(channel, request_event, response_event, handler, broadcast["payload"]))

    channel.on_broadcast(request_event, on_request)


async def run_and_reply(channel, request_event: str, response_event: str, handler: Handler, data: dict) -> None:
    """Run a handler, time it, and broadcast the result (or an error) on the response event.

    Shared by the immediate dispatcher (register_handler) and the queued worker (JobQueue).
    """
    job_id = data.get("jobId")
    with time_job(f"{request_event} {job_id}"):
        try:
            result = await handler(data)
            await channel.send_broadcast(response_event, {"jobId": job_id, **result})
        except Exception as e:
            await channel.send_broadcast(response_event, {"jobId": job_id, "error": str(e)})
