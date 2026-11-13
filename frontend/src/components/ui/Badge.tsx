import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-fg',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-[#8a5d00]',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm px-1.5 text-xs font-bold', tones[tone], className)}>{children}</span>
}

export type PresenceStatus = 'online' | 'away' | 'invisible' | 'offline'

const dot: Record<PresenceStatus, string> = {
  online: 'bg-online',
  away: 'bg-away',
  invisible: 'bg-invisible',
  offline: 'bg-offline',
}

export const presenceLabel: Record<PresenceStatus, string> = { online: 'Online', away: 'Away', invisible: 'Invisible', offline: 'Offline' }

/** Presence dot with optional label. Also used for generic statuses via `tone`. */
export function StatusBadge({ status, showLabel = false, className }: { status: PresenceStatus; showLabel?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', dot[status])} />
      {showLabel ? <span>{presenceLabel[status]}</span> : <span className="sr-only">{presenceLabel[status]}</span>}
    </span>
  )
}

export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs font-bold text-fg">
      {children}
      {onRemove && (
        <button type="button" aria-label={`Remove ${String(children)}`} onClick={onRemove} className="text-fg-secondary hover:text-danger">
          ×
        </button>
      )}
    </span>
  )
}
