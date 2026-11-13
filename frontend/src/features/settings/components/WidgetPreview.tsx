import { useState } from 'react'
import { ArrowUpRight, LogOut, MoreHorizontal, Paperclip } from 'lucide-react'
import { Select } from '@/components/ui'
import { cn } from '@/utils/cn'

export interface WidgetAppearance {
  title: string
  theme_color: string
  position: 'bl' | 'br'
  badge_enabled: boolean
  badge_layout: 'image_right' | 'image_left' | 'text_only' | 'custom_image'
  badge_text: string
  badge_bg_same_as_theme: boolean
  badge_bg_color: string
  badge_image: string | null
  concierge_name: string
  concierge_byline: string
  concierge_avatar: string | null
  show_avatars: boolean
}

export interface WidgetForms {
  visitor_profile_enabled: boolean
  allow_phone: boolean
  prechat_enabled: boolean
  prechat_greeting: string
  require_identity: boolean
  require_phone: boolean
  require_question: boolean
  offline_enabled: boolean
  offline_greeting: string
  offline_require_phone: boolean
  messenger_enabled: boolean
  messenger_id: string
}

export type PreviewState = 'chat' | 'prechat' | 'offline' | 'badge'

/** Readable text color for a background (WCAG-ish luminance). */
export function contrastOn(hex: string) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#1f2933' : '#ffffff'
}

const Field = ({ label, ph }: { label: string; ph?: string }) => (
  <div className="mb-2">
    <div className="mb-0.5 text-[11px] font-bold text-fg">{label}</div>
    <div className="h-7 rounded-sm border border-border-strong bg-surface px-2 text-[11px] leading-7 text-fg-secondary">{ph}</div>
  </div>
)

