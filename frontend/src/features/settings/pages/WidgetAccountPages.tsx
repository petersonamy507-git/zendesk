import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FormFooter, Page, SectionTitle, SettingsLayout } from '@/components/layout/Page'
import { Button, Checkbox, FormField, Input, Notice, Select, SegmentedControl, RadioGroup, Skeleton, Switch, Tag, Textarea, TimePicker, toast } from '@/components/ui'
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { useSettingsSection } from '../hooks/useSettingsSection'

/** Sub-tab navigation shared by Widget / Personal / Account (URL-driven: /settings/<area>/<tab>). */
export function Tabbed({ area, title, tabs, children }: { area: string; title: string; tabs: [string, string][]; children: (tab: string) => ReactNode }) {
  const { tab = tabs[0]![0] } = useParams()
  const navigate = useNavigate()
  return (
    <Page title={title}>
      <SegmentedControl label={`${title} sections`} className="mb-5" value={tab} onChange={(v) => navigate(`/settings/${area}/${v}`)} items={tabs.map(([value, label]) => ({ value, label }))} />
      {children(tab)}
    </Page>
  )
}

/** Wraps one settings section with Save / Revert / Reset. */
export function SectionForm<T extends Record<string, any>>({ section, tips, children }: { section: string; tips?: { title: string; body: ReactNode }[]; children: (d: T, set: <K extends keyof T>(k: K, v: T[K]) => void, ro: boolean) => ReactNode }) {
  const s = useSettingsSection<T>(section)
  const ro = !useAuth((x) => x.can)('settings.manage')
  if (!s.data) return <Skeleton height={240} />
  return (
    <SettingsLayout tips={tips}>
      <form onSubmit={(e) => { e.preventDefault(); void s.save() }}>
        {ro && <Notice tone="info">Only administrators can change these settings.</Notice>}
        <fieldset disabled={ro}>{children(s.data, s.set, ro)}</fieldset>
        {!ro && <FormFooter dirty={s.dirty} saving={s.saving} onRevert={s.revert} onReset={s.reset} />}
      </form>
    </SettingsLayout>
  )
}

