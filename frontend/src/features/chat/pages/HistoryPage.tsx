import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, isToday, parseISO } from 'date-fns'
import { ChevronDown, Download, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'
import { Page, PageToolbar, SplitPanel } from '@/components/layout/Page'
import { Badge, Button, Checkbox, ConfirmDialog, DataTable, DatePicker, IconButton, Input, MultiSelect, Pagination, Popover, SearchInput, SegmentedControl, Select, Spinner, toast, type ColumnDef, type RowSelectionState } from '@/components/ui'
import { ChatConversation } from '@/components/domain/ChatConversation'
import { VisitorDetails } from '@/components/domain/VisitorDetails'
import { useDebounce } from '@/hooks/useDebounce'
import { apiError, getAccessToken } from '@/services/api'
import { useAuth } from '@/stores/auth'
import type { Chat } from '@/types'
import { chatApi, chatKeys, type HistoryFilters } from '../services/chatApi'

const EMPTY: HistoryFilters = { scope: 'all' }

function FilterPopover({ value, onApply }: { value: HistoryFilters; onApply: (f: HistoryFilters) => void }) {
  const [f, setF] = useState<HistoryFilters>(value)
  const tags = useQuery({ queryKey: ['chat-tags'], queryFn: chatApi.tags })
  const toggle = (key: 'served' | 'rating', v: string) => setF((p) => ({ ...p, [key]: (p[key] ?? []).includes(v) ? p[key]!.filter((x) => x !== v) : [...(p[key] ?? []), v] }))
  return (
    <Popover
      className="w-[340px] p-4"
      trigger={(p) => (
        <IconButton {...p} label="Filter chats" icon={<ChevronDown size={12} />} size="sm" />
      )}
    >
      {(close) => (
        <form
          className="space-y-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            onApply({ ...f, page: 1 })
            close()
          }}
        >
          <div className="grid grid-cols-[90px_1fr] items-center gap-2">
            <span>Search</span>
            <SegmentedControl label="Search scope" size="sm" value={f.scope ?? 'all'} onChange={(v) => setF({ ...f, scope: v })} items={[{ value: 'all', label: 'All' }, { value: 'chat', label: 'Chat' }, { value: 'offline', label: 'Offline msg' }]} />
            <span />
            <Checkbox label="Unread" checked={!!f.unread} onChange={(e) => setF({ ...f, unread: e.target.checked || undefined })} />
            <span>Keywords</span>
            <Input value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value || undefined })} />
            <span>Date range</span>
            <div className="flex gap-1">
              <DatePicker aria-label="From" value={f.date_from ?? ''} onChange={(v) => setF({ ...f, date_from: v || undefined })} />
              <DatePicker aria-label="To" value={f.date_to ?? ''} onChange={(v) => setF({ ...f, date_to: v || undefined })} />
            </div>
          </div>
          <h4 className="border-t border-border pt-2 text-xs font-bold text-fg-secondary">CHATS</h4>
          <div className="grid grid-cols-[90px_1fr] items-center gap-2">
            <span>At least</span>
            <span className="flex items-center gap-2"><Input type="number" min={0} className="w-16" value={f.min_messages ?? 0} onChange={(e) => setF({ ...f, min_messages: Number(e.target.value) || undefined })} /> messages</span>
            <span>Chats served</span>
            <div className="grid grid-cols-2 gap-1">
              {['completed', 'dropped', 'missed', 'unresponsive'].map((s) => <Checkbox key={s} label={s[0]!.toUpperCase() + s.slice(1)} checked={(f.served ?? []).includes(s)} onChange={() => toggle('served', s)} />)}
            </div>
            <span>Satisfaction</span>
            <div className="flex gap-3">
              {['good', 'bad'].map((s) => <Checkbox key={s} label={s === 'good' ? 'Good' : 'Bad'} checked={(f.rating ?? []).includes(s)} onChange={() => toggle('rating', s)} />)}
            </div>
            <span>Tags</span>
            <MultiSelect label="Tags" options={(tags.data ?? []).map((t) => ({ value: t, label: t }))} value={f.tags ?? []} onChange={(t) => setF({ ...f, tags: t })} placeholder="Contains any of these tags" />
            <span>Others</span>
            <Checkbox label="Triggered" checked={!!f.triggered} onChange={(e) => setF({ ...f, triggered: e.target.checked || undefined })} />
          </div>
          <h4 className="border-t border-border pt-2 text-xs font-bold text-fg-secondary">PROFILE</h4>
          <div className="grid grid-cols-[90px_1fr] items-center gap-2">
            <span>Chat initiated by</span>
            <Select value={f.initiated_by ?? ''} onChange={(e) => setF({ ...f, initiated_by: e.target.value || undefined })} options={[{ value: '', label: 'Anyone' }, { value: 'visitor', label: 'Visitor' }, { value: 'agent', label: 'Agent' }, { value: 'trigger', label: 'Trigger' }]} />
            <span>Visitor name</span>
            <Input value={f.visitor_name ?? ''} onChange={(e) => setF({ ...f, visitor_name: e.target.value || undefined })} />
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="primary" type="submit">Search</Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </Popover>
  )
}

function TranscriptPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'transcript' | 'info'>('transcript')
  const { data: chat, isLoading, refetch } = useQuery({ queryKey: chatKeys.detail(chatId), queryFn: () => chatApi.get(chatId) })
  const tags = useQuery({ queryKey: ['chat-tags'], queryFn: chatApi.tags })
  const [editTags, setEditTags] = useState(false)
  const download = async () => {
    const r = await fetch(chatApi.transcriptUrl(chatId), { headers: { Authorization: `Bearer ${getAccessToken()}` } })
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `chat-${chatId.slice(0, 8)}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <SegmentedControl label="Transcript view" size="sm" value={tab} onChange={setTab} items={[{ value: 'transcript', label: 'Transcript' }, { value: 'info', label: 'User info' }]} />
        <span className="flex-1" />
        <IconButton label="Download transcript" icon={<Download size={12} />} size="sm" onClick={download} />
        <IconButton label="Close" icon={<X size={12} />} size="sm" onClick={onClose} />
      </div>
      {isLoading || !chat ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : tab === 'info' ? (
        <div className="flex-1 overflow-y-auto"><VisitorDetails visitorId={chat.visitor_id} /></div>
      ) : (
        <>
          <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 border-b border-border px-4 py-3 text-sm">
            <dt className="text-fg-secondary">Rating</dt>
            <dd>{chat.rating ? (chat.rating === 'good' ? '👍 Good' : '👎 Bad') : '—'}</dd>
            <dt className="text-fg-secondary">Comment</dt>
            <dd>{chat.rating_comment || '—'}</dd>
            <dt className="text-fg-secondary">Tags</dt>
            <dd>
              {editTags ? (
                <MultiSelect label="Tags" creatable options={(tags.data ?? []).map((t) => ({ value: t, label: t }))} value={chat.tags} onChange={async (t) => { try { await chatApi.patch(chat.id, { tags: t }); refetch() } catch (e) { toast.error(apiError(e).message) } }} />
              ) : (
                <button type="button" onClick={() => setEditTags(true)} className="text-left hover:text-primary">{chat.tags.length ? chat.tags.join(', ') : 'Add tags'}</button>
              )}
            </dd>
          </dl>
          <ChatConversation messages={chat.messages} />
        </>
      )}
    </div>
  )
}

export function HistoryPage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('chat')
  const can = useAuth((s) => s.can)
  const qc = useQueryClient()
  const [filters, setFilters] = useState<HistoryFilters>({ ...EMPTY, page: 1 })
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<RowSelectionState>({})
  const [confirmDel, setConfirmDel] = useState(false)
  const dq = useDebounce(q)
  const f = { ...filters, q: dq || filters.q }
  const { data, isLoading } = useQuery({ queryKey: chatKeys.history(f), queryFn: () => chatApi.history(f), placeholderData: keepPreviousData })
  const ids = Object.keys(sel).filter((k) => sel[k])
  const active = Object.values(filters).some((v, i) => Object.keys(filters)[i] !== 'page' && Object.keys(filters)[i] !== 'scope' && v !== undefined && (!Array.isArray(v) || v.length))

  const open = (c: Chat) => {
    setParams({ chat: c.id })
    if (c.unread) void chatApi.markRead([c.id]).then(() => qc.invalidateQueries({ queryKey: ['chats', 'history'] }))
  }
  const del = async () => {
    try {
      await chatApi.bulkDelete(ids)
      setSel({})
      setConfirmDel(false)
      qc.invalidateQueries({ queryKey: ['chats', 'history'] })
      toast.success(`${ids.length} chat(s) deleted`)
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }

  const columns: ColumnDef<Chat>[] = [
    { header: 'Name', size: 140, cell: ({ row: { original: c } }) => <span className={c.unread ? 'font-bold' : ''}>{c.visitor_name}{c.kind === 'offline' && <Badge tone="warning" className="ml-1">Offline</Badge>}</span> },
    { header: 'Agent', size: 130, cell: ({ row }) => row.original.agent_name ?? '-' },
    { header: 'Time', size: 120, cell: ({ row }) => { const d = parseISO(row.original.started_at); return isToday(d) ? format(d, 'h:mm a') : format(d, 'MMM d h:mm a') } },
    { header: 'Rating', size: 60, cell: ({ row }) => (row.original.rating === 'good' ? <ThumbsUp size={12} className="text-success" aria-label="Good" /> : row.original.rating === 'bad' ? <ThumbsDown size={12} className="text-danger" aria-label="Bad" /> : '-') },
    ...(selected ? [] : [{ header: 'Messages', cell: ({ row }: { row: { original: Chat } }) => <span className="inline-flex items-center gap-2"><Badge>{row.original.message_count}</Badge><span className="truncate text-fg-secondary">{row.original.preview}</span></span> } as ColumnDef<Chat>]),
  ]

  return (
    <Page title="History" padded={false}>
      <div className="flex h-full flex-col">
        <PageToolbar
          className="px-[30px] pt-3"
          left={
            <>
              <span className="inline-flex items-center gap-1">
                <FilterPopover value={filters} onApply={setFilters} />
                <SearchInput value={q} onChange={setQ} />
              </span>
              <Button size="sm" onClick={() => { setFilters({ ...EMPTY, page: 1 }); setQ('') }} disabled={!active && !q}>Clear search</Button>
              {ids.length > 0 && can('chats.delete') && <Button size="sm" variant="danger" leftIcon={<Trash2 size={12} />} onClick={() => setConfirmDel(true)}>Delete {ids.length}</Button>}
            </>
          }
          right={
            <>
              <span>{data?.unread_count ?? 0} unread</span>
              <Pagination page={data?.page ?? 1} pageCount={data?.page_count ?? 1} onPageChange={(p) => setFilters({ ...filters, page: p })} />
            </>
          }
        />
        <div className="min-h-0 flex-1 px-[30px]">
          <SplitPanel
            detailOpen={!!selected}
            list={<DataTable data={data?.items ?? []} columns={columns} getRowId={(c) => c.id} loading={isLoading} selectable rowSelection={sel} onRowSelectionChange={setSel} onRowClick={open} activeRowId={selected} empty="No chats match these filters" />}
            detail={selected && <TranscriptPanel key={selected} chatId={selected} onClose={() => setParams({})} />}
          />
        </div>
      </div>
      <ConfirmDialog open={confirmDel} title={`Delete ${ids.length} chat(s)?`} message="Deleted transcripts are removed from History and reports." confirmLabel="Delete" danger onConfirm={del} onCancel={() => setConfirmDel(false)} />
    </Page>
  )
}
