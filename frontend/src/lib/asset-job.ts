import type { RealtimeChannel } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

/**
 * Realtime transport for local-worker asset jobs (F12).
 *
 * Distinct from lib/realtime-request.ts, which resolves on the first matching reply and then
 * removes the channel -- correct for the ping/pong-shaped campaign calls, wrong here. Image and
 * TTS generation runs for tens of seconds and reports progress along the way, so this helper
 * keeps one subscribed channel per topic and multiplexes jobs over it by jobId. That also
 * sidesteps the "two channels on one topic silently never subscribe" trap, since the channel is
 * created once and reused.
 *
 * Wire contract (backend/assets.py):
 *   request   -> `generate-image` | `generate-tts` | `get-capabilities`, payload includes jobId
 *   progress  <- `asset-progress` { jobId, stage, chunkIndex?, storagePath?, detail? }  (repeated)
 *   terminal  <- `asset-result`   { jobId, ...data }  or  { jobId, error }
 */

export const ASSET_STAGES = ['received', 'generating', 'chunk', 'uploading', 'done'] as const
export type AssetStage = (typeof ASSET_STAGES)[number]

export interface AssetProgressEvent {
  jobId: string
  stage: AssetStage
  /** Local TTS emits one per audio chunk as it lands in Storage. */
  chunkIndex?: number
  storagePath?: string
  detail?: string
}

/** When each stage was first observed, relative to the request being sent. */
export interface AssetJobMark {
  stage: AssetStage
  atMs: number
}

export interface AssetJobOutcome<T> {
  data: T
  marks: AssetJobMark[]
}

interface SendAssetJobArgs {
  userId: string
  requestEvent: string
  payload: Record<string, unknown>
  jobId: string
  onProgress?: (event: AssetProgressEvent) => void
  /** No first reply within this window means nothing is listening. */
  ackTimeoutMs?: number
  /** Silence between progress events after the worker acked. */
  idleTimeoutMs?: number
}

const DEFAULT_ACK_TIMEOUT_MS = 8_000
const DEFAULT_IDLE_TIMEOUT_MS = 180_000

type JobListener = {
  onProgress: (event: AssetProgressEvent) => void
  onResult: (payload: Record<string, unknown>) => void
}

type TopicEntry = {
  channel: RealtimeChannel
  ready: Promise<void>
  listeners: Map<string, JobListener>
}

const topics = new Map<string, TopicEntry>()

/** Topic is per-user so a worker only ever sees jobs addressed to the account it runs for. */
export function assetTopic(userId: string): string {
  return `assets:${userId}`
}

function entryFor(userId: string): TopicEntry {
  const topic = assetTopic(userId)
  const existing = topics.get(topic)
  if (existing) return existing

  const listeners = new Map<string, JobListener>()
  const channel = supabase.channel(topic)

  channel
    .on('broadcast', { event: 'asset-progress' }, ({ payload }) => {
      const event = payload as AssetProgressEvent
      listeners.get(event.jobId)?.onProgress(event)
    })
    .on('broadcast', { event: 'asset-result' }, ({ payload }) => {
      const result = payload as Record<string, unknown>
      const jobId = typeof result.jobId === 'string' ? result.jobId : null
      if (jobId) listeners.get(jobId)?.onResult(result)
    })

  const ready = new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        topics.delete(topic)
        reject(new Error(`Could not subscribe to '${topic}'`))
      }
    })
  })

  const created: TopicEntry = { channel, ready, listeners }
  topics.set(topic, created)
  return created
}

/**
 * Sends one job to the local worker and resolves with its terminal payload. Rejects if nothing
 * acks within ackTimeoutMs (worker offline) or the worker goes quiet mid-job.
 */
export async function sendAssetJob<T>({
  userId,
  requestEvent,
  payload,
  jobId,
  onProgress,
  ackTimeoutMs = DEFAULT_ACK_TIMEOUT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
}: SendAssetJobArgs): Promise<AssetJobOutcome<T>> {
  const entry = entryFor(userId)
  await entry.ready

  return new Promise<AssetJobOutcome<T>>((resolve, reject) => {
    const startedAt = performance.now()
    const marks: AssetJobMark[] = []
    let timer: ReturnType<typeof setTimeout>

    const finish = (fn: () => void) => {
      clearTimeout(timer)
      entry.listeners.delete(jobId)
      fn()
    }

    const arm = (ms: number, message: string) => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(() => reject(new Error(message))), ms)
    }

    entry.listeners.set(jobId, {
      onProgress: (event) => {
        // 'chunk' repeats per audio segment; every other stage is recorded once so the run
        // table can show where the time actually went.
        if (event.stage === 'chunk' || !marks.some((m) => m.stage === event.stage)) {
          marks.push({ stage: event.stage, atMs: performance.now() - startedAt })
        }
        arm(idleTimeoutMs, `Worker went quiet after '${event.stage}'`)
        onProgress?.(event)
      },
      onResult: (result) => {
        if (typeof result.error === 'string') {
          finish(() => reject(new Error(result.error as string)))
          return
        }
        marks.push({ stage: 'done', atMs: performance.now() - startedAt })
        finish(() => resolve({ data: result as T, marks }))
      },
    })

    arm(ackTimeoutMs, 'Local worker did not respond - is backend/main.py running?')
    void entry.channel.send({ type: 'broadcast', event: requestEvent, payload: { ...payload, jobId } })
  })
}

export interface WorkerCapabilities {
  ttsBackend: 'chatterbox' | 'kokoro' | null
  cuda: boolean
  /** Chatterbox clones from a reference clip; Kokoro only has preset voices. */
  cloning: boolean
  ttsVoices: string[]
  imageModels: string[]
  queueDepth: number
}

/** Asks the worker what it can actually do. Rejecting means no worker is listening. */
export async function getWorkerCapabilities(userId: string, jobId: string): Promise<WorkerCapabilities> {
  const { data } = await sendAssetJob<{ capabilities: WorkerCapabilities }>({
    userId,
    requestEvent: 'get-capabilities',
    payload: {},
    jobId,
  })
  return data.capabilities
}
