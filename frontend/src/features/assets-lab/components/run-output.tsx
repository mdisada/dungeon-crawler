import { useAssetUrl } from '@/hooks/use-asset-url'
import type { Medium } from '../types'

function ImageOutput({ path }: { path: string }) {
  const url = useAssetUrl(path)
  if (!url) return <span className="text-xs text-muted-foreground">resolving...</span>
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Generated result" className="h-16 w-16 rounded border object-cover" />
    </a>
  )
}

function AudioOutput({ path }: { path: string }) {
  const url = useAssetUrl(path)
  if (!url) return <span className="text-xs text-muted-foreground">resolving...</span>
  return <audio controls src={url} className="h-8 w-56" />
}

/** Renders a run's stored output: the single image, or each ordered TTS chunk. */
export function RunOutput({ medium, paths }: { medium: Medium; paths: string[] }) {
  if (medium === 'image') {
    return <ImageOutput path={paths[0]} />
  }
  return (
    <div className="flex flex-col gap-1">
      {paths.map((path, index) => (
        <AudioOutput key={`${path}-${index}`} path={path} />
      ))}
    </div>
  )
}
