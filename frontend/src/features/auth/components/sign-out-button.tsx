import { Button } from '@/components/ui/button'
import { signOut } from '../api/sign-out'

export function SignOutButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => signOut()}>
      Log out
    </Button>
  )
}
