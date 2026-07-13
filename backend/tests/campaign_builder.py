"""Standalone entrypoint for the campaign-builder realtime channel.

Run this, then open the frontend and go through the "New campaign" flow. Listens for
list-models / generate-plot / generate-outline / regenerate-outline / save-campaign broadcasts
and replies on the matching response event, timing each with `time_job`.

    uv run tests/campaign_builder.py
"""
import asyncio
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from realtime.types import RealtimeSubscribeStates  # noqa: E402
from supabase_realtime import get_realtime_client  # noqa: E402
from realtime_dispatch import register_handler  # noqa: E402
from campaign import manager, storage  # noqa: E402

CHANNEL_TOPIC = "campaign-builder"


async def main() -> None:
    storage.init_db()

    client = get_realtime_client()
    channel = client.channel(CHANNEL_TOPIC)

    register_handler(channel, "list-models", "models-list", manager.handle_list_models)
    register_handler(channel, "generate-plot", "plot-generated", manager.handle_generate_plot)
    register_handler(channel, "generate-outline", "outline-generated", manager.handle_generate_outline)
    register_handler(channel, "regenerate-outline", "outline-regenerated", manager.handle_regenerate_outline)
    register_handler(channel, "save-campaign", "campaign-saved", manager.handle_save_campaign)

    def on_subscribe(state: RealtimeSubscribeStates, error: Optional[Exception]) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            print(f"Subscribed to '{CHANNEL_TOPIC}', waiting for requests... (Ctrl+C to stop)")
        elif error:
            print(f"Subscribe error: {error}")

    await channel.subscribe(on_subscribe)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
