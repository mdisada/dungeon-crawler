import { Volume2Icon, VolumeXIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import { usePlay } from '../hooks/use-play-context'
import { LeaveTableDialog } from './leave-table-dialog'

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

/** F06 SS2 header: a transparent strip - leave, title, in-game day, connection dot, volume. */
export function PlayHeader({ volumes, onVolumesChange, needsAudioUnlock, onAudioUnlock }: PlayHeaderProps) {
  const { adventure, state, connection } = usePlay()
  const navigate = useNavigate()
  const location = useLocation()

  // 'default' is react-router's key for an entry the app itself did not push - going -1 there
  // would leave the app entirely, so send those visitors home instead.
  const handleLeave = () => {
    if (location.key === 'default') navigate('/')
    else navigate(-1)
  }

  const meta = [state.session.index > 0 && `Session ${state.session.index}`, `Day ${state.scene.day}`]
    .filter(Boolean)
    .join(' · ')

  return (
    <header className="flex h-7 shrink-0 items-center gap-2 px-2.5">
      <LeaveTableDialog onConfirm={handleLeave} />

      {/* index.css styles bare h1 outside any @layer (clamp(32px..56px), weight 500), and
          unlayered CSS outranks every @layer utility - so the size/weight here need `!`. */}
      <h1 className="min-w-0 truncate text-xs! font-semibold! tracking-tight">{adventure.title}</h1>
      {/* Session/day is chrome, not a heading - small caps keeps it legible while it recedes. */}
      <span aria-hidden className="hidden h-3 w-px shrink-0 bg-border sm:block" />
      <span className="hidden shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:block">
        {meta}
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <span
          title={connection === 'live' ? 'Live' : 'Reconnecting…'}
          className={cn(
            'size-1.5 rounded-full ring-2',
            connection === 'live'
              ? 'bg-emerald-500 ring-emerald-500/20'
              : 'animate-pulse bg-amber-500 ring-amber-500/20',
          )}
          role="status"
          aria-label={connection === 'live' ? 'Connected' : 'Reconnecting'}
        />

        {needsAudioUnlock && (
          <Button size="xs" variant="outline" onClick={onAudioUnlock}>
            Enable audio
          </Button>
        )}

        <Popover>
          <PopoverTrigger
            aria-label="Volume controls"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {volumes.muted ? <VolumeXIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />}
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <div className="flex flex-col gap-4">
              {(['narration', 'music', 'sfx'] as const).map((layer) => (
                <div key={layer}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="capitalize">{layer}</span>
                    <span className="text-muted-foreground">{Math.round(volumes[layer] * 100)}%</span>
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
      </div>
    </header>
  )
}
