"""Thin wrapper for Supabase Storage, configured for this app.

Mirrors supabase_realtime.py, but uses the service role key (not the anon key) since this runs
server-side only and needs to bypass RLS to write narration audio files.
"""

import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

_client: Client | None = None


def get_storage_client() -> Client:
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"].rstrip("/")
        service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, service_role_key)
    return _client


def ensure_bucket(name: str) -> None:
    """Idempotently creates a public bucket for narration audio, if it doesn't already exist."""
    storage = get_storage_client().storage
    existing = {bucket.id for bucket in storage.list_buckets()}
    if name not in existing:
        storage.create_bucket(name, options={"public": True})


def upload_audio(bucket: str, path: str, data: bytes) -> str:
    """Uploads Opus-encoded audio bytes to `path` in `bucket` and returns its public URL.
    Blocking network I/O — callers must run this via asyncio.to_thread.
    """
    files = get_storage_client().storage.from_(bucket)
    files.upload(
        path,
        data,
        file_options={
            "content-type": "audio/ogg",
            "cache-control": "31536000",
            "upsert": "true",
        },
    )
    return files.get_public_url(path)
