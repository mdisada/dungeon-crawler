"""Speed/accuracy probe for NVIDIA Parakeet TDT 0.6B v3, for comparison
against whisper.py in this same directory.

This uses the `onnx-asr` library directly (the same library the
groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai FastAPI server wraps) instead of
standing up that server, so there's no HTTP layer in the timing.

Run with `uv run tests/parakeet.py` from backend/ -- onnx-asr and soundfile
are regular project dependencies (see pyproject.toml), so this uses the
shared backend/.venv like whisper.py does.

To compare GPU vs GPU instead of GPU (whisper) vs CPU (parakeet), swap the
onnx-asr[cpu,hub] extra in pyproject.toml for onnx-asr[gpu,hub] and pass
providers=["CUDAExecutionProvider"] to load_model() below. Left as CPU by
default since onnxruntime-gpu needs a system CUDA/cuDNN install that matches
its build, which isn't guaranteed to line up with the torch cu126 wheels
already pinned in this project.
"""

import os
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")

import onnx_asr
import soundfile as sf

MODEL_NAME = "nemo-parakeet-tdt-0.6b-v3"

script_dir = os.path.dirname(__file__)
audio_filename = sys.argv[1] if len(sys.argv) > 1 else "voice.wav"
wav_path = os.path.join(script_dir, audio_filename)

load_start = time.perf_counter()
model = onnx_asr.load_model(MODEL_NAME)
print(f"Model load: {time.perf_counter() - load_start:.2f}s")

# Read via soundfile rather than passing the path straight to recognize():
# onnx_asr's built-in reader uses Python's `wave` module, which only handles
# PCM WAVs and errors on the float32 WAVs torchaudio.save() produces.
waveform, sample_rate = sf.read(wav_path, dtype="float32")

infer_start = time.perf_counter()
text = model.recognize(waveform, sample_rate=sample_rate)
print(f"Transcription: {time.perf_counter() - infer_start:.2f}s")

print(text)
