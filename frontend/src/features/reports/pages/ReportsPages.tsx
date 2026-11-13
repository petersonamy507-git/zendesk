import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { AlertCircle, Download, MessageSquare, Save, Timer } from 'lucide-react'
import { Page, PageToolbar } from '@/components/layout/Page'
import { Button, DataTable, DatePicker, Dropdown, ErrorState, Select, Skeleton, StatusBadge, Tabs, toast, type ColumnDef } from '@/components/ui'
import { CHART_COLORS, ChatVolumeChart, ReportChart, StatTile, fmtDuration } from '@/components/domain/ReportChart'
import { api, apiError, getAccessToken } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { useInvalidateOn } from '@/hooks/useRealtime'
import type { Agent, Department } from '@/types'

interface ChatReport {
  total: number
  served: number
  missed: number
  dropped: number
  avg_wait_s: number | null
  median_first_response_s: number | null
  avg_duration_s: number | null
  satisfaction_pct: number | null
  rated: number
  good: number
  bad: number
  daily: { date: string; chats: number; missed: number; served: number; avg_wait_s: number | null }[]
  agents: { agent_id: string; name: string; chats: number; satisfaction_pct: number | null; avg_duration_s: number | null; median_first_response_s: number | null }[]
}

interface TicketReport {
  total: number
  by_status: Record<string, number>
  by_channel: Record<string, number>
  by_priority: Record<string, number>
  median_first_response_min: number | null
  median_resolution_h: number | null
  sla_compliance_pct: number | null
}

