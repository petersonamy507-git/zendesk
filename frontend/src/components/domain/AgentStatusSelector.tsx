import { ChevronDown } from 'lucide-react'
import { Dropdown, StatusBadge, presenceLabel, toast, type PresenceStatus } from '@/components/ui'
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'

const OPTIONS: Exclude<PresenceStatus, 'offline'>[] = ['online', 'away', 'invisible']

/** Sidebar presence pill (Online / Away / Invisible). Persists via API; broadcast over WS. */
export function AgentStatusSelector() {
  const me = useAuth((s) => s.me)
  const setMe = useAuth((s) => s.setMe)
  if (!me) return null
  const status = me.user.presence
  const change = async (next: (typeof OPTIONS)[number]) => {
    const prev = me
    setMe({ ...me, user: { ...me.user, presence: next } })
    try {
      await api.put('/users/me/presence', { status: next })
    } catch (e) {
      setMe(prev)
      toast.error(apiError(e).message)
    }
  }
  return (
    <Dropdown
      className="w-[160px]"
      items={OPTIONS.map((o) => ({ id: o, label: <StatusBadge status={o} showLabel />, onSelect: () => change(o) }))}
      trigger={(p) => (
        <button {...p} type="button" aria-label={`Status: ${presenceLabel[status]}. Change status`} className="flex h-[30px] w-[160px] items-center gap-2 rounded-full bg-sidebar-deep px-3 text-[13px] text-sidebar-fg hover:bg-black/20">
          <StatusBadge status={status} />
          <span className="flex-1 text-left">{presenceLabel[status]}</span>
          <ChevronDown size={14} className="opacity-70" />
        </button>
      )}
    />
  )
}
