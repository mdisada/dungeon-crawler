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

import supabase_storage
import tts
from config.tts import audio_bucket_name
from job_queue import JobQueue
from supabase_realtime import get_realtime_client
from campaign import manager as campaign_manager, session_handlers, storage

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
    supabase_storage.ensure_bucket(audio_bucket_name)
    await asyncio.to_thread(tts.warm_up)

    client = get_realtime_client()
    queue = JobQueue(num_workers=NUM_WORKERS)

    # signal-test channel — ping/pong health check
    signal_channel = client.channel("signal-test")
    queue.register(signal_channel, "ping", "pong", handle_ping)

    # campaign-builder channel — campaign generation flow
    campaign_channel = client.channel("campaign-builder")
    queue.register(campaign_channel, "list-models", "models-list", campaign_manager.handle_list_models)
    queue.register(campaign_channel, "generate-plot", "plot-generated", campaign_manager.handle_generate_plot)
    queue.register(campaign_channel, "improve-plot", "plot-improved", campaign_manager.handle_improve_plot)
    queue.register(campaign_channel, "generate-plot-points", "plot-points-generated", campaign_manager.handle_generate_plot_points)
    queue.register(campaign_channel, "regenerate-plot-points", "plot-points-regenerated", campaign_manager.handle_regenerate_plot_points)
    queue.register(campaign_channel, "save-campaign", "campaign-saved", campaign_manager.handle_save_campaign)
    queue.register(campaign_channel, "save-plot-draft", "plot-draft-saved", campaign_manager.handle_save_plot_draft)
    queue.register(campaign_channel, "list-plot-drafts", "plot-drafts-listed", campaign_manager.handle_list_plot_drafts)
    queue.register(campaign_channel, "detect-puzzles", "puzzles-detected", campaign_manager.handle_detect_puzzles)

    # puzzle-compile channel — wizard text-to-puzzle compiler; its own topic (not campaign-builder)
    # so a slow compile can't race the wizard's other requests on a shared topic.
    puzzle_compile_channel = client.channel("puzzle-compile")
    queue.register(puzzle_compile_channel, "compile-puzzle", "puzzle-compiled", campaign_manager.handle_compile_puzzle)

    # campaign-session-* channels — request/response actions for the "open campaign" DM/player
    # loop, one topic per action (not one shared topic) since campaign/DM pages fire get-campaign
    # and list-turns concurrently on mount, and sendRealtimeRequest tears down any existing
    # channel on a topic before opening its own — concurrent requests sharing a topic would race.
    # campaign-live channel — broadcast-only; campaign/DM/player pages passively subscribe here
    # to receive published turns in real time (kept separate for the same reason).
    list_campaigns_channel = client.channel("campaign-session-list-campaigns")
    get_campaign_channel = client.channel("campaign-session-get-campaign")
    list_turns_channel = client.channel("campaign-session-list-turns")
    list_puzzles_channel = client.channel("campaign-session-list-puzzles")
    generate_branch_options_channel = client.channel("campaign-session-generate-branch-options")
    generate_turn_channel = client.channel("campaign-session-generate-turn")
    generate_puzzle_start_channel = client.channel("campaign-session-generate-puzzle-start")
    publish_turn_channel = client.channel("campaign-session-publish-turn")
    live_channel = client.channel("campaign-live")

    queue.register(list_campaigns_channel, "list-campaigns", "campaigns-listed", session_handlers.handle_list_campaigns)
    queue.register(get_campaign_channel, "get-campaign", "campaign-fetched", session_handlers.handle_get_campaign)
    queue.register(list_turns_channel, "list-turns", "turns-listed", session_handlers.handle_list_turns)
    queue.register(list_puzzles_channel, "list-puzzles", "puzzles-listed", session_handlers.handle_list_puzzles)
    queue.register(
        generate_branch_options_channel, "generate-branch-options", "branch-options-generated",
        session_handlers.handle_generate_branch_options,
    )
    queue.register(
        generate_turn_channel, "generate-turn", "turn-drafted",
        session_handlers.make_handle_generate_turn(live_channel),
    )
    queue.register(
        generate_puzzle_start_channel, "generate-puzzle-start", "puzzle-start-drafted",
        session_handlers.handle_generate_puzzle_start,
    )
    queue.register(
        publish_turn_channel, "publish-turn", "turn-published-ack",
        session_handlers.make_handle_publish_turn(live_channel),
    )

    queue.start()

    await signal_channel.subscribe(_on_subscribe("signal-test"))
    await campaign_channel.subscribe(_on_subscribe("campaign-builder"))
    await puzzle_compile_channel.subscribe(_on_subscribe("puzzle-compile"))
    await list_campaigns_channel.subscribe(_on_subscribe("campaign-session-list-campaigns"))
    await get_campaign_channel.subscribe(_on_subscribe("campaign-session-get-campaign"))
    await list_turns_channel.subscribe(_on_subscribe("campaign-session-list-turns"))
    await list_puzzles_channel.subscribe(_on_subscribe("campaign-session-list-puzzles"))
    await generate_branch_options_channel.subscribe(_on_subscribe("campaign-session-generate-branch-options"))
    await generate_turn_channel.subscribe(_on_subscribe("campaign-session-generate-turn"))
    await generate_puzzle_start_channel.subscribe(_on_subscribe("campaign-session-generate-puzzle-start"))
    await publish_turn_channel.subscribe(_on_subscribe("campaign-session-publish-turn"))
    await live_channel.subscribe(_on_subscribe("campaign-live"))


    print(f"Universal job listener running ({NUM_WORKERS} worker(s)). Waiting for jobs... (Ctrl+C to stop)")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
