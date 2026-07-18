import { describe, expect, it } from 'vitest'

import { activeLoop, advanceBeat, completeLoop, pushLoop, resumeLoop, suspendLoop } from './loops.ts'
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

describe('advanceBeat', () => {
  it('moves the active loop to the new beat', () => {
    const { loops } = expectOk(advanceBeat([loop({})], 'l1', 'beat-9'))
    expect(loops[0].currentBeatId).toBe('beat-9')
  })

  it('only the active loop advances', () => {
    expect(advanceBeat([loop({ status: 'suspended' })], 'l1', 'beat-9').ok).toBe(false)
  })
})
