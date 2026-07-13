import os
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

from faster_whisper import WhisperModel

model_size = "large-v3"

load_start = time.perf_counter()
# Run on GPU with FP16
model = WhisperModel(model_size, device="cuda", compute_type="float16")
print(f"Model load: {time.perf_counter() - load_start:.2f}s")

script_dir = os.path.dirname(__file__)
audio_filename = sys.argv[1] if len(sys.argv) > 1 else "voice.wav"
mp3_path = os.path.join(script_dir, audio_filename)

infer_start = time.perf_counter()
segments, info = model.transcribe(mp3_path, beam_size=5)

print("Detected language '%s' with probability %f" % (info.language, info.language_probability))

# segments is a lazy generator, so the transcription work happens during
# iteration -- timing has to wrap the loop, not just the transcribe() call.
for segment in segments:
    print("[%.2fs -> %.2fs] %s" % (segment.start, segment.end, segment.text))
print(f"Transcription: {time.perf_counter() - infer_start:.2f}s")