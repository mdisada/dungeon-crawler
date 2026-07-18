import { Progress as ProgressPrimitive } from '@base-ui/react/progress'

import { cn } from '@/lib/utils'

const Progress = ProgressPrimitive.Root

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn('block h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    />
  )
}

function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn('block h-full bg-primary transition-all duration-300 ease-out', className)}
      {...props}
    />
  )
}

export { Progress, ProgressIndicator, ProgressTrack }
