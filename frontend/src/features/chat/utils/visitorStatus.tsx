import { AlertCircle, Clock, Eye, MessageSquare, MousePointerClick, UserCheck, Zap } from 'lucide-react'
import type { ReactNode } from 'react'

export type VisitorStatus = 'incoming' | 'assigned' | 'clicked' | 'served' | 'triggered' | 'active' | 'idle'

export const VISITOR_STATUSES: { value: VisitorStatus; label: string; icon: ReactNode }[] = [
  { value: 'incoming', label: 'Incoming', icon: <AlertCircle size={12} /> },
  { value: 'assigned', label: 'Assigned', icon: <UserCheck size={12} /> },
  { value: 'clicked', label: 'Clicked', icon: <MousePointerClick size={12} /> },
  { value: 'served', label: 'Served', icon: <MessageSquare size={12} /> },
  { value: 'triggered', label: 'Triggered', icon: <Zap size={12} /> },
  { value: 'active', label: 'Active', icon: <Eye size={12} /> },
  { value: 'idle', label: 'Idle', icon: <Clock size={12} /> },
]

/** Square status glyph used by the legend and every visitor tile. */
export function StatusGlyph({ status, size = 18 }: { status: VisitorStatus; size?: number }) {
  const s = VISITOR_STATUSES.find((x) => x.value === status)!
  return (
    <span aria-hidden className="inline-flex items-center justify-center rounded-sm text-white" style={{ width: size, height: size, background: `var(--visitor-${status})` }}>
      {s.icon}
    </span>
  )
}

export function VisitorLegend() {
  return (
    <ul aria-label="Status legend" className="space-y-1.5 text-xs uppercase text-fg-secondary">
      {VISITOR_STATUSES.map((s) => (
        <li key={s.value} className="flex items-center gap-2">
          <StatusGlyph status={s.value} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}
