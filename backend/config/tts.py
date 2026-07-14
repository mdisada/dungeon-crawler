import os

from dotenv import load_dotenv

load_dotenv()

narrator_voice_path = r"tests\voice.wav"  # Chatterbox reference clip for voice cloning, used
                                           # when a CUDA GPU is available -- see tts.py
narrator_voice = "am_michael"  
narrator_lang_code = "a"
audio_bucket_name = "narration-audio"


tts_enabled = os.getenv("TTS_ENABLED", "true").strip().lower() not in ("false", "0", "no")
