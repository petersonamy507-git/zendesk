import { useEffect, useRef } from 'react'
import { format, parseISO } from 'date-fns'
import { AlertCircle, Check, CheckCheck, FileText, Lock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { getAccessToken } from '@/services/api'
import type { ChatMessage as Msg } from '@/types'

function Attachment({ id }: { id: string }) {
  const src = `/api/v1/files/${id}?token=${encodeURIComponent(getAccessToken() ?? '')}`
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-sm text-primary">
      <FileText size={14} /> View attachment
    </a>
  )
}

/** One message row — the same component renders agent, visitor, trigger, note and system events. */
export function ChatMessage({ m, mine }: { m: Msg; mine: boolean }) {
  const time = format(parseISO(m.created_at), 'h:mm a')
  if (m.kind === 'event')
    return (
      <div className="flex items-center gap-3 py-1 text-xs italic text-fg-secondary">
        <span className="flex-1 border-t border-dashed border-border" />
        <span>{m.body}</span>
        <span className="flex-1 border-t border-dashed border-border" />
        <span className="not-italic">{time}</span>
      </div>
    )
  const note = m.kind === 'note'
  return (
    <div className={cn('group border-b border-border/60 py-2', note && 'rounded-sm bg-warning-soft px-2')}>
      <div className="flex items-baseline gap-2">
        <span className={cn('text-sm font-bold', m.sender_type === 'visitor' ? 'text-fg' : 'text-primary')}>{m.sender_name ?? (m.sender_type === 'trigger' ? 'Trigger' : 'Agent')}</span>
        {note && (
          <span className="inline-flex items-center gap-0.5 text-xs text-[#8a5d00]">
            <Lock size={10} /> Internal note
          </span>
        )}
        {m.sender_type === 'trigger' && <span className="text-xs text-fg-secondary">· automated</span>}
        <span className="ml-auto text-xs text-fg-secondary">{time}</span>
        {mine && (
          <span className="text-fg-secondary" aria-label={m.failed ? 'Failed to send' : m.pending ? 'Sending' : m.read_at ? 'Read' : 'Delivered'}>
            {m.failed ? <AlertCircle size={12} className="text-danger" /> : m.pending ? <Check size={12} className="opacity-50" /> : <CheckCheck size={12} />}
          </span>
        )}
      </div>
      {m.body && <p className="whitespace-pre-wrap break-words text-md text-fg">{m.body}</p>}
      {m.options && m.options.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {m.options.map((o) => (
            <li key={o} className="flex items-center gap-1.5 text-sm text-fg-secondary">
              <span className="h-2.5 w-2.5 rounded-full border border-border-strong" /> {o}
            </li>
          ))}
        </ul>
      )}
      {m.attachment_id && <Attachment id={m.attachment_id} />}
    </div>
  )
}

/** Scrolling transcript with auto-scroll to newest and a typing indicator. */
export function ChatConversation({ messages, myId, typing }: { messages: Msg[]; myId?: string; typing?: string | null }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, typing])
  return (
    <div className="flex-1 overflow-y-auto px-4 py-2" role="log" aria-live="polite" aria-label="Conversation">
      {messages.map((m) => (
        <ChatMessage key={m.client_id ? `c-${m.client_id}` : m.id} m={m} mine={m.sender_type === 'agent' && m.sender_id === myId} />
      ))}
      {typing && (
        <div className="py-2 text-xs italic text-fg-secondary" aria-live="polite">
          {typing}
          <span className="ml-1 inline-flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-fg-secondary" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-fg-secondary [animation-delay:120ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-fg-secondary [animation-delay:240ms]" />
          </span>
        </div>
      )}
      <div ref={end} />
    </div>
  )
}
