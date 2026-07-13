"""Thin wrapper for building a Supabase Realtime client, configured for this app.

Mirrors frontend/src/lib/supabase.ts: one place that knows how to read the Supabase
env vars and construct a client, so callers don't repeat that setup.
"""

import os

from dotenv import load_dotenv
from realtime import AsyncRealtimeClient

load_dotenv()


def get_realtime_client() -> AsyncRealtimeClient:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_ANON_KEY"]
    return AsyncRealtimeClient(f"{url}/realtime/v1", key)
