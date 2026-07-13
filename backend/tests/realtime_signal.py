"""Manual test for the Supabase Realtime signaling channel.

Run this, then open the frontend and click "Send ping" in the realtime-test feature.
This listens for a 'ping' broadcast and replies with a 'pong' broadcast carrying the
same jobId, timing how long the reply takes to build and send with `time_job`.

    uv run tests/realtime_signal.py
"""

import asyncio
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from realtime.types import RealtimeSubscribeStates  # noqa: E402

from supabase_realtime import get_realtime_client  # noqa: E402
from timing import time_job  # noqa: E402

CHANNEL_TOPIC = "signal-test"


async def main() -> None:
    client = get_realtime_client()
    channel = client.channel(CHANNEL_TOPIC)

    def on_ping(broadcast: dict) -> None:
        data = broadcast["payload"]
        asyncio.create_task(handle_ping(data))

    async def handle_ping(data: dict) -> None:
        job_id = data.get("jobId")
        with time_job(f"handle ping {job_id}"):
            await channel.send_broadcast(
                "pong", {"jobId": job_id, "sentAt": data.get("sentAt")}
            )

    channel.on_broadcast("ping", on_ping)

    def on_subscribe(state: RealtimeSubscribeStates, error: Optional[Exception]) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            print(f"Subscribed to '{CHANNEL_TOPIC}', waiting for pings... (Ctrl+C to stop)")
        elif error:
            print(f"Subscribe error: {error}")

    await channel.subscribe(on_subscribe)

    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
