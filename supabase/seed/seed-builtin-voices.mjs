#!/usr/bin/env node
// Seeds the built-in (ownerless) voice profiles every account can narrate with.
//
// A built-in voice is a voice_profiles row with user_id null - readable by all authenticated users
// via voice_profiles_select_builtin, writable by none (the existing owner policies compare
// auth.uid() = user_id, which is NULL for these rows). See 20260801170000_narration_audio.sql.
//
// The clip is normalized to 16 kHz mono WAV cropped to 15 s, matching what the browser's
// normalizeVoiceClip produces, so every clip in the `voices` bucket has one shape regardless of
// which route reads it (Fish cloning, or the local Chatterbox worker).
//
// fish_reference_id is deliberately left null: narration-tts registers the clip with Fish on first
// use and caches the id with the service role. That keeps the Fish key out of this script.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/seed-builtin-voices.mjs https://<ref>.supabase.co

import { readFile } from 'node:fs/promises'

const TARGET_RATE = 16_000
const MAX_SECONDS = 15
const BUCKET = 'voices'

const VOICES = [{ name: 'Carl', file: new URL('../../voices/carl.wav', import.meta.url), path: 'builtin/carl.wav' }]

const projectUrl = (process.argv[2] ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!projectUrl || !serviceKey) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed/seed-builtin-voices.mjs <project-url>')
  process.exit(1)
}

/** Reads the fmt/data chunks of a PCM WAV. Only 8/16/32-bit integer PCM, which is what any recorder emits. */
function parseWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file')
  }
  let format = null
  let data = null
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = buffer.subarray(offset + 8, offset + 8 + size)
    if (id === 'fmt ') {
      format = { channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }
    } else if (id === 'data') {
      data = body
    }
    offset += 8 + size + (size % 2)
  }
  if (!format || !data) throw new Error('WAV is missing a fmt or data chunk')
  if (format.bits !== 16) throw new Error(`Only 16-bit PCM is supported, got ${format.bits}-bit`)
  return { format, data }
}

/** Stereo (or more) to mono by averaging, then linear-resampled to 16 kHz and cropped. */
function normalize(buffer) {
  const { format, data } = parseWav(buffer)
  const frames = Math.floor(data.length / (2 * format.channels))
  const mono = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < format.channels; channel++) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2) / 32768
    }
    mono[frame] = sum / format.channels
  }

  const ratio = format.rate / TARGET_RATE
  const outFrames = Math.min(Math.floor(frames / ratio), TARGET_RATE * MAX_SECONDS)
  const out = Buffer.alloc(44 + outFrames * 2)
  for (let i = 0; i < outFrames; i++) {
    const position = i * ratio
    const low = Math.floor(position)
    const sample = mono[low] + (mono[Math.min(low + 1, frames - 1)] - mono[low]) * (position - low)
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), 44 + i * 2)
  }

  const bytes = outFrames * 2
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + bytes, 4)
  out.write('WAVEfmt ', 8, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(1, 22) // mono
  out.writeUInt32LE(TARGET_RATE, 24)
  out.writeUInt32LE(TARGET_RATE * 2, 28) // byte rate
  out.writeUInt16LE(2, 32) // block align
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(bytes, 40)
  return { wav: out, seconds: outFrames / TARGET_RATE }
}

async function api(path, init = {}) {
  const res = await fetch(`${projectUrl}${path}`, {
    ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...init.headers },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res
}

async function main() {
  for (const voice of VOICES) {
    const { wav, seconds } = normalize(await readFile(voice.file))
    console.log(`${voice.name}: ${seconds.toFixed(1)}s, ${(wav.length / 1024).toFixed(0)} KB at ${TARGET_RATE} Hz mono`)

    await api(`/storage/v1/object/${BUCKET}/${voice.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'x-upsert': 'true' },
      body: wav,
    })

    // No unique constraint to upsert against, so check-then-insert. Re-running only refreshes the
    // clip, which is the point: the row's id is referenced by adventures.narrator_voice_id.
    const existing = await (
      await api(`/rest/v1/voice_profiles?select=id&user_id=is.null&name=eq.${encodeURIComponent(voice.name)}`)
    ).json()
    if (existing.length > 0) {
      console.log(`  row exists (${existing[0].id}) - clip refreshed, row left alone`)
      continue
    }

    const inserted = await (
      await api('/rest/v1/voice_profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ user_id: null, name: voice.name, storage_path: voice.path }),
      })
    ).json()
    console.log(`  inserted ${inserted[0].id}`)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exitCode = 1
})
