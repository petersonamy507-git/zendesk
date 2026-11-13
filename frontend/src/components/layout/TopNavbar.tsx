import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Avatar, Dropdown, Modal } from '@/components/ui'
import { ConnectionDialog } from '@/components/domain/ConnectionDialog'
import { realtime } from '@/services/realtime'
import { useAuth } from '@/stores/auth'
import { useConnectionStatus } from '@/hooks/useConnectionStatus'

/** Downloads a JSON diagnostics file (no tokens or secrets) that support can use to debug problems. */
function downloadDebugReport(userId: string) {
  const report = {
    generatedAt: new Date().toISOString(),
    userId,
    url: location.pathname,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    viewport: `${innerWidth}x${innerHeight}`,
    realtime: realtime.stats,
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  a.download = `debug-report-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export const KEYBOARD_SHORTCUTS: [string, string][] = [
  ['Alt + 1…9', 'Switch between open chats'],
  ['Alt + A', 'Accept the oldest incoming chat'],
  ['Alt + E', 'End the current chat'],
  ['/', 'Insert a shortcut while typing'],
  ['Enter', 'Send message'],
  ['Shift + Enter', 'New line'],
  ['Esc', 'Close dialogs and menus'],
]

export function UserMenu() {
  const me = useAuth((s) => s.me)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()
  const [kbd, setKbd] = useState(false)
  const [conn, setConn] = useState(false)
  if (!me) return null
  const name = me.user.display_name || me.user.name
  return (
    <>
      <Dropdown
        align="end"
        className="w-[220px]"
        header={
          <button type="button" onClick={() => navigate('/settings/personal')} className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-surface-hover">
            <Avatar name={name} src={me.user.avatar_url} size={32} />
            <span>
              <span className="block text-md font-bold">{name}</span>
              <span className="text-xs text-fg-secondary">View profile</span>
            </span>
          </button>
        }
        items={[
          { id: 'help', label: 'Help center', onSelect: () => window.open('/help', '_blank') },
          { id: 'kbd', label: 'Keyboard shortcuts', onSelect: () => setKbd(true) },
          { id: 'conn', label: 'Check connection', onSelect: () => setConn(true) },
          { id: 'debug', label: 'Download debug report', onSelect: () => downloadDebugReport(me.user.id) },
          { id: 'privacy', label: 'Privacy policy', onSelect: () => navigate('/privacy') },
          { id: 'd', label: '', divider: true },
          { id: 'logout', label: 'Leave session', onSelect: () => logout().then(() => navigate('/login')) },
        ]}
        trigger={(p) => (
          <button {...p} type="button" aria-label="Account menu" className="rounded-full">
            <Avatar name={name} src={me.user.avatar_url} size={28} />
          </button>
        )}
      />
      <ConnectionDialog open={conn} onClose={() => setConn(false)} />
      <Modal open={kbd} onClose={() => setKbd(false)} title="Keyboard shortcuts" size="sm">
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 pb-2">
          {KEYBOARD_SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded-sm border border-border bg-surface-subtle px-1.5 py-0.5 text-xs font-bold">{k}</kbd>
              </dt>
              <dd className="text-fg-secondary">{d}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  )
}

export function TopNavbar({ title, back, actions }: { title: ReactNode; back?: string; actions?: ReactNode }) {
  const navigate = useNavigate()
  const conn = useConnectionStatus()
  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center gap-3 border-b border-border bg-surface px-[30px]">
      {back && (
        <button type="button" aria-label="Back" onClick={() => navigate(back)} className="-ml-2 rounded p-1 text-fg-secondary hover:text-fg">
          <ChevronLeft size={16} />
        </button>
      )}
      <h1 className="flex-1 truncate text-sm text-fg">{title}</h1>
      {conn !== 'open' && (
        <span role="status" className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-[#8a5d00]">
          {conn === 'connecting' ? 'Reconnecting…' : 'Offline — retrying'}
        </span>
      )}
      {actions}
      <UserMenu />
    </header>
  )
}
