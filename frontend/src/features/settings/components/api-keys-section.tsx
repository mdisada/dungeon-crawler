interface Props {
  byokLocalStorage: boolean
  onChange: (value: boolean) => void
}

export function ApiKeysSection({ byokLocalStorage, onChange }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">API keys</h2>
      <p className="text-sm text-muted-foreground">
        Your own server-stored OpenRouter key isn't wired up to a UI action yet (F01 SS3.3/SS4.4)
        -- the platform key is used for every call in the meantime.
      </p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={byokLocalStorage}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1"
        />
        <span className="text-sm">
          Advanced: I understand a key stored in this browser&apos;s localStorage is exposed to
          browser scripts. (No localStorage key path is implemented yet -- this only records the
          acknowledgement.)
        </span>
      </label>
    </section>
  )
}
