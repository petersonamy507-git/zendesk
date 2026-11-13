import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { Check, Hand, MessageSquareText } from 'lucide-react'
import { FormFooter, Page, SectionTitle, SettingsLayout } from '@/components/layout/Page'
import { Button, Checkbox, Dropdown, FormField, Input, Modal, MultiSelect, Notice, Select, SegmentedControl, Skeleton, Switch, Tag, Textarea, toast, type ColumnDef } from '@/components/ui'
import { ActionBuilder, ConditionBuilder, type ActionSpec, type FieldSpec } from '@/components/domain/ConditionBuilder'
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { cn } from '@/utils/cn'
import type { Banned, Department, Shortcut, Trigger } from '@/types'
import { ResourceListPage } from '../components/ResourceListPage'
import { useSettingsSection } from '../hooks/useSettingsSection'

// ------------------------------------------------------------------ Routing
interface Routing {
  mode: 'broadcast' | 'assigned'
  chat_limit_enabled: boolean
  chat_limit_scope: 'account' | 'agent'
  max_chats: number
}

export function RoutingPage() {
  const s = useSettingsSection<Routing>('routing')
  const can = useAuth((x) => x.can)
  const [tab, setTab] = useState<'settings' | 'skills'>('settings')
  const ro = !can('settings.manage')
  return (
    <Page title="Routing">
      <SegmentedControl label="Routing sections" className="mb-4" value={tab} onChange={setTab} items={[{ value: 'settings', label: 'Settings' }, { value: 'skills', label: 'Skills' }]} />
      {tab === 'skills' ? (
        <SkillsTab />
      ) : !s.data ? (
        <Skeleton height={200} />
      ) : (
        <SettingsLayout tips={[{ title: 'Broadcast', body: 'Broadcasting chats gives agents more autonomy: every eligible online agent is notified and the first to accept serves the visitor. Set a chat limit to keep quality high.' }, { title: 'Assigned', body: 'Assigned chats keep workload even: each request is offered to the eligible agent with the fewest active chats. Chat limits stop agents from being overwhelmed.' }]}>
          <form onSubmit={(e) => { e.preventDefault(); void s.save() }}>
            {ro && <Notice tone="info">Only administrators can change routing.</Notice>}
            <SectionTitle description="Choose how agents will receive incoming chat requests.">Chat routing</SectionTitle>
            <div role="radiogroup" aria-label="Routing mode" className="flex gap-3 py-2">
              {(['broadcast', 'assigned'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={s.data!.mode === m} disabled={ro} onClick={() => s.set('mode', m)} className={cn('flex h-[74px] w-[86px] flex-col items-center justify-center gap-1 rounded-md border text-xs font-bold', s.data!.mode === m ? 'border-fg-secondary bg-surface-muted' : 'border-transparent hover:bg-surface-hover')}>
                  {m === 'broadcast' ? <Hand size={22} /> : <MessageSquareText size={22} />}
                  {m === 'broadcast' ? 'Broadcast' : 'Assigned'}
                </button>
              ))}
            </div>
            <p className="text-sm text-fg-secondary">{s.data.mode === 'broadcast' ? 'Agents are notified of all incoming chat requests and serve chats from a shared queue.' : 'Each chat request is offered to one available agent at a time based on their current load.'}</p>
            <SectionTitle description="Limit the number of chats that each agent is allowed to take at one time." action={<Switch appearance="onoff" label="Chat limit" disabled={ro} checked={s.data.chat_limit_enabled} onChange={(v) => s.set('chat_limit_enabled', v)} />}>Chat limit</SectionTitle>
            <FormField label="Apply to">
              <SegmentedControl label="Apply chat limit to" size="sm" value={s.data.chat_limit_scope} onChange={(v) => s.set('chat_limit_scope', v)} items={[{ value: 'account', label: 'Account', disabled: ro || !s.data.chat_limit_enabled }, { value: 'agent', label: 'Agent', disabled: ro || !s.data.chat_limit_enabled }]} />
            </FormField>
            <FormField label="Maximum chats" hint={s.data.chat_limit_scope === 'account' ? 'This chat limit will apply to all agents.' : 'Agents without their own limit (Settings › Agents) use this value.'}>
              <Input type="number" min={1} max={20} className="w-20" disabled={ro || !s.data.chat_limit_enabled} value={s.data.max_chats} onChange={(e) => s.set('max_chats', Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
            </FormField>
            {!ro && <FormFooter dirty={s.dirty} saving={s.saving} onRevert={s.revert} onReset={s.reset} />}
          </form>
        </SettingsLayout>
      )}
    </Page>
  )
}

function SkillsTab() {
  const me = useAuth((s) => s.me)!
  const reload = useAuth((s) => s.reloadMe)
  const [skills, setSkills] = useState<string[]>(me.user.skills)
  const save = async () => {
    try {
      await api.patch(`/agents/${me.user.id}`, { skills })
      await reload()
      toast.success('Skills saved')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  return (
    <SettingsLayout tips={[{ title: 'Skills-based routing', body: 'Tag agents with skills such as languages or products. Admins can set skills for any agent from Settings › Agents.' }]}>
      <SectionTitle description="Your skills are used to match you with chats that need them.">My skills</SectionTitle>
      <MultiSelect label="Skills" creatable options={skills.map((s) => ({ value: s, label: s }))} value={skills} onChange={setSkills} placeholder="Add skills (e.g. Spanish, Billing)" />
      <div className="mt-4"><Button variant="primary" onClick={save}>Save changes</Button></div>
    </SettingsLayout>
  )
}

// ------------------------------------------------------------------ Shortcuts
export function ShortcutsPage() {
  const navigate = useNavigate()
  const [avail, setAvail] = useState<string>('')
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') })
  const columns: ColumnDef<Shortcut>[] = [
    { header: 'Shortcut', size: 140, cell: ({ row }) => <span className="font-bold">{row.original.name}</span> },
    { header: 'Message', cell: ({ row: { original: s } }) => <div className="whitespace-pre-wrap py-1.5">{s.message}{s.options.length > 0 && <ul className="mt-1">{s.options.map((o) => <li key={o} className="flex items-center gap-1.5 text-fg-secondary"><span className="h-2.5 w-2.5 rounded-full border border-border-strong" />{o}</li>)}</ul>}</div> },
    { header: 'Available for', size: 140, cell: ({ row: { original: s } }) => (s.owner_id ? 'Only me' : s.department_id ? depts.data?.items.find((d) => d.id === s.department_id)?.name ?? 'Department' : 'All agents') },
    { header: 'Tags', size: 180, cell: ({ row }) => <span className="inline-flex flex-wrap gap-1">{row.original.tags.map((t) => <Tag key={t}>{t}</Tag>)}</span> },
  ]
  return (
    <ResourceListPage<Shortcut>
      title="Shortcuts"
      queryKey="shortcuts"
      endpoint="/shortcuts"
      params={{ availability: avail || undefined }}
      columns={columns}
      getRowId={(s) => s.id}
      addLabel="Add shortcut"
      onAdd={() => navigate('/settings/shortcuts/new')}
      onRowClick={(s) => navigate(`/settings/shortcuts/${s.id}`)}
      bulkDelete={{ endpoint: '/shortcuts/bulk-delete', noun: 'shortcut' }}
      summary={(d) => <span>{d?.total ?? 0} shortcuts</span>}
      toolbarExtra={<Dropdown align="end" items={[['', 'All shortcuts'], ['all', 'Available to all agents'], ['department', 'Department shortcuts'], ['personal', 'My shortcuts']].map(([v, l]) => ({ id: v!, label: l, onSelect: () => setAvail(v!) }))} trigger={(p) => <Button {...p} size="sm">Filter shortcuts ▾</Button>} />}
      empty="Shortcuts let you send canned responses by typing / in a chat."
    />
  )
}

export function ShortcutEditPage() {
  const { shortcutId } = useParams()
  const isNew = shortcutId === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const can = useAuth((s) => s.can)
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') })
  const tags = useQuery({ queryKey: ['chat-tags'], queryFn: () => api.get<string[]>('/chat-tags') })
  const list = useQuery({ queryKey: ['shortcuts', 'all'], queryFn: () => api.get<{ items: Shortcut[] }>('/shortcuts'), enabled: !isNew })
  const existing = list.data?.items.find((s) => s.id === shortcutId)
  const [f, setF] = useState({ name: '', message: '', options: [] as string[], tags: [] as string[], availability: can('shortcuts.manage') ? 'all' : 'personal', department_id: '' })
  const [opt, setOpt] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (existing) setF({ name: existing.name, message: existing.message, options: existing.options, tags: existing.tags, availability: existing.owner_id ? 'personal' : existing.department_id ? 'department' : 'all', department_id: existing.department_id ?? '' })
  }, [existing])
  const valid = /^[^\s/]+$/.test(f.name) && f.message.trim().length > 0 && (f.availability !== 'department' || !!f.department_id)
  const submit = async () => {
    setSaving(true)
    try {
      const body = { ...f, department_id: f.department_id || null }
      if (isNew) await api.post('/shortcuts', body)
      else await api.put(`/shortcuts/${shortcutId}`, body)
      qc.invalidateQueries({ queryKey: ['shortcuts'] })
      toast.success('Shortcut saved')
      navigate('/settings/shortcuts')
    } catch (e) {
      toast.error(apiError(e).message)
    } finally {
      setSaving(false)
    }
  }
  const insertPlaceholder = (ph: string) => setF((x) => ({ ...x, message: `${x.message}{{${ph}}}` }))
  return (
    <Page title={isNew ? 'Add shortcut' : 'Edit shortcut'} back="/settings/shortcuts">
      <SettingsLayout tips={[{ title: 'Create shortcuts', body: 'Set up a shortcut by entering a name (example: "hi") and the message (example: "Hello, how can I help you today?"). You can also add multiple choice options to let visitors reply from a list.' }, { title: 'Chat tags', body: 'Tags on a shortcut are added to the chat automatically when you use it.' }, { title: 'While chatting', body: 'Type a forward slash (/) followed by the shortcut name to insert it.' }]}>
        <form onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <FormField label="Shortcut" error={f.name && !/^[^\s/]+$/.test(f.name) ? 'No spaces or slashes' : undefined}><Input className="w-[220px]" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label="Available for">
            <div className="flex gap-2">
              <Select className="w-[160px]" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} options={[{ value: 'all', label: 'All agents', disabled: !can('shortcuts.manage') }, { value: 'department', label: 'A department', disabled: !can('shortcuts.manage') }, { value: 'personal', label: 'Only me' }]} />
              {f.availability === 'department' && <Select className="w-[160px]" value={f.department_id} placeholder="Choose department" onChange={(e) => setF({ ...f, department_id: e.target.value })} options={(depts.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))} />}
            </div>
          </FormField>
          <FormField label="Message">
            <div>
              <Textarea rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
              <div className="mt-1 flex justify-end">
                <Dropdown align="end" items={[['visitor.name', 'Visitor name'], ['agent.name', 'Agent name']].map(([v, l]) => ({ id: v!, label: l, onSelect: () => insertPlaceholder(v!) }))} trigger={(p) => <button {...p} type="button" className="text-xs font-bold text-fg">Insert placeholder</button>} />
              </div>
            </div>
          </FormField>
          <FormField label="Options" hint="Visitors can tap one of these to reply">
            <div>
              <div className="flex gap-2">
                <Input className="w-[220px]" value={opt} onChange={(e) => setOpt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (opt.trim()) { setF({ ...f, options: [...f.options, opt.trim()] }); setOpt('') } } }} />
                <Button size="sm" onClick={() => { if (opt.trim()) { setF({ ...f, options: [...f.options, opt.trim()] }); setOpt('') } }}>+</Button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">{f.options.map((o, i) => <Tag key={i} onRemove={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })}>{o}</Tag>)}</div>
            </div>
          </FormField>
          <FormField label="Tags" hint="Automatically add the above tags to a chat when you use this shortcut">
            <MultiSelect label="Tags" creatable options={(tags.data ?? []).map((t) => ({ value: t, label: t }))} value={f.tags} onChange={(t) => setF({ ...f, tags: t })} placeholder="Add chat tags" />
          </FormField>
          <div className="mt-6 flex gap-2 border-t border-border pt-4">
            <Button type="submit" variant="primary" disabled={!valid} loading={saving}>{isNew ? 'Create shortcut' : 'Save changes'}</Button>
            <Button onClick={() => navigate('/settings/shortcuts')}>Cancel</Button>
          </div>
        </form>
      </SettingsLayout>
    </Page>
  )
}

