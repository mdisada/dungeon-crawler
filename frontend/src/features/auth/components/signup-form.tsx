import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSignupForm } from '../hooks/use-signup-form'

export function SignupForm() {
  const { email, setEmail, password, setPassword, status, error, submit } = useSignupForm()

  if (status === 'success') {
    return <p className="text-sm">Check your email to confirm your account.</p>
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {status === 'error' && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Signing up…' : 'Sign up'}
      </Button>
    </form>
  )
}
