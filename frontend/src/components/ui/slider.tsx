import { Slider as SliderPrimitive } from '@base-ui/react/slider'

import { cn } from '@/lib/utils'

const Slider = SliderPrimitive.Root

const SliderValue = SliderPrimitive.Value

function SliderControl({ className, ...props }: SliderPrimitive.Control.Props) {
  return (
    <SliderPrimitive.Control
      data-slot="slider-control"
      className={cn('flex w-full touch-none items-center py-2 select-none', className)}
      {...props}
    />
  )
}

function SliderTrack({ className, ...props }: SliderPrimitive.Track.Props) {
  return (
    <SliderPrimitive.Track
      data-slot="slider-track"
      className={cn('h-1.5 w-full rounded-full bg-muted select-none', className)}
      {...props}
    />
  )
}

function SliderIndicator({ className, ...props }: SliderPrimitive.Indicator.Props) {
  return (
    <SliderPrimitive.Indicator
      data-slot="slider-indicator"
      className={cn('rounded-full bg-primary select-none', className)}
      {...props}
    />
  )
}

function SliderThumb({ className, ...props }: SliderPrimitive.Thumb.Props) {
  return (
    <SliderPrimitive.Thumb
      data-slot="slider-thumb"
      className={cn(
        'size-4 rounded-full border border-primary bg-background shadow-sm outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack, SliderValue }