// ------------------------------------------------------------------ Banned
export function BannedPage() {
  const can = useAuth((s) => s.can)
  const [kind, setKind] = useState('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ip: '', reason: '' })
  const qc = useQueryClient()
  const add = async () => {
    try {
      await api.post('/banned', form)
      qc.invalidateQueries({ queryKey: ['banned'] })
      setOpen(false)
      setForm({ ip: '', reason: '' })
      toast.success('IP address banned')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const columns: ColumnDef<Banned>[] = [
    { header: 'Visitor/IP address', cell: ({ row }) => `${row.original.label}${row.original.ip && row.original.ip !== row.original.label ? ` (${row.original.ip})` : ''}` },
    { header: 'Reason', cell: ({ row }) => row.original.reason ?? '' },
    { header: 'Date created', size: 140, cell: ({ row }) => format(parseISO(row.original.created_at), 'dd/MM/yyyy') },
  ]
  return (
    <>
      <ResourceListPage<Banned>
        title="Banned visitors"
        queryKey="banned"
        endpoint="/banned"
        params={{ kind, per_page: 200 }}
        columns={columns}
        getRowId={(b) => b.id}
        addLabel="Add visitor"
        onAdd={() => setOpen(true)}
        canManage={can('visitors.ban')}
        bulkDelete={{ endpoint: '/banned/bulk-delete', noun: 'ban' }}
        summary={(d) => <span>{d?.total ?? 0} entries</span>}
        toolbarExtra={<Select aria-label="Filters" className="w-[120px]" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'all', label: 'Filters' }, { value: 'visitor', label: 'Visitors' }, { value: 'ip', label: 'IP addresses' }]} />}
        empty="No banned visitors. Ban visitors from their profile, or add an IP address."
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Ban an IP address" size="sm" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!/^[0-9a-fA-F:.]{3,}$/.test(form.ip)} onClick={add}>Ban</Button></>}>
        <FormField label="IP address" layout="stacked"><Input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value.trim() })} placeholder="203.0.113.7" /></FormField>
        <FormField label="Reason" layout="stacked"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></FormField>
      </Modal>
    </>
  )
}

