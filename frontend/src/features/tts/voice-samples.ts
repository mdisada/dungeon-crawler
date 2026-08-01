/**
 * The lines every voice is auditioned with.
 *
 * Three, in different registers, because a voice that reads narration well can still be wrong for
 * dialogue: an invitation, a confrontation with quoted speech, and flat exposition. Fixed strings
 * on purpose - narration audio is content-addressed on (text + voice + engine), so a stable line
 * means a voice is synthesized once and every later audition is a free cache hit.
 */
export const VOICE_SAMPLE_LINES = [
  'The tide has stopped, traveler. Sit - there is a story you need to hear.',
  '"You should not have come back here," she says. "Not after what you did to them."',
  'Three days east, past the salt flats, the road simply ends. Nobody agrees on why.',
] as const

export const VOICE_SAMPLE_COUNT = VOICE_SAMPLE_LINES.length
