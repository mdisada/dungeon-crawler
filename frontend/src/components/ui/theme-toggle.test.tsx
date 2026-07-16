import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ThemeToggle } from '@/components/ui/theme-toggle'

describe('ThemeToggle', () => {
  it('toggles the accessible label when clicked', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    const button = screen.getByRole('button')
    const initialLabel = button.getAttribute('aria-label')

    await user.click(button)

    expect(button.getAttribute('aria-label')).not.toBe(initialLabel)
  })
})
