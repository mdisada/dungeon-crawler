import { useState } from 'react'
import { Label } from '@/components/ui/label'

const DEFAULT_VOLUMES = { narration: 100, music: 60, sfx: 80 }

export function AudioSection() {
  const [volumes, setVolumes] = useState(DEFAULT_VOLUMES)

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Audio</h2>
      <p className="text-sm text-muted-foreground">
        Nothing plays audio yet (F12) -- these defaults aren&apos;t persisted server-side until
        there&apos;s a consumer for them.
      </p>
      {(Object.keys(volumes) as Array<keyof typeof volumes>).map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <Label htmlFor={`volume-${key}`} className="capitalize">
            {key} volume
          </Label>
          <input
            id={`volume-${key}`}
            type="range"
            min={0}
            max={100}
            value={volumes[key]}
            onChange={(e) => setVolumes((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
          />
        </div>
      ))}
      <p className="text-sm text-muted-foreground">
        Autoplay is blocked by browsers until the first user gesture on this page -- the audio
        chunk player (F12) handles the unlock gesture when it lands.
      </p>
    </section>
  )
}
