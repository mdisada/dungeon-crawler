import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import { usePlay } from '../hooks/use-play-context'

export interface VolumeLevels {
  narration: number
  music: number
  sfx: number
  muted: boolean
}

interface PlayHeaderProps {
  volumes: VolumeLevels
  onVolumesChange: (next: VolumeLevels) => void
  needsAudioUnlock: boolean
  onAudioUnlock: () => void
}

/** F06 SS2 header: in-game day, adventure + session title, connection dot, volume popover. */
export function PlayHeader({ volumes, onVolumesChange, needsAudioUnlock, onAudioUnlock }: PlayHeaderProps) {
  const { adventure, state, connection } = usePlay()

  return (
    <header className="flex items-center gap-3 border-b bg-card px-4 py-2">
      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">Day {state.scene.day}</span>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
        {adventure.title}
        {state.session.index > 0 && <span className="ml-2 font-normal text-muted-foreground">Session {state.session.index}</span>}
      </h1>

      <span
        title={connection === 'live' ? 'Live' : 'Reconnecting…'}
        className={cn('h-2.5 w-2.5 rounded-full', connection === 'live' ? 'bg-emerald-500' : 'animate-pulse bg-amber-500')}
        role="status"
        aria-label={connection === 'live' ? 'Connected' : 'Reconnecting'}
      />

      {needsAudioUnlock && (
        <Button size="sm" variant="outline" onClick={onAudioUnlock}>
          Enable audio
        </Button>
      )}

      <Popover>
        <PopoverTrigger
          aria-label="Volume controls"
          className="rounded-md border px-2 py-1 text-sm hover:bg-accent"
        >
          {volumes.muted ? '🔇' : '🔊'}
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="flex flex-col gap-4">
            {(['narration', 'music', 'sfx'] as const).map((layer) => (
              <div key={layer}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="capitalize">{layer}</span>
                  <span>{Math.round(volumes[layer] * 100)}%</span>
                </div>
                <Slider
                  value={volumes[layer] * 100}
                  min={0}
                  max={100}
                  onValueChange={(value) =>
                    onVolumesChange({ ...volumes, [layer]: Number(value) / 100 })
                  }
                  aria-label={`${layer} volume`}
                >
                  <SliderControl>
                    <SliderTrack>
                      <SliderIndicator />
                      <SliderThumb />
                    </SliderTrack>
                  </SliderControl>
                </Slider>
              </div>
            ))}
            <Button
              size="sm"
              variant={volumes.muted ? 'default' : 'outline'}
              onClick={() => onVolumesChange({ ...volumes, muted: !volumes.muted })}
            >
              {volumes.muted ? 'Unmute' : 'Mute all'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </header>
  )
}
