import { beforeEach, describe, expect, it, vi } from 'vitest'

const callEdgeFunction = vi.fn()
vi.mock('@/lib/edge-function', () => ({ callEdgeFunction: (...args: unknown[]) => callEdgeFunction(...args) }))

const { writeLocationScenePrompt } = await import('./api/image-prompt')
const { locationBackgroundPrompt, needsBackground } = await import('./api/location-images')
type LocationRow = import('./types').LocationRow

function location(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: 'loc-1',
    chapterId: null,
    name: 'The Drowned Quarter',
    description: 'A flooded dockside district the tide reclaimed.',
    imagePrompt: "Maren's harbour at dusk, half-sunken warehouses",
    backgroundPath: null,
    previousBackgroundPaths: [],
    map: null,
    humanEdited: false,
    pendingRegen: null,
    ...overrides,
  }
}

/** The model answers with JSON: a brief plus the tags it filed the place under. */
const reply = (brief: string, tags: string[] = ['coast']) => replyRaw(JSON.stringify({ brief, tags }))

const replyRaw = (content: string) => ({
  ok: true,
  json: () => Promise.resolve({ choices: [{ message: { content } }] }),
})

// mockClear, not mockReset: after a reset, vitest reports a mock's recorded throw as an unhandled
// error and fails the test even though the caller catches it. Every test sets its own behaviour.
beforeEach(() => {
  callEdgeFunction.mockClear()
})

describe('needsBackground', () => {
  it('picks up a location with something to draw and no plate', () => {
    expect(needsBackground(location())).toBe(true)
  })

  it('skips a blank row', () => {
    expect(needsBackground(location({ imagePrompt: '', description: '' }))).toBe(false)
  })

  it('leaves a location that already has a plate', () => {
    expect(needsBackground(location({ backgroundPath: 'locations/loc-1/background-1.png' }))).toBe(false)
  })
})

describe('locationBackgroundPrompt', () => {
  it('strips the cast and appends the background preset', () => {
    const prompt = locationBackgroundPrompt(location(), ['Maren'])
    expect(prompt.startsWith('harbour at dusk, half-sunken warehouses,')).toBe(true)
    expect(prompt).toContain('empty of people')
    expect(prompt).toContain('visual-novel background plate')
    expect(prompt).not.toContain('Maren')
  })

  it('is empty when there is nothing to draw', () => {
    expect(locationBackgroundPrompt(location({ imagePrompt: '', description: '' }), [])).toBe('')
  })
})

describe('writeLocationScenePrompt', () => {
  it('sends the name-stripped note on the primary seat and returns the rewrite', async () => {
    callEdgeFunction.mockResolvedValue(reply('An empty harbour of half-sunken warehouses at dusk, lanterns guttering.'))
    const result = await writeLocationScenePrompt(location(), ['Maren'])

    expect(result?.brief).toBe('An empty harbour of half-sunken warehouses at dusk, lanterns guttering.')
    expect(result?.tags).toEqual(['coast'])
    const body = JSON.parse((callEdgeFunction.mock.calls[0][1] as { body: string }).body)
    expect(body.agent_role).toBe('image_prompter')
    expect(body.payload.messages[1].content).not.toContain('Maren')
  })

  it('gives up quietly on an error status', async () => {
    // An ai-proxy that predates the image_prompter role answers 400; the caller must still end up
    // with a usable prompt rather than an exception.
    callEdgeFunction.mockResolvedValue({ ok: false, text: () => Promise.resolve('Unknown agent_role') })
    expect(await writeLocationScenePrompt(location(), ['Maren'])).toBeNull()
  })

  it('gives up quietly when the call throws', async () => {
    callEdgeFunction.mockImplementation(() => {
      throw new Error('offline')
    })
    expect(await writeLocationScenePrompt(location(), ['Maren'])).toBeNull()
  })

  it('rejects an answer that is not a brief', async () => {
    callEdgeFunction.mockResolvedValue(reply('No.'))
    expect(await writeLocationScenePrompt(location(), [])).toBeNull()

    callEdgeFunction.mockResolvedValue(reply('x'.repeat(700)))
    expect(await writeLocationScenePrompt(location(), [])).toBeNull()
  })

  it('unwraps the fenced block a model likes to answer in', async () => {
    const fenced = ['```json', JSON.stringify({ brief: 'An empty stone bridge over a frozen river.', tags: ['river'] }), '```'].join('\n')
    callEdgeFunction.mockResolvedValue(replyRaw(fenced))

    const result = await writeLocationScenePrompt(location(), [])
    expect(result?.brief).toBe('An empty stone bridge over a frozen river.')
    expect(result?.tags).toEqual(['river'])
  })

  it('keeps only tags from the closed vocabulary, and falls back to the location text', async () => {
    // "spooky" is not a shelf. With nothing usable left, the words of the place itself decide.
    callEdgeFunction.mockResolvedValue(reply('An empty flooded dockside of half-sunken warehouses.', ['spooky', 'vibes']))
    const result = await writeLocationScenePrompt(location({ name: 'The Drowned Forest' }), [])
    expect(result?.tags).toEqual(['forest'])
  })

  it('does not call out at all when there is nothing to draw', async () => {
    expect(await writeLocationScenePrompt(location({ imagePrompt: '', description: '' }), [])).toBeNull()
    expect(callEdgeFunction).not.toHaveBeenCalled()
  })
})
