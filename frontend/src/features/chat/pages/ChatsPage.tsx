import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict, parseISO } from 'date-fns'
import { ArrowRightLeft, MessageSquare, Tag as TagIcon, X } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Avatar, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Modal, MultiSelect, Select, Spinner, toast } from '@/components/ui'
import { ChatConversation } from '@/components/domain/ChatConversation'
import { ChatMessageComposer } from '@/components/domain/ChatMessageComposer'
import { VisitorDetails } from '@/components/domain/VisitorDetails'
import { useAuth } from '@/stores/auth'
import { api, apiError } from '@/services/api'
import { cn } from '@/utils/cn'
import type { Agent, Chat, Department, Shortcut } from '@/types'
import { useOpenChats } from '../hooks/useOpenChats'
import { useChatSession } from '../hooks/useChatSession'
import { chatApi, chatKeys } from '../services/chatApi'

function QueueItem({ c, active, onClick }: { c: Chat; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={active || undefined} className={cn('flex w-full gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-surface-hover', active && 'bg-surface-muted')}>
      <Avatar name={c.visitor_name ?? 'Visitor'} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate text-sm font-bold">{c.visitor_name}</span>
          {c.unread && c.state === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unread" />}
          <span className="ml-auto shrink-0 text-xs text-fg-secondary">{formatDistanceToNowStrict(parseISO(c.started_at))}</span>
        </span>
        <span className="block truncate text-xs text-fg-secondary">{c.preview ?? c.question ?? '…'}</span>
      </span>
    </button>
  )
}

function TransferDialog({ chat, open, onClose }: { chat: Chat; open: boolean; onClose: () => void }) {
  const me = useAuth((s) => s.me)!
  const agents = useQuery({ queryKey: ['agents', 'transfer'], queryFn: () => api.get<{ items: Agent[] }>('/agents'), enabled: open })
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments'), enabled: open })
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const options = [
    ...(agents.data?.items ?? []).filter((a) => a.id !== me.user.id && a.enabled).map((a) => ({ value: `u:${a.id}`, label: `${a.display_name || a.name} (${a.presence})`, disabled: a.presence !== 'online' })),
    ...(depts.data?.items ?? []).filter((d) => d.enabled).map((d) => ({ value: `d:${d.id}`, label: `Department: ${d.name}` })),
  ]
  const submit = async () => {
    setBusy(true)
    try {
      const [k, id] = target.split(':')
      await chatApi.transfer(chat.id, k === 'u' ? { to_user_id: id } : { to_department_id: id })
      toast.success('Chat transferred')
      qc.invalidateQueries({ queryKey: chatKeys.open })
      onClose()
    } catch (e) {
      toast.error(apiError(e).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Transfer chat" size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!target} loading={busy} onClick={submit}>Transfer</Button></>}>
      <p className="mb-2 text-fg-secondary">Only online agents can receive a transfer. Transferring to a department puts the chat back in that department's queue.</p>
      <Select aria-label="Transfer to" options={options} placeholder="Choose agent or department" value={target} onChange={(e) => setTarget(e.target.value)} />
    </Modal>
  )
}

function ChatPanel({ chatId }: { chatId: string }) {
  const me = useAuth((s) => s.me)!
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { chat, messages, typing, send, sendTyping, isLoading, error, refetch } = useChatSession(chatId, me.user)
  const shortcuts = useQuery({ queryKey: ['shortcuts', 'composer'], queryFn: () => api.get<{ items: Shortcut[] }>('/shortcuts') })
  const tags = useQuery({ queryKey: ['chat-tags'], queryFn: chatApi.tags })
  const [transfer, setTransfer] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (chat?.unread && chat.state !== 'incoming') void chatApi.markRead([chat.id]).then(() => qc.invalidateQueries({ queryKey: chatKeys.open }))
  }, [chat?.id, chat?.unread, chat?.state, qc])

  if (isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  if (error || !chat) return <ErrorState error={error ? apiError(error).message : 'Chat not found'} onRetry={() => refetch()} />

  const mineActive = chat.state === 'active' && (chat.assignee_id === me.user.id || chat.participant_ids.includes(me.user.id))
  const accept = async () => {
    setBusy(true)
    try {
      await chatApi.accept(chat.id)
      qc.invalidateQueries({ queryKey: chatKeys.open })
      refetch()
    } catch (e) {
      toast.error(apiError(e).message)
    } finally {
      setBusy(false)
    }
  }
  const end = async () => {
    try {
      await chatApi.end(chat.id)
      setConfirmEnd(false)
      qc.invalidateQueries({ queryKey: chatKeys.open })
      navigate('/chats')
      toast.success('Chat ended — transcript saved to History')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  const setTags = async (t: string[]) => {
    try {
      await chatApi.patch(chat.id, { tags: t })
      refetch()
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col" aria-label={`Chat with ${chat.visitor_name}`}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-md font-bold">{chat.visitor_name}</div>
            <div className="text-xs text-fg-secondary">
              {chat.state === 'incoming' ? 'Waiting for an agent' : chat.state === 'active' ? 'Active chat' : `Ended · ${chat.outcome ?? ''}`}
            </div>
          </div>
          <div className="w-56">
            <MultiSelect label="Chat tags" creatable placeholder="Add tags" options={(tags.data ?? []).map((t) => ({ value: t, label: t }))} value={chat.tags} onChange={setTags} />
          </div>
          {chat.state === 'incoming' && (
            <Button variant="primary" loading={busy} onClick={accept} leftIcon={<MessageSquare size={12} />}>
              Accept chat
            </Button>
          )}
          {mineActive && (
            <>
              <Button onClick={() => setTransfer(true)} leftIcon={<ArrowRightLeft size={12} />}>
                Transfer
              </Button>
              <Button variant="danger" onClick={() => setConfirmEnd(true)} leftIcon={<X size={12} />}>
                End chat
              </Button>
            </>
          )}
        </div>
        <ChatConversation messages={messages} myId={me.user.id} typing={typing} />
        <ChatMessageComposer disabled={!mineActive} shortcuts={shortcuts.data?.items} onSubmit={send} onTyping={sendTyping} placeholders={{ 'visitor.name': chat.visitor_name ?? '', 'agent.name': me.user.display_name || me.user.name }} />
      </section>
      <aside className="w-[320px] shrink-0 overflow-y-auto border-l border-border" aria-label="Visitor details">
        <VisitorDetails visitorId={chat.visitor_id} onBanned={() => navigate('/chats')} />
      </aside>
      <TransferDialog chat={chat} open={transfer} onClose={() => setTransfer(false)} />
      <ConfirmDialog open={confirmEnd} title="End chat?" message="The visitor will be notified and the transcript saved to History." confirmLabel="End chat" danger onConfirm={end} onCancel={() => setConfirmEnd(false)} />
    </div>
  )
}

export function ChatsPage() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const { incoming, mine, chats, isLoading } = useOpenChats()
  const can = useAuth((s) => s.can)
  const others = useMemo(() => (can('chats.view_all') ? chats.filter((c) => c.state === 'active' && !mine.includes(c)) : []), [chats, mine, can])

  // Keyboard: Alt+1..9 switch chats, Alt+A accept oldest
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 9 && mine[n - 1]) navigate(`/chats/${mine[n - 1]!.id}`)
      if (e.key.toLowerCase() === 'a' && incoming[0]) {
        e.preventDefault()
        void chatApi.accept(incoming[0].id).then(() => navigate(`/chats/${incoming[0]!.id}`), (err) => toast.error(apiError(err).message))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mine, incoming, navigate])

  return (
    <Page title="Chats" padded={false}>
      <div className="flex h-full min-h-0">
        <nav aria-label="Chat queue" className="w-[260px] shrink-0 overflow-y-auto border-r border-border">
          <h2 className="flex items-center justify-between bg-surface-subtle px-3 py-2 text-xs font-bold text-fg-secondary">
            Incoming requests <Badge tone={incoming.length ? 'warning' : 'neutral'}>{incoming.length}</Badge>
          </h2>
          {incoming.map((c) => <QueueItem key={c.id} c={c} active={c.id === chatId} onClick={() => navigate(`/chats/${c.id}`)} />)}
          {!isLoading && incoming.length === 0 && <p className="px-3 py-3 text-sm text-fg-secondary">No one is waiting</p>}
          <h2 className="flex items-center justify-between bg-surface-subtle px-3 py-2 text-xs font-bold text-fg-secondary">
            My chats <Badge>{mine.length}</Badge>
          </h2>
          {mine.map((c, i) => (
            <div key={c.id} className="relative">
              <QueueItem c={c} active={c.id === chatId} onClick={() => navigate(`/chats/${c.id}`)} />
              {i < 9 && <kbd className="absolute bottom-1 right-2 text-[10px] text-fg-secondary">Alt+{i + 1}</kbd>}
            </div>
          ))}
          {others.length > 0 && (
            <>
              <h2 className="bg-surface-subtle px-3 py-2 text-xs font-bold text-fg-secondary">Other active chats</h2>
              {others.map((c) => <QueueItem key={c.id} c={c} active={c.id === chatId} onClick={() => navigate(`/chats/${c.id}`)} />)}
            </>
          )}
        </nav>
        {chatId ? (
          <ChatPanel key={chatId} chatId={chatId} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={<TagIcon size={24} />} title="Select a chat" description="Incoming requests appear on the left. Set your status to Online to receive chats." />
          </div>
        )}
      </div>
    </Page>
  )
}
