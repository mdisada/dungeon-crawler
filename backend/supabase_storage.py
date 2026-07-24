"""Thin wrapper for Supabase Storage, configured for this app.

Mirrors supabase_realtime.py, but uses the secret key (not the publishable key) since this runs
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
        secret_key = os.environ["SUPABASE_SECRET_KEY"]
        _client = create_client(url, secret_key)
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


def upload_bytes(bucket: str, path: str, data: bytes, content_type: str) -> str:
    """Uploads arbitrary bytes to a (possibly private) bucket and returns the storage *path*.

    The asset worker writes into the private `assets` bucket with the service key, which bypasses
    RLS -- but the path still starts with the owning user's uid so that user can read it back
    under RLS. The frontend signs the returned path at render time; there is no public URL.
    Blocking network I/O — call via asyncio.to_thread.
    """
    files = get_storage_client().storage.from_(bucket)
    files.upload(
        path,
        data,
        file_options={"content-type": content_type, "cache-control": "3600", "upsert": "true"},
    )
    return path


def download_bytes(bucket: str, path: str) -> bytes:
    """Downloads an object's bytes (reference images, voice clips). Service key bypasses RLS.
    Blocking network I/O — call via asyncio.to_thread.
    """
    return get_storage_client().storage.from_(bucket).download(path)
