import { cn } from '@/utils/cn'

export function Spinner({ size = 16, className, label = 'Loading' }: { size?: number; className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className)}
      style={{ width: size, height: size }}
    />
  )
}

export function Skeleton({ className, width, height = 12 }: { className?: string; width?: number | string; height?: number | string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded-sm bg-surface-muted', className)} style={{ width, height }} />
}

export function ProgressBar({ value, max = 100, className }: { value: number; max?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div role="progressbar" aria-valuenow={value} aria-valuemax={max} className={cn('h-1.5 w-full rounded-full bg-surface-muted', className)}>
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}
