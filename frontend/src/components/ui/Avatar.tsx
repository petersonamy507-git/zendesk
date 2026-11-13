import { cn } from '@/utils/cn'
import { StatusBadge, type PresenceStatus } from './Badge'

const palette = ['#4f7a7e', '#1d6fb0', '#8a5cb8', '#c26a2b', '#2fa36b', '#b8455b', '#5a6b7b']

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?'
}

function colorFor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return palette[h % palette.length]
}

export interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  status?: PresenceStatus
  shape?: 'circle' | 'square'
  className?: string
}

export function Avatar({ name, src, size = 28, status, shape = 'circle', className }: AvatarProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt={name} className={cn('h-full w-full object-cover', shape === 'circle' ? 'rounded-full' : 'rounded-sm')} />
      ) : (
        <span
          aria-label={name}
          role="img"
          className={cn('flex h-full w-full items-center justify-center font-bold text-white', shape === 'circle' ? 'rounded-full' : 'rounded-sm')}
          style={{ background: colorFor(name), fontSize: Math.max(9, size * 0.38) }}
        >
          {initials(name)}
        </span>
      )}
      {status && <StatusBadge status={status} className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface" />}
    </span>
  )
}

export function AvatarGroup({ people, max = 4, size = 24 }: { people: { name: string; src?: string | null }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span className="inline-flex -space-x-1.5">
      {shown.map((p) => (
        <Avatar key={p.name} name={p.name} src={p.src} size={size} className="ring-2 ring-surface rounded-full" />
      ))}
      {rest > 0 && (
        <span className="flex items-center justify-center rounded-full bg-surface-muted text-xs font-bold ring-2 ring-surface" style={{ width: size, height: size }}>
          +{rest}
        </span>
      )}
    </span>
  )
}