// ------------------------------------------------------------------ Triggers
interface TriggerSchema {
  events: Record<string, string>
  fields: Record<string, string>
  actions: Record<string, string>
}

const NUMERIC = new Set(['hour_of_day', 'visitor_previous_chats', 'visitor_previous_visits', 'visitor_page_count', 'queue_size'])
const BOOL = new Set(['visitor_triggered', 'visitor_is_chatting', 'visitor_requesting_chat', 'visitor_served'])
const STATUS = new Set(['account_status', 'department_status', 'visitor_status'])

export function TriggersPage() {
  const navigate = useNavigate()
  const can = useAuth((s) => s.can)
  const columns: ColumnDef<Trigger>[] = [
    { header: 'Name', size: 280, accessorKey: 'name' },
    { header: 'Description', cell: ({ row }) => row.original.description ?? '' },
    { header: 'Enabled', size: 70, cell: ({ row }) => (row.original.enabled ? <Check size={14} className="text-primary" aria-label="Enabled" /> : '—') },
  ]
  return (
    <ResourceListPage<Trigger>
      title="Triggers"
      queryKey="triggers"
      endpoint="/triggers"
      columns={columns}
      getRowId={(t) => t.id}
      addLabel="Add trigger"
      onAdd={() => navigate('/settings/triggers/new')}
      onRowClick={(t) => navigate(`/settings/triggers/${t.id}`)}
      canManage={can('triggers.manage')}
      bulkDelete={{ endpoint: '/triggers/bulk-delete', noun: 'trigger' }}
      bulkActions={(ids, done) => (
        <>
          <Button size="sm" onClick={() => api.post('/triggers/bulk-enable', { ids, enabled: true }).then(done, (e) => toast.error(apiError(e).message))}>Enable</Button>
          <Button size="sm" onClick={() => api.post('/triggers/bulk-enable', { ids, enabled: false }).then(done, (e) => toast.error(apiError(e).message))}>Disable</Button>
        </>
      )}
      summary={(d) => <span>{d?.enabled_count ?? 0} enabled / {d?.total ?? 0} triggers</span>}
      empty="Automatically engage high-value customers by sending them a customized chat invite."
    />
  )
}

