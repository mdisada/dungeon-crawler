import { useState, type FormEvent } from 'react'
import { signUpWithPassword } from '../api/sign-up'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function useSignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('submitting')
    setError(null)
    try {
      const { needsEmailConfirmation } = await signUpWithPassword(email, password)
      setStatus(needsEmailConfirmation ? 'success' : 'idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  return { email, setEmail, password, setPassword, status, error, submit }
}
