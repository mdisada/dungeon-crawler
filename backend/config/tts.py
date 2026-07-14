import os

from dotenv import load_dotenv

load_dotenv()

narrator_voice_path = r"tests\voice.wav"  # Chatterbox reference clip for voice cloning, used
                                           # when a CUDA GPU is available -- see tts.py
narrator_voice = "af_heart"  # Kokoro preset voice, used on CPU-only machines since Kokoro has no
                              # voice-cloning support -- placeholder until a real voice-selection
                              # system exists
narrator_lang_code = "a"  # American English -- must match narrator_voice's af_/am_ prefix
audio_bucket_name = "narration-audio"

# Set TTS_ENABLED=false in .env (per machine, not committed) to skip narration audio entirely.
tts_enabled = os.getenv("TTS_ENABLED", "true").strip().lower() not in ("false", "0", "no")
