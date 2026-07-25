import type { NarrationFlag, NarrationLine } from '../types'

const FLAG_LABEL: Record<NarrationFlag, string> = {
  fallback: 'mechanical fallback — the narrator failed here',
  duplicate: 'repeated line',
}
const FLAG_TEXT: Record<NarrationFlag, string> = {
  fallback: 'text-destructive',
  duplicate: 'text-amber-600 dark:text-amber-400',
}

/** The clean player-facing story, for catching NARRATIVE bugs by reading, with inline flags on
 *  fallback / duplicate lines so broken or repeated prose jumps out. */
export function NarrationView({ lines }: { lines: NarrationLine[] }) {
  if (lines.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No narration recorded yet.</p>
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 leading-relaxed">
        {lines.map((line, i) => (
          <p key={`${i}-${line.text.slice(0, 16)}`} className={line.flag ? 'rounded-md border border-amber-500/50 bg-amber-50/50 p-2 dark:bg-amber-950/20' : ''}>
            {line.speaker && <span className="mr-1 font-semibold">{line.speaker}:</span>}
            <span className={line.flag ? FLAG_TEXT[line.flag] : line.speaker ? '' : 'italic text-foreground/90'}>{line.text}</span>
            {line.flag && <span className="ml-2 align-middle text-xs text-amber-600 dark:text-amber-400">⚠️ {FLAG_LABEL[line.flag]}</span>}
          </p>
        ))}
      </div>
    </div>
  )
}
