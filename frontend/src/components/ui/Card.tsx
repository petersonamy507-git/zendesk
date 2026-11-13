import type { ReactNode } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from './Button'

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn('rounded-md border border-border bg-surface', padded && 'p-4', className)}>{children}</div>
}

export function EmptyState({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon && <div className="text-fg-secondary">{icon}</div>}
      <p className="text-md text-fg-secondary">{title}</p>
      {description && <p className="max-w-md text-sm text-fg-secondary">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong'
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-10 text-center">
      <AlertTriangle className="text-danger" size={20} />
      <p className="text-md text-fg">{msg}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  )
}

/** Inline banner — e.g. the "Restricted feature" notice on settings pages. */
export function Notice({ tone = 'warning', title, children }: { tone?: 'warning' | 'info' | 'danger'; title?: ReactNode; children: ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2 rounded-sm px-3 py-2.5 text-sm', tone === 'warning' && 'bg-warning-soft', tone === 'info' && 'bg-primary-soft', tone === 'danger' && 'bg-danger-soft')}
    >
      <Info size={14} className="mt-0.5 shrink-0 text-fg-secondary" />
      <div>
        {title && <p className="mb-1 font-bold text-md">{title}</p>}
        <div className="text-fg">{children}</div>
      </div>
    </div>
  )
}
