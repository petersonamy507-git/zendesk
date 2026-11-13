import { Api, ApiError, type Msg, type WChat, type WidgetConfig } from './api'
import { css } from './styles'

/** v4 id that also works on plain-HTTP pages, where crypto.randomUUID is unavailable (non-secure contexts). */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

/**
 * Parley visitor widget. Embeds with one <script> tag:
 *   <script src="/widget/parley-widget.js" data-workspace="acme" data-api="https://api.example.com" async></script>
 * Runs in a Shadow DOM so host-page CSS can't leak in or out.
 */
const script = document.currentScript as HTMLScriptElement | null
const workspace = script?.dataset.workspace ?? new URLSearchParams(location.search).get('ws') ?? ''
const apiBase = (script?.dataset.api ?? (script ? new URL(script.src).origin : location.origin)).replace(/\/$/, '')

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string | null | false)[]) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const k of kids) if (k) el.append(k)
  return el
}

const store = {
  get: (k: string) => { try { return localStorage.getItem(`parley:${workspace}:${k}`) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(`parley:${workspace}:${k}`, v) } catch { /* private mode */ } },
}

class Widget {
  api = new Api(apiBase, workspace)
  cfg!: WidgetConfig
  chat: WChat | null = null
  msgs: Msg[] = []
  ws: WebSocket | null = null
  poll: ReturnType<typeof setInterval> | null = null
  typingTimer: ReturnType<typeof setTimeout> | null = null
  open = false
  unread = 0
  view: 'start' | 'chat' | 'offline' | 'rate' | 'sent' = 'start'
  root = h('div', { class: 'root' })
  panel = h('section', { class: 'panel', role: 'dialog', 'aria-label': 'Chat' })
  launcher!: HTMLButtonElement
  badge = h('span', { class: 'badge', 'aria-live': 'polite' })
  body!: HTMLElement
  typingEl: HTMLElement | null = null
  host = document.createElement('div')

  async init() {
    if (!workspace) return console.warn('[parley] missing data-workspace')
    let s
    try {
      s = await this.api.session({ visitor_key: store.get('vk'), url: location.href, title: document.title, referrer: document.referrer, ...this.authFromWindow() })
    } catch (e) {
      if (e instanceof ApiError && ['banned', 'country_blocked', 'domain_not_allowed'].includes(e.code)) return // stay hidden
      return console.warn('[parley] unavailable', e)
    }
    this.api.token = s.visitor_token
    store.set('vk', s.visitor.key)
    this.cfg = s.config
    this.profile = { name: s.visitor.name ?? '', email: s.visitor.email ?? '', phone: s.visitor.phone ?? '' }
    const shadow = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    const ap = this.cfg.appearance
    style.textContent = css(ap.theme_color, ap.position === 'bl', ap.badge_enabled ? (ap.badge_bg_same_as_theme ? ap.theme_color : ap.badge_bg_color) : ap.theme_color)
    shadow.append(style, this.root)
    document.body.append(this.host)
    this.buildLauncher()
    this.root.append(this.panel)
    if (s.chat && ['incoming', 'active', 'proactive'].includes(s.chat.state)) this.attach(s.chat)
    window.addEventListener('keydown', (e) => e.key === 'Escape' && this.open && this.toggle(false))
    setInterval(() => this.api.heartbeat(location.href, document.title).catch(() => undefined), 30000)
    let last = location.href
    setInterval(() => { if (location.href !== last) { last = location.href; this.api.heartbeat(last, document.title).catch(() => undefined) } }, 1500)
    ;(window as any).Parley = { open: () => this.toggle(true), close: () => this.toggle(false), identify: (p: any) => Object.assign(this.profile, p) }
    this.render()
  }
  profile = { name: '', email: '', phone: '' }

  authFromWindow() {
    const a = (window as any).ParleyAuth
    return a ? { auth_external_id: a.externalId, auth_email: a.email, auth_name: a.name, auth_signature: a.signature } : {}
  }

