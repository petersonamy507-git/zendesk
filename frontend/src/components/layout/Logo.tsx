/** Original Parley mark: two overlapping speech bubbles. */
export function Logo({ size = 22, withText = false }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <path d="M4 6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-5 4v-4H8a4 4 0 0 1-4-4z" fill="#5fc4b8" />
        <path d="M12 14a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-1v4l-5-4h-2a4 4 0 0 1-4-4z" fill="#f5b544" opacity=".95" />
      </svg>
      {withText && <span className="text-lg font-bold tracking-tight">Parley</span>}
    </span>
  )
}
