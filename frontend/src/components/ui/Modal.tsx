import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from './Button'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Drawer variant slides from the right edge. */
  variant?: 'dialog' | 'drawer'
  closeOnBackdrop?: boolean
}

const widths = { sm: 'w-[360px]', md: 'w-[520px]', lg: 'w-[760px]' }

export function Modal({ open, onClose, title, children, footer, size = 'md', variant = 'dialog', closeOnBackdrop = true }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement as HTMLElement
    const first = panel.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')
    ;(first ?? panel.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input,select,textarea,[tabindex]:not([tabindex="-1"])')
        if (!f.length) return
        const a = f[0]!, z = f[f.length - 1]!
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      lastFocus.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className={cn('fixed inset-0 flex bg-black/40 z-[var(--z-modal)]', variant === 'dialog' ? 'items-center justify-center' : 'justify-end')} onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn('flex max-h-[90vh] flex-col bg-surface shadow-modal focus:outline-none', variant === 'dialog' ? cn('rounded-md', widths[size]) : 'h-full w-[420px] max-h-none')}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-md font-bold text-fg">{title}</h2>
          <button data-close type="button" aria-label="Close" onClick={onClose} className="rounded-full border border-border p-1 text-fg-secondary hover:text-fg">
            <X size={12} />
          </button>
        </div>
        <div className="overflow-auto px-5 py-2 text-sm">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-md bg-surface-subtle px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer(props: Omit<ModalProps, 'variant'>) {
  return <Modal {...props} variant="drawer" />
}

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-fg-secondary">{message}</div>
    </Modal>
  )
}
