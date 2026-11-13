import { useEffect, useState } from 'react'
import { FormFooter, SectionTitle, SettingsLayout } from '@/components/layout/Page'
import { Avatar, Button, Checkbox, FileUploader, FormField, Input, MultiSelect, Notice, RadioGroup, Select, Switch, toast } from '@/components/ui'
// Avatars are stored inline (data: URI) so the public chat widget can display them without authentication.
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { SOUND_OPTIONS, playSound } from '@/features/chat/utils/notify'
import { SecurityTab, Tabbed } from './WidgetAccountPages'

const AVATAR_MAX_BYTES = 100 * 1024

/** Personal › Profile / Sounds & notifications / Idle timeout / Email reports / Labs / Password & security. */
export function PersonalSettingsPage() {
  return (
    <Tabbed area="personal" title="Personal" tabs={[['profile', 'Profile'], ['notifications', 'Sounds & notifications'], ['idle', 'Idle timeout'], ['reports', 'Email reports'], ['labs', 'Labs'], ['security', 'Password & security']]}>
      {(tab) => (tab === 'profile' ? <ProfileTab /> : tab === 'security' ? <SecurityTab /> : <PreferencesTab tab={tab} />)}
    </Tabbed>
  )
}

function ProfileTab() {
  const me = useAuth((s) => s.me)!
  const setMe = useAuth((s) => s.setMe)
  const reload = useAuth((s) => s.reloadMe)
  const init = { display_name: me.user.display_name ?? '', tagline: me.user.tagline ?? '', avatar_url: me.user.avatar_url, chat_limit: me.user.chat_limit ? String(me.user.chat_limit) : '', skills: me.user.skills, keyboard_shortcuts: !!me.preferences.keyboard_shortcuts, offline_message_notification: !!me.preferences.offline_message_notification }
  const [f, setF] = useState(init)
  const dirty = JSON.stringify(f) !== JSON.stringify(init)
  const limitErr = f.chat_limit !== '' && !/^([1-9]|1\d|20)$/.test(f.chat_limit) ? 'Must be between 1 and 20' : undefined
  const save = async () => {
    if (limitErr) return
    try {
      await api.patch('/users/me', { display_name: f.display_name, tagline: f.tagline, avatar_url: f.avatar_url })
      await api.patch(`/agents/${me.user.id}`, { chat_limit: f.chat_limit ? Number(f.chat_limit) : null, skills: f.skills }).catch((e) => {
        if (me.user.role.key === 'agent' || me.user.role.key === 'light_agent') return // agents can't edit their own limit/skills; admins can
        throw e
      })
      setMe(await api.put('/users/me/preferences', { keyboard_shortcuts: f.keyboard_shortcuts, offline_message_notification: f.offline_message_notification }))
      await reload()
      toast.success('Profile saved')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const canEditRouting = me.permissions.includes('agents.manage')
  return (
    <SettingsLayout tips={[{ title: 'Display name', body: 'Visitors see your display name, tagline and avatar in the chat widget.' }]}>
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <SectionTitle>Profile</SectionTitle>
        <FormField label="Name"><span className="pt-1.5 text-sm">{me.user.name}</span></FormField>
        <FormField label="Email"><span className="pt-1.5 text-sm">{me.user.email}</span></FormField>
        <FormField label="Display name"><Input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></FormField>
        <FormField label="Tagline"><Input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></FormField>
        <FormField label="Avatar" hint="Appears when chatting with visitors. Maximum size 100 KB, recommended dimensions 50x50px">
          <div className="flex items-center gap-3">
            <Avatar name={f.display_name || me.user.name} src={f.avatar_url} size={50} shape="square" />
            <FileUploader variant="button" accept="image/png,image/jpeg,image/gif" multiple={false} onFiles={(files) => {
              const file = files[0]!
              if (!/^image\/(png|jpeg|gif)$/.test(file.type)) return void toast.error('Use a PNG, JPEG or GIF image')
              if (file.size > AVATAR_MAX_BYTES) return void toast.error('Image must be 100 KB or smaller')
              const r = new FileReader()
              r.onload = () => setF((cur) => ({ ...cur, avatar_url: String(r.result) }))
              r.readAsDataURL(file)
            }} />
            <span className="text-sm">Upload image</span>
            {f.avatar_url && <Button size="sm" onClick={() => setF({ ...f, avatar_url: null })}>Remove</Button>}
          </div>
        </FormField>
        <SectionTitle>Preferences</SectionTitle>
        <FormField label="Dashboard language" hint="English is fully supported; more languages are planned."><Select className="w-[200px]" value="en" onChange={() => undefined} options={[{ value: 'en', label: 'English' }]} /></FormField>
        <FormField label="Chat limit" error={limitErr} hint={<>Number of chats you are allowed to take (1–20). Admins can edit other chat routing settings under <a className="text-primary" href="/settings/routing">Routing › Settings</a>.</>}>
          <Input type="number" min={1} max={20} className="w-[200px]" disabled={!canEditRouting} value={f.chat_limit} onChange={(e) => setF({ ...f, chat_limit: e.target.value })} />
        </FormField>
        <FormField label="Skills" hint="Identify the agent's capabilities. Assign up to 5 skills per agent.">
          <MultiSelect label="Skills" creatable options={f.skills.map((s) => ({ value: s, label: s }))} value={f.skills} onChange={(v) => v.length <= 5 ? setF({ ...f, skills: v }) : toast.error('You can assign up to 5 skills')} placeholder={canEditRouting ? 'Add skills' : 'Managed by an administrator'} />
        </FormField>
        <FormField label="Keyboard shortcuts"><Checkbox label="Enable keyboard shortcuts" checked={f.keyboard_shortcuts} onChange={(e) => setF({ ...f, keyboard_shortcuts: e.target.checked })} /></FormField>
        <FormField label="Offline message notification"><Checkbox label="Email me when a visitor leaves an offline message" checked={f.offline_message_notification} onChange={(e) => setF({ ...f, offline_message_notification: e.target.checked })} /></FormField>
        <FormFooter dirty={dirty} onRevert={() => setF(init)} />
      </form>
    </SettingsLayout>
  )
}

const SOUND_EVENTS: [string, string, boolean?][] = [
  ['incoming_visitor', 'Incoming visitor'],
  ['incoming_chat', 'Chat request', true],
  ['new_message', 'Incoming message'],
  ['status_change', 'Automatic status change'],
]

function PreferencesTab({ tab }: { tab: string }) {
  const me = useAuth((s) => s.me)!
  const setMe = useAuth((s) => s.setMe)
  const [p, setP] = useState<Record<string, any>>(me.preferences)
  useEffect(() => setP(me.preferences), [me.preferences])
  const dirty = JSON.stringify(p) !== JSON.stringify(me.preferences)
  const set = (k: string, v: unknown) => setP({ ...p, [k]: v })
  const save = async () => {
    try {
      setMe(await api.put('/users/me/preferences', p))
      toast.success('Preferences saved')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const idleOn = !!p.idle_enabled
  return (
    <SettingsLayout>
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        {tab === 'notifications' && (
          <>
            <SectionTitle description={`Set your notification preferences for when you are in or away from the dashboard. You will need to allow notifications from ${location.host} in your browser settings.`}>Notifications</SectionTitle>
            <div className="space-y-3">
              <FormField label="Chat request"><Checkbox label="Show notifications for incoming chat requests" checked={p.notify_chat_request} onChange={(e) => set('notify_chat_request', e.target.checked)} /></FormField>
              <FormField label="New messages"><Checkbox label="Show notifications for new messages in open chats" checked={p.notify_new_message} onChange={(e) => set('notify_new_message', e.target.checked)} /></FormField>
              <FormField label="Status changes"><Checkbox label="Show notifications for automatic status changes" checked={p.notify_status_change} onChange={(e) => set('notify_status_change', e.target.checked)} /></FormField>
              <FormField label="Session expiry"><Checkbox label="Show notifications within 1 minute of session expiry" checked={p.notify_session_expiry} onChange={(e) => set('notify_session_expiry', e.target.checked)} /></FormField>
            </div>
            <SectionTitle>Sounds</SectionTitle>
            {SOUND_EVENTS.map(([ev, label, repeat]) => (
              <FormField key={ev} label={label}>
                <div className="space-y-2">
                  <Select aria-label={`${label} sound`} className="w-[250px]" value={p[`sound_${ev}`]} onChange={(e) => { set(`sound_${ev}`, e.target.value); playSound(e.target.value, p[`volume_${ev}`]) }} options={SOUND_OPTIONS} />
                  <div className="flex w-[250px] items-center gap-2">
                    <span aria-hidden className="text-xs">🔈</span>
                    <input type="range" min={0} max={100} aria-label={`${label} volume`} value={p[`volume_${ev}`]} onChange={(e) => set(`volume_${ev}`, Number(e.target.value))} onMouseUp={() => playSound(p[`sound_${ev}`], p[`volume_${ev}`])} className="flex-1 accent-[var(--primary)]" />
                    <span aria-hidden className="text-xs">🔊</span>
                  </div>
                  {repeat && (
                    <label className="inline-flex items-center gap-2 text-sm text-fg-secondary">
                      Repeat: <Input type="number" min={1} max={10} className="w-14" value={p.sound_incoming_chat_repeat} onChange={(e) => set('sound_incoming_chat_repeat', Math.min(10, Math.max(1, Number(e.target.value) || 1)))} /> (1 to 10)
                    </label>
                  )}
                </div>
              </FormField>
            ))}
          </>
        )}
        {tab === 'idle' && (
          <>
            <SectionTitle action={<Switch appearance="onoff" label="Idle timeout" checked={idleOn} onChange={(v) => set('idle_enabled', v)} />}>Idle timeout</SectionTitle>
            <p className="mb-2 text-sm text-fg-secondary">Set your status to Away or Invisible after a period on inactivity.</p>
            <FormField label="Ignore if chatting"><Checkbox label="Do not change my status if I have open chat windows" disabled={!idleOn} checked={p.idle_ignore_if_chatting} onChange={(e) => set('idle_ignore_if_chatting', e.target.checked)} /></FormField>
            <FormField label="Inactivity period" hint="Time (in minutes) before going Away or Invisible."><Input type="number" min={1} max={480} className="w-20" disabled={!idleOn} value={p.idle_minutes} onChange={(e) => set('idle_minutes', Math.max(1, Number(e.target.value) || 1))} /></FormField>
            <FormField label="Idle status"><RadioGroup name="idle_status" disabled={!idleOn} value={p.idle_status} onChange={(v) => set('idle_status', v)} options={[{ value: 'away', label: 'Away' }, { value: 'invisible', label: 'Invisible' }]} /></FormField>
          </>
        )}
        {tab === 'reports' && (
          <>
            <Notice tone="info" title="Delivery">Reports are sent by email once outgoing email (SMTP) is configured for this deployment; your choices are saved now.</Notice>
            <SectionTitle description="Track website statistics and agent performance.">Analytics reports</SectionTitle>
            <FormField label="Daily"><Checkbox label="Receive daily email reports" checked={p.email_report_daily} onChange={(e) => set('email_report_daily', e.target.checked)} /></FormField>
            <FormField label="Weekly"><Checkbox label="Receive weekly email reports (sent every Sunday)" checked={p.email_report_weekly} onChange={(e) => set('email_report_weekly', e.target.checked)} /></FormField>
            <FormField label="Monthly"><Checkbox label="Receive monthly email reports (sent every first day of the month)" checked={p.email_report_monthly} onChange={(e) => set('email_report_monthly', e.target.checked)} /></FormField>
          </>
        )}
        {tab === 'labs' && (
          <>
            <Notice tone="warning">These features are experimental and may be changed or removed.</Notice>
            <SectionTitle>Chat panel</SectionTitle>
            <FormField label="Docked chat panel"><Checkbox label="Attach chat panel to right edge of screen" checked={p.docked_chat_panel} onChange={(e) => set('docked_chat_panel', e.target.checked)} /></FormField>
          </>
        )}
        <FormFooter dirty={dirty} onRevert={() => setP(me.preferences)} onReset={() => setP({ ...me.preferences, ...DEFAULTS[tab] })} />
      </form>
    </SettingsLayout>
  )
}

/** Per-tab "Reset to defaults" values (mirror backend PREF_DEFAULTS). */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  notifications: { notify_chat_request: true, notify_new_message: true, notify_status_change: true, notify_session_expiry: true, sound_incoming_visitor: 'alert', volume_incoming_visitor: 100, sound_incoming_chat: 'bright', volume_incoming_chat: 100, sound_incoming_chat_repeat: 1, sound_new_message: 'bright', volume_new_message: 100, sound_status_change: 'alert', volume_status_change: 100 },
  idle: { idle_enabled: false, idle_ignore_if_chatting: true, idle_minutes: 15, idle_status: 'away' },
  reports: { email_report_daily: false, email_report_weekly: false, email_report_monthly: false },
  labs: { docked_chat_panel: false },
}
