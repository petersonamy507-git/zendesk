import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { TopNavbar } from './TopNavbar'
import { Button } from '@/components/ui'

/** Every routed screen renders inside <Page>: header + scrollable content. */
export function Page({ title, back, actions, children, padded = true, className }: { title: ReactNode; back?: string; actions?: ReactNode; children: ReactNode; padded?: boolean; className?: string }) {
  return (
    <>
      <TopNavbar title={title} back={back} actions={actions} />
      <main className={cn('min-h-0 flex-1 overflow-auto', padded && 'px-[30px] py-4', className)}>{children}</main>
    </>
  )
}

/** Toolbar row: left controls, right summary (e.g. "1 enabled / 2 triggers"). */
export function PageToolbar({ left, right, className }: { left?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 pb-3', className)}>
      <div className="flex flex-1 flex-wrap items-center gap-2">{left}</div>
      {right && <div className="flex items-center gap-2 text-sm text-fg">{right}</div>}
    </div>
  )
}

export function SectionTitle({ children, description, action }: { children: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 first:mt-0">
      <div className="flex items-center justify-between border-b border-border pb-1.5">
        <h2 className="text-lg font-normal text-fg-strong">{children}</h2>
        {action}
      </div>
      {description && <p className="mt-1.5 text-sm text-fg-secondary">{description}</p>}
    </div>
  )
}

export function QuickTips({ tips }: { tips: { title: string; body: ReactNode }[] }) {
  return (
    <aside aria-label="Quick tips" className="w-[200px] shrink-0">
      <h2 className="mb-3 inline-block border-b-2 border-primary pb-1 text-md font-bold">Quick tips</h2>
      {tips.map((t) => (
        <div key={t.title} className="mb-4">
          <h3 className="mb-1 text-sm font-bold">{t.title}</h3>
          <div className="text-sm leading-relaxed text-fg-secondary">{t.body}</div>
        </div>
      ))}
    </aside>
  )
}

/** Two-column settings layout: form + Quick tips rail. */
export function SettingsLayout({ children, tips, top }: { children: ReactNode; tips?: { title: string; body: ReactNode }[]; top?: ReactNode }) {
  return (
    <div>
      {top && <div className="pb-4">{top}</div>}
      <div className="flex gap-12">
        <div className="w-full max-w-[560px]">{children}</div>
        {tips && <QuickTips tips={tips} />}
      </div>
    </div>
  )
}

/** Save / Revert / Reset footer shared by every settings form. */
export function FormFooter({ dirty, saving, onRevert, onReset, onDelete, submitLabel = 'Save changes', cancelLabel = 'Revert changes', onCancel }: { dirty: boolean; saving?: boolean; onRevert?: () => void; onReset?: () => void; onDelete?: () => void; submitLabel?: string; cancelLabel?: string; onCancel?: () => void }) {
  return (
    <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
      <Button type="submit" variant="primary" loading={saving} disabled={!dirty && !onCancel}>
        {submitLabel}
      </Button>
      {(onRevert || onCancel) && (
        <Button onClick={onCancel ?? onRevert} disabled={!onCancel && !dirty}>
          {cancelLabel}
        </Button>
      )}
      <span className="flex-1" />
      {onReset && <Button onClick={onReset}>Reset to defaults</Button>}
      {onDelete && (
        <Button variant="danger" onClick={onDelete}>
          Delete
        </Button>
      )}
    </div>
  )
}

/** List (left) + detail panel (right) split used by History and Chats. */
export function SplitPanel({ list, detail, detailOpen }: { list: ReactNode; detail: ReactNode; detailOpen: boolean }) {
  return (
    <div className="flex h-full min-h-0">
      <div className={cn('min-w-0 overflow-auto', detailOpen ? 'w-[40%] border-r border-border' : 'w-full')}>{list}</div>
      {detailOpen && <div className="min-w-0 flex-1 overflow-hidden">{detail}</div>}
    </div>
  )
}
