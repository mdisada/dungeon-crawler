/**
 * Voice reference clips are normalized in the browser before upload so Storage holds one
 * canonical file both routes can use as-is: OpenRouter gets a signed URL to it, the local worker
 * downloads it and hands the path to Chatterbox as its audio prompt.
 *
 * 16 kHz mono 16-bit PCM WAV is the safe common denominator -- WAV needs no decoder library on
 * either side, and encoding it from decoded samples is a few dozen lines rather than a ~50 KB
 * MP3 encoder dependency.
 *
 * Anything past MAX_SECONDS is cropped rather than rejected (F12: clips are usually a long
 * recording with a usable opening). Under MIN_SECONDS is still a hard error -- there isn't
 * enough signal to clone from, and silently proceeding produces a bad voice with no explanation.
 */

const TARGET_SAMPLE_RATE = 16_000
const MAX_SECONDS = 15
const MIN_SECONDS = 3

export interface NormalizedClip {
  blob: Blob
  durationSec: number
  wasCropped: boolean
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * 2
  const view = new DataView(new ArrayBuffer(44 + dataBytes))

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // format: PCM
  view.setUint16(22, 1, true) // channels: mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }

  return new Blob([view.buffer], { type: 'audio/wav' })
}

export async function normalizeVoiceClip(file: Blob): Promise<NormalizedClip> {
  const context = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error('Could not read that audio file - try a wav, mp3 or ogg recording')
  } finally {
    void context.close()
  }

  if (decoded.duration < MIN_SECONDS) {
    throw new Error(
      `Voice clips need at least ${MIN_SECONDS}s to clone from (this one is ${decoded.duration.toFixed(1)}s)`,
    )
  }

  const durationSec = Math.min(decoded.duration, MAX_SECONDS)
  const frames = Math.floor(durationSec * TARGET_SAMPLE_RATE)
  // Downmix to mono and resample in one pass -- OfflineAudioContext does both on render.
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0, 0, durationSec)
  const rendered = await offline.startRendering()

  return {
    blob: encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE),
    durationSec,
    wasCropped: decoded.duration > MAX_SECONDS,
  }
}
