"""Narration text-to-speech: one narrator voice, one chunk at a time.

Chunked generation (rather than one file per turn) is what makes narration audio start playing
almost immediately instead of waiting for the whole turn to finish — see
campaign/session_handlers.py's _tts_chunks.

Two interchangeable backends, picked by _backend() based on GPU availability:
  - Chatterbox (CUDA only): clones the narrator voice from narrator_voice_path. Much slower than
    Kokoro on CPU, so it's only used when a GPU is present.
  - Kokoro (CPU or CUDA): a much smaller, CPU-friendly model, but with no voice-cloning support --
    it only offers a fixed set of preset voices (narrator_voice in config/tts.py).
"""
import io
import re
from functools import lru_cache

import nltk
import numpy as np
import soundfile as sf
import torch
import torchaudio as ta
from pydub import AudioSegment

from config.tts import narrator_lang_code, narrator_voice, narrator_voice_path, tts_enabled

_PARAGRAPH_SPLIT_RE = re.compile(r"\n\s*\n")

_KOKORO_SAMPLE_RATE = 24000  # fixed by Kokoro's model architecture


@lru_cache(maxsize=1)
def _backend() -> str:
    return "chatterbox" if torch.cuda.is_available() else "kokoro"


@lru_cache(maxsize=1)
def _chatterbox_model():
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    return ChatterboxTurboTTS.from_pretrained(device="cuda")


@lru_cache(maxsize=1)
def _kokoro_pipeline():
    from kokoro import KPipeline

    return KPipeline(lang_code=narrator_lang_code)


@lru_cache(maxsize=1)
def _ensure_nltk_punkt() -> None:
    """Downloads nltk's punkt sentence tokenizer data if it isn't already cached locally."""
    try:
        nltk.data.find("tokenizers/punkt_tab")
    except LookupError:
        nltk.download("punkt_tab")


def warm_up() -> None:
    """Forces the narrator model to load now (downloading its weights first, if they aren't
    already cached) instead of on the first real request. Blocking — call once at startup via
    asyncio.to_thread, before the job queue starts accepting requests.

    Never raises: if loading fails, narration TTS just isn't available — every real call site
    already catches and logs that per-request (see campaign/session_handlers.py) — rather than
    taking down the whole backend, which has nothing to do with narration audio for every other
    channel.
    """
    if not tts_enabled:
        print("TTS disabled (TTS_ENABLED=false) — skipping narrator model warm-up.")
        return

    try:
        print(f"Loading narrator voice model ({_backend()})...")
        _chatterbox_model() if _backend() == "chatterbox" else _kokoro_pipeline()
        _ensure_nltk_punkt()
        print("Narrator voice model ready.")
    except Exception as e:
        print(f"Narrator voice model failed to load, narration audio will be unavailable: {e}")


def generate_chunk_audio(text: str) -> bytes:
    """Synthesizes one narration chunk (one or more grouped sentences, see split_into_chunks) in
    the narrator voice and returns Opus-encoded (ogg container) bytes. Blocking GPU/CPU inference
    — callers must run this via asyncio.to_thread.
    """
    wav_buffer = _generate_chatterbox(text) if _backend() == "chatterbox" else _generate_kokoro(text)

    segment = AudioSegment.from_wav(wav_buffer)
    opus_buffer = io.BytesIO()
    segment.export(
        opus_buffer, format="ogg", codec="libopus", bitrate="32k", parameters=["-ac", "1"]
    )
    return opus_buffer.getvalue()


def _generate_chatterbox(text: str) -> io.BytesIO:
    model = _chatterbox_model()
    # norm_loudness=False works around a chatterbox-tts bug on numpy>=2.0: its reference-loudness
    # normalization step multiplies a float32 array by a np.float64 gain scalar, which numpy 2's
    # stricter type promotion upcasts to float64, and that leaks into calls downstream that don't
    # re-cast, raising "expected scalar type Double but found Float". See
    # https://github.com/resemble-ai/chatterbox/issues/499. Our current lockfile resolves numpy to
    # 1.26.4 (kokoro's other dependencies pull it back below 2.0), so this bug doesn't currently
    # trigger, but we still skip normalization for consistency: it just means the reference clip's
    # raw (un-normalized) loudness drives voice conditioning instead of a target-LUFS-normalized
    # version — consistent across every call, not a per-sentence quality issue -- and keeps this
    # working if a future dependency bump pulls numpy back to 2.x.
    wav = model.generate(text, audio_prompt_path=narrator_voice_path, norm_loudness=False)

    wav_buffer = io.BytesIO()
    ta.save(wav_buffer, wav, model.sr, format="wav")
    wav_buffer.seek(0)
    return wav_buffer


