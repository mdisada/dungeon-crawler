import { useEffect } from 'react'
import { subscribeToBroadcast } from '@/lib/realtime-channel'
import { CAMPAIGN_LIVE_TOPIC } from '../constants'
import type { NarrationAudioChunkEvent, NarrationGenerationStartedEvent } from '../types'
import { useAudioChunkPlayer } from './use-audio-chunk-player'

/** Plays narration audio live as it's generated: a transition-narration preview first (filling
 * the wait while the DM works), then the real narration sentences, autoplaying as soon as the
 * first chunk arrives. See backend/campaign/session_handlers.py's make_handle_generate_turn. */
export function useLiveNarrationAudio(campaignId: number) {
  const { audioRef, enqueue, reset } = useAudioChunkPlayer()

  useEffect(() => {
    const unsubscribeStarted = subscribeToBroadcast<NarrationGenerationStartedEvent>(
      CAMPAIGN_LIVE_TOPIC,
      'narration-generation-started',
      (event) => {
        if (event.campaignId === campaignId) reset()
      },
    )

    const unsubscribeChunk = subscribeToBroadcast<NarrationAudioChunkEvent>(
      CAMPAIGN_LIVE_TOPIC,
      'narration-audio-chunk',
      (event) => {
        if (event.campaignId !== campaignId) return
        enqueue({ url: event.audioUrl, isNewParagraph: event.isNewParagraph })
      },
    )

    return () => {
      unsubscribeStarted()
      unsubscribeChunk()
      reset()
    }
  }, [campaignId, enqueue, reset])

  return { audioRef }
}
