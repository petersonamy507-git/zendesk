import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Image as ImageIcon, RefreshCw } from 'lucide-react'
import { FormFooter, QuickTips, SectionTitle } from '@/components/layout/Page'
import { Avatar, Button, Checkbox, ConfirmDialog, FileUploader, FormField, Input, Modal, Notice, Select, SegmentedControl, Skeleton, Switch, Tag, Textarea, toast } from '@/components/ui'
import { api, apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { cn } from '@/utils/cn'
import { copyText } from '@/utils/browser'
import { WidgetPreview, type PreviewState, type WidgetAppearance, type WidgetForms } from '../components/WidgetPreview'
import { useSettingsSection } from '../hooks/useSettingsSection'
import { Tabbed } from './WidgetAccountPages'

const IMAGE_MAX = 1024 * 1024 // 1 MB (reference limit for the badge image)

function readDataUrl(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif)$/.test(file.type)) return reject(new Error('Use a PNG, JPEG or GIF image'))
    if (file.size > maxBytes) return reject(new Error(`Image must be ${maxBytes >= 1024 * 1024 ? `${maxBytes / 1024 / 1024} MB` : `${maxBytes / 1024} KB`} or smaller`))
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read the image'))
    r.readAsDataURL(file)
  })
}

/** Original badge artwork (generated SVG): the "gallery" visitors can pick from. */
const gallery = (text: string, bg: string, fg = '#ffffff') =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="164" viewBox="0 0 240 164"><rect width="240" height="164" rx="12" fill="${bg}"/><path d="M40 40h160a10 10 0 0 1 10 10v50a10 10 0 0 1-10 10h-70l-24 20v-20H40a10 10 0 0 1-10-10V50a10 10 0 0 1 10-10z" fill="${fg}" opacity=".18"/><text x="120" y="92" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="${fg}">${text}</text></svg>`)}`
const GALLERY = [gallery('Chat now', '#1d6fb0'), gallery('Need help?', '#2fa36b'), gallery("We're here", '#8a5cb8')]

export function WidgetSettingsPage() {
  return (
    <Tabbed area="widget" title="Widget" tabs={[['getting-started', 'Getting started'], ['appearance', 'Appearance'], ['forms', 'Forms'], ['settings', 'Settings'], ['security', 'Widget security']]}>
      {(tab) => (tab === 'getting-started' ? <GettingStarted /> : tab === 'security' ? <WidgetSecurity /> : <PreviewedTab tab={tab as 'appearance' | 'forms' | 'settings'} />)}
    </Tabbed>
  )
}

