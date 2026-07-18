import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { LoginForm } from './login-form'
import { SignupForm } from './signup-form'

type Mode = 'login' | 'signup'

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Dungeon Crawler</h1>
        <p className="text-muted-foreground">AI-run campaigns, built for the table.</p>
      </div>

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <h2 className="mb-6 text-xl font-semibold">
          {mode === 'login' ? 'Log in' : 'Create an account'}
        </h2>
        {mode === 'login' ? <LoginForm /> : <SignupForm />}
      </div>

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
