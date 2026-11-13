import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface TabItem<V extends string = string> {
  value: V
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<V extends string> {
  items: TabItem<V>[]
  value: V
  onChange: (v: V) => void
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Joined button group — used for List/Visual, Hourly/Daily/..., settings sub-tabs, Transcript/User info.
 * Implements WAI-ARIA tabs keyboard behaviour (arrow keys).
 */
export function SegmentedControl<V extends string>({ items, value, onChange, label, size = 'md', className }: SegmentedControlProps<V>) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const enabled = items.filter((i) => !i.disabled)
    const idx = enabled.findIndex((i) => i.value === value)
    const next = enabled[(idx + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    if (next) {
      onChange(next.value)
      ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
    }
  }
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className={cn('inline-flex overflow-hidden rounded-sm border border-border', className)}>
      {items.map((it, i) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            data-value={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            className={cn(
              'font-bold text-fg transition-colors disabled:opacity-50',
              size === 'sm' ? 'h-[26px] px-2.5 text-xs' : 'h-[30px] px-3 text-xs',
              active ? 'bg-surface-muted' : 'bg-surface hover:bg-surface-hover',
              i > 0 && 'border-l border-border',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/** Underlined tabs for page-level sections. */
export function Tabs<V extends string>({ items, value, onChange, label }: Omit<SegmentedControlProps<V>, 'size' | 'className'>) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-5 border-b border-border">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={it.value === value}
          disabled={it.disabled}
          onClick={() => onChange(it.value)}
          className={cn('-mb-px border-b-2 py-2 text-md transition-colors', it.value === value ? 'border-primary text-fg font-bold' : 'border-transparent text-fg-secondary hover:text-fg')}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Accordion({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-2.5 text-left text-md font-bold text-fg">
        {title}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}
