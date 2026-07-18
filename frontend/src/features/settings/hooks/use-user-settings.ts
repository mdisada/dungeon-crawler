import { useCallback, useEffect, useState } from 'react'

import { errorMessage } from '@/lib/error-message'
import { getUserSettings } from '../api/get-user-settings'
import { updateUserSettings, type UpdateUserSettingsInput } from '../api/update-user-settings'
import type { UserSettings } from '../types'

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; settings: UserSettings }

export function useUserSettings(userId: string) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    getUserSettings(userId)
      .then((settings) => {
        if (!cancelled) setState({ status: 'ready', settings })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: errorMessage(error) })
      })

    return () => {
      cancelled = true
    }
  }, [userId])

  const update = useCallback(
    async (input: UpdateUserSettingsInput) => {
      await updateUserSettings(userId, input)
      setState((prev) => (prev.status === 'ready' ? { status: 'ready', settings: { ...prev.settings, ...input } } : prev))
    },
    [userId],
  )

  return { state, update }
}
