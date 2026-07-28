import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'theme'

export type Theme = 'light' | 'dark'

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Storage is read through a guard because `localStorage` is not always the browser's. Node 26
// defines a global `localStorage` that is a getter returning undefined unless started with
// --localstorage-file, and it shadows the one jsdom installs - so every test touching the theme
// died on `undefined.getItem` under a Node 26 toolchain while passing on CI's Node 22. Safari's
// private mode is the same shape for real users: the property exists and using it throws.
//
// A theme is a preference. Losing it is not worth taking the page down for.
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function getStoredTheme(): Theme | null {
  const stored = storage()?.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : null
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function initTheme() {
  applyTheme(getStoredTheme() ?? getSystemTheme())
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme())

  useEffect(() => {
    applyTheme(theme)
    storage()?.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggleTheme }
}
