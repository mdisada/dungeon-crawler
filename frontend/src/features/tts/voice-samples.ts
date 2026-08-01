/**
 * The lines a voice is auditioned with, per job.
 *
 * Two sets because the picker does two different things. A narrator voice reads third-person scene
 * prose (narration-view); an NPC voice reads first-person speech in character (roleplay-view).
 * Auditioning an NPC on narration - complete with a "she says" it will never utter - tells you
 * almost nothing about how it will actually deliver that character's dialogue.
 *
 * Every line is META and STANDALONE: it knows it is a sample and introduces the job it is applying
 * for. A fragment lifted out of a scene makes you wonder who "she" is and where the marsh was,
 * which is attention spent on the writing instead of on the voice. These need no context at all.
 *
 * Each still earns its place by testing something. Narrator 2 exists to carry invented proper
 * nouns - this is a fantasy game, the narrator reads made-up compounds constantly, and engines
 * diverge far more on those than on ordinary prose. Narrator 3 carries quoted speech, which real
 * narration lines do. The NPC set walks neutral, heated and wry.
 *
 * Fixed strings on purpose - narration audio is content-addressed on (text + voice + engine), so a
 * stable line means a voice is synthesized once and every later audition is a free cache hit.
 */
export type VoiceSampleKind = 'narrator' | 'npc'

export const VOICE_SAMPLE_LINES: Record<VoiceSampleKind, readonly string[]> = {
  narrator: [
    'This is the voice that will carry your story - every door, every dice roll, every bad idea.',
    'I will not stumble on a name like Ashfell or Kestrel Deep, and I will say it the same way twice.',
    'When someone speaks, you will hear it like this. "Not that way," she said. "Not tonight."',
  ],
  npc: [
    'Give me a name and a grudge, and I will carry both for as long as you need.',
    'I can refuse you, too. No. Absolutely not. Not for any coin you are carrying.',
    'Or I can find all of this funny - most of us down here do, eventually.',
  ],
}
