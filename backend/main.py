"""Universal backend entrypoint.

Listens for realtime jobs across every feature channel, queues each incoming request, and
works through the queue with a pool of workers (one at a time per worker). Run this instead of
the individual standalone scripts under tests/ to serve every feature from a single process.

    uv run main.py

The per-feature scripts in tests/ (realtime_signal.py, campaign_builder.py) still exist for
testing one feature in isolation — they run requests immediately rather than through the queue.
"""
import asyncio
from typing import Optional

from realtime.types import RealtimeSubscribeStates

from job_queue import JobQueue
from supabase_realtime import get_realtime_client
from campaign import manager as campaign_manager, storage

# How many jobs to work on concurrently. 1 = a strict FIFO job list (heavy LLM calls run one at
# a time); raise it to process more in parallel.
NUM_WORKERS = 1


async def handle_ping(data: dict) -> dict:
    """signal-test health check — echo the sentAt timestamp straight back."""
    return {"sentAt": data.get("sentAt")}


def _on_subscribe(topic: str):
    def callback(state: RealtimeSubscribeStates, error: Optional[Exception]) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            print(f"Subscribed to '{topic}'")
        elif error:
            print(f"Subscribe error on '{topic}': {error}")

    return callback


async def main() -> None:
    storage.init_db()

    client = get_realtime_client()
    queue = JobQueue(num_workers=NUM_WORKERS)

    # signal-test channel — ping/pong health check
    signal_channel = client.channel("signal-test")
    queue.register(signal_channel, "ping", "pong", handle_ping)

    # campaign-builder channel — campaign generation flow
    campaign_channel = client.channel("campaign-builder")
    queue.register(campaign_channel, "list-models", "models-list", campaign_manager.handle_list_models)
    queue.register(campaign_channel, "generate-plot", "plot-generated", campaign_manager.handle_generate_plot)
    queue.register(campaign_channel, "generate-outline", "outline-generated", campaign_manager.handle_generate_outline)
    queue.register(campaign_channel, "regenerate-outline", "outline-regenerated", campaign_manager.handle_regenerate_outline)
    queue.register(campaign_channel, "save-campaign", "campaign-saved", campaign_manager.handle_save_campaign)

    queue.start()

    await signal_channel.subscribe(_on_subscribe("signal-test"))
    await campaign_channel.subscribe(_on_subscribe("campaign-builder"))
    

    print(f"Universal job listener running ({NUM_WORKERS} worker(s)). Waiting for jobs... (Ctrl+C to stop)")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