/** Live preview of the visitor widget, driven by the (unsaved) form values. Rendered with our own markup. */
export function WidgetPreview({ appearance: a, forms: f, state, onState }: { appearance: WidgetAppearance; forms: WidgetForms; state: PreviewState; onState?: (s: PreviewState) => void }) {
  const [mobile, setMobile] = useState(false)
  const ink = contrastOn(a.theme_color)
  const badgeBg = a.badge_bg_same_as_theme ? a.theme_color : a.badge_bg_color
  const badgeInk = contrastOn(badgeBg)
  const right = a.position === 'br'

  const header = (sub: string) => (
    <>
      <div className="flex items-center justify-between px-3 py-2.5 text-sm font-bold" style={{ background: a.theme_color, color: ink }}>
        <span className="flex-1 text-center">{a.title || 'Chat with us'}</span>
        <ArrowUpRight size={14} aria-hidden />
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {a.show_avatars && (
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-xs font-bold">
            {a.concierge_avatar ? <img src={a.concierge_avatar} alt="" className="h-full w-full object-cover" /> : (a.concierge_name || 'L')[0]}
          </span>
        )}
        <div>
          <div className="text-xs font-bold">{a.concierge_name}</div>
          <div className="text-[11px] text-fg-secondary">{sub}</div>
        </div>
      </div>
    </>
  )

  return (
    <aside aria-label="Widget preview" className="w-[360px] shrink-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="inline-block border-b-2 border-primary pb-1 text-md font-bold">Preview</h2>
        <Select aria-label="Preview state" className="w-[190px]" value={state} onChange={(e) => onState?.(e.target.value as PreviewState)} options={[{ value: 'chat', label: 'Online: Chat window' }, { value: 'prechat', label: 'Online: Pre-chat form' }, { value: 'offline', label: 'Offline: Offline form' }, { value: 'badge', label: 'Chat badge' }]} />
      </div>
      <p className="mb-3 text-xs text-fg-secondary">
        This is how your widget will look in a {mobile ? 'mobile' : 'desktop'} browser.{' '}
        <button type="button" className="text-primary hover:underline" onClick={() => setMobile(!mobile)}>
          {mobile ? 'Switch to desktop' : 'Find out what it will look like in a mobile browser.'}
        </button>
      </p>
      <div className={cn('flex rounded-md bg-surface-muted p-4', right ? 'justify-end' : 'justify-start')} style={{ minHeight: 440 }}>
        {state === 'badge' ? (
          <div className="self-end">
            {a.badge_enabled ? (
              <div className={cn('inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold shadow-popover', a.badge_layout === 'image_left' ? 'flex-row' : 'flex-row-reverse')} style={{ background: badgeBg, color: badgeInk }}>
                {a.badge_layout === 'custom_image' && a.badge_image ? <img src={a.badge_image} alt={a.badge_text} className="h-10 max-w-[160px] rounded-sm object-cover" /> : <>
                  {a.badge_layout !== 'text_only' && <span aria-hidden>💬</span>}
                  <span>{a.badge_text}</span>
                </>}
              </div>
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full text-lg shadow-popover" style={{ background: a.theme_color, color: ink }} aria-label="Launcher">💬</div>
            )}
          </div>
        ) : (
          <div className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-popover', mobile ? 'w-[190px]' : 'w-full')}>
            {header(state === 'offline' ? 'We are offline' : "We're Online")}
            {state === 'chat' && (
              <div className="flex-1 space-y-2 bg-surface-subtle p-3 text-[11px]">
                <div className="text-center text-fg-secondary">Chat started</div>
                <div className="ml-auto max-w-[75%] rounded-lg rounded-br-sm px-2.5 py-1.5" style={{ background: a.theme_color, color: ink }}>Hi there, I'm looking for green and pink shirts.</div>
                <div className="text-center text-fg-secondary">Jordan joined the chat</div>
                {a.show_avatars && <div className="text-fg-secondary">Jordan</div>}
                <div className="max-w-[75%] rounded-lg rounded-bl-sm border border-border bg-surface px-2.5 py-1.5">Hi! Welcome to our store!</div>
                <div className="max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-surface px-2.5 py-1.5">We have green shirts in all sizes. Unfortunately, we're out of pink shirts at the moment.</div>
              </div>
            )}
            {state === 'prechat' && (
              <div className="flex-1 p-3">
                <p className="mb-3 text-[11px] text-fg-secondary">{f.prechat_enabled ? f.prechat_greeting || 'Tell us a little about yourself so we can help.' : 'The pre-chat form is turned off: visitors go straight to the chat.'}</p>
                {f.prechat_enabled && <>
                  <Field label={`Name${f.require_identity ? ' *' : ''}`} />
                  <Field label={`Email${f.require_identity ? ' *' : ''}`} />
                  {f.visitor_profile_enabled && f.allow_phone && <Field label={`Phone${f.require_phone ? ' *' : ''}`} />}
                  <Field label={`Message${f.require_question ? ' *' : ''}`} ph="How can we help?" />
                  <div className="rounded-sm py-1.5 text-center text-[11px] font-bold" style={{ background: a.theme_color, color: ink }}>Start chat</div>
                </>}
              </div>
            )}
            {state === 'offline' && (
              <div className="flex-1 p-3">
                <p className="mb-3 text-[11px] text-fg-secondary">{f.offline_enabled ? f.offline_greeting : 'The offline form is turned off: visitors only see that you are offline.'}</p>
                {f.offline_enabled && <>
                  <Field label="Name *" />
                  <Field label="Email *" />
                  {f.offline_require_phone && <Field label="Phone *" />}
                  <Field label="Message *" />
                  <div className="rounded-sm py-1.5 text-center text-[11px] font-bold" style={{ background: a.theme_color, color: ink }}>Send message</div>
                  {f.messenger_enabled && f.messenger_id && <p className="mt-2 text-center text-[11px] text-primary">Message us on Messenger</p>}
                </>}
              </div>
            )}
            {state === 'chat' && (
              <div className="border-t border-border p-2">
                <div className="mb-1 h-12 rounded-sm border border-border px-2 py-1 text-[11px] text-fg-secondary">Type a message here…</div>
                <div className="flex items-center gap-3 text-fg-secondary">
                  <span className="text-[10px] font-bold">Powered by Parley</span>
                  <span className="flex-1" />
                  <LogOut size={12} aria-hidden />
                  <Paperclip size={12} aria-hidden />
                  <MoreHorizontal size={12} aria-hidden />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
