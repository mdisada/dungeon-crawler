"""Asset generation handlers for the Assets Lab (F12).

The web app broadcasts a job on the per-user channel `assets:{user_id}`; these handlers run it on
the local machine and broadcast progress back. The wire contract mirrors lib/asset-job.ts:

  request   generate-image | generate-tts | get-capabilities   (payload carries jobId)
  progress  asset-progress { jobId, stage, chunkIndex?, storagePath? }   (0+ times)
  terminal  asset-result   { jobId, ... }   (sent by run_and_reply from the handler's return)

Only the preset *key* arrives for images -- the worker owns what it means (see image.py). Results
land in the private `assets` bucket under {user_id}/... so the requesting user can read them back
under RLS; the worker writes with the service key.
"""
import asyncio
import os

import image as image_gen
import supabase_storage
import torch
import tts

ASSETS_BUCKET = "assets"
VOICES_BUCKET = "voices"

# Which account this worker serves. The realtime broadcast channel is unauthenticated (documented
# gap, DECISIONS 2026-07-24), so the worker simply listens on one user's topic.
ASSETS_USER_ID = os.environ.get("ASSETS_USER_ID", "")


async def _emit(channel, job_id: str, stage: str, **extra) -> None:
    await channel.send_broadcast("asset-progress", {"jobId": job_id, "stage": stage, **extra})


def _asset_path(kind: str, job_id: str, extension: str) -> str:
    return f"{ASSETS_USER_ID}/{kind}/{job_id}.{extension}"


def make_handle_generate_image(channel):
    async def handler(data: dict) -> dict:
        job_id = data["jobId"]
        await _emit(channel, job_id, "received")

        references = data.get("references") or []
        reference_bytes = [
            await asyncio.to_thread(supabase_storage.download_bytes, ASSETS_BUCKET, path)
            for path in references
        ]

        await _emit(channel, job_id, "generating")
        png = await asyncio.to_thread(
            image_gen.render,
            data.get("preset", "base_char"),
            data.get("prompt", ""),
            reference_bytes,
            bool(data.get("isEdit")),
        )

        await _emit(channel, job_id, "uploading")
        path = await asyncio.to_thread(
            supabase_storage.upload_bytes, ASSETS_BUCKET, _asset_path("image", job_id, "png"), png, "image/png"
        )
        return {"storagePath": path}

    return handler


def make_handle_generate_tts(channel):
    async def handler(data: dict) -> dict:
        job_id = data["jobId"]
        await _emit(channel, job_id, "received")

        # Cloning uses the reference clip itself; download it from the voices bucket to a temp file
        # Chatterbox can read as its audio prompt. A preset id needs no download.
        clip_path: str | None = None
        voice_path = data.get("voicePath")
        if voice_path:
            clip_bytes = await asyncio.to_thread(supabase_storage.download_bytes, VOICES_BUCKET, voice_path)
            clip_path = os.path.join(os.environ.get("TEMP", "/tmp"), f"voice-{job_id}.wav")
            with open(clip_path, "wb") as handle:
                handle.write(clip_bytes)

        await _emit(channel, job_id, "generating")
        chunks = tts.split_into_chunks(data.get("text", ""))
        stored: list[str] = []
        try:
            for index, (chunk_text, _is_new_paragraph) in enumerate(chunks):
                audio = await asyncio.to_thread(tts.generate_chunk_audio, chunk_text, clip_path)
                path = await asyncio.to_thread(
                    supabase_storage.upload_bytes,
                    ASSETS_BUCKET,
                    _asset_path("audio", f"{job_id}-{index}", "opus"),
                    audio,
                    "audio/ogg",
                )
                stored.append(path)
                # Report each chunk as it lands so the lab can measure time-to-first-audio, which
                # is where local chunked synthesis differs from the cloud's single file.
                await _emit(channel, job_id, "chunk", chunkIndex=index, storagePath=path)
        finally:
            if clip_path and os.path.exists(clip_path):
                os.remove(clip_path)

        await _emit(channel, job_id, "uploading")
        return {"chunks": stored}

    return handler


def make_handle_get_capabilities(queue_depth):
    async def handler(_data: dict) -> dict:
        backend = tts.backend_name() if tts.tts_enabled else None
        cuda = torch.cuda.is_available()
        return {
            "capabilities": {
                "ttsBackend": backend,
                "cuda": cuda,
                # Only Chatterbox clones; Kokoro has preset voices only.
                "cloning": backend == "chatterbox",
                "ttsVoices": [tts_config_narrator_voice()],
                "imageModels": image_gen.image_models(),
                "queueDepth": queue_depth(),
            }
        }

    return handler


def tts_config_narrator_voice() -> str:
    from config.tts import narrator_voice

    return narrator_voice