export function SecurityTab() {
  const me = useAuth((s) => s.me)!
  const reload = useAuth((s) => s.reloadMe)
  const qc = useQueryClient()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ id: string; ip: string | null; user_agent: string | null; last_used_at: string }[]>('/users/me/sessions') })
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [mfa, setMfa] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const change = async () => {
    try {
      await api.post('/users/me/password', pw)
      setPw({ current_password: '', new_password: '' })
      toast.success('Password changed — other sessions were signed out')
      qc.invalidateQueries({ queryKey: ['sessions'] })
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const startMfa = async () => setMfa(await api.post('/users/me/mfa/setup'))
  const enableMfa = async () => {
    try {
      await api.post(me.user.mfa_enabled ? '/users/me/mfa/disable' : '/users/me/mfa/enable', { code })
      setMfa(null)
      setCode('')
      await reload()
      toast.success(me.user.mfa_enabled ? 'Two-factor authentication disabled' : 'Two-factor authentication enabled')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  return (
    <SettingsLayout>
      <SectionTitle>Change password</SectionTitle>
      <FormField label="Current"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></FormField>
      <FormField label="New" hint="At least 10 characters with letters and numbers"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></FormField>
      <Button variant="primary" disabled={!pw.current_password || pw.new_password.length < 10} onClick={change}>Change password</Button>
      <SectionTitle description="Require a code from an authenticator app when you sign in.">Two-factor authentication</SectionTitle>
      {me.user.mfa_enabled || mfa ? (
        <div className="space-y-2">
          {mfa && <><p className="text-sm">Add this key to your authenticator app, then enter the 6-digit code:</p><code className="block break-all rounded-sm bg-surface-subtle p-2 text-xs">{mfa.secret}</code></>}
          <div className="flex gap-2"><Input className="w-32" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /><Button variant={me.user.mfa_enabled ? 'danger' : 'primary'} disabled={code.length !== 6} onClick={enableMfa}>{me.user.mfa_enabled ? 'Disable 2FA' : 'Verify & enable'}</Button></div>
        </div>
      ) : (
        <Button onClick={startMfa}>Set up two-factor authentication</Button>
      )}
      <SectionTitle>Active sessions</SectionTitle>
      <ul className="divide-y divide-border">
        {sessions.data?.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{s.user_agent || 'Unknown device'} · {s.ip}</span>
            <Button size="sm" onClick={() => api.del(`/users/me/sessions/${s.id}`).then(() => qc.invalidateQueries({ queryKey: ['sessions'] }))}>Sign out</Button>
          </li>
        ))}
      </ul>
    </SettingsLayout>
  )
}

// ------------------------------------------------------------------ Account
const DAYS: [string, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]

export function AccountSettingsPage() {
  return (
    <Tabbed area="account" title="Account" tabs={[['subscription', 'Subscription'], ['email-piping', 'Email piping'], ['chat-tags', 'Chat tags'], ['file-sending', 'File sending'], ['operating-hours', 'Operating hours'], ['timezone', 'Timezone'], ['security', 'Security'], ['visitor-list', 'Visitor list'], ['ticketing', 'Support integration'], ['sla', 'SLAs'], ['audit', 'Audit log']]}>
      {(tab) => {
        if (tab === 'subscription') return <SubscriptionTab />
        if (tab === 'email-piping')
          return (
            <SectionForm<any> section="account.email_piping" tips={[{ title: 'Email piping', body: 'Sends a copy of every chat transcript and offline message to this address. Requires SMTP to be configured on the server.' }]}>
              {(d, set) => (<><SectionTitle action={<Switch appearance="onoff" label="Email piping" checked={d.enabled} onChange={(v) => set('enabled', v)} />}>Email piping</SectionTitle><FormField label="Send to"><Input type="email" value={d.address} onChange={(e) => set('address', e.target.value)} /></FormField></>)}
            </SectionForm>
          )
        if (tab === 'chat-tags') return <ChatTagsTab />
        if (tab === 'file-sending')
          return (
            <SectionForm<any> section="account.file_sending" tips={[{ title: 'Safe file types', body: 'PDF, PNG, JPEG, GIF and TXT files are always allowed. Any extra type is opt-in and uploads are still size-limited and content-checked.' }]}>
              {(d, set) => (
                <>
                  <SectionTitle action={<Switch appearance="onoff" label="File sending" checked={d.enabled} onChange={(v) => set('enabled', v)} />}>File sending</SectionTitle>
                  <p className="mb-3 text-sm text-fg-secondary">Set your preferences for receiving and sending files during a chat. Specify allowed safe file extensions below.</p>
                  <FormField label="File types">
                    <div className="space-y-3">
                      <RadioGroup name="file_mode" value={d.mode} onChange={(v) => set('mode', v)} options={[
                        { value: 'default', label: 'Sharing is limited to PDF (.pdf), PNG (.png), JPEG (.jpg), GIF (.gif) or text (.txt) file types.' },
                        { value: 'extended', label: 'Allow PDF (.pdf), PNG (.png), JPEG (.jpg), GIF (.gif), text (.txt), and the additional file types specified below.' },
                      ]} />
                      {d.mode === 'extended' && (
                        <div className="space-y-2 pl-6">
                          <p className="text-xs text-fg-secondary">Use commas to separate file types. Include a period (.) before each extension. Example: .svg, .html</p>
                          <Textarea aria-label="Additional file types" rows={3} value={d.extra_types.map((t: string) => '.' + t.replace(/^\./, '')).join(', ')} onChange={(e) => set('extra_types', e.target.value.split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean))} />
                          <div className="rounded-sm bg-surface-muted p-3">
                            <Checkbox label="I understand there may be potential risks associated with allowing these extensions and agree to assume these risks when enabling extensions." checked={d.risk_ack} onChange={(e) => set('risk_ack', e.target.checked)} />
                            <p className="mt-1 text-xs text-fg-secondary">Take care to only enable safe extensions that you need for your business operations. If you accept compressed files, keep in mind that they could contain any attachment type when extracted.</p>
                          </div>
                          {d.extra_types.length > 0 && !d.risk_ack && <p className="text-xs text-danger">Extra types stay blocked until you accept the risk above.</p>}
                        </div>
                      )}
                    </div>
                  </FormField>
                </>
              )}
            </SectionForm>
          )
        if (tab === 'operating-hours')
          return (
            <SectionForm<any> section="account.operating_hours" tips={[{ title: 'Operating hours', body: 'Outside these hours the widget shows the offline form, even if agents are online. Change your timezone under Account › Timezone.' }]}>
              {(d, set) => (
                <>
                  <SectionTitle action={<Switch appearance="onoff" label="Operating hours" checked={d.enabled} onChange={(v) => set('enabled', v)} />}>Online schedule</SectionTitle>
                  {DAYS.map(([k, label]) => {
                    const ranges: [string, string][] = d.schedule[k] ?? []
                    const closed = ranges.length === 0
                    return (
                      <div key={k} className="flex items-center gap-3 py-1.5">
                        <span className="w-24 text-sm">{label}</span>
                        <Checkbox label="Open" checked={!closed} onChange={(e) => set('schedule', { ...d.schedule, [k]: e.target.checked ? [['09:00', '17:00']] : [] })} />
                        {closed ? <span className="text-sm text-fg-secondary">(Closed all day)</span> : ranges.map((r, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <TimePicker aria-label={`${label} opens`} value={r[0]} onChange={(v) => set('schedule', { ...d.schedule, [k]: ranges.map((x, j) => (j === i ? [v, x[1]] : x)) })} />–
                            <TimePicker aria-label={`${label} closes`} value={r[1]} onChange={(v) => set('schedule', { ...d.schedule, [k]: ranges.map((x, j) => (j === i ? [x[0], v] : x)) })} />
                          </span>
                        ))}
                      </div>
                    )
                  })}
                  <Checkbox className="mt-3" label="Display operating hours" description="Show the schedule in the widget" checked={d.display} onChange={(e) => set('display', e.target.checked)} />
                </>
              )}
            </SectionForm>
          )
        if (tab === 'timezone') return <TimezoneTab />
        if (tab === 'security')
          return (
            <SectionForm<any> section="account.security">
              {(d, set) => (
                <>
                  <SectionTitle>Authentication options</SectionTitle>
                  <Checkbox label="Require two-factor authentication" description="Agents without 2FA are asked to set it up" checked={d.mfa_required} onChange={(e) => set('mfa_required', e.target.checked)} />
                  <SectionTitle>Automatic redaction</SectionTitle>
                  <p className="mb-2 text-sm text-fg-secondary">Automatically redact credit card numbers submitted by visitors during chat sessions to protect sensitive data. If a set of numbers matches a credit card pattern (and passes the card checksum), all but the last four digits are replaced with block characters.</p>
                  <FormField label="Credit card redaction"><Checkbox label="Enable automatic redaction of credit card numbers" checked={d.cc_redaction} onChange={(e) => set('cc_redaction', e.target.checked)} /></FormField>
                </>
              )}
            </SectionForm>
          )
        if (tab === 'visitor-list')
          return (
            <SectionForm<any> section="account.visitor_list" tips={[{ title: 'High load dashboard', body: 'For busy sites: shows only visitors who are chatting or requesting a chat, to keep the dashboard fast.' }]}>
              {(d, set) => (<><SectionTitle>Visitor List (High Load Dashboard)</SectionTitle><p className="mb-3 text-sm text-fg-secondary">The High Load Dashboard is an alternative version of the Visitor List that only shows visitors in your Incoming Chats and Currently Served sections. All other visitors are hidden.</p><FormField label="High Load Dashboard"><Checkbox label="Enable this for websites with high visitor traffic" checked={d.high_load} onChange={(e) => set('high_load', e.target.checked)} /></FormField></>)}
            </SectionForm>
          )
        if (tab === 'ticketing') return <TicketingTab />
        if (tab === 'sla')
          return (
            <SectionForm<any> section="account.sla" tips={[{ title: 'Reply time SLAs', body: 'Controls whether agent replies during live chats count toward first-reply and next-reply targets in ticket SLA policies.' }]}>
              {(d, set) => (
                <>
                  <SectionTitle action={<Switch appearance="onoff" label="Reply time SLAs for live chat" checked={d.chat_reply_sla} onChange={(v) => set('chat_reply_sla', v)} />}>Reply time SLAs for live chat</SectionTitle>
                  <p className="text-sm text-fg-secondary">When turned on, both public replies and agents' responses during live chat conversations count towards the first reply time and next reply time targets in SLA policies.</p>
                  <p className="mt-2 text-sm text-fg-secondary">When turned off, only public replies on the tickets count towards the reply time SLAs.</p>
                </>
              )}
            </SectionForm>
          )
        return <AuditTab />
      }}
    </Tabbed>
  )
}