export function AnalyticsPage() {
  const can = useAuth((s) => s.can)
  const qc = useQueryClient()
  const [tab, setTab] = useState<'chats' | 'tickets'>('chats')
  const [preset, setPreset] = useState('30')
  const [bucket, setBucket] = useState<'day' | 'week'>('day')
  const [kpi, setKpi] = useState<'wait' | 'first' | 'duration'>('wait')
  const [f, setF] = useState({ date_from: format(subDays(new Date(), 29), 'yyyy-MM-dd'), date_to: format(new Date(), 'yyyy-MM-dd'), agent_id: '', department_id: '', channel: '' })
  const agents = useQuery({ queryKey: ['agents', 'all'], queryFn: () => api.get<{ items: Agent[] }>('/agents', { per_page: 200 }), enabled: can('reports.view_all') })
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') })
  const saved = useQuery({ queryKey: ['reports', 'saved'], queryFn: () => api.get<{ id: string; name: string; metric: string; filters: typeof f }[]>('/reports/saved') })
  const params = { date_from: f.date_from, date_to: f.date_to, agent_id: f.agent_id || undefined, department_id: f.department_id || undefined }
  const chats = useQuery({ queryKey: ['reports', 'chats', params], queryFn: () => api.get<ChatReport>('/reports/chats', params), enabled: tab === 'chats' })
  const tickets = useQuery({ queryKey: ['reports', 'tickets', f], queryFn: () => api.get<TicketReport>('/reports/tickets', { date_from: f.date_from, date_to: f.date_to, agent_id: f.agent_id || undefined, group_id: f.department_id || undefined, channel: f.channel || undefined }), enabled: tab === 'tickets' })

  const applyPreset = (v: string) => {
    setPreset(v)
    if (v !== 'custom') setF({ ...f, date_from: format(subDays(new Date(), Number(v) - 1), 'yyyy-MM-dd'), date_to: format(new Date(), 'yyyy-MM-dd') })
  }
  const volume = useMemo(() => {
    const days = chats.data?.daily ?? []
    if (bucket === 'day') return days.map((d) => ({ date: d.date, served: d.served, missed: d.missed, avg_wait_s: d.avg_wait_s }))
    const weeks = new Map<string, { served: number; missed: number; waits: number[] }>()
    for (const d of days) {
      const dt = new Date(d.date)
      const key = format(new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000), 'yyyy-MM-dd')
      const w = weeks.get(key) ?? { served: 0, missed: 0, waits: [] }
      w.served += d.served
      w.missed += d.missed
      if (d.avg_wait_s != null) w.waits.push(d.avg_wait_s)
      weeks.set(key, w)
    }
    return [...weeks].map(([date, w]) => ({ date, served: w.served, missed: w.missed, avg_wait_s: w.waits.length ? Math.round(w.waits.reduce((a, b) => a + b, 0) / w.waits.length) : null }))
  }, [chats.data, bucket])
  const kpiValue = chats.data ? (kpi === 'wait' ? chats.data.avg_wait_s : kpi === 'first' ? chats.data.median_first_response_s : chats.data.avg_duration_s) : null

  const exportCsv = async () => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
    const r = await fetch(`/api/v1/reports/chats.csv?${qs}`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
    if (!r.ok) return toast.error('Export failed')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await r.blob())
    a.download = `chat-report-${f.date_from}-${f.date_to}.csv`
    a.click()
  }
  const saveReport = async () => {
    const name = window.prompt('Name this report')
    if (!name) return
    try {
      await api.post('/reports/saved', { name, metric: tab, filters: f })
      qc.invalidateQueries({ queryKey: ['reports', 'saved'] })
      toast.success('Report saved')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const agentCols: ColumnDef<ChatReport['agents'][number]>[] = [
    { header: 'Agent', accessorKey: 'name' },
    { header: 'Chats', accessorKey: 'chats' },
    { header: 'Satisfaction', cell: ({ row }) => (row.original.satisfaction_pct == null ? '—' : `${row.original.satisfaction_pct}%`) },
    { header: 'Avg duration', cell: ({ row }) => fmtDuration(row.original.avg_duration_s) },
    { header: 'Median first response', cell: ({ row }) => fmtDuration(row.original.median_first_response_s) },
  ]
  return (
    <Page title="Analytics">
      <Tabs label="Report type" value={tab} onChange={setTab} items={[{ value: 'chats', label: 'Chats' }, { value: 'tickets', label: 'Tickets' }]} />
      <PageToolbar
        className="pt-4"
        left={
          <>
            <DatePicker aria-label="From" value={f.date_from} onChange={(v) => { setPreset('custom'); setF({ ...f, date_from: v }) }} />
            <span>–</span>
            <DatePicker aria-label="To" value={f.date_to} onChange={(v) => { setPreset('custom'); setF({ ...f, date_to: v }) }} />
            {can('reports.view_all') && <Select aria-label="Agent" className="w-[160px]" value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })} options={[{ value: '', label: 'All agents' }, ...(agents.data?.items ?? []).map((a) => ({ value: a.id, label: a.display_name || a.name }))]} />}
            <Select aria-label="Department" className="w-[160px]" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })} options={[{ value: '', label: 'All departments' }, ...(depts.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
            {tab === 'tickets' && <Select aria-label="Channel" className="w-[140px]" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} options={[{ value: '', label: 'All channels' }, ...['web', 'email', 'chat', 'portal', 'api'].map((c) => ({ value: c, label: c }))]} />}
          </>
        }
        right={
          <>
            {(saved.data?.length ?? 0) > 0 && <Dropdown align="end" items={saved.data!.map((s) => ({ id: s.id, label: s.name, onSelect: () => { setTab(s.metric as 'chats'); setF(s.filters) } }))} trigger={(p) => <Button {...p} size="sm">Saved reports ▾</Button>} />}
            <Button size="sm" leftIcon={<Save size={12} />} onClick={saveReport}>Save</Button>
            {tab === 'chats' && <Button size="sm" leftIcon={<Download size={12} />} onClick={exportCsv}>Export CSV</Button>}
          </>
        }
      />
      {tab === 'chats' ? (
        chats.error ? <ErrorState error={apiError(chats.error).message} /> : !chats.data ? <Skeleton height={300} /> : (
          <div className="space-y-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[32px] font-bold leading-none text-fg-strong">{chats.data.total.toLocaleString()}</div>
                <div className="text-sm text-fg-secondary">Total Chats</div>
              </div>
              <div className="flex gap-2">
                <Select aria-label="Date range" className="w-[130px]" value={preset} onChange={(e) => applyPreset(e.target.value)} options={[{ value: '7', label: 'Last 7 days' }, { value: '14', label: 'Last 14 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: 'custom', label: 'Custom' }]} />
                <Select aria-label="Group by" className="w-[100px]" value={bucket} onChange={(e) => setBucket(e.target.value as 'day' | 'week')} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }]} />
              </div>
            </div>
            <ChatVolumeChart data={volume} xFormat={(d) => format(new Date(d), 'd MMM')} />
            <div className="grid grid-cols-3 divide-x divide-border rounded-md border border-border py-4 text-center">
              <div className="flex items-center justify-center gap-3"><span className="rounded-sm p-2" style={{ background: 'var(--visitor-served)' }}><MessageSquare size={22} className="text-white" aria-hidden /></span><span className="text-left"><span className="block text-xl font-bold" style={{ color: 'var(--visitor-assigned)' }}>{chats.data.served.toLocaleString()}</span><span className="text-sm text-fg-secondary">Chats Served</span></span></div>
              <div className="flex items-center justify-center gap-3"><span className="rounded-sm bg-warning p-2"><AlertCircle size={22} className="text-white" aria-hidden /></span><span className="text-left"><span className="block text-xl font-bold text-warning">{chats.data.missed.toLocaleString()}</span><span className="text-sm text-fg-secondary">Chats Missed</span></span></div>
              <div className="flex items-center justify-center gap-3"><span className="rounded-sm bg-sidebar p-2"><Timer size={22} className="text-white" aria-hidden /></span><span className="text-left"><span className="block text-xl font-bold text-sidebar">{fmtDuration(kpiValue)}</span>
                <select aria-label="Metric" className="rounded-sm border border-border bg-surface px-1 text-xs" value={kpi} onChange={(e) => setKpi(e.target.value as typeof kpi)}><option value="wait">Wait Time (Served)</option><option value="first">First response (median)</option><option value="duration">Chat duration (avg)</option></select></span></div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              <StatTile label="Satisfaction" value={chats.data.satisfaction_pct == null ? null : `${chats.data.satisfaction_pct}%`} hint={`${chats.data.rated} rated`} />
              <StatTile label="Good ratings" value={chats.data.good} />
              <StatTile label="Bad ratings" value={chats.data.bad} />
            </div>
            <h2 className="text-lg text-fg-strong">Agent performance</h2>
            <DataTable data={chats.data.agents} columns={agentCols} getRowId={(r) => r.agent_id} empty="No chats served in this period" />
          </div>
        )
      ) : tickets.error ? <ErrorState error={apiError(tickets.error).message} /> : !tickets.data ? <Skeleton height={300} /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            <StatTile label="Tickets created" value={tickets.data.total} />
            {['open', 'pending', 'hold', 'solved', 'closed'].map((s) => <StatTile key={s} label={s[0]!.toUpperCase() + s.slice(1)} value={tickets.data.by_status[s] ?? 0} />)}
            <StatTile label="Median first reply" value={tickets.data.median_first_response_min == null ? null : `${tickets.data.median_first_response_min} min`} />
            <StatTile label="Median resolution" value={tickets.data.median_resolution_h == null ? null : `${tickets.data.median_resolution_h} h`} />
            <StatTile label="SLA compliance" value={tickets.data.sla_compliance_pct == null ? null : `${tickets.data.sla_compliance_pct}%`} />
          </div>
          <ReportChart type="bar" data={Object.entries(tickets.data.by_channel).map(([k, v]) => ({ channel: k, tickets: v }))} x="channel" series={[{ key: 'tickets', label: 'Tickets by channel', color: CHART_COLORS[1]! }]} />
        </div>
      )}
    </Page>
  )
}

