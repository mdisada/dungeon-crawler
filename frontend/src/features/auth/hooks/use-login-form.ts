import { useState, type FormEvent } from 'react'
import { signInWithPassword } from '../api/sign-in'

type Status = 'idle' | 'submitting' | 'error'

export function useLoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('submitting')
    setError(null)
    try {
      await signInWithPassword(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('error')
    }
  }

  return { email, setEmail, password, setPassword, status, error, submit }
}
