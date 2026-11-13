import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { chatApi, chatKeys } from '../services/chatApi'
import { useRealtimeEvent } from '@/hooks/useRealtime'
import { useAuth } from '@/stores/auth'
import type { Chat } from '@/types'
import { notifyIncoming } from '../utils/notify'

/** Live queue (incoming + active), kept fresh by realtime events. Used by sidebar, Chats page and Home. */
export function useOpenChats({ notify = false }: { notify?: boolean } = {}) {
  const qc = useQueryClient()
  const me = useAuth((s) => s.me)
  const known = useRef(new Set<string>())
  const q = useQuery({ queryKey: chatKeys.open, queryFn: chatApi.open, enabled: !!me, refetchInterval: 60000 })

  useRealtimeEvent(['chat.incoming', 'chat.offered', 'chat.accepted', 'chat.transferred', 'chat.ended', 'chat.updated', 'chat.assigned', 'resync'], (e) => {
    const c = e.data as Chat
    if (notify && (e.type === 'chat.incoming' || e.type === 'chat.offered' || e.type === 'chat.assigned') && c?.id && !known.current.has(c.id)) {
      const forMe = !c.assignee_id || c.assignee_id === me?.user.id
      if (forMe && me?.user.presence === 'online') notifyIncoming(c, me.preferences)
    }
    qc.invalidateQueries({ queryKey: chatKeys.open })
    if (c?.id) qc.invalidateQueries({ queryKey: chatKeys.detail(c.id) })
  })
  useRealtimeEvent('chat.activity', () => qc.invalidateQueries({ queryKey: chatKeys.open }))

  const chats = q.data ?? []
  chats.forEach((c) => known.current.add(c.id))
  const myId = me?.user.id
  const incoming = chats.filter((c) => c.state === 'incoming' && (!c.assignee_id || c.assignee_id === myId))
  const mine = chats.filter((c) => c.state === 'active' && (c.assignee_id === myId || c.participant_ids.includes(myId ?? '')))
  return { ...q, chats, incoming, mine }
}
