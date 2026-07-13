import os

import torchaudio as ta
from chatterbox.tts_turbo import ChatterboxTurboTTS

# Load the Turbo model
model = ChatterboxTurboTTS.from_pretrained(device="cuda")

# Longer, harder passage: numbers/dates, acronyms, tricky proper nouns,
# homophones, tongue-twisters, and paralinguistic tags -- meant to stress
# whisper.py / parakeet.py harder than the short voice.wav clip does.
text = "Attention all personnel: effective zero six hundred hours on the fourteenth,  Dr. Elizabeth Kowalczyk from the Cardiology department will be relocating to Suite 4B, adjacent to the MRI wing."


# Generate audio (requires a reference clip for voice cloning)
script_dir = os.path.dirname(__file__)
voice_wav = os.path.join(script_dir, "voice.wav")

print("IS EXISTS: ", os.path.exists(voice_wav))

wav = model.generate(text, audio_prompt_path=voice_wav)

ta.save(os.path.join(script_dir, "voice_hard.wav"), wav, model.sr)
print("Reference transcript:")
print(text)
