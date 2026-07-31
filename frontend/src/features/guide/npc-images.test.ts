import { describe, expect, it } from 'vitest'

import { needsImages, npcImagePrompt } from './api/npc-images'
import type { Npc, NpcImages } from './types'

function npc(overrides: Partial<Npc> = {}): Npc {
  return {
    id: 'npc-1',
    name: 'Elder Maren',
    role: 'npc',
    personality: {},
    faction: '',
    voiceId: null,
    imagePrompt: 'a weathered village elder in a grey shawl',
    images: {},
    description: 'Keeps the village records and the village secrets.',
    statBlock: null,
    humanEdited: false,
    pendingRegen: null,
    ...overrides,
  } as Npc
}

describe('needsImages', () => {
  it('picks up an NPC with a description and no images', () => {
    expect(needsImages(npc())).toBe(true)
  })

  it('skips a blank row', () => {
    // "Add NPC" inserts one of these; drawing it would buy a picture of nobody.
    expect(needsImages(npc({ imagePrompt: '', description: '' }))).toBe(false)
    expect(needsImages(npc({ imagePrompt: '   ', description: '  ' }))).toBe(false)
  })

  it('draws from the description when no image prompt was authored', () => {
    expect(needsImages(npc({ imagePrompt: '' }))).toBe(true)
  })

  it.each([
    ['original', { original: 'npcs/1/original.png' }],
    ['base', { base: 'npcs/1/base.png' }],
    ['portrait', { portrait: 'npcs/1/portrait.png' }],
    ['token', { token: 'npcs/1/token.png' }],
    ['a pre-2026-07-31 fullbody', { fullbody: 'npcs/1/fullbody.png' }],
  ])('leaves an NPC alone once it has %s', (_label, images: NpcImages) => {
    expect(needsImages(npc({ images }))).toBe(false)
  })

  it('is not re-triggered by a stored token colour alone', () => {
    // tokenBackground is a hex, not a path - on its own it is not a picture.
    expect(needsImages(npc({ images: { tokenBackground: '#1f2937' } }))).toBe(true)
  })
})

describe('npcImagePrompt', () => {
  it('prefers the authored image prompt and appends the preset suffix', () => {
    const prompt = npcImagePrompt(npc())
    expect(prompt.startsWith('a weathered village elder in a grey shawl,')).toBe(true)
    expect(prompt).toContain('chroma key green background')
    expect(prompt).toContain('full body visible from head to toe')
  })

  it('falls back to the description, then to the name', () => {
    expect(npcImagePrompt(npc({ imagePrompt: '' }))).toContain('Keeps the village records')
    expect(npcImagePrompt(npc({ imagePrompt: '', description: '' }))).toContain('Elder Maren')
  })
})
