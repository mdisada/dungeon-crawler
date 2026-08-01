-- Per-NPC audition lines: three short lines in that character's own voice, so casting a voice is
-- an audition rather than a timbre check.
--
-- Written by the voice_caster agent on first audition and cached here, NOT regenerated per press.
-- That is the whole point: narration audio is content-addressed on (text + voice + engine), so a
-- line that changed every time would miss the cache and pay for synthesis again on every click.
--
-- Null means "not written yet" and the picker falls back to the generic set in
-- features/tts/voice-samples.ts, which is also where it lands if generation fails. Shaped as jsonb
-- rather than three columns because the count is a product decision, not a schema one.

alter table npcs add column voice_sample_lines jsonb;

comment on column npcs.voice_sample_lines is
  'Three short in-character lines used to audition a voice for this NPC, as a jsonb array of '
  'strings. Null until first generated; the voice picker falls back to generic lines.';
