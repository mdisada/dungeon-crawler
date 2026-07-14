import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCampaignPuzzles } from '../hooks/use-campaign-puzzles'

type Props = {
  campaignId: number
  busy: boolean
  onStartPuzzle: (puzzleId: number) => void
}

// Battle encounters aren't implemented yet — the button is a placeholder so the DM sees where
// that option will land, per the request that scoped this panel to puzzles only for now.
export function EventTriggerPanel({ campaignId, busy, onStartPuzzle }: Props) {
  const { puzzles, isLoading } = useCampaignPuzzles(campaignId)
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null)

  const placeholder = isLoading ? 'Loading puzzles…' : puzzles.length === 0 ? 'No puzzles available' : 'Choose a puzzle'

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base">Trigger an event</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedPuzzleId ?? undefined}
          onValueChange={(next) => setSelectedPuzzleId(next ?? null)}
          disabled={busy || puzzles.length === 0}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {puzzles.map((puzzle) => (
              <SelectItem key={puzzle.id} value={String(puzzle.id)}>
                {puzzle.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !selectedPuzzleId}
          onClick={() => {
            if (!selectedPuzzleId) return
            onStartPuzzle(Number(selectedPuzzleId))
            setSelectedPuzzleId(null)
          }}
        >
          Start puzzle
        </Button>
        <Button type="button" variant="outline" disabled title="Battle encounters aren't implemented yet">
          Start battle
        </Button>
      </div>
    </div>
  )
}
