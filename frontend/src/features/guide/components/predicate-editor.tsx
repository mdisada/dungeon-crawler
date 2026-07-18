import { useState } from 'react'

import { parsePredicateJson } from '@rules/guide'

import { Button } from '@/components/ui/button'
import { Dialog, DialogPopup, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fromPredicate, toPredicate, emptyAtom, type BuilderNode } from '../predicate-builder'

interface PredicateNodeEditorProps {
  node: BuilderNode
  onChange: (node: BuilderNode) => void
  onRemove?: () => void
}

const KIND_OPTIONS: { value: BuilderNode['kind']; label: string }[] = [
  { value: 'flag', label: 'Quest flag' },
  { value: 'fact', label: 'World fact' },
  { value: 'event', label: 'Event happened' },
  { value: 'any', label: 'ANY of…' },
  { value: 'all', label: 'ALL of…' },
]

function changeKind(node: BuilderNode, kind: BuilderNode['kind']): BuilderNode {
  if (kind === node.kind) return node
  if (kind === 'any' || kind === 'all') {
    return { kind, children: 'children' in node ? node.children : [node] }
  }
  if (kind === 'fact') return { kind, path: '', op: 'eq', value: '' }
  if (kind === 'flag') return { kind, flag: '', value: 'true' }
  return { kind: 'event', text: '' }
}

function PredicateNodeEditor({ node, onChange, onRemove }: PredicateNodeEditorProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <select
          aria-label="Condition type"
          className="h-8 rounded-md border bg-background px-2 text-sm"
          value={node.kind}
          onChange={(e) => onChange(changeKind(node, e.target.value as BuilderNode['kind']))}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove condition">
            Remove
          </Button>
        )}
      </div>

      {node.kind === 'flag' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Flag name" placeholder="flag name (e.g. ritual_stopped)" value={node.flag} onChange={(e) => onChange({ ...node, flag: e.target.value })} />
          <Input aria-label="Flag value" placeholder="value (e.g. true)" value={node.value} onChange={(e) => onChange({ ...node, value: e.target.value })} />
        </div>
      )}
      {node.kind === 'fact' && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Fact path" placeholder="npc.volgarth.status" value={node.path} onChange={(e) => onChange({ ...node, path: e.target.value })} />
          <select
            aria-label="Comparison"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={node.op}
            onChange={(e) => onChange({ ...node, op: e.target.value as 'eq' | 'in' })}
          >
            <option value="eq">equals</option>
            <option value="in">is one of</option>
          </select>
          <Input
            aria-label="Fact value"
            placeholder={node.op === 'in' ? 'dead, captured, fled' : 'value'}
            value={node.value}
            onChange={(e) => onChange({ ...node, value: e.target.value })}
          />
        </div>
      )}
      {node.kind === 'event' && (
        <Input aria-label="Event description" placeholder="party entered the Sunken Chapel" value={node.text} onChange={(e) => onChange({ ...node, text: e.target.value })} />
      )}
      {(node.kind === 'any' || node.kind === 'all') && (
        <div className="flex flex-col gap-2 border-l-2 pl-3">
          {node.children.map((child, i) => (
            <PredicateNodeEditor
              key={i}
              node={child}
              onChange={(next) => onChange({ ...node, children: node.children.map((c, j) => (j === i ? next : c)) })}
              onRemove={node.children.length > 1 ? () => onChange({ ...node, children: node.children.filter((_, j) => j !== i) }) : undefined}
            />
          ))}
          <Button variant="outline" size="sm" onClick={() => onChange({ ...node, children: [...node.children, emptyAtom()] })}>
            Add condition
          </Button>
        </div>
      )}
    </div>
  )
}

interface PredicateEditorProps {
  value: unknown
  onSave: (predicate: unknown) => Promise<void>
}

// F04 SS5.1: form-based builder over the predicate atoms with a raw-JSON escape hatch; invalid
// raw JSON is blocked with the validator's errors (SS7).
export function PredicateEditor({ value, onSave }: PredicateEditorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<'builder' | 'raw'>('builder')
  const [node, setNode] = useState<BuilderNode>(() => fromPredicate(value))
  const [rawText, setRawText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  function open(nextOpen: boolean) {
    if (nextOpen) {
      setNode(fromPredicate(value))
      setRawText(JSON.stringify(value ?? toPredicate(emptyAtom()), null, 2))
      setErrors([])
      setMode('builder')
    }
    setIsOpen(nextOpen)
  }

  async function save() {
    const candidate = mode === 'builder' ? JSON.stringify(toPredicate(node)) : rawText
    const parsed = parsePredicateJson(candidate)
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    setIsSaving(true)
    try {
      await onSave(parsed.predicate)
      setIsOpen(false)
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Failed to save predicate'])
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open}>
      <DialogTrigger className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">
        Completion conditions
      </DialogTrigger>
      <DialogPopup className="max-w-2xl">
        <DialogTitle>Completion conditions</DialogTitle>
        <div className="mt-4 flex gap-2">
          <Button variant={mode === 'builder' ? 'default' : 'outline'} size="sm" onClick={() => setMode('builder')}>
            Builder
          </Button>
          <Button
            variant={mode === 'raw' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setRawText(JSON.stringify(toPredicate(node), null, 2))
              setMode('raw')
            }}
          >
            Raw JSON
          </Button>
        </div>
        <div className="mt-4 max-h-96 overflow-y-auto">
          {mode === 'builder' ? (
            <PredicateNodeEditor node={node} onChange={setNode} />
          ) : (
            <Textarea
              aria-label="Predicate JSON"
              className="min-h-48 font-mono text-xs"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />
          )}
        </div>
        {errors.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-destructive">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={isSaving}>
            Save conditions
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
