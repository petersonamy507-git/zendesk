import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatApi, chatKeys, type ChatWithMessages } from '../services/chatApi'
import { useRealtimeEvent, useTopic } from '@/hooks/useRealtime'
import { realtime } from '@/services/realtime'
import { api, apiError } from '@/services/api'
import { toast } from '@/components/ui'
import { uuid } from '@/utils/browser'
import type { ChatMessage, User } from '@/types'

/**
 * Everything a chat panel needs: messages (REST + realtime merge, ordered by seq, gap repair),
 * typing indicator, optimistic sends with idempotent client ids, and retry.
 */
export function useChatSession(chatId: string | null, me: User | undefined) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: chatKeys.detail(chatId ?? ''), queryFn: () => chatApi.get(chatId!), enabled: !!chatId })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typing, setTyping] = useState<string | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useTopic(chatId ? `chat:${chatId}` : null)

  useEffect(() => {
    if (q.data) setMessages((prev) => merge(q.data.messages, prev.filter((m) => m.pending || m.failed)))
  }, [q.data])
  useEffect(() => {
    setMessages([])
    setTyping(null)
  }, [chatId])

  const catchUp = useCallback(async () => {
    if (!chatId) return
    const last = messages.filter((m) => !m.pending && !m.failed).reduce((a, m) => Math.max(a, m.seq), 0)
    const more = await chatApi.messagesAfter(chatId, last)
    setMessages((prev) => merge(prev, more))
  }, [chatId, messages])

  useRealtimeEvent('chat.message', (e) => {
    const m = e.data as ChatMessage
    if (m.chat_id !== chatId) return
    setMessages((prev) => {
      const confirmedMax = prev.filter((x) => !x.pending).reduce((a, x) => Math.max(a, x.seq), 0)
      if (m.seq > confirmedMax + 1) void catchUp() // gap → fetch missing
      return merge(prev, [m])
    })
    if (m.sender_type === 'visitor') setTyping(null)
  })
  useRealtimeEvent('chat.typing', (e) => {
    const d = e.data as { chat_id: string; sender_type: string; sender_id: string; name?: string; typing: boolean; text?: string }
    if (d.chat_id !== chatId || d.sender_id === me?.id) return
    setTyping(d.typing ? `${d.sender_type === 'visitor' ? 'Visitor' : d.name ?? 'Agent'} is typing${d.text ? `: “${d.text}”` : ''}` : null)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => setTyping(null), 6000)
  })
  useRealtimeEvent('resync', () => {
    if (chatId) qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) })
  })

  const send = useCallback(
    async (input: { body: string; note: boolean; options?: string[]; tags?: string[]; file?: File }) => {
      if (!chatId || !me) return
      const client_id = uuid()
      const optimistic: ChatMessage = { id: client_id, chat_id: chatId, seq: Number.MAX_SAFE_INTEGER, client_id, sender_type: 'agent', sender_id: me.id, sender_name: me.display_name || me.name, kind: input.note ? 'note' : input.options ? 'options' : 'text', body: input.body || (input.file ? input.file.name : ''), options: input.options ?? null, attachment_id: null, created_at: new Date().toISOString(), delivered_at: null, read_at: null, pending: true }
      setMessages((prev) => [...prev, optimistic])
      const attempt = async () => {
        let attachment_id: string | undefined
        if (input.file) attachment_id = (await api.upload<{ id: string }>('/files', input.file)).id
        const saved = await chatApi.send(chatId, { body: input.body || undefined, kind: input.note ? 'note' : input.options ? 'options' : 'text', options: input.options, attachment_id, client_id })
        setMessages((prev) => merge(prev.filter((m) => m.client_id !== client_id), [saved]))
        if (input.tags?.length && q.data) await chatApi.patch(chatId, { tags: Array.from(new Set([...q.data.tags, ...input.tags])) })
      }
      try {
        await attempt()
      } catch (e) {
        setMessages((prev) => prev.map((m) => (m.client_id === client_id ? { ...m, pending: false, failed: true } : m)))
        toast.error(`Message not sent: ${apiError(e).message}`, { action: { label: 'Retry', onClick: () => void attempt().catch(() => undefined) } })
      }
    },
    [chatId, me, q.data],
  )

  const sendTyping = useCallback((t: boolean) => chatId && realtime.send({ op: 'typing', chat_id: chatId, typing: t }), [chatId])

  return { chat: q.data as ChatWithMessages | undefined, isLoading: q.isLoading, error: q.error, messages, typing, send, sendTyping, refetch: q.refetch }
}

function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>()
  for (const m of [...a, ...b]) {
    const key = m.client_id && !m.pending && !m.failed ? `c-${m.client_id}` : m.pending || m.failed ? `p-${m.client_id}` : m.id
    // a confirmed message replaces its pending twin
    if (m.client_id && !m.pending && !m.failed) byKey.delete(`p-${m.client_id}`)
    if (!(m.pending && byKey.has(`c-${m.client_id}`))) byKey.set(key, m)
  }
  return Array.from(byKey.values()).sort((x, y) => x.seq - y.seq)
}
