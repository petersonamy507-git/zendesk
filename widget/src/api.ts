export interface WidgetConfig {
  account_name: string
  appearance: { title: string; theme_color: string; position: 'bl' | 'br'; badge_enabled: boolean; badge_layout: 'image_right' | 'image_left' | 'text_only' | 'custom_image'; badge_text: string; badge_bg_same_as_theme: boolean; badge_bg_color: string; badge_image: string | null; concierge_name: string; concierge_byline: string; concierge_avatar: string | null; show_avatars: boolean }
  forms: { visitor_profile_enabled: boolean; offline_require_phone: boolean; messenger_enabled: boolean; messenger_id: string; allow_phone: boolean; prechat_enabled: boolean; prechat_greeting: string; require_identity: boolean; require_phone: boolean; require_question: boolean; department_select: boolean; offline_enabled: boolean; offline_greeting: string }
  settings: { sounds: boolean; ratings_enabled: boolean }
  file_sending: boolean
  online: boolean
  departments: { id: string; name: string; online: boolean }[]
}

export interface Msg {
  id: string
  seq: number
  client_id: string | null
  sender_type: 'visitor' | 'agent' | 'system' | 'trigger'
  sender_name: string | null
  kind: string
  body: string | null
  options: string[] | null
  attachment_id: string | null
  created_at: string
  pending?: boolean
  failed?: boolean
}

export interface WChat {
  id: string
  state: string
  rating: string | null
  agent: { name: string; avatar_url: string | null; tagline: string | null } | null
  messages: Msg[]
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

export class Api {
  token = ''
  constructor(private base: string, private workspace: string) {}

  private async req<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) headers['X-Visitor-Token'] = this.token
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const r = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new ApiError(data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong', r.status)
    return data as T
  }

  session(body: Record<string, unknown>) {
    return this.req<{ visitor_token: string; visitor: { id: string; key: string; name: string | null; email: string | null; phone: string | null }; config: WidgetConfig; chat: WChat | null }>('POST', `/widget/${this.workspace}/session`, body)
  }
  heartbeat(url: string, title: string) {
    return this.req('POST', '/widget/heartbeat', { url, title })
  }
  requestChat(body: Record<string, unknown>) {
    return this.req<WChat>('POST', '/widget/chats', body)
  }
  offline(body: Record<string, unknown>) {
    return this.req('POST', '/widget/offline-message', body)
  }
  send(chatId: string, body: { body?: string; attachment_id?: string; client_id: string }) {
    return this.req<Msg>('POST', `/widget/chats/${chatId}/messages`, body)
  }
  chat(chatId: string) {
    return this.req<WChat>('GET', `/widget/chats/${chatId}`)
  }
  after(chatId: string, seq: number) {
    return this.req<Msg[]>('GET', `/widget/chats/${chatId}/messages?after_seq=${seq}`)
  }
  rate(chatId: string, rating: 'good' | 'bad' | null, comment?: string) {
    return this.req('POST', `/widget/chats/${chatId}/rating`, { rating, comment })
  }
  end(chatId: string) {
    return this.req('POST', `/widget/chats/${chatId}/end`)
  }
  async upload(file: File): Promise<{ id: string }> {
    const fd = new FormData()
    fd.append('file', file)
    return this.req('POST', '/files', undefined, fd)
  }
  fileUrl(id: string) {
    return `${this.base}/api/v1/files/${id}?token=${encodeURIComponent(this.token)}`
  }
  wsUrl() {
    const u = new URL(this.base)
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/api/v1/widget/ws?token=${encodeURIComponent(this.token)}`
  }
}
