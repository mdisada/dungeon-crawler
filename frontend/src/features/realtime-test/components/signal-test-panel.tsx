import { useSignalTest } from '../hooks/use-signal-test'

export function SignalTestPanel() {
  const { status, lastDurationLabel, error, sendSignal } = useSignalTest()

  return (
    <div>
      <button onClick={sendSignal} disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send ping'}
      </button>
      {status === 'success' && lastDurationLabel !== null && (
        <p>Round trip: {lastDurationLabel}</p>
      )}
      {status === 'error' && <p>Error: {error}</p>}
    </div>
  )
}
