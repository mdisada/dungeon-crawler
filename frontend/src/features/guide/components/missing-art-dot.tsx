/**
 * Count of entries on a tab that still have no art. Amber rather than red: nothing is broken, there
 * is just work left before the table can open (art-readiness.ts decides what actually blocks).
 */
export function MissingArtDot({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[0.65rem] font-medium text-amber-700 dark:text-amber-400"
      title={`${count} still ${count === 1 ? 'needs' : 'need'} art`}
    >
      {count}
    </span>
  )
}