function SubscriptionTab() {
  const me = useAuth((s) => s.me)!
  const usage = useQuery({ queryKey: ['usage'], queryFn: async () => { const [a, d, t] = await Promise.all([api.get<{ enabled_count: number }>('/agents'), api.get<{ enabled_count: number }>('/departments'), api.get<{ enabled_count: number }>('/triggers')]); return { agents: a.enabled_count, depts: d.enabled_count, triggers: t.enabled_count } } })
  const row = (label: string, used: number | undefined, max: number) => (
    <div className="flex justify-between border-b border-border py-2 text-sm"><span>{label}</span><span>{used ?? '…'} of {max} used</span></div>
  )
  return (
    <SettingsLayout>
      <SectionTitle description="Limits for this workspace. Billing integration is not connected in this deployment; limits are set by the platform operator.">{me.account.plan[0]!.toUpperCase() + me.account.plan.slice(1)} plan</SectionTitle>
      {row('Agents', usage.data?.agents, me.account.max_agents)}
      {row('Departments', usage.data?.depts, me.account.max_departments)}
      {row('Triggers', usage.data?.triggers, me.account.max_triggers)}
      <div className="flex justify-between border-b border-border py-2 text-sm"><span>Concurrent chats</span><span>Unlimited (set a per-agent limit under Routing)</span></div>
      <div className="flex justify-between border-b border-border py-2 text-sm"><span>Widget customization</span><span>Yes</span></div>
    </SettingsLayout>
  )
}

