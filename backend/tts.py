"""Narration text-to-speech: one cloned narrator voice, one sentence at a time.

Sentence-level generation (rather than one file per turn) is what makes narration audio start
playing almost immediately instead of waiting for the whole turn to finish — see
campaign/session_handlers.py's _tts_sentences.
"""
import io
import re
from functools import lru_cache

import torch
import torchaudio as ta
from pydub import AudioSegment

from config.tts import narrator_voice_path

_PARAGRAPH_SPLIT_RE = re.compile(r"\n\s*\n")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


@lru_cache(maxsize=1)
def _model():
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("No CUDA GPU available — running the narrator model on CPU (much slower per sentence).")
    return ChatterboxTurboTTS.from_pretrained(device=device)


def warm_up() -> None:
    """Forces the narrator model to load now (downloading its weights first, if they aren't
    already cached) instead of on the first real request. Blocking — call once at startup via
    asyncio.to_thread, before the job queue starts accepting requests.

    Never raises: if loading fails (no GPU driver, out of VRAM, etc.), narration TTS just isn't
    available — every real call site already catches and logs that per-request (see
    campaign/session_handlers.py) — rather than taking down the whole backend, which has nothing
    to do with narration audio for every other channel.
    """
    try:
        print("Loading narrator voice model...")
        _model()
        print("Narrator voice model ready.")
    except Exception as e:
        print(f"Narrator voice model failed to load, narration audio will be unavailable: {e}")


def generate_sentence_audio(text: str) -> bytes:
    """Synthesizes one sentence in the narrator voice and returns Opus-encoded (ogg container)
    bytes. Blocking GPU inference — callers must run this via asyncio.to_thread.
    """
    model = _model()
    wav = model.generate(text, audio_prompt_path=narrator_voice_path)

    wav_buffer = io.BytesIO()
    ta.save(wav_buffer, wav, model.sr, format="wav")
    wav_buffer.seek(0)

    segment = AudioSegment.from_wav(wav_buffer)
    opus_buffer = io.BytesIO()
    segment.export(
        opus_buffer, format="ogg", codec="libopus", bitrate="32k", parameters=["-ac", "1"]
    )
    return opus_buffer.getvalue()


def split_into_sentences(text: str) -> list[tuple[str, bool]]:
    """Splits narration text into (sentence, is_new_paragraph) pairs, on blank-line paragraph
    boundaries then sentence-ending punctuation. is_new_paragraph is True for each paragraph's
    first sentence, except the very first sentence overall.
    """
    paragraphs = [p.strip() for p in _PARAGRAPH_SPLIT_RE.split(text) if p.strip()]

    result: list[tuple[str, bool]] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(paragraph) if s.strip()]
        for sentence_index, sentence in enumerate(sentences):
            is_new_paragraph = sentence_index == 0 and paragraph_index > 0
            result.append((sentence, is_new_paragraph))
    return result
