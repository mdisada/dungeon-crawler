import type { FxEvent } from '@rules/state'

/** Transient overlays: floating damage/heal numbers and mode banners (F06 SS3.1). */
export function FxLayer({ fx }: { fx: FxEvent[] }) {
  if (fx.length === 0) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {fx.map((event, i) =>
        event.kind === 'banner' ? (
          <div
            key={`${event.kind}-${i}`}
            className="fx-banner absolute inset-x-0 top-1/3 text-center text-4xl font-bold tracking-widest text-white drop-shadow-lg"
          >
            {event.text}
          </div>
        ) : (
          <div
            key={`${event.kind}-${i}`}
            className={`fx-float absolute left-1/2 top-1/2 text-2xl font-bold drop-shadow ${
              event.kind === 'damage' ? 'text-red-400' : 'text-emerald-400'
            }`}
            style={{ marginLeft: (i - fx.length / 2) * 28 }}
          >
            {event.kind === 'damage' ? '-' : '+'}
            {event.value}
          </div>
        ),
      )}
    </div>
  )
}
