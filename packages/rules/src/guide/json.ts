// Helpers shared by the stage parsers: pull a JSON object out of raw LLM text (models wrap
// output in code fences or preambles even when asked not to) and small error-collecting
// coercers so each parser reads as a flat schema description.

import type { ParseResult } from './types.ts'

export function extractJsonObject(raw: string): ParseResult<Record<string, unknown>> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, errors: ['response contains no JSON object'] }
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, errors: ['response JSON is not an object'] }
    }
    return { ok: true, data: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, errors: [`response JSON does not parse: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

/** Collects schema errors while coercing fields, so parsers report every problem at once. */
export class Check {
  readonly errors: string[] = []

  str(value: unknown, path: string, { allowEmpty = false } = {}): string {
    if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
      this.errors.push(`${path}: expected a non-empty string`)
      return ''
    }
    return value.trim()
  }

  int(value: unknown, path: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.errors.push(`${path}: expected an integer in [${min}, ${max}]`)
      return min
    }
    return value
  }

  arr(value: unknown, path: string, minLen = 0, maxLen = Infinity): unknown[] {
    if (!Array.isArray(value) || value.length < minLen || value.length > maxLen) {
      const bound = maxLen === Infinity ? `>= ${minLen}` : `${minLen}-${maxLen}`
      this.errors.push(`${path}: expected an array of length ${bound}`)
      return []
    }
    return value
  }

  obj(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.errors.push(`${path}: expected an object`)
      return {}
    }
    return value as Record<string, unknown>
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      this.errors.push(`${path}: expected one of ${allowed.join(', ')}`)
      return allowed[0]
    }
    return value as T
  }

  result<T>(data: T): ParseResult<T> {
    return this.errors.length > 0 ? { ok: false, errors: this.errors } : { ok: true, data }
  }
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * True when prose appears cut off mid-thought - it ends on a bare letter/digit, comma, colon,
 * or dash instead of a finished sentence. A FORM check, not a meaning check (same class as
 * countWords): models fitting a token budget ship "Success here means the pa", and both the
 * stage-3 author and the stage-7 repairs did exactly that live (2026-07-22). Used as a hard
 * parse error so the existing regeneration loops finish the sentence.
 */
export function looksCutOff(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return !/[.!?…"'’”)\]]$/.test(trimmed)
}
