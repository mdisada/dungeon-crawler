import { describe, expect, it } from 'vitest'

import {
  activeLoop, advanceBeat, completeLoop, needsSpineLoop, pushLoop, resumeLoop, SPINE_LOOP_TYPE,
  spineLoopId, suspendLoop,
} from './loops.ts'
import { isOffLoop, LOOP_TEMPLATES } from './templates.ts'
import type { CoreLoop } from './types.ts'

const loop = (over: Partial<CoreLoop>): CoreLoop => ({
  id: 'l1',
  type: 'mystery',
  status: 'active',
  stackPosition: 1,
  currentBeatId: null,
  customLabel: null,
  ...over,
})

function expectOk(result: ReturnType<typeof pushLoop>): { loops: CoreLoop[]; resumedId: string | null } {
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('pushLoop', () => {
  it('activates the new loop and suspends the incumbent, preserving its beat', () => {
    const stack = [loop({ id: 'mystery', currentBeatId: 'beat-3' })]
    const { loops } = expectOk(pushLoop(stack, { id: 'crawl', type: 'dungeon_crawl', customLabel: null }))
    expect(activeLoop(loops)?.id).toBe('crawl')
    const suspended = loops.find((l) => l.id === 'mystery')
    expect(suspended?.status).toBe('suspended')
    expect(suspended?.currentBeatId).toBe('beat-3')
    expect(loops.find((l) => l.id === 'crawl')?.stackPosition).toBe(2)
  })

  it('pushes onto an empty stack', () => {
    const { loops } = expectOk(pushLoop([], { id: 'q1', type: 'escort', customLabel: 'Escort Maren' }))
    expect(activeLoop(loops)?.id).toBe('q1')
    expect(loops[0].stackPosition).toBe(1)
  })

  it('rejects a duplicate id', () => {
    const result = pushLoop([loop({})], { id: 'l1', type: 'heist', customLabel: null })
    expect(result.ok).toBe(false)
  })
})

describe('suspend/resume', () => {
  it('suspend then resume round-trips with beat position intact', () => {
    const stack = [loop({ currentBeatId: 'beat-2' })]
    const { loops: suspended } = expectOk(suspendLoop(stack, 'l1'))
    expect(activeLoop(suspended)).toBeNull()
    const { loops: resumed } = expectOk(resumeLoop(suspended, 'l1'))
    expect(activeLoop(resumed)?.currentBeatId).toBe('beat-2')
  })

  it('refuses to resume while another loop is active', () => {
    const stack = [loop({ id: 'a', status: 'suspended' }), loop({ id: 'b', stackPosition: 2 })]
    const result = resumeLoop(stack, 'a')
    expect(result.ok).toBe(false)
  })

  it('refuses to suspend a non-active loop', () => {
    expect(suspendLoop([loop({ status: 'suspended' })], 'l1').ok).toBe(false)
  })
})

describe('completeLoop', () => {
  it('completing the active loop resumes the topmost suspended one at its beat', () => {
    const stack = [
      loop({ id: 'mystery', status: 'suspended', stackPosition: 1, currentBeatId: 'beat-4' }),
      loop({ id: 'side', status: 'suspended', stackPosition: 2, currentBeatId: 'beat-1' }),
      loop({ id: 'crawl', status: 'active', stackPosition: 3 }),
    ]
    const { loops, resumedId } = expectOk(completeLoop(stack, 'crawl'))
    expect(resumedId).toBe('side')
    expect(activeLoop(loops)?.id).toBe('side')
    expect(activeLoop(loops)?.currentBeatId).toBe('beat-1')
  })

  it('completing a suspended loop leaves the active loop alone', () => {
    const stack = [loop({ id: 'a', status: 'suspended' }), loop({ id: 'b', stackPosition: 2 })]
    const { loops, resumedId } = expectOk(completeLoop(stack, 'a'))
    expect(resumedId).toBeNull()
    expect(activeLoop(loops)?.id).toBe('b')
  })

  it('completing the last active loop leaves an empty stage (resumedId null)', () => {
    const { loops, resumedId } = expectOk(completeLoop([loop({})], 'l1'))
    expect(resumedId).toBeNull()
    expect(activeLoop(loops)).toBeNull()
  })

  it('rejects double-completion', () => {
    expect(completeLoop([loop({ status: 'completed' })], 'l1').ok).toBe(false)
  })
})

describe('a live objective always has a loop (2026-07-27)', () => {
  it('an active objective with an empty stack needs one', () => {
    expect(needsSpineLoop([], true)).toBe(true)
  })

  it('completing the last quest loop leaves an active objective stranded - the live failure', () => {
    // The Lantern of Saltmarsh Reach: the entry contract covered objectives 0-1, so its payout
    // completed the only loop while objective 2 (the climax) was being revealed.
    const { loops, resumedId } = expectOk(completeLoop([loop({ type: 'custom' })], 'l1'))
    expect(resumedId).toBeNull()
    expect(needsSpineLoop(loops, true)).toBe(true)
  })

  it('does not open one before an objective is active (the pre-acceptance window)', () => {
    expect(needsSpineLoop([], false)).toBe(false)
  })

  it('does not add a third loop when completing auto-resumes a suspended one', () => {
    const pushed = expectOk(pushLoop([loop({})], { id: 'l2', type: 'heist', customLabel: null }))
    const done = expectOk(completeLoop(pushed.loops, 'l2'))
    expect(done.resumedId).toBe('l1')
    expect(needsSpineLoop(done.loops, true)).toBe(false)
  })

  it('derives a stable, well-formed, non-colliding id per objective', () => {
    const objective = '58d06487-e9af-4849-ae88-04bdc2ba94bd'
    const id = spineLoopId(objective)
    expect(id).toBe(spineLoopId(objective))
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).not.toBe(objective)
    expect(spineLoopId('9ba17545-4c2c-4874-88f2-207e0d0a91ec')).not.toBe(id)
  })

  it('leaves a non-uuid untouched rather than emitting a malformed one', () => {
    expect(spineLoopId('not-a-uuid')).toBe('not-a-uuid')
  })

  it('the spine loop type exists and can never read as off-loop', () => {
    expect(LOOP_TEMPLATES[SPINE_LOOP_TYPE]).toBeDefined()
    for (const pillar of ['combat', 'social', 'exploration'] as const) {
      expect(isOffLoop(pillar, SPINE_LOOP_TYPE)).toBe(false)
    }
  })
})

describe('advanceBeat', () => {
  it('moves the active loop to the new beat', () => {
    const { loops } = expectOk(advanceBeat([loop({})], 'l1', 'beat-9'))
    expect(loops[0].currentBeatId).toBe('beat-9')
  })

  it('only the active loop advances', () => {
    expect(advanceBeat([loop({ status: 'suspended' })], 'l1', 'beat-9').ok).toBe(false)
  })
})
