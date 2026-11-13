import { api, type Paged } from '@/services/api'
import type { Chat, ChatMessage, LiveVisitor, VisitorDetail } from '@/types'

export interface ChatWithMessages extends Chat {
  messages: ChatMessage[]
}

export interface HistoryFilters {
  q?: string
  scope?: 'all' | 'chat' | 'offline'
  unread?: boolean
  date_from?: string
  date_to?: string
  min_messages?: number
  served?: string[]
  rating?: string[]
  tags?: string[]
  triggered?: boolean
  initiated_by?: string
  visitor_name?: string
  page?: number
  per_page?: number
}

export const chatKeys = {
  open: ['chats', 'open'] as const,
  detail: (id: string) => ['chats', 'detail', id] as const,
  history: (f: HistoryFilters) => ['chats', 'history', f] as const,
  visitors: (groupBy: string, q: string) => ['visitors', groupBy, q] as const,
  visitor: (id: string) => ['visitor', id] as const,
}

export const chatApi = {
  open: () => api.get<Chat[]>('/chats'),
  get: (id: string) => api.get<ChatWithMessages>(`/chats/${id}`),
  messagesAfter: (id: string, seq: number) => api.get<ChatMessage[]>(`/chats/${id}/messages`, { after_seq: seq }),
  accept: (id: string) => api.post<Chat>(`/chats/${id}/accept`),
  send: (id: string, body: { body?: string; kind?: 'text' | 'note' | 'options'; options?: string[]; attachment_id?: string; client_id: string }) => api.post<ChatMessage>(`/chats/${id}/messages`, body),
  transfer: (id: string, body: { to_user_id?: string; to_department_id?: string; note?: string }) => api.post<Chat>(`/chats/${id}/transfer`, body),
  end: (id: string) => api.post<Chat>(`/chats/${id}/end`),
  patch: (id: string, body: { tags?: string[]; unread?: boolean }) => api.patch<Chat>(`/chats/${id}`, body),
  history: (f: HistoryFilters) => api.get<Paged<Chat> & { unread_count: number }>('/chats/history', f),
  bulkDelete: (ids: string[]) => api.post('/chats/bulk-delete', { ids }),
  markRead: (ids: string[]) => api.post('/chats/mark-read', { ids }),
  transcriptUrl: (id: string) => `/api/v1/chats/${id}/transcript`,
  visitors: (group_by: string, q: string) => api.get<{ items: LiveVisitor[]; total: number }>('/visitors', { group_by, q: q || undefined }),
  visitor: (id: string) => api.get<VisitorDetail>(`/visitors/${id}`),
  updateVisitor: (id: string, body: Partial<Pick<VisitorDetail, 'name' | 'email' | 'phone' | 'notes' | 'tags'>>) => api.patch<VisitorDetail>(`/visitors/${id}`, body),
  simulate: () => api.post<LiveVisitor>('/visitors/simulate'),
  startChat: (visitorId: string, message: string) => api.post<Chat>(`/visitors/${visitorId}/chat`, { message }),
  ban: (visitorId: string, reason?: string) => api.post(`/visitors/${visitorId}/ban`, { reason }),
  tags: () => api.get<string[]>('/chat-tags'),
}