interface Realtime {
  visitors_online: number
  agents: Record<string, number>
  incoming: number
  active: number
  longest_wait_s: number
  today: { total: number; served: number; missed: number; avg_wait_s: number | null; satisfaction_pct: number | null; avg_duration_s: number | null; good: number; bad: number }
}

export function MonitorPage() {
  const q = useQuery({ queryKey: ['reports', 'realtime'], queryFn: () => api.get<Realtime>('/reports/realtime'), refetchInterval: 10000 })
  useInvalidateOn(['chat.incoming', 'chat.accepted', 'chat.ended', 'presence.updated', 'visitor.arrived', 'visitor.left'], [['reports', 'realtime']])
  const d = q.data
  return (
    <Page title="Monitor">
      <h2 className="mb-1 text-lg text-fg-strong">Real-time monitoring</h2>
      <p className="mb-4 text-sm text-fg-secondary">Live metrics on chat volume, visitor experience and agent availability. Updates in real time.</p>
      {!d ? <Skeleton height={200} /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            <StatTile label="Visitors on site" value={d.visitors_online} />
            <StatTile label="Chats waiting" value={d.incoming} />
            <StatTile label="Chats in progress" value={d.active} />
            <StatTile label="Longest wait" value={fmtDuration(d.longest_wait_s)} />
            <div className="rounded-md border border-border bg-surface px-4 py-3">
              <div className="text-xs text-fg-secondary">Agents</div>
              <ul className="mt-1 space-y-0.5 text-sm">
                <li className="flex items-center gap-2"><StatusBadge status="online" /> <b>{d.agents.online ?? 0}</b> online</li>
                <li className="flex items-center gap-2"><StatusBadge status="away" /> <b>{d.agents.away ?? 0}</b> away</li>
                <li className="flex items-center gap-2"><StatusBadge status="invisible" /> <b>{d.agents.invisible ?? 0}</b> invisible</li>
              </ul>
            </div>
          </div>
          <h3 className="text-md font-bold">Today</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            <StatTile label="Chats" value={d.today.total} />
            <StatTile label="Served" value={d.today.served} />
            <StatTile label="Missed" value={d.today.missed} />
            <StatTile label="Avg wait" value={fmtDuration(d.today.avg_wait_s)} />
            <StatTile label="Satisfaction" value={d.today.satisfaction_pct == null ? null : `${d.today.satisfaction_pct}%`} hint={`👍 ${d.today.good} · 👎 ${d.today.bad}`} />
            <StatTile label="Avg duration" value={fmtDuration(d.today.avg_duration_s)} />
          </div>
        </div>
      )}
    </Page>
  )
}
