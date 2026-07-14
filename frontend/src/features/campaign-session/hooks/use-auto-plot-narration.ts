import { useEffect, useRef } from 'react'
import { timeJob } from '@/lib/job-timer'
import { narratePlot } from '../api/narrate-plot'

/** First-open experience: when a campaign is opened with no turns published yet, ask the backend
 * to read the plot premise aloud. The audio arrives as kind "plot" chunks on campaign-live, so
 * useLiveNarrationAudio plays it through the page's existing audio element. `enabled` should only
 * become true once the turn feed has actually loaded empty — the ref guards against re-triggering
 * when the first real turn (or a re-render) flips it back and forth.
 */
export function useAutoPlotNarration(campaignId: number, enabled: boolean) {
  const hasStartedRef = useRef(false)

  useEffect(() => {
    if (!enabled || hasStartedRef.current) return
    hasStartedRef.current = true
    timeJob('narrate-plot', (jobId) => narratePlot(jobId, campaignId)).catch((err) => {
      console.error('Plot narration failed to start:', err)
    })
  }, [enabled, campaignId])
}
