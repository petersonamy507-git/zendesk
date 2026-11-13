import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronsUp, ChevronsDown, MessageSquarePlus } from 'lucide-react'
import { Page, PageToolbar } from '@/components/layout/Page'
import { Avatar, Badge, Button, DataTable, IconButton, Modal, SearchInput, SegmentedControl, Select, Textarea, toast, type ColumnDef } from '@/components/ui'
import { useDebounce } from '@/hooks/useDebounce'
import { useInvalidateOn } from '@/hooks/useRealtime'
import { apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { fmtDuration } from '@/components/domain/ReportChart'
import type { LiveVisitor } from '@/types'
import { groupBy as groupItems } from '@/utils/collections'
import { StatusGlyph, VisitorLegend } from '../utils/visitorStatus'
import { chatApi, chatKeys } from '../services/chatApi'

const GROUPS = [
  ['activity', 'Activity'],
  ['page_title', 'Page title'],
  ['page_url', 'Page URL'],
  ['country', 'Country'],
  ['serving_agent', 'Serving agent'],
  ['department', 'Department'],
  ['browser', 'Browser'],
  ['search_engine', 'Search engine'],
  ['search_term', 'Search term'],
] as const

export function VisitorsPage() {
  const navigate = useNavigate()
  const can = useAuth((s) => s.can)
  const [mode, setMode] = useState<'list' | 'visual'>('list')
  const [groupBy, setGroupBy] = useState<string>('activity')
  const [q, setQ] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [startFor, setStartFor] = useState<LiveVisitor | null>(null)
  const [message, setMessage] = useState('')
  const dq = useDebounce(q)
  const query = useQuery({ queryKey: chatKeys.visitors(groupBy, dq), queryFn: () => chatApi.visitors(groupBy, dq), refetchInterval: 15000 })
  useInvalidateOn(['visitor.arrived', 'visitor.updated', 'visitor.left', 'chat.incoming', 'chat.accepted', 'chat.ended'], [['visitors']])
  const rows = query.data?.items ?? []

  const simulate = async () => {
    try {
      await chatApi.simulate()
      query.refetch()
      toast.success('Test visitor added — open it to start a chat')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const start = async () => {
    if (!startFor) return
    try {
      const c = await chatApi.startChat(startFor.id, message)
      setStartFor(null)
      setMessage('')
      navigate(`/chats/${c.id}`)
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }

  const columns: ColumnDef<LiveVisitor>[] = [
    { header: 'Name', cell: ({ row: { original: v } }) => <span className="inline-flex items-center gap-2"><StatusGlyph status={v.status ?? 'active'} size={16} /><Avatar name={v.name} size={20} />{v.name}{v.simulated && <Badge tone="primary">Test</Badge>}{v.triggered && <Badge tone="warning">Triggered</Badge>}</span> },
    { header: 'Online', size: 90, cell: ({ row }) => fmtDuration(row.original.online_seconds) },
    { header: 'Viewing', cell: ({ row }) => <span title={row.original.current_url ?? ''}>{row.original.current_title || row.original.current_url || '—'}</span> },
    { header: 'Pages', size: 60, cell: ({ row }) => row.original.page_count },
    { header: 'Visits', size: 60, cell: ({ row }) => row.original.visits },
    { header: 'Chats', size: 60, cell: ({ row }) => row.original.chats },
    { header: 'Location', cell: ({ row }) => [row.original.city, row.original.country_name ?? row.original.country_code].filter(Boolean).join(', ') || '—' },
    { header: 'Note', cell: ({ row }) => row.original.note ?? '' },
  ]

  return (
    <Page title="Visitors">
      <PageToolbar
        left={<SegmentedControl label="View mode" size="sm" value={mode} onChange={setMode} items={[{ value: 'list', label: 'List' }, { value: 'visual', label: 'Visual' }]} />}
        right={<span>Total: {query.data?.total ?? 0}</span>}
        className="border-b border-border"
      />
      <PageToolbar
        className="pt-3"
        left={
          <>
            <IconButton label={collapsed ? 'Expand all groups' : 'Collapse all groups'} icon={collapsed ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />} onClick={() => setCollapsed(!collapsed)} size="sm" />
            <Select aria-label="Group by" className="w-[180px]" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} options={GROUPS.map(([v, l]) => ({ value: v, label: `Group by ${l}` }))} />
          </>
        }
        right={<SearchInput value={q} onChange={setQ} />}
      />
      {rows.length === 0 && !query.isLoading ? (
        <div className="flex items-center justify-center gap-3 py-6 text-md text-fg-secondary">
          No active visitors
          <Button size="sm" onClick={simulate}>Simulate visitor</Button>
        </div>
      ) : mode === 'visual' ? (
        <div className="flex gap-4 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap content-start gap-3" aria-label="Visitors map">
            {Object.entries(groupItems(rows, (r) => r.group ?? '')).map(([g, vs]) => (
              <section key={g} className="min-w-[220px] rounded-md border border-border p-3">
                <h3 className="mb-2 text-sm font-bold">{g} <Badge>{vs.length}</Badge></h3>
                <div className="flex flex-wrap gap-2">
                  {vs.map((v) => (
                    <button key={v.id} type="button" title={`${v.name} — ${v.current_title ?? ''} (${v.status})`} onClick={() => (v.chat_id ? navigate(`/chats/${v.chat_id}`) : can('chats.serve') && setStartFor(v))} className="relative rounded-full ring-offset-2 hover:ring-2 hover:ring-primary">
                      <Avatar name={v.name} size={36} />
                      <span className="absolute -bottom-1 -right-1"><StatusGlyph status={v.status ?? 'active'} size={16} /></span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <VisitorLegend />
        </div>
      ) : (
        <DataTable
          data={collapsed ? [] : rows}
          columns={columns}
          getRowId={(r) => r.id}
          loading={query.isLoading}
          groupBy={(r) => r.group ?? ''}
          onRowClick={(v) => (v.chat_id ? navigate(`/chats/${v.chat_id}`) : can('chats.serve') ? setStartFor(v) : undefined)}
          empty={collapsed ? `${rows.length} visitors (groups collapsed)` : undefined}
        />
      )}
      <Modal
        open={!!startFor}
        onClose={() => setStartFor(null)}
        title={`Start chat with ${startFor?.name ?? ''}`}
        footer={<><Button onClick={() => setStartFor(null)}>Cancel</Button><Button variant="primary" disabled={!message.trim()} onClick={start} leftIcon={<MessageSquarePlus size={12} />}>Send</Button></>}
      >
        <p className="mb-2 text-fg-secondary">Viewing: {startFor?.current_title || startFor?.current_url}</p>
        <Textarea aria-label="First message" autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi! Can I help you find anything?" />
      </Modal>
    </Page>
  )
}
