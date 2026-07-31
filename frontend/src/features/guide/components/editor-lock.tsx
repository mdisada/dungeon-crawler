import { cn } from '@/lib/utils'

interface EditorLockProps {
  isLocked: boolean
  children: React.ReactNode
}

/**
 * Read-only while something is writing (F04, owner's call 2026-08-01).
 *
 * `inert` is what enforces it: one attribute takes the whole subtree out of hit-testing, the tab
 * order and the accessibility tree, so there is no input left to reach and no per-field `disabled`
 * for the next tab someone adds to forget. The dimming only explains it.
 *
 * Locked, not hidden - the DM is meant to watch the guide fill in.
 */
export function EditorLock({ isLocked, children }: EditorLockProps) {
  return (
    <div
      inert={isLocked}
      className={cn('flex flex-col gap-4 transition-opacity', isLocked && 'select-none opacity-50')}
    >
      {children}
    </div>
  )
}
