import { sendRealtimeRequest } from '@/lib/realtime-request'
import { PUZZLE_COMPILE_TOPIC, TIMEOUTS } from '../constants'
import type { PuzzleCompiledResponse, PuzzleDefinition } from '../types'

export type CompilePuzzlePayload = {
  model: string
  description: string
  archetype: string
  presentation?: 'map' | 'text'
  existingDefinition?: PuzzleDefinition
  feedback?: string
  plot?: string
}

export function compilePuzzle(
  jobId: string,
  payload: CompilePuzzlePayload,
): Promise<PuzzleCompiledResponse> {
  return sendRealtimeRequest<CompilePuzzlePayload, PuzzleCompiledResponse>({
    channelTopic: PUZZLE_COMPILE_TOPIC,
    requestEvent: 'compile-puzzle',
    responseEvent: 'puzzle-compiled',
    jobId,
    payload,
    timeoutMs: TIMEOUTS.compilePuzzle,
  })
}