  buildLauncher() {
    const a = this.cfg.appearance
    const icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>'
    const custom = a.badge_enabled && a.badge_layout === 'custom_image' && !!a.badge_image
    const textOnly = a.badge_enabled && a.badge_layout === 'text_only'
    this.launcher = h('button', { class: `launcher${custom ? ' img' : a.badge_enabled ? '' : ' round'}`, 'aria-label': a.badge_enabled ? a.badge_text || 'Open chat' : 'Open chat', 'aria-expanded': 'false', onClick: () => this.toggle() }) as HTMLButtonElement
    if (custom) this.launcher.append(h('img', { src: a.badge_image!, alt: a.badge_text || 'Chat' }))
    else {
      if (!textOnly) this.launcher.insertAdjacentHTML('beforeend', icon)
      if (a.badge_enabled) this.launcher.append(h('span', {}, a.badge_text))
      if (a.badge_enabled && a.badge_layout === 'image_right') this.launcher.style.flexDirection = 'row-reverse'
    }
    const wrap = h('div', { style: 'position:relative;display:flex;justify-content:' + (a.position === 'bl' ? 'flex-start' : 'flex-end') }, this.launcher, this.badge)
    this.root.append(wrap)
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open
    this.panel.classList.toggle('open', this.open)
    this.launcher.setAttribute('aria-expanded', String(this.open))
    if (this.open) {
      this.unread = 0
      this.updateBadge()
      setTimeout(() => (this.panel.querySelector('textarea,input') as HTMLElement | null)?.focus(), 50)
      this.scroll()
    }
  }

  updateBadge() {
    this.badge.textContent = String(this.unread)
    this.badge.classList.toggle('on', this.unread > 0)
  }

  header(title: string, sub?: string, agentAvatar?: string | null) {
    const a = this.cfg.appearance
    const name = this.chat?.agent?.name ?? a.concierge_name
    const av = h('div', { class: 'av', 'aria-hidden': 'true' })
    const src = agentAvatar ?? a.concierge_avatar
    if (a.show_avatars) src ? av.append(h('img', { src: src.startsWith('/') ? apiBase + src : src, alt: '' })) : (av.textContent = name.slice(0, 1).toUpperCase())
    return h('header', {}, a.show_avatars ? av : null, h('div', { class: 't' }, h('b', {}, title), h('span', {}, sub ?? '')), h('button', { 'aria-label': 'Minimize chat', onClick: () => this.toggle(false) }, '–'))
  }

  render() {
    this.panel.replaceChildren()
    const a = this.cfg.appearance
    if (this.view === 'chat' && this.chat) return this.renderChat()
    if (this.view === 'rate') return this.renderRate()
    if (this.view === 'sent') {
      this.panel.append(this.header(a.title), h('div', { class: 'pad center' }, h('p', {}, 'Thanks! We received your message and will reply by email soon.'), h('button', { class: 'btn', onClick: () => { this.view = 'start'; this.render() } }, 'Back')))
      return
    }
    const online = this.cfg.online
    if (!online && this.cfg.forms.offline_enabled) this.view = 'offline'
    if (!online && !this.cfg.forms.offline_enabled) {
      this.panel.append(this.header(a.title, 'Offline'), h('div', { class: 'pad center' }, h('p', {}, 'Our team is offline right now. Please check back later.')))
      return
    }
    this.view === 'offline' ? this.renderOffline() : this.renderStart()
  }

  field(label: string, el: HTMLElement) {
    return h('label', {}, label, el)
  }

