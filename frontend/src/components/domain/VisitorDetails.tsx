import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Ban, Globe } from 'lucide-react'
import { Avatar, Button, ConfirmDialog, Input, Skeleton, Tag, Textarea, toast } from '@/components/ui'
import { chatApi, chatKeys } from '@/features/chat/services/chatApi'
import { apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="py-1.5">
      <div className="text-xs text-fg-secondary">{label}</div>
      <div className="break-words text-sm text-fg">{value}</div>
    </div>
  )
}

/** Visitor profile panel — shared by the live chat panel and History › User info. */
export function VisitorDetails({ visitorId, onBanned }: { visitorId: string; onBanned?: () => void }) {
  const qc = useQueryClient()
  const can = useAuth((s) => s.can)
  const { data: v, isLoading } = useQuery({ queryKey: chatKeys.visitor(visitorId), queryFn: () => chatApi.visitor(visitorId) })
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [confirmBan, setConfirmBan] = useState(false)
  useEffect(() => {
    if (v) setForm({ name: v.name ?? '', email: v.email ?? '', phone: v.phone ?? '', notes: v.notes ?? '' })
  }, [v])

  if (isLoading || !v) return <div className="space-y-2 p-4"><Skeleton height={40} /><Skeleton height={80} /></div>

  const save = async (field: keyof typeof form) => {
    const value = form[field].trim()
    if ((v[field] ?? '') === value) return
    try {
      await chatApi.updateVisitor(v.id, { [field]: value || null })
      qc.invalidateQueries({ queryKey: chatKeys.visitor(v.id) })
      toast.success('Visitor updated')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const ban = async () => {
    try {
      await chatApi.ban(v.id, 'Banned from visitor profile')
      toast.success('Visitor banned')
      setConfirmBan(false)
      qc.invalidateQueries({ queryKey: chatKeys.visitor(v.id) })
      onBanned?.()
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const inline = (field: keyof typeof form, placeholder: string, type = 'text') => (
    <Input aria-label={placeholder} type={type} placeholder={placeholder} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} onBlur={() => save(field)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="border-transparent hover:border-border" />
  )

  return (
    <div className="space-y-3 overflow-y-auto p-4">
      <div className="flex items-start gap-3">
        <Avatar name={v.name} size={44} shape="square" />
        <div className="min-w-0 flex-1 space-y-1">
          {inline('name', 'Add name')}
          {inline('email', 'Add email', 'email')}
        </div>
        {can('visitors.ban') && !v.banned && (
          <Button variant="danger" size="sm" leftIcon={<Ban size={12} />} onClick={() => setConfirmBan(true)}>
            Ban visitor
          </Button>
        )}
      </div>
      {v.banned && <p className="rounded-sm bg-danger-soft px-2 py-1 text-sm text-danger">This visitor is banned</p>}
      {inline('phone', 'Add phone number', 'tel')}
      <Textarea aria-label="Visitor notes" placeholder="Add visitor notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} onBlur={() => save('notes')} />
      {v.tags.length > 0 && <div className="flex flex-wrap gap-1">{v.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-sm border border-border p-2"><div className="text-lg font-bold">{v.visits}</div><div className="text-xs text-fg-secondary">Past visits</div></div>
        <div className="rounded-sm border border-border p-2"><div className="text-lg font-bold">{Math.max(0, v.past_chats.length)}</div><div className="text-xs text-fg-secondary">Past chats</div></div>
      </div>
      {v.path.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-fg-secondary">Visitor path</div>
          <ol className="space-y-1">
            {v.referrer && <li className="flex items-center gap-1.5 text-sm"><Globe size={12} className="text-fg-secondary" /> {new URL(v.referrer).hostname}</li>}
            {v.path.map((p, i) => (
              <li key={i} className="flex items-center gap-1.5 text-sm" title={p.url}>
                <span className="h-2 w-2 shrink-0 rounded-full border border-fg-secondary" />
                <span className="truncate">{p.title || p.url}</span>
                <span className="ml-auto shrink-0 text-xs text-fg-secondary">{format(parseISO(p.at), 'HH:mm')}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="border-t border-border pt-2">
        <Row label="Location" value={[v.city, v.region, v.country_name ?? v.country_code].filter(Boolean).join(', ') || null} />
        <Row label="Browser" value={v.browser} />
        <Row label="Platform" value={v.platform} />
        <Row label="Device" value={v.device} />
        <Row label="IP address" value={v.ip} />
        <Row label="Search" value={v.search_engine ? `${v.search_engine}${v.search_terms ? `: “${v.search_terms}”` : ''}` : null} />
        <Row label="User agent" value={v.user_agent} />
      </div>
      <ConfirmDialog open={confirmBan} title="Ban visitor?" message="The visitor (and their IP address) will no longer be able to load the chat widget. Open chats will end." confirmLabel="Ban visitor" danger onConfirm={ban} onCancel={() => setConfirmBan(false)} />
    </div>
  )
}
