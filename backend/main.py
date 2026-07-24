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

import assets
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
    # Assets (image/tts) get their own single-worker queue so a 60s GPU job never blocks campaign
    # LLM jobs and vice versa, while GPU work stays serialized within itself (one GPU).
    asset_queue = JobQueue(num_workers=1)

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

    # campaign-session-* channels — request/response actions for the "open campaign" DM/player
    # loop, one topic per action (not one shared topic) since campaign/DM pages fire get-campaign
    # and list-turns concurrently on mount, and sendRealtimeRequest tears down any existing
    # channel on a topic before opening its own — concurrent requests sharing a topic would race.
    # campaign-live channel — broadcast-only; campaign/DM/player pages passively subscribe here
    # to receive published turns in real time (kept separate for the same reason).
    list_campaigns_channel = client.channel("campaign-session-list-campaigns")
    get_campaign_channel = client.channel("campaign-session-get-campaign")
    list_turns_channel = client.channel("campaign-session-list-turns")
    generate_branch_options_channel = client.channel("campaign-session-generate-branch-options")
    generate_turn_channel = client.channel("campaign-session-generate-turn")
    publish_turn_channel = client.channel("campaign-session-publish-turn")
    narrate_plot_channel = client.channel("campaign-session-narrate-plot")
    live_channel = client.channel("campaign-live")

    queue.register(list_campaigns_channel, "list-campaigns", "campaigns-listed", session_handlers.handle_list_campaigns)
    queue.register(get_campaign_channel, "get-campaign", "campaign-fetched", session_handlers.handle_get_campaign)
    queue.register(list_turns_channel, "list-turns", "turns-listed", session_handlers.handle_list_turns)
    queue.register(
        generate_branch_options_channel, "generate-branch-options", "branch-options-generated",
        session_handlers.handle_generate_branch_options,
    )
    queue.register(
        generate_turn_channel, "generate-turn", "turn-drafted",
        session_handlers.make_handle_generate_turn(live_channel),
    )
    queue.register(
        publish_turn_channel, "publish-turn", "turn-published-ack",
        session_handlers.make_handle_publish_turn(live_channel),
    )
    queue.register(
        narrate_plot_channel, "narrate-plot", "plot-narration-started",
        session_handlers.make_handle_narrate_plot(live_channel),
    )

    # assets:{user_id} channel — Assets Lab image/tts jobs (F12). Per-user topic; the worker
    # serves the single account named by ASSETS_USER_ID.
    asset_channel = None
    if assets.ASSETS_USER_ID:
        asset_topic = f"assets:{assets.ASSETS_USER_ID}"
        asset_channel = client.channel(asset_topic)
        asset_queue.register(
            asset_channel, "generate-image", "asset-result", assets.make_handle_generate_image(asset_channel)
        )
        asset_queue.register(
            asset_channel, "generate-tts", "asset-result", assets.make_handle_generate_tts(asset_channel)
        )
        asset_queue.register(
            asset_channel,
            "get-capabilities",
            "asset-result",
            assets.make_handle_get_capabilities(lambda: asset_queue.qsize()),
        )
    else:
        print("ASSETS_USER_ID not set — Assets Lab worker channel disabled (set it in backend/.env).")

    queue.start()
    asset_queue.start()

    await signal_channel.subscribe(_on_subscribe("signal-test"))
    if asset_channel is not None:
        await asset_channel.subscribe(_on_subscribe(f"assets:{assets.ASSETS_USER_ID}"))
    await campaign_channel.subscribe(_on_subscribe("campaign-builder"))
    await list_campaigns_channel.subscribe(_on_subscribe("campaign-session-list-campaigns"))
    await get_campaign_channel.subscribe(_on_subscribe("campaign-session-get-campaign"))
    await list_turns_channel.subscribe(_on_subscribe("campaign-session-list-turns"))
    await generate_branch_options_channel.subscribe(_on_subscribe("campaign-session-generate-branch-options"))
    await generate_turn_channel.subscribe(_on_subscribe("campaign-session-generate-turn"))
    await publish_turn_channel.subscribe(_on_subscribe("campaign-session-publish-turn"))
    await narrate_plot_channel.subscribe(_on_subscribe("campaign-session-narrate-plot"))
    await live_channel.subscribe(_on_subscribe("campaign-live"))


    print(f"Universal job listener running ({NUM_WORKERS} worker(s)). Waiting for jobs... (Ctrl+C to stop)")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