export function TriggerEditPage() {
  const { triggerId } = useParams()
  const isNew = triggerId === 'new'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useAuth((s) => s.me)!
  const schema = useQuery({ queryKey: ['triggers', 'schema'], queryFn: () => api.get<TriggerSchema>('/triggers/schema') })
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') })
  const list = useQuery({ queryKey: ['triggers', 'count'], queryFn: () => api.get<{ enabled_count: number }>('/triggers') })
  const existing = useQuery({ queryKey: ['trigger', triggerId], queryFn: () => api.get<Trigger>(`/triggers/${triggerId}`), enabled: !isNew })
  const [t, setT] = useState<Omit<Trigger, 'id'>>({ name: '', description: '', enabled: true, event: 'chat_requested', match: 'all', conditions: [], actions: [{ type: 'send_message', name: 'Live Support', value: '' }], fire_once_per_visitor: false })
  const [mode, setMode] = useState<'visual' | 'developer'>('visual')
  const [json, setJson] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (existing.data) setT(existing.data)
  }, [existing.data])

  const fields: FieldSpec[] = useMemo(
    () =>
      Object.entries(schema.data?.fields ?? {}).map(([value, label]) => {
        if (value === 'still_on_site' || value === 'still_on_page') return { value, label, type: 'none' as const, hint: 'Delay (in secs) before checking next condition. Max 3600 seconds' }
        if (NUMERIC.has(value)) return { value, label, type: 'number' as const }
        if (BOOL.has(value)) return { value, label, type: 'boolean' as const, hint: value === 'visitor_served' ? "'true' if visitor is currently served by agents" : undefined }
        if (STATUS.has(value)) return { value, label, type: 'select' as const, options: [{ value: 'online', label: 'Online' }, { value: 'away', label: 'Away' }, { value: 'offline', label: 'Offline' }] }
        if (value === 'day_of_week') return { value, label, type: 'select' as const, options: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) })) }
        if (value === 'visitor_tag') return { value, label, operators: ['contains', 'not_contains'] }
        if (value === 'sender_type') return { value, label, type: 'select' as const, options: [{ value: 'visitor', label: 'Visitor' }, { value: 'agent', label: 'Agent' }] }
        return { value, label, type: 'text' as const }
      }),
    [schema.data],
  )
  const actions: ActionSpec[] = useMemo(
    () =>
      Object.entries(schema.data?.actions ?? {}).map(([value, label]) => {
        if (value === 'send_message') return { value, label, type: 'message' as const }
        if (value === 'set_triggered') return { value, label, type: 'boolean' as const }
        if (value === 'wait') return { value, label, type: 'number' as const, hint: 'Seconds to wait before the next action (max 3600)' }
        if (value === 'block_visitor') return { value, label, type: 'boolean' as const }
        if (value === 'set_department') return { value, label, type: 'select' as const, options: (depts.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })) }
        if (value === 'add_tag' || value === 'remove_tag') return { value, label, type: 'text' as const, hint: 'Comma-separated tags' }
        return { value, label, type: value.endsWith('note') ? ('textarea' as const) : ('text' as const) }
      }),
    [schema.data, depts.data],
  )

  const switchMode = (m: 'visual' | 'developer') => {
    if (m === 'developer') setJson(JSON.stringify({ event: t.event, match: t.match, conditions: t.conditions, actions: t.actions }, null, 2))
    else {
      try {
        const parsed = JSON.parse(json)
        setT({ ...t, ...parsed })
      } catch {
        toast.error('Invalid JSON — fix it before switching back')
        return
      }
    }
    setMode(m)
  }
  const save = async () => {
    let body = t
    if (mode === 'developer') {
      try {
        body = { ...t, ...JSON.parse(json) }
      } catch {
        toast.error('Invalid JSON')
        return
      }
    }
    setSaving(true)
    try {
      if (isNew) await api.post('/triggers', body)
      else await api.put(`/triggers/${triggerId}`, body)
      qc.invalidateQueries({ queryKey: ['triggers'] })
      toast.success('Trigger saved')
      navigate('/settings/triggers')
    } catch (e) {
      toast.error(apiError(e).message)
    } finally {
      setSaving(false)
    }
  }
  if (!schema.data || (!isNew && existing.isLoading)) return <Page title="Edit trigger" back="/settings/triggers"><Skeleton height={300} /></Page>
  return (
    <Page title={isNew ? 'Add trigger' : 'Edit trigger'} back="/settings/triggers">
      <SettingsLayout tips={[{ title: 'Create triggers', body: 'Triggers let you create automated actions based on specific criteria. For example, you can create a trigger to assist visitors who get stuck on a particular page of your website.' }, { title: 'Example', body: "If a visitor is on your product page for more than 30 seconds, a trigger can automatically ask them, \"Would you like more information about the product?\"." }]}>
        <form onSubmit={(e) => { e.preventDefault(); void save() }} className="max-w-[560px]">
          <FormField label="Trigger status">
            <div>
              <Checkbox label="Enable trigger" checked={t.enabled} onChange={(e) => setT({ ...t, enabled: e.target.checked })} />
              <p className="mt-1 text-xs text-fg-secondary">{list.data?.enabled_count ?? 0} of {me.account.max_triggers} Triggers used.</p>
            </div>
          </FormField>
          <FormField label="Trigger name"><Input className="w-[220px]" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></FormField>
          <FormField label="Description"><Textarea rows={2} value={t.description ?? ''} onChange={(e) => setT({ ...t, description: e.target.value })} /></FormField>
          <FormField label="Fire only once per visitor"><Checkbox label="Each visitor will receive this message only once" checked={t.fire_once_per_visitor} onChange={(e) => setT({ ...t, fire_once_per_visitor: e.target.checked })} /></FormField>
          <SectionTitle action={<SegmentedControl label="Editor mode" size="sm" value={mode} onChange={switchMode} items={[{ value: 'visual', label: 'Visual' }, { value: 'developer', label: 'Developer' }]} />}>Customize trigger</SectionTitle>
          {mode === 'developer' ? (
            <Textarea aria-label="Trigger JSON" rows={18} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
          ) : (
            <>
              <FormField label="Run trigger"><Select value={t.event} onChange={(e) => setT({ ...t, event: e.target.value })} options={Object.entries(schema.data.events).map(([v, l]) => ({ value: v, label: l }))} /></FormField>
              <FormField label="Check conditions"><Select value={t.match} onChange={(e) => setT({ ...t, match: e.target.value as 'all' | 'any' })} options={[{ value: 'all', label: 'Check all of the following conditions' }, { value: 'any', label: 'Check any of the following conditions' }]} /></FormField>
              <ConditionBuilder conditions={t.conditions} onChange={(c) => setT({ ...t, conditions: c })} fields={fields} />
              <p className="mb-2 mt-4 text-sm">Perform the following actions</p>
              <ActionBuilder actions={t.actions} onChange={(a) => setT({ ...t, actions: a })} specs={actions} />
            </>
          )}
          <div className="mt-6 flex gap-2 border-t border-border pt-4">
            <Button type="submit" variant="primary" loading={saving} disabled={!t.name.trim()}>{isNew ? 'Create trigger' : 'Save changes'}</Button>
            <Button onClick={() => navigate('/settings/triggers')}>Cancel</Button>
          </div>
        </form>
      </SettingsLayout>
    </Page>
  )
}
