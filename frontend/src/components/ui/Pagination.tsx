import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface PaginationProps {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

/** Compact pager: [<] Page x of y [>] — matches the reference History pager. */
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  const total = Math.max(1, pageCount)
  return (
    <nav aria-label="Pagination" className="inline-flex items-center overflow-hidden rounded-sm border border-border">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="flex h-[26px] w-[26px] items-center justify-center hover:bg-surface-hover disabled:opacity-40">
        <ChevronLeft size={14} />
      </button>
      <span className="border-x border-border px-2.5 text-xs font-bold leading-[26px]" aria-live="polite">
        Page {page.toLocaleString()} of {total.toLocaleString()}
      </span>
      <button type="button" aria-label="Next page" disabled={page >= total} onClick={() => onPageChange(page + 1)} className="flex h-[26px] w-[26px] items-center justify-center hover:bg-surface-hover disabled:opacity-40">
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}