def _generate_kokoro(text: str) -> io.BytesIO:
    pipeline = _kokoro_pipeline()
    chunks = [result.audio for result in pipeline(text, voice=narrator_voice) if result.audio is not None]
    audio = np.concatenate([chunk.numpy() for chunk in chunks])

    wav_buffer = io.BytesIO()
    sf.write(wav_buffer, audio, _KOKORO_SAMPLE_RATE, format="WAV")
    wav_buffer.seek(0)
    return wav_buffer


# Target length (characters) for each generated audio chunk. Sentences shorter than this get
# grouped with their paragraph-neighbors so playback doesn't sound choppy and so Chatterbox's
# per-call reference-conditioning cost (see _generate_chatterbox) isn't paid once per short
# sentence -- but a single sentence longer than this is still its own chunk; sentences are never
# split apart to fit.
_IDEAL_CHUNK_CHARS = 200

_QUOTE_CHARS = '"“”'  # straight " plus curly opening/closing double quotes


def _merge_unclosed_quotes(sentences: list[str]) -> list[str]:
    """nltk's sent_tokenize has no notion of quotation -- dialogue like 'she whispered, "Don't!
    They'll hear you!"' gets split at every internal '!', mid-quote. Re-merge any run of
    consecutive sentences that leaves a double quote open, so a quoted line (how ever many
    sentence-ending marks it has inside it) stays attached to the sentence that introduces it.
    """
    merged: list[str] = []
    buffer = ""
    for sentence in sentences:
        buffer = f"{buffer} {sentence}" if buffer else sentence
        if sum(buffer.count(c) for c in _QUOTE_CHARS) % 2 == 1:
            continue
        merged.append(buffer)
        buffer = ""
    if buffer:  # unbalanced all the way to the end (e.g. a stray/typo'd quote) -- keep it, not lost
        merged.append(buffer)
    return merged


def split_into_chunks(text: str) -> list[tuple[str, bool]]:
    """Splits narration text into (chunk, is_new_paragraph) pairs for TTS: text is split into
    paragraphs on blank lines, each paragraph is sentence-tokenized with nltk (with unclosed
    quotes re-merged, see _merge_unclosed_quotes), and consecutive sentences within the same
    paragraph are then grouped into chunks of roughly _IDEAL_CHUNK_CHARS -- never across a
    paragraph boundary, and never splitting a sentence.
    is_new_paragraph is True for each paragraph's first chunk, except the very first chunk overall.
    """
    _ensure_nltk_punkt()
    paragraphs = [p.strip() for p in _PARAGRAPH_SPLIT_RE.split(text) if p.strip()]

    result: list[tuple[str, bool]] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        sentences = [s.strip() for s in nltk.sent_tokenize(paragraph) if s.strip()]
        sentences = _merge_unclosed_quotes(sentences)

        paragraph_chunks: list[str] = []
        current_sentences: list[str] = []
        current_len = 0
        for sentence in sentences:
            if current_sentences and current_len + 1 + len(sentence) > _IDEAL_CHUNK_CHARS:
                paragraph_chunks.append(" ".join(current_sentences))
                current_sentences = []
                current_len = 0
            current_sentences.append(sentence)
            current_len += len(sentence) + 1
        if current_sentences:
            paragraph_chunks.append(" ".join(current_sentences))

        for chunk_index, chunk in enumerate(paragraph_chunks):
            is_new_paragraph = chunk_index == 0 and paragraph_index > 0
            result.append((chunk, is_new_paragraph))
    return result