const TAG_RULE = /^[A-Za-z0-9_-]+$/

function ChatTagsTab() {
  const qc = useQueryClient()
  const tags = useQuery({ queryKey: ['chat-tags'], queryFn: () => api.get<string[]>('/chat-tags') })
  const [list, setList] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  useEffect(() => tags.data && setList(tags.data), [tags.data])
  const clean = draft.trim().toLowerCase()
  const err = clean && !TAG_RULE.test(clean) ? 'Spaces and special characters other than underscore (_) and hyphen (-) are not allowed' : clean && list.includes(clean) ? 'That tag already exists' : undefined
  const add = () => {
    if (!clean || err) return
    setList([...list, clean].sort())
    setDraft('')
  }
  const save = async () => {
    try {
      qc.setQueryData(['chat-tags'], await api.put('/chat-tags', { tags: list }))
      toast.success('Tags saved')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const groups = list.reduce<Record<string, string[]>>((acc, t) => ((acc[t[0]!.toUpperCase()] ??= []).push(t), acc), {})
  return (
    <>
      <SectionForm<any> section="account.chat_tags" tips={[{ title: 'Using chat tags', body: 'Tag your chats manually during a chat or add tags to shortcuts to automatically tag the chat when you use them.' }, { title: 'Other tags', body: 'Tags added by triggers or through the JS API are separate and do not appear here.' }]}>
        {(d, set) => (
          <>
            <SectionTitle>General preferences</SectionTitle>
            <FormField label="Allow tag creation during chats"><Checkbox label="Allow admins to create new tags during chats. If not enabled, admins can only create tags in the predefined tags list below and in shortcuts." checked={d.allow_create_in_chat} onChange={(e) => set('allow_create_in_chat', e.target.checked)} /></FormField>
            <p className="rounded-sm bg-surface-muted px-3 py-2 text-center text-sm">Admins can create new tags under <b>Settings › Shortcuts</b> and edit chat tags in <b>History</b>.</p>
          </>
        )}
      </SectionForm>
      <div className="mt-6 max-w-[560px]">
        <SectionTitle description="Add or delete tags from your account's list of available tags. Deleting a tag here does not remove it from existing chats. Spaces and special characters other than underscore (_) and hyphen (-) are not allowed.">Predefined tags list</SectionTitle>
        <div className="flex items-start gap-2">
          <div className="w-[230px]"><Input aria-label="New tag" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} invalid={!!err} /></div>
          <Button aria-label="Add tag" onClick={add} disabled={!clean || !!err}>+</Button>
        </div>
        {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        <div className="mt-4 space-y-3">
          {Object.entries(groups).map(([letter, items]) => (
            <div key={letter}>
              <div className="mb-1 text-sm font-bold">{letter}</div>
              <div className="flex flex-wrap gap-1">{items.map((t) => <Tag key={t} onRemove={() => setList(list.filter((x) => x !== t))}>{t}</Tag>)}</div>
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-fg-secondary">No predefined tags yet.</p>}
        </div>
        <div className="mt-4 flex gap-2 border-t border-border pt-4">
          <Button variant="primary" disabled={JSON.stringify(list) === JSON.stringify(tags.data)} onClick={save}>Save changes</Button>
          <Button disabled={JSON.stringify(list) === JSON.stringify(tags.data)} onClick={() => tags.data && setList(tags.data)}>Revert changes</Button>
        </div>
      </div>
    </>
  )
}

function SegmentedSetting({ label, hint, value, onChange, items }: { label: string; hint: string; value: string; onChange: (v: string) => void; items: { value: string; label: string }[] }) {
  return (
    <FormField label={label}>
      <div>
        <SegmentedControl label={label} size="sm" value={value} onChange={onChange} items={items} />
        <p className="mt-1 text-xs text-fg-secondary">{hint}</p>
      </div>
    </FormField>
  )
}

/** Account › Support integration: how chats and offline messages turn into tickets. */
function TicketingTab() {
  return (
    <SectionForm<any> section="account.ticketing" tips={[{ title: 'Ticket assignment', body: 'Tickets are assigned to the agent who served the chat. Choose whether that is the first or the last agent when a chat was transferred.' }, { title: 'Status', body: 'These choices are saved now and take effect as soon as the Tickets module creates tickets from chats.' }]}>
      {(d, set) => (
        <>
          <SectionTitle>Ticket creation</SectionTitle>
          <SegmentedSetting label="Automatic ticket creation" value={d.auto_create} onChange={(v) => set('auto_create', v)} items={[{ value: 'automatic', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} hint={d.auto_create === 'automatic' ? 'A ticket is created automatically for every chat' : 'A ticket can be manually created at any time during or after a chat'} />
          <SegmentedSetting label="Transcript visibility" value={d.transcript_visibility} onChange={(v) => set('transcript_visibility', v)} items={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} hint={d.transcript_visibility === 'public' ? 'The chat transcript will be incrementally appended to the ticket as a public reply' : 'The chat transcript will be added to the ticket as a private note'} />
          <SegmentedSetting label="Ticket assignment" value={d.assignment} onChange={(v) => set('assignment', v)} items={[{ value: 'last', label: 'Last agent' }, { value: 'first', label: 'First agent' }]} hint={d.assignment === 'first' ? 'The ticket will be assigned to the first agent who joined the chat.' : 'The ticket will be assigned to the last agent who served the chat.'} />
          <SectionTitle>Ticket creation – offline messages</SectionTitle>
          <SegmentedSetting label="Automatic ticket creation" value={d.offline_auto_create} onChange={(v) => set('offline_auto_create', v)} items={[{ value: 'automatic', label: 'Automatic' }, { value: 'manual', label: 'Manual' }]} hint={d.offline_auto_create === 'automatic' ? 'A ticket is created automatically for every offline message' : 'A ticket can be manually created for an offline message at any time'} />
          <SegmentedSetting label="Transcript visibility" value={d.offline_transcript_visibility} onChange={(v) => set('offline_transcript_visibility', v)} items={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} hint="Whether the offline message is added to the ticket as a public reply or a private note" />
        </>
      )}
    </SectionForm>
  )
}

function TimezoneTab() {
  const me = useAuth((s) => s.me)!
  const reload = useAuth((s) => s.reloadMe)
  const [tz, setTz] = useState(me.account.timezone)
  const zones = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined
  return (
    <SettingsLayout tips={[{ title: 'Timezone', body: 'Used for operating hours, business hours and reports.' }]}>
      <SectionTitle description="Select the timezone for your account.">Timezone</SectionTitle>
      <Select value={tz} onChange={(e) => setTz(e.target.value)} options={(zones ?? ['UTC']).map((z) => ({ value: z, label: z }))} />
      <Button className="mt-4" variant="primary" disabled={tz === me.account.timezone} onClick={async () => { try { await api.patch('/accounts/current', { timezone: tz }); await reload(); toast.success('Timezone saved') } catch (e) { toast.error(apiError(e).message) } }}>Save timezone</Button>
    </SettingsLayout>
  )
}

function AuditTab() {
  const [page, setPage] = useState(1)
  const q = useQuery({ queryKey: ['audit', page], queryFn: () => api.get<{ items: { id: string; action: string; entity_type: string; actor_name: string | null; created_at: string; changes: any }[]; page_count: number }>('/admin/audit-logs', { page }) })
  return (
    <div>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border text-left text-xs font-bold"><th className="h-9 px-2">When</th><th className="px-2">Who</th><th className="px-2">Action</th><th className="px-2">Details</th></tr></thead>
        <tbody>{q.data?.items.map((r) => <tr key={r.id} className="border-b border-border"><td className="h-9 px-2">{new Date(r.created_at).toLocaleString()}</td><td className="px-2">{r.actor_name ?? 'System'}</td><td className="px-2">{r.action}</td><td className="max-w-[400px] truncate px-2 text-fg-secondary">{r.changes ? JSON.stringify(r.changes) : ''}</td></tr>)}</tbody>
      </table>
      <div className="mt-3 flex gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= (q.data?.page_count ?? 1)} onClick={() => setPage(page + 1)}>Next</Button></div>
    </div>
  )
}
