import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { LoginForm } from './login-form'
import { SignupForm } from './signup-form'

type Mode = 'login' | 'signup'

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      {mode === 'login' ? <LoginForm /> : <SignupForm />}
      <Button
        variant="link"
        size="sm"
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
      >
        {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
      </Button>
    </div>
  )
}
