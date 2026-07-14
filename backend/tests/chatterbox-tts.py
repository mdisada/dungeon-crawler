import os

import torchaudio as ta
from chatterbox.tts_turbo import ChatterboxTurboTTS

# Load the Turbo model
model = ChatterboxTurboTTS.from_pretrained(device="cuda")

# Generate with Paralinguistic Tags
text = "Attention all personnel: effective zero six hundred hours on the fourteenth,  Dr. Elizabeth Kowalczyk from the Cardiology department will be relocating to Suite 4B, adjacent to the MRI wing."

# Generate audio (requires a reference clip for voice cloning)
script_dir = os.path.dirname(__file__)
voice_wav = os.path.join(script_dir, "voice.wav")

print("IS EXISTS: ", os.path.exists(voice_wav))

wav = model.generate(text, audio_prompt_path=voice_wav)

ta.save(os.path.join(script_dir, "test-turbo.wav"), wav, model.sr)
