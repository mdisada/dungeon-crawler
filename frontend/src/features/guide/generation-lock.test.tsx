// What the DM sees while the guide builds: a bar that actually moves, and an editor they cannot
// type into. The lock exists because a pipeline stage reads the rows it is about to replace.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

vi.mock('./api/pipeline', () => ({ retryJob: vi.fn() }))

const { EditorLock } = await import('./components/editor-lock')
const { PipelineProgress } = await import('./components/pipeline-progress')
type GuideJob = import('./types').GuideJob

let nextId = 0
const job = (stage: number, status: GuideJob['status'], over: Partial<GuideJob> = {}): GuideJob => ({
  id: `job-${(nextId += 1)}`,
  stage,
  chapterId: null,
  status,
  error: null,
  attempts: 1,
  ...over,
})

describe('the generation progress panel', () => {
  it('fills the bar to the share of steps that are done', () => {
    render(
      <PipelineProgress
        jobs={[job(1, 'done'), job(2, 'done'), job(3, 'running'), job(4, 'queued')]}
        chapters={[]}
        onChanged={() => {}}
      />,
    )

    expect(screen.getByText('2 of 4 steps')).toBeInTheDocument()
    // Base UI needs Track + Indicator inside Progress; without them the bar is an empty container,
    // which is what this page shipped with.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })

  it('names the stage the DM is waiting on', () => {
    render(
      <PipelineProgress jobs={[job(1, 'done'), job(2, 'running')]} chapters={[]} onChanged={() => {}} />,
    )
    expect(screen.getByText(/Stage 2 of 2: Scene scaffolding/)).toBeInTheDocument()
  })

  it('offers a retry on the stage that failed, and stops calling itself busy', () => {
    render(
      <PipelineProgress
        jobs={[job(1, 'done'), job(2, 'failed', { error: 'model returned nothing' })]}
        chapters={[]}
        onChanged={() => {}}
      />,
    )

    expect(screen.getByText('Guide generation paused')).toBeInTheDocument()
    expect(screen.getByText('model returned nothing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry stage' })).toBeInTheDocument()
  })
})

describe('the editor lock', () => {
  it('leaves the guide readable but takes it out of reach while a stage writes', () => {
    render(
      <EditorLock isLocked>
        <button type="button">Save NPC</button>
      </EditorLock>,
    )

    // Readable: the DM is meant to watch the guide fill in, not stare at a spinner.
    expect(screen.getByText('Save NPC')).toBeInTheDocument()
    // inert is the enforcement - it removes the subtree from hit-testing, tab order and the
    // accessibility tree in one attribute, so no per-field `disabled` can be forgotten.
    expect(screen.getByText('Save NPC').closest('[inert]')).not.toBeNull()
  })

  it('hands the guide back once nothing is writing', () => {
    render(
      <EditorLock isLocked={false}>
        <button type="button">Save NPC</button>
      </EditorLock>,
    )
    expect(screen.getByText('Save NPC').closest('[inert]')).toBeNull()
  })
})
