import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Button, Modal } from '@/components/ui'
import { api } from '@/services/api'
import { realtime, type RealtimeStats } from '@/services/realtime'

function fmtUptime(ms: number | null) {
  if (ms == null) return '—'
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`
}

/** "Check connection" diagnostics — every value comes from the live realtime client or the server health endpoint. */
export function ConnectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stats, setStats] = useState<RealtimeStats>({ ...realtime.stats })
  const [server, setServer] = useState<{ status: string; realtime: string; time: number; rtt: number } | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    const refresh = async () => {
      const t0 = performance.now()
      const h = await api.get<{ status: string; realtime: string }>('/health').catch(() => null)
      if (!alive) return
      if (h) {
        setServer({ ...h, time: Date.now(), rtt: Math.round(performance.now() - t0) })
      } else setServer(null)
      await realtime.ping()
      if (alive) setStats({ ...realtime.stats })
    }
    void refresh()
    const t = setInterval(() => alive && setStats({ ...realtime.stats }), 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [open])

  const uptime = stats.connectedAt ? Date.now() - stats.connectedAt : null
  const left: [string, string][] = [
    ['Server', server ? `${location.host} (HTTP ${server.rtt} ms)` : 'Unreachable'],
    ['Connection type', 'WebSocket'],
    ['Connection status', stats.status === 'open' ? 'Connected' : stats.status === 'connecting' ? 'Connecting…' : 'Disconnected'],
    ['Realtime backend', server?.realtime ?? '—'],
    ['Uptime', fmtUptime(uptime)],
    ['Connect attempts', String(stats.connectAttempts)],
    ['Connected count', String(stats.connectedCount)],
    ['D/C count', String(stats.disconnects)],
    ['Local time', format(new Date(), 'yyyy-MM-dd HH:mm:ss')],
    ['Server time', server ? format(new Date(server.time), 'yyyy-MM-dd HH:mm:ss') : '—'],
  ]
  const right: [string, string][] = [
    ['Sent / received messages', `${stats.sentMessages} / ${stats.receivedMessages}`],
    ['Sent / received bytes', `${stats.sentBytes} / ${stats.receivedBytes}`],
    ['Lost frames', String(stats.lostFrames)],
    ['Duplicate frames dropped', String(stats.duplicateFrames)],
    ['Latency (RTT)', stats.latencyMs == null ? '—' : `${stats.latencyMs} ms`],
    ['Last pong', stats.lastPongAt ? format(new Date(stats.lastPongAt), 'HH:mm:ss') : '—'],
    ['Subscribed topics', 'account + user (+ open chats)'],
  ]
  return (
    <Modal open={open} onClose={onClose} title="Connection" size="lg" footer={<Button onClick={onClose}>Dismiss</Button>}>
      <div className="grid grid-cols-2 gap-x-8 pb-2">
        {[left, right].map((col, i) => (
          <dl key={i} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
            {col.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-bold">{k}</dt>
                <dd className="text-right text-fg-secondary">{v}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </Modal>
  )
}
