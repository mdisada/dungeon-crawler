import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLoginForm } from '../hooks/use-login-form'

export function LoginForm() {
  const { email, setEmail, password, setPassword, status, error, submit } = useLoginForm()

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {status === 'error' && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Logging in…' : 'Log in'}
      </Button>
    </form>
  )
}
