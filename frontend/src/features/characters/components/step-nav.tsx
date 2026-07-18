export function StepNav({
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  showBack = true,
}: {
  onBack: () => void
  onNext: () => void
  nextLabel?: string
  nextDisabled?: boolean
  showBack?: boolean
}) {
  return (
    <div className="mt-6 flex justify-between">
      {showBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {nextLabel}
      </button>
    </div>
  )
}
