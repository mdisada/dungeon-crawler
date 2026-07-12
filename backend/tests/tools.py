from pydub import AudioSegment
import os

def mp3_to_wav(mp3_path):
    # Define your file paths
    base_name = os.path.basename(mp3_path)
    # Split the text into a tuple: ('file', '.txt') and select index 0
    filename = os.path.splitext(base_name)[0]

    input_mp3 = mp3_path
    output_wav = f"{filename}.wav"

    # Load the MP3 file
    sound = AudioSegment.from_mp3(input_mp3)

    # Export as WAV
    sound.export(output_wav, format="wav")

    return output_wav
