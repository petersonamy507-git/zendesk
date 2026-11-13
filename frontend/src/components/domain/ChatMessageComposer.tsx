import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Lock, Send, X } from 'lucide-react'
import { Button, FileUploader, toast } from '@/components/ui'
import { cn } from '@/utils/cn'
import type { Shortcut } from '@/types'

export interface ComposerSubmit {
  body: string
  note: boolean
  options?: string[]
  tags?: string[]
  file?: File
}

export interface ChatMessageComposerProps {
  onSubmit: (v: ComposerSubmit) => void
  onTyping?: (typing: boolean) => void
  shortcuts?: Shortcut[]
  disabled?: boolean
  allowNotes?: boolean
  placeholders?: Record<string, string>
}

function fill(text: string, ph: Record<string, string> = {}) {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => ph[k] ?? '')
}

/** Composer with `/shortcut` autocomplete, Enter-to-send, notes toggle and attachments. */
export function ChatMessageComposer({ onSubmit, onTyping, shortcuts = [], disabled, allowNotes = true, placeholders }: ChatMessageComposerProps) {
  const [text, setText] = useState('')
  const [note, setNote] = useState(false)
  const [pending, setPending] = useState<{ options?: string[]; tags?: string[] }>({})
  const [file, setFile] = useState<File | null>(null)
  const [active, setActive] = useState(0)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  const slash = /(?:^|\s)\/(\S*)$/.exec(text)
  const matches = useMemo(() => (slash ? shortcuts.filter((s) => s.name.toLowerCase().startsWith(slash[1]!.toLowerCase())).slice(0, 8) : []), [slash, shortcuts])

  const apply = (s: Shortcut) => {
    setText((t) => t.replace(/(?:^|\s)\/\S*$/, (m) => (m.startsWith(' ') ? ' ' : '') + fill(s.message, placeholders)))
    setPending({ options: s.options.length ? s.options : undefined, tags: s.tags.length ? s.tags : undefined })
    ta.current?.focus()
  }

  const submit = () => {
    const body = text.trim()
    if ((!body && !file) || disabled) return
    onSubmit({ body, note, file: file ?? undefined, ...pending })
    setText('')
    setPending({})
    setFile(null)
    onTyping?.(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setActive((a) => (a + 1) % matches.length)
      if (e.key === 'ArrowUp') return e.preventDefault(), setActive((a) => (a - 1 + matches.length) % matches.length)
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), apply(matches[active]!)
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const change = (v: string) => {
    setText(v)
    setActive(0)
    if (!onTyping) return
    onTyping(v.length > 0)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => onTyping(false), 3000)
  }

  return (
    <div className={cn('relative border-t border-border p-3', note && 'bg-warning-soft')}>
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Shortcuts" className="absolute bottom-full left-3 right-3 mb-1 max-h-60 overflow-auto rounded-md border border-border bg-surface shadow-popover">
          {matches.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => (e.preventDefault(), apply(s))} className={cn('flex w-full gap-3 px-3 py-1.5 text-left text-sm', i === active && 'bg-surface-hover')}>
                <span className="w-24 shrink-0 font-bold">/{s.name}</span>
                <span className="truncate text-fg-secondary">{s.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(pending.options || pending.tags || file) && (
        <div className="mb-2 flex flex-wrap gap-2 text-xs text-fg-secondary">
          {pending.options && <span>Options: {pending.options.join(' · ')}</span>}
          {pending.tags && <span>Will tag: {pending.tags.join(', ')}</span>}
          {file && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-surface-muted px-1.5 py-0.5 text-fg">
              {file.name}
              <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)}>
                <X size={10} />
              </button>
            </span>
          )}
        </div>
      )}
      <textarea
        ref={ta}
        value={text}
        disabled={disabled}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        aria-label={note ? 'Internal note' : 'Message'}
        placeholder={disabled ? 'This chat is not active' : note ? 'Write an internal note — only agents can see it' : 'Type a message… (type / for shortcuts)'}
        className="w-full resize-none rounded-sm border border-border bg-surface px-2 py-1.5 text-md focus:border-primary focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-1">
        <FileUploader variant="button" multiple={false} disabled={disabled} onFiles={(f) => setFile(f[0] ?? null)} onError={(m) => toast.error(m)} />
        {allowNotes && (
          <button type="button" aria-pressed={note} onClick={() => setNote(!note)} className={cn('inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold', note ? 'bg-warning text-white' : 'text-fg-secondary hover:bg-surface-hover')}>
            <Lock size={12} /> Note
          </button>
        )}
        <span className="flex-1" />
        <Button variant="primary" onClick={submit} disabled={disabled || (!text.trim() && !file)} leftIcon={<Send size={12} />}>
          Send
        </Button>
      </div>
    </div>
  )
}