  renderStart() {
    const f = this.cfg.forms, a = this.cfg.appearance
    const err = h('div', { class: 'err', role: 'alert' })
    const name = h('input', { name: 'name', autocomplete: 'name', value: this.profile.name, required: f.require_identity }) as HTMLInputElement
    const email = h('input', { name: 'email', type: 'email', autocomplete: 'email', value: this.profile.email, required: f.require_identity }) as HTMLInputElement
    const phone = h('input', { name: 'phone', type: 'tel', value: this.profile.phone, required: f.require_phone }) as HTMLInputElement
    const dept = h('select', { name: 'dept' }, h('option', { value: '' }, 'Any department'), ...this.cfg.departments.map((d) => h('option', { value: d.id }, d.name + (d.online ? '' : ' (offline)')))) as HTMLSelectElement
    const msg = h('textarea', { name: 'message', placeholder: 'How can we help?', required: f.require_question }) as HTMLTextAreaElement
    const go = h('button', { class: 'btn', type: 'submit' }, 'Start chat') as HTMLButtonElement
    const form = h('form', { class: 'f', novalidate: true }, f.prechat_greeting ? h('p', { class: 'hint' }, f.prechat_greeting) : null)
    if (f.prechat_enabled) {
      if (f.prechat_greeting) form.append(h('p', { class: 'hint' }, ''))
      form.append(this.field('Name', name), this.field('Email', email))
      if (f.visitor_profile_enabled && f.allow_phone) form.append(this.field('Phone', phone))
      if (f.department_select && this.cfg.departments.length > 0) form.append(this.field('Department', dept))
    }
    form.append(this.field('Message', msg), err, go)
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      err.textContent = ''
      if (f.prechat_enabled) {
        if (f.require_identity && (!name.value.trim() || !/^\S+@\S+\.\S+$/.test(email.value))) return void (err.textContent = 'Please enter your name and a valid email.')
        if (f.visitor_profile_enabled && f.allow_phone && f.require_phone && !phone.value.trim()) return void (err.textContent = 'Please enter your phone number.')
        if (f.require_question && !msg.value.trim()) return void (err.textContent = 'Please tell us how we can help.')
      } else if (!msg.value.trim()) return void (err.textContent = 'Please type a message.')
      go.disabled = true
      try {
        const c = await this.api.requestChat({ name: name.value || undefined, email: email.value || undefined, phone: phone.value || undefined, department_id: dept.value || undefined, message: msg.value })
        this.attach(c)
      } catch (e2) {
        err.textContent = e2 instanceof ApiError ? e2.message : 'Could not start the chat. Please try again.'
        go.disabled = false
      }
    })
    this.panel.append(this.header(a.title, 'We typically reply in a few minutes'), form)
  }

  renderOffline() {
    const a = this.cfg.appearance
    const err = h('div', { class: 'err', role: 'alert' })
    const name = h('input', { name: 'name', autocomplete: 'name', value: this.profile.name }) as HTMLInputElement
    const email = h('input', { name: 'email', type: 'email', autocomplete: 'email', value: this.profile.email }) as HTMLInputElement
    const msg = h('textarea', { name: 'message' }) as HTMLTextAreaElement
    const phone = h('input', { name: 'phone', type: 'tel', autocomplete: 'tel' }) as HTMLInputElement
    const f = this.cfg.forms
    const go = h('button', { class: 'btn', type: 'submit' }, 'Send message') as HTMLButtonElement
    const messenger = f.messenger_enabled && f.messenger_id ? h('a', { class: 'link', href: `https://m.me/${encodeURIComponent(f.messenger_id)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Or message us on Messenger') : null
    const form = h('form', { class: 'f', novalidate: true }, h('p', { class: 'hint' }, f.offline_greeting), this.field('Name', name), this.field('Email', email), f.offline_require_phone ? this.field('Phone', phone) : null, this.field('Message', msg), err, go, messenger)
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (!name.value.trim() || !/^\S+@\S+\.\S+$/.test(email.value) || !msg.value.trim()) return void (err.textContent = 'Please fill in all fields with a valid email.')
      if (f.offline_require_phone && !phone.value.trim()) return void (err.textContent = 'Please enter your phone number.')
      go.disabled = true
      try {
        await this.api.offline({ name: name.value, email: email.value, phone: phone.value || undefined, message: msg.value })
        this.view = 'sent'
        this.render()
      } catch (e2) {
        err.textContent = e2 instanceof ApiError ? e2.message : 'Could not send. Please try again.'
        go.disabled = false
      }
    })
    this.panel.append(this.header(a.title, 'We are offline'), form)
  }

  // ---------------------------------------------------------------- chat
  attach(c: WChat) {
    this.chat = c
    this.msgs = c.messages
    this.view = 'chat'
    this.connect()
    this.render()
  }

  renderChat() {
    const c = this.chat!
    const a = this.cfg.appearance
    this.body = h('div', { class: 'body', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' })
    const ta = h('textarea', { rows: 1, placeholder: 'Type a message…', 'aria-label': 'Message' }) as HTMLTextAreaElement
    const file = h('input', { type: 'file', hidden: true }) as HTMLInputElement
    const send = () => {
      const t = ta.value.trim()
      if (!t) return
      ta.value = ''
      void this.send({ body: t })
    }
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
    ta.addEventListener('input', () => this.typing(ta.value))
    file.addEventListener('change', async () => {
      const f = file.files?.[0]
      if (!f) return
      try { const up = await this.api.upload(f); await this.send({ body: f.name, attachment_id: up.id }) } catch (e) { this.notice(e instanceof ApiError ? e.message : 'Upload failed') }
      file.value = ''
    })
    const bar = h('div', { class: 'composer' }, this.cfg.file_sending ? h('button', { 'aria-label': 'Attach file', onClick: () => file.click() }, '📎') : null, file, ta, h('button', { class: 'send', onClick: send }, 'Send'))
    const ended = ['ended', 'missed'].includes(c.state)
    const sub = c.state === 'incoming' ? 'Waiting for an agent…' : c.agent ? (c.agent.tagline ?? 'Online') : a.concierge_byline
    this.panel.append(
      this.header(c.agent?.name ?? a.title, sub, c.agent?.avatar_url),
      this.body,
      ended ? h('div', { class: 'pad center' }, h('p', {}, 'This chat has ended.'), this.cfg.settings.ratings_enabled ? h('button', { class: 'btn', onClick: () => { this.view = 'rate'; this.render() } }, 'Rate this chat') : null, h('button', { class: 'btn ghost', onClick: () => { this.chat = null; this.msgs = []; this.view = 'start'; this.render() } }, 'Start a new chat')) : bar,
    )
    if (!ended) this.panel.append(h('div', { class: 'center hint', style: 'padding:0 0 6px;background:#fff' }, h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); void this.endChat() } }, 'End chat')))
    this.paint()
  }

  paint() {
    if (!this.body) return
    this.body.replaceChildren()
    for (const m of this.msgs) {
      if (m.kind === 'note') continue
      if (m.kind === 'event') { this.body.append(h('div', { class: 'ev' }, m.body ?? '')); continue }
      const mine = m.sender_type === 'visitor'
      const bubble = h('div', { class: `m ${mine ? 'v' : 'a'}${m.failed ? ' failed' : ''}` })
      if (!mine && this.cfg.appearance.show_avatars && m.sender_name) bubble.append(h('span', { class: 'n' }, m.sender_name))
      if (m.attachment_id) bubble.append(h('a', { href: this.api.fileUrl(m.attachment_id), target: '_blank', rel: 'noreferrer' }, `📎 ${m.body ?? 'Attachment'}`))
      else bubble.append(document.createTextNode(m.body ?? ''))
      if (m.options?.length && !mine) bubble.append(h('div', { class: 'opts' }, ...m.options.map((o) => h('button', { onClick: () => void this.send({ body: o }) }, o))))
      bubble.append(h('span', { class: 'ts' }, m.failed ? 'Not sent — tap to retry' : m.pending ? 'Sending…' : new Date(m.created_at + (m.created_at.endsWith('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })))
      if (m.failed) bubble.addEventListener('click', () => void this.send({ body: m.body ?? '', retry: m }))
      this.body.append(bubble)
    }
    if (this.typingEl) this.body.append(this.typingEl)
    this.scroll()
  }

  scroll() {
    if (this.body) this.body.scrollTop = this.body.scrollHeight
  }

  notice(text: string) {
    this.msgs.push({ id: 'n' + Date.now(), seq: Number.MAX_SAFE_INTEGER, client_id: null, sender_type: 'system', sender_name: null, kind: 'event', body: text, options: null, attachment_id: null, created_at: new Date().toISOString() })
    this.paint()
  }

  async send(o: { body: string; attachment_id?: string; retry?: Msg }) {
    if (!this.chat) return
    const client_id = o.retry?.client_id ?? uuid()
    if (o.retry) this.msgs = this.msgs.filter((m) => m !== o.retry)
    const local: Msg = { id: client_id, seq: Number.MAX_SAFE_INTEGER, client_id, sender_type: 'visitor', sender_name: null, kind: o.attachment_id ? 'file' : 'text', body: o.body, options: null, attachment_id: o.attachment_id ?? null, created_at: new Date().toISOString(), pending: true }
    this.msgs.push(local)
    this.paint()
    try {
      const saved = await this.api.send(this.chat.id, { body: o.body, attachment_id: o.attachment_id, client_id })
      this.merge([saved])
    } catch (e) {
      local.pending = false
      local.failed = true
      if (e instanceof ApiError && e.code === 'chat_ended') { this.chat.state = 'ended'; this.render() } else this.paint()
    }
  }

  merge(incoming: Msg[]) {
    const byId = new Map<string, Msg>()
    for (const m of [...this.msgs.filter((x) => !(x.pending || x.failed) || !incoming.some((i) => i.client_id && i.client_id === x.client_id)), ...incoming]) byId.set(m.id, m)
    this.msgs = [...byId.values()].sort((a, b) => a.seq - b.seq)
    this.paint()
  }

  lastSeq() {
    return this.msgs.reduce((a, m) => (m.seq !== Number.MAX_SAFE_INTEGER ? Math.max(a, m.seq) : a), 0)
  }

  onMessage(m: Msg) {
    if (!this.chat) return
    const before = this.msgs.length
    if (m.seq > this.lastSeq() + 1) void this.api.after(this.chat.id, this.lastSeq()).then((more) => this.merge(more))
    this.merge([m])
    if (this.msgs.length > before && m.sender_type !== 'visitor' && m.kind !== 'event' && (!this.open || document.hidden)) {
      this.unread++
      this.updateBadge()
      if (this.cfg.settings.sounds) this.ding()
    }
    this.setTyping(false)
  }

  ding() {
    try {
      const ctx = new AudioContext(), o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = 740
      g.gain.setValueAtTime(0.08, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
      o.connect(g).connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 0.26)
    } catch { /* ignore */ }
  }

  setTyping(on: boolean) {
    this.typingEl?.remove()
    this.typingEl = on ? h('div', { class: 'typing' }, 'Agent is typing…') : null
    if (on && this.body) { this.body.append(this.typingEl!); this.scroll() }
  }

  typing(text: string) {
    if (!this.chat || this.ws?.readyState !== 1) return
    this.ws.send(JSON.stringify({ op: 'typing', chat_id: this.chat.id, typing: text.length > 0, text }))
  }

  async endChat() {
    if (!this.chat) return
    try { await this.api.end(this.chat.id) } catch { /* already ended */ }
    this.chat = await this.api.chat(this.chat.id).catch(() => this.chat)
    this.disconnect()
    this.render()
  }

  renderRate() {
    const c = this.chat!
    let rating: 'good' | 'bad' | null = c.rating as 'good' | 'bad' | null
    const comment = h('textarea', { placeholder: 'Any comments? (optional)', 'aria-label': 'Comment' }) as HTMLTextAreaElement
    const mk = (v: 'good' | 'bad', glyph: string, label: string) => {
      const b = h('button', { 'aria-label': label, 'aria-pressed': String(rating === v), onClick: () => { rating = v; this.panel.querySelectorAll('.rate button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))) } }, glyph)
      return b
    }
    this.panel.append(this.header('Rate this chat'), h('div', { class: 'pad' }, h('div', { class: 'rate' }, mk('good', '👍', 'Good'), mk('bad', '👎', 'Bad')), comment, h('button', { class: 'btn', onClick: async () => { if (!rating) return; await this.api.rate(c.id, rating, comment.value).catch(() => undefined); c.rating = rating; this.view = 'sent'; this.render() } }, 'Submit')))
  }

  // ---------------------------------------------------------------- realtime (WebSocket with polling fallback)
  connect() {
    this.disconnect()
    if (!this.chat) return
    const chatId = this.chat.id
    try {
      const ws = new WebSocket(this.api.wsUrl())
      this.ws = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ op: 'watch', chat_id: chatId }))
        void this.api.after(chatId, this.lastSeq()).then((m) => this.merge(m)).catch(() => undefined) // catch up after (re)connect
      }
      ws.onmessage = (ev) => {
        const e = JSON.parse(ev.data)
        if (e.type === 'chat.message') this.onMessage(e.data)
        else if (e.type === 'chat.typing') { this.setTyping(!!e.data.typing); this.typingTimer && clearTimeout(this.typingTimer); this.typingTimer = setTimeout(() => this.setTyping(false), 5000) }
        else if (['chat.accepted', 'chat.updated', 'chat.transferred', 'chat.ended'].includes(e.type)) void this.refresh()
      }
      ws.onclose = () => { if (this.ws === ws && this.chat && !['ended', 'missed'].includes(this.chat.state)) setTimeout(() => this.connect(), 2000) }
    } catch { /* fallback below */ }
    this.poll = setInterval(() => { if (this.ws?.readyState !== 1) void this.refresh() }, 4000)
  }

  async refresh() {
    if (!this.chat) return
    try {
      const fresh = await this.api.chat(this.chat.id)
      const stateChanged = fresh.state !== this.chat.state || fresh.agent?.name !== this.chat.agent?.name
      this.chat = fresh
      this.merge(fresh.messages)
      if (stateChanged && this.view === 'chat') { this.render(); if (['ended', 'missed'].includes(fresh.state)) this.disconnect() }
    } catch { /* transient */ }
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }
}

void new Widget().init()
