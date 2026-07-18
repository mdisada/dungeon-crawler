// Pure mapping between predicate JSON (F04 SS4, validated by @rules/guide) and the form
// builder's editable node tree. Kept out of the component so the round-trip is unit-testable.

import type { Json } from '@rules/guide'

export type BuilderNode =
  | { kind: 'fact'; path: string; op: 'eq' | 'in'; value: string }
  | { kind: 'flag'; flag: string; value: string }
  | { kind: 'event'; text: string }
  | { kind: 'any' | 'all'; children: BuilderNode[] }

export function emptyAtom(): BuilderNode {
  return { kind: 'flag', flag: '', value: 'true' }
}

/** Scalar -> input text. Strings show raw; everything else as JSON. */
function scalarToText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null)
}

/**
 * Input text -> scalar. JSON-parseable text ("true", "3") becomes the typed value; anything
 * else stays a string. (A string that *looks* like a number can't round-trip as a string -
 * acceptable for quest flags and status values, which are worded.)
 */
function textToScalar(text: string): Json {
  const trimmed = text.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)) return parsed as Json
    return trimmed
  } catch {
    return trimmed
  }
}

export function fromPredicate(value: unknown): BuilderNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyAtom()
  const o = value as Record<string, unknown>
  if (Array.isArray(o.any)) return { kind: 'any', children: o.any.map(fromPredicate) }
  if (Array.isArray(o.all)) return { kind: 'all', children: o.all.map(fromPredicate) }
  if (typeof o.fact === 'string') {
    if (Array.isArray(o.in)) {
      return { kind: 'fact', path: o.fact, op: 'in', value: o.in.map(scalarToText).join(', ') }
    }
    return { kind: 'fact', path: o.fact, op: 'eq', value: scalarToText(o.eq) }
  }
  if (typeof o.flag === 'string') return { kind: 'flag', flag: o.flag, value: scalarToText(o.eq) }
  if (typeof o.event === 'string') return { kind: 'event', text: o.event }
  return emptyAtom()
}

export function toPredicate(node: BuilderNode): Json {
  switch (node.kind) {
    case 'fact':
      return node.op === 'in'
        ? { fact: node.path, in: node.value.split(',').map((v) => textToScalar(v)) }
        : { fact: node.path, eq: textToScalar(node.value) }
    case 'flag':
      return { flag: node.flag, eq: textToScalar(node.value) }
    case 'event':
      return { event: node.text }
    case 'any':
    case 'all':
      return { [node.kind]: node.children.map(toPredicate) }
  }
}
