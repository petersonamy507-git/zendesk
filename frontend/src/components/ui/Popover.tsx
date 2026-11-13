import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { useDismiss } from '@/hooks/useDismiss'

export interface PopoverProps {
  /** Render prop for the trigger; spread `props` onto a button. */
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' | 'dialog' }, open: boolean) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  role?: 'menu' | 'dialog'
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Popover({ trigger, children, align = 'start', side = 'bottom', role = 'dialog', className, open: controlled, onOpenChange }: PopoverProps) {
  const [internal, setInternal] = useState(false)
  const open = controlled ?? internal
  const setOpen = useCallback(
    (v: boolean) => {
      setInternal(v)
      onOpenChange?.(v)
    },
    [onOpenChange],
  )
  const root = useRef<HTMLDivElement>(null)
  const refs = useRef([root]).current
  const close = useCallback(() => setOpen(false), [setOpen])
  useDismiss(open, refs, close)

  return (
    <div ref={root} className="relative inline-block">
      {trigger({ onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': role }, open)}
      {open && (
        <div
          role={role}
          className={cn(
            'absolute min-w-[160px] rounded-md border border-border bg-surface shadow-popover',
            'z-[var(--z-dropdown)]',
            side === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
            align === 'start' ? 'left-0' : 'right-0',
            className,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export interface DropdownItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  divider?: boolean
}

export interface DropdownProps extends Omit<PopoverProps, 'children' | 'role'> {
  items: DropdownItem[]
  header?: ReactNode
}

/** Menu built on Popover with arrow-key navigation. */
export function Dropdown({ items, header, ...rest }: DropdownProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role=menuitem]:not(:disabled)'))
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      btns[(i + 1) % btns.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      btns[(i - 1 + btns.length) % btns.length]?.focus()
    }
  }
  return (
    <Popover role="menu" {...rest}>
      {(close) => (
        <div onKeyDown={onKeyDown} className="py-1">
          {header}
          {items.map((it) =>
            it.divider ? (
              <hr key={it.id} className="my-1 border-border" />
            ) : (
              <button
                key={it.id}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  it.onSelect?.()
                  close()
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-hover focus:bg-surface-hover focus:outline-none disabled:opacity-50',
                  it.danger ? 'text-danger' : 'text-fg',
                )}
              >
                {it.icon}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </Popover>
  )
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-fg px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 z-[var(--z-tooltip)]"
      >
        {content}
      </span>
    </span>
  )
}