function GettingStarted() {
  const me = useAuth((s) => s.me)!
  const snippet = `<!-- Start of Parley chat widget -->\n<script src="${location.origin}/widget/parley-widget.js" data-workspace="${me.account.subdomain}" data-api="${location.origin}" async></script>\n<!-- End of Parley chat widget -->`
  return (
    <div className="flex gap-12">
      <div className="w-full max-w-[560px]">
        <SectionTitle description={<>Copy the following script and insert it into your website's HTML source code, just before the closing <code>&lt;/body&gt;</code> tag. It must be inserted into every page where you want the widget to appear.</>}>Embed the chat widget</SectionTitle>
        <Textarea readOnly rows={5} className="font-mono text-xs" value={snippet} aria-label="Embed code" />
        <Button className="mt-2" leftIcon={<Copy size={12} />} onClick={() => copyText(snippet).then((ok) => (ok ? toast.success('Copied') : toast.error('Could not copy: select the code and press Ctrl+C')))}>Copy code</Button>
        <SectionTitle description="Identify signed-in visitors on your site and let them continue conversations across browsers.">Enable visitor authentication</SectionTitle>
        <p className="text-sm">Generate a shared secret under <a className="text-primary" href="/settings/widget/security">Widget security</a>, then sign <code>externalId + email</code> with HMAC-SHA256 on your server and pass it to the widget as <code>window.ParleyAuth</code>.</p>
      </div>
      <QuickTips tips={[{ title: 'Try it', body: <>Open the <a className="text-primary" href={`/widget/demo.html?ws=${me.account.subdomain}`} target="_blank" rel="noreferrer">demo page</a> to chat as a visitor.</> }]} />
    </div>
  )
}

/** Appearance / Forms / Settings share one layout: form on the left, live preview on the right. */
function PreviewedTab({ tab }: { tab: 'appearance' | 'forms' | 'settings' }) {
  const ro = !useAuth((s) => s.can)('settings.manage')
  const app = useSettingsSection<WidgetAppearance & Record<string, any>>('widget.appearance')
  const forms = useSettingsSection<WidgetForms & Record<string, any>>('widget.forms')
  const misc = useSettingsSection<{ sounds: boolean; ratings_enabled: boolean }>('widget.settings')
  const active = tab === 'appearance' ? app : tab === 'forms' ? forms : misc
  const [state, setState] = useState<PreviewState>(tab === 'appearance' ? 'chat' : tab === 'forms' ? 'prechat' : 'chat')
  useEffect(() => setState(tab === 'forms' ? 'prechat' : 'chat'), [tab])
  if (!app.data || !forms.data || !misc.data) return <Skeleton height={300} />
  return (
    <div className="flex gap-10">
      <form className="w-full max-w-[560px]" onSubmit={(e) => { e.preventDefault(); void active.save() }}>
        {ro && <Notice tone="info">Only administrators can change the widget.</Notice>}
        <fieldset disabled={ro}>
          {tab === 'appearance' && <AppearanceFields d={app.data} set={app.set} onState={setState} />}
          {tab === 'forms' && <FormsFields d={forms.data} set={forms.set} onState={setState} />}
          {tab === 'settings' && (
            <>
              <SectionTitle>General preferences</SectionTitle>
              <FormField label="Notification sounds"><Checkbox label="Play a sound for the visitor when a new message is received" checked={misc.data.sounds} onChange={(e) => misc.set('sounds', e.target.checked)} /></FormField>
              <SectionTitle>Satisfaction ratings</SectionTitle>
              <FormField label="Enable satisfaction ratings"><Checkbox label="Allow visitors to rate their chats with your agents." checked={misc.data.ratings_enabled} onChange={(e) => misc.set('ratings_enabled', e.target.checked)} /></FormField>
            </>
          )}
        </fieldset>
        {!ro && <FormFooter dirty={active.dirty} saving={active.saving} onRevert={active.revert} onReset={active.reset} />}
      </form>
      <WidgetPreview appearance={app.data} forms={forms.data} state={state} onState={setState} />
    </div>
  )
}

const BADGE_LAYOUTS: { value: WidgetAppearance['badge_layout']; label: string }[] = [
  { value: 'image_right', label: 'Image right' },
  { value: 'image_left', label: 'Image left' },
  { value: 'text_only', label: 'Text only' },
  { value: 'custom_image', label: 'Custom image' },
]

function AppearanceFields({ d, set, onState }: { d: WidgetAppearance; set: <K extends keyof WidgetAppearance>(k: K, v: WidgetAppearance[K]) => void; onState: (s: PreviewState) => void }) {
  const [gal, setGal] = useState(false)
  const hexOk = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
  const colorField = (value: string, onChange: (v: string) => void, label: string, disabled = false) => (
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`${label} picker`} disabled={disabled} value={hexOk.test(value) && value.length === 7 ? value : '#1d6fb0'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-[30px] w-9 rounded-sm border border-border p-0.5" />
      <Input aria-label={label} className="w-[110px] font-mono" disabled={disabled} value={value} invalid={!hexOk.test(value)} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </div>
  )
  const upload = async (files: File[], key: 'badge_image' | 'concierge_avatar', max: number) => {
    try {
      set(key, await readDataUrl(files[0]!, max))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <>
      <SectionTitle>Chat window</SectionTitle>
      <FormField label="Top title"><Input value={d.title} onChange={(e) => set('title', e.target.value)} /></FormField>
      <FormField label="Theme color" error={hexOk.test(d.theme_color) ? undefined : 'Enter a hex color such as #1D6FB0'}>{colorField(d.theme_color, (v) => set('theme_color', v), 'Theme color')}</FormField>
      <FormField label="Widget position"><SegmentedControl label="Widget position" size="sm" value={d.position} onChange={(v) => set('position', v)} items={[{ value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' }]} /></FormField>

      <SectionTitle action={<Switch appearance="onoff" label="Chat badge" checked={d.badge_enabled} onChange={(v) => { set('badge_enabled', v); if (v) onState('badge') }} />}>Chat badge</SectionTitle>
      <div role="radiogroup" aria-label="Badge layout" className="flex gap-2 py-2">
        {BADGE_LAYOUTS.map((l) => (
          <button key={l.value} type="button" role="radio" aria-checked={d.badge_layout === l.value} disabled={!d.badge_enabled} onClick={() => { set('badge_layout', l.value); onState('badge') }} className={cn('flex h-[72px] w-[84px] flex-col items-center justify-center gap-1 rounded-md border text-xs font-bold disabled:opacity-50', d.badge_layout === l.value ? 'border-border-strong bg-surface-muted' : 'border-transparent hover:bg-surface-hover')}>
            <ImageIcon size={28} aria-hidden className="text-fg-secondary" />
            {l.label}
          </button>
        ))}
      </div>
      <FormField label="Badge text"><Input disabled={!d.badge_enabled || d.badge_layout === 'custom_image'} value={d.badge_text} onChange={(e) => set('badge_text', e.target.value)} /></FormField>
      <FormField label="Background color">
        <div className="flex items-center gap-3">
          {colorField(d.badge_bg_same_as_theme ? d.theme_color : d.badge_bg_color, (v) => set('badge_bg_color', v), 'Background color', !d.badge_enabled || d.badge_bg_same_as_theme)}
          <Checkbox label="Same as theme color" disabled={!d.badge_enabled} checked={d.badge_bg_same_as_theme} onChange={(e) => set('badge_bg_same_as_theme', e.target.checked)} />
        </div>
      </FormField>
      {d.badge_layout === 'custom_image' && (
        <FormField label="Image" hint="Maximum size 1 MB. Recommended dimensions 240x164px. To support retina displays, recommended dimensions are 480x328px.">
          <div className="space-y-2">
            {d.badge_image ? <img src={d.badge_image} alt="Badge" className="h-[82px] w-[120px] rounded-sm border border-border object-cover" /> : <div className="flex h-[82px] w-[120px] items-center justify-center rounded-sm border border-dashed border-border-strong text-xs text-fg-secondary">No image</div>}
            <div className="flex gap-2">
              <Button size="sm" disabled={!d.badge_enabled} onClick={() => setGal(true)}>Choose from gallery</Button>
              <FileUploader variant="button" accept="image/png,image/jpeg,image/gif" multiple={false} disabled={!d.badge_enabled} onFiles={(f) => upload(f, 'badge_image', IMAGE_MAX)} />
              <Button size="sm" disabled={!d.badge_image} onClick={() => set('badge_image', null)}>Remove</Button>
            </div>
          </div>
        </FormField>
      )}

      <SectionTitle>Concierge</SectionTitle>
      <FormField label="Display title" hint="Customize this name to give the Concierge a personality."><Input value={d.concierge_name} onChange={(e) => set('concierge_name', e.target.value)} /></FormField>
      <FormField label="Byline"><Input value={d.concierge_byline} onChange={(e) => set('concierge_byline', e.target.value)} /></FormField>
      <FormField label="Avatar" hint="Shown when no agent has joined yet. Maximum size 100 KB.">
        <div className="flex items-center gap-3">
          <Avatar name={d.concierge_name} src={d.concierge_avatar} size={40} />
          <FileUploader variant="button" accept="image/png,image/jpeg,image/gif" multiple={false} onFiles={(f) => upload(f, 'concierge_avatar', 100 * 1024)} />
          {d.concierge_avatar && <Button size="sm" onClick={() => set('concierge_avatar', null)}>Remove</Button>}
        </div>
      </FormField>
      <SectionTitle>Message style</SectionTitle>
      <FormField label="Show avatars"><Checkbox label="Show agent avatars next to messages" checked={d.show_avatars} onChange={(e) => set('show_avatars', e.target.checked)} /></FormField>

      <Modal open={gal} onClose={() => setGal(false)} title="Choose a badge image" size="md">
        <div className="grid grid-cols-3 gap-3 pb-2">
          {GALLERY.map((g, i) => (
            <button key={i} type="button" onClick={() => { set('badge_image', g); setGal(false) }} className="overflow-hidden rounded-md border border-border hover:border-primary focus-visible:border-primary">
              <img src={g} alt={`Badge option ${i + 1}`} className="w-full" />
            </button>
          ))}
        </div>
      </Modal>
    </>
  )
}

function FormsFields({ d, set, onState }: { d: WidgetForms; set: <K extends keyof WidgetForms>(k: K, v: WidgetForms[K]) => void; onState: (s: PreviewState) => void }) {
  return (
    <>
      <SectionTitle action={<Switch appearance="onoff" label="Visitor profile" checked={d.visitor_profile_enabled} onChange={(v) => set('visitor_profile_enabled', v)} />}>Visitor profile</SectionTitle>
      <FormField label="Allow phone number"><Checkbox label="Allow non-authenticated visitors to enter their phone number" disabled={!d.visitor_profile_enabled} checked={d.allow_phone} onChange={(e) => set('allow_phone', e.target.checked)} /></FormField>

      <SectionTitle action={<Switch appearance="onoff" label="Pre-chat form" checked={d.prechat_enabled} onChange={(v) => { set('prechat_enabled', v); onState('prechat') }} />}>Pre-chat form</SectionTitle>
      <p className="mb-2 text-sm text-fg-secondary">Require visitors to complete a form before starting a chat.</p>
      <FormField label="Pre-chat greeting"><Textarea rows={3} disabled={!d.prechat_enabled} value={d.prechat_greeting} onChange={(e) => set('prechat_greeting', e.target.value)} /></FormField>
      <FormField label="Require identity"><Checkbox label="Visitors must provide their name and email." disabled={!d.prechat_enabled} checked={d.require_identity} onChange={(e) => set('require_identity', e.target.checked)} /></FormField>
      <FormField label="Require phone number"><Checkbox label="Visitors must enter their phone number before starting a chat." disabled={!d.prechat_enabled || !d.allow_phone} checked={d.require_phone} onChange={(e) => set('require_phone', e.target.checked)} /></FormField>
      <FormField label="Require question"><Checkbox label="Visitors must enter a question to ask your agents before starting a chat." disabled={!d.prechat_enabled} checked={d.require_question} onChange={(e) => set('require_question', e.target.checked)} /></FormField>

      <SectionTitle action={<Switch appearance="onoff" label="Offline form" checked={d.offline_enabled} onChange={(v) => { set('offline_enabled', v); onState('offline') }} />}>Offline form</SectionTitle>
      <FormField label="Offline greeting"><Textarea rows={3} disabled={!d.offline_enabled} value={d.offline_greeting} onChange={(e) => set('offline_greeting', e.target.value)} /></FormField>
      <FormField label="Require phone number"><Checkbox label="Visitors must enter their phone number when sending you an offline message" disabled={!d.offline_enabled} checked={d.offline_require_phone} onChange={(e) => set('offline_require_phone', e.target.checked)} /></FormField>
      <FormField label="Allow messaging channels" hint="Add your Messenger username or Facebook page ID. Visitors who can't reach you get a link to message you there.">
        <div className="space-y-2">
          <Checkbox label="Messenger" disabled={!d.offline_enabled} checked={d.messenger_enabled} onChange={(e) => set('messenger_enabled', e.target.checked)} />
          <Input aria-label="Messenger username or page ID" placeholder="your.page" disabled={!d.offline_enabled || !d.messenger_enabled} value={d.messenger_id} onChange={(e) => set('messenger_id', e.target.value.replace(/[^A-Za-z0-9._-]/g, ''))} />
        </div>
      </FormField>
    </>
  )
}

// ------------------------------------------------------------------ security
const COUNTRY_CODES = 'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ')

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

function WidgetSecurity() {
  const s = useSettingsSection<{ blocked_countries_enabled: boolean; blocked_countries: string[]; allowed_domains_enabled: boolean; allowed_domains: string[]; auth_enabled: boolean; shared_secret: string | null }>('widget.security')
  const ro = !useAuth((x) => x.can)('settings.manage')
  const qc = useQueryClient()
  const [domain, setDomain] = useState('')
  const [pick, setPick] = useState('')
  const [confirm, setConfirm] = useState(false)
  const countries = useMemo(() => COUNTRY_CODES.map((c) => ({ value: c, label: `${countryName(c)} (${c})` })).sort((a, b) => a.label.localeCompare(b.label)), [])
  if (!s.data) return <Skeleton height={240} />
  const d = s.data
  const dom = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const domErr = dom && !DOMAIN_RE.test(dom) ? 'Enter a domain such as shop.example.com' : dom && d.allowed_domains.includes(dom) ? 'Already listed' : undefined
  const regenerate = async () => {
    try {
      qc.setQueryData(['settings', 'widget.security'], await api.post('/settings/widget.security/regenerate-secret'))
      s.revert()
      setConfirm(false)
      toast.success('New shared secret generated')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  return (
    <form className="max-w-[640px]" onSubmit={(e) => { e.preventDefault(); void s.save() }}>
      {ro && <Notice tone="info">Only administrators can change widget security.</Notice>}
      <fieldset disabled={ro}>
        <SectionTitle action={<Switch appearance="onoff" label="Blocked countries" checked={d.blocked_countries_enabled} onChange={(v) => s.set('blocked_countries_enabled', v)} />}>Blocked countries</SectionTitle>
        <p className="mb-2 text-sm text-fg-secondary">Restrict the widget from loading in selected countries. Uses the country header from your proxy or CDN (CF-IPCountry or X-Country-Code).</p>
        <Select aria-label="Add blocked country" className="w-[260px]" disabled={!d.blocked_countries_enabled} value={pick} placeholder="Select" options={countries.filter((c) => !d.blocked_countries.includes(c.value))} onChange={(e) => { if (e.target.value) s.set('blocked_countries', [...d.blocked_countries, e.target.value]); setPick('') }} />
        <div className="mt-2 flex flex-wrap gap-1">{d.blocked_countries.map((c) => <Tag key={c} onRemove={() => s.set('blocked_countries', d.blocked_countries.filter((x) => x !== c))}>{countryName(c)}</Tag>)}</div>

        <SectionTitle action={<Switch appearance="onoff" label="Allowed domains" checked={d.allowed_domains_enabled} onChange={(v) => s.set('allowed_domains_enabled', v)} />}>Allowed domains</SectionTitle>
        <p className="mb-2 text-sm text-fg-secondary">List the domains where the widget should be displayed. Subdomains are included.</p>
        <div className="flex items-start gap-2">
          <div className="w-[260px]"><Input aria-label="Domain name" placeholder="Enter domain name" disabled={!d.allowed_domains_enabled} value={domain} invalid={!!domErr} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (dom && !domErr) { s.set('allowed_domains', [...d.allowed_domains, dom]); setDomain('') } } }} /></div>
          <Button aria-label="Add domain" disabled={!d.allowed_domains_enabled || !dom || !!domErr} onClick={() => { s.set('allowed_domains', [...d.allowed_domains, dom]); setDomain('') }}>+</Button>
        </div>
        {domErr && <p className="mt-1 text-xs text-danger">{domErr}</p>}
        <div className="mt-2 flex flex-wrap gap-1">{d.allowed_domains.map((x) => <Tag key={x} onRemove={() => s.set('allowed_domains', d.allowed_domains.filter((y) => y !== x))}>{x}</Tag>)}</div>

        <SectionTitle action={<Switch appearance="onoff" label="Visitor authentication" checked={d.auth_enabled} onChange={(v) => s.set('auth_enabled', v)} />}>Visitor authentication</SectionTitle>
        <p className="mb-2 text-sm text-fg-secondary">Enable visitor authentication for cross-domain support and the ability to show past chats in the widget.</p>
        <FormField label="Shared secret">
          <div className="flex gap-2">
            <Input readOnly value={d.shared_secret ?? ''} placeholder="Not generated yet" className="font-mono text-xs" />
            <Button leftIcon={<RefreshCw size={12} />} disabled={!d.auth_enabled} onClick={() => (d.shared_secret ? setConfirm(true) : void regenerate())}>{d.shared_secret ? 'Regenerate' : 'Generate'}</Button>
          </div>
        </FormField>
      </fieldset>
      {!ro && <FormFooter dirty={s.dirty} saving={s.saving} onRevert={s.revert} />}
      <ConfirmDialog open={confirm} title="Regenerate shared secret?" message="Signatures made with the old secret stop working immediately." confirmLabel="Regenerate" danger onConfirm={regenerate} onCancel={() => setConfirm(false)} />
    </form>
  )
}
