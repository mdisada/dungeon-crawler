import type { OfferBannerView } from '@rules/state'

/**
 * F08 SS2.1: open quest offers pin top-center so what the game is waiting on is never
 * ambiguous. Players answer in the fiction (say/do) - the banner is a reminder, not a form.
 */
export function OfferBanner({ offers }: { offers: OfferBannerView[] }) {
  if (offers.length === 0) return null
  return (
    <div className="absolute left-1/2 top-14 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {offers.map((offer) => (
        <div key={offer.id} className="max-w-md rounded-lg bg-black/70 px-4 py-1.5 text-center">
          <p className="text-sm font-semibold text-amber-200">
            Offer: {offer.label} ({offer.giverName}
            {offer.gold > 0 ? `, ${offer.gold} gp` : ''})
          </p>
          {offer.stakes && <p className="text-xs text-white/70">{offer.stakes}</p>}
        </div>
      ))}
    </div>
  )
}
