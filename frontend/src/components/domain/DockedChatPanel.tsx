import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronsDown, ChevronsUp, MessageSquare } from 'lucide-react'
import { Avatar, Badge, Button, toast } from '@/components/ui'
import { chatApi } from '@/features/chat'
import { useOpenChats } from '@/features/chat'
import { apiError } from '@/services/api'
import { useAuth } from '@/stores/auth'

/**
 * Labs › "Docked chat panel": attaches the chat queue to the right edge of every screen so agents
 * can accept and jump into chats without leaving the page they are on.
 */
export function DockedChatPanel() {
  const docked = useAuth((s) => !!s.me?.preferences.docked_chat_panel)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { incoming, mine } = useOpenChats()
  const [open, setOpen] = useState(true)
  if (!docked || pathname.startsWith('/chats')) return null
  const count = incoming.length + mine.length
  return (
    <aside aria-label="Docked chats" className="fixed bottom-0 right-6 z-[var(--z-sticky)] w-[280px] rounded-t-md border border-b-0 border-border bg-surface shadow-popover">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-10 w-full items-center gap-2 rounded-t-md bg-primary px-3 text-left text-sm font-bold text-white">
        <MessageSquare size={14} /> Chats <Badge tone="warning">{count}</Badge>
        <span className="flex-1" />
        {open ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
      </button>
      {open && (
        <ul className="max-h-[320px] overflow-y-auto">
          {count === 0 && <li className="px-3 py-4 text-sm text-fg-secondary">No open chats</li>}
          {incoming.map((c) => (
            <li key={c.id} className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Avatar name={c.visitor_name ?? 'Visitor'} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{c.visitor_name}</span>
                <span className="block truncate text-xs text-fg-secondary">{c.preview}</span>
              </span>
              <Button size="sm" variant="primary" onClick={() => chatApi.accept(c.id).then(() => navigate(`/chats/${c.id}`), (e) => toast.error(apiError(e).message))}>
                Accept
              </Button>
            </li>
          ))}
          {mine.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => navigate(`/chats/${c.id}`)} className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left hover:bg-surface-hover">
                <Avatar name={c.visitor_name ?? 'Visitor'} size={24} status="online" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{c.visitor_name}</span>
                  <span className="block truncate text-xs text-fg-secondary">{c.preview}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
