import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { OfferBannerView } from '@rules/state'

interface OfferStep {
  offer: OfferBannerView
  kind: 'terms' | 'stakes'
}

/** An offer's lines, in the order the player reads them. Stakes only exist when authored. */
function buildSteps(offers: OfferBannerView[]): OfferStep[] {
  return offers.flatMap((offer) => {
    const terms: OfferStep = { offer, kind: 'terms' }
    return offer.stakes ? [terms, { offer, kind: 'stakes' }] : [terms]
  })
}

/**
 * F08 SS2.1: open quest offers pin top-center so what the game is waiting on is never
 * ambiguous. Players answer in the fiction (say/do) - the banner is a reminder, not a form.
 *
 * Paced like the scene text (F06 SS3.2): the terms land with the offer and every further line
 * waits for Next, so an offer arriving mid-scene is never a block of text dropped over it. A
 * second offer's lines queue behind the first for the same reason.
 */
export function OfferBanner({ offers }: { offers: OfferBannerView[] }) {
  const steps = useMemo(() => buildSteps(offers), [offers])
  const [shown, setShown] = useState(1)

  // Clamp when an offer resolves, and start the next one fresh once the banner empties -
  // render-time adjustment (react.dev "adjusting state"), not an effect. Growth is deliberately
  // not handled here: a new offer's lines stay behind Next until the player asks for them.
  const capped = steps.length === 0 ? 1 : Math.min(shown, steps.length)
  if (capped !== shown) setShown(capped)

  if (steps.length === 0) return null
  const visible = steps.slice(0, capped)

  return (
    <div className="absolute left-1/2 top-14 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {offers.map((offer) => {
        const lines = visible.filter((step) => step.offer.id === offer.id)
        if (lines.length === 0) return null
        return (
          <div key={offer.id} className="max-w-md rounded-lg bg-black/70 px-4 py-1.5 text-center">
            <p className="text-sm font-semibold text-amber-200">
              Offer: {offer.label} ({offer.giverName}
              {offer.gold > 0 ? `, ${offer.gold} gp` : ''})
            </p>
            {lines.some((step) => step.kind === 'stakes') && (
              <p className="text-xs text-white/70">{offer.stakes}</p>
            )}
          </div>
        )
      })}
      {capped < steps.length && (
        <button
          type="button"
          onClick={() => setShown((count) => count + 1)}
          aria-label="Show the next line of the offer"
          className="text-white/70 drop-shadow transition-colors hover:text-white"
        >
          <ChevronRight className="size-7" />
        </button>
      )}
    </div>
  )
}
