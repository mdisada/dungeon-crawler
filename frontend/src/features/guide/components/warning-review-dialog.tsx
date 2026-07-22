import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogPopup, DialogTitle } from '@/components/ui/dialog'

import { resolveWarning } from '../api/resolve-warning'
import type { GuideWarning } from '../types'

interface WarningReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Unresolved needs-attention findings; the dialog always shows the first and works down. */
  queue: GuideWarning[]
  /** Approve/Edit resolved a warning - reload guide data so the queue advances. */
  onResolved: () => void
  /** Edit chosen: navigate to the content the finding is about (tab switch / drawer). */
  onEdit: (warning: GuideWarning) => void
}

const TARGET_LABELS: Record<string, string> = {
  objectives: 'Objective',
  npcs: 'NPC',
  locations: 'Location',
  ingredients: 'Ingredient',
  encounters: 'Encounter',
  endings: 'Ending',
}

/**
 * Sequential review of the findings generation could not fix by itself - one at a time,
 * Approve (accept as-is) or Edit (jump to the content). Both mark the finding handled;
 * regeneration writes fresh findings, so nothing is ever silently lost.
 */
export function WarningReviewDialog({ open, onOpenChange, queue, onResolved, onEdit }: WarningReviewDialogProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = queue[0]
  if (!current) return null

  const handle = async (action: 'approve' | 'edit') => {
    setIsSaving(true)
    setError(null)
    try {
      await resolveWarning(current.id)
      if (action === 'edit') {
        onEdit(current)
        onOpenChange(false)
      } else if (queue.length === 1) {
        onOpenChange(false)
      }
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save your decision')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogTitle>Review generation findings</DialogTitle>
        <DialogDescription>
          {queue.length} to review · {current.targetTable ? (TARGET_LABELS[current.targetTable] ?? current.targetTable) : 'Whole guide'}
        </DialogDescription>
        <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">{current.message}</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {current.targetTable && (
            <Button variant="outline" disabled={isSaving} onClick={() => void handle('edit')}>
              Edit
            </Button>
          )}
          <Button disabled={isSaving} onClick={() => void handle('approve')}>
            Approve
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
