import { useMemo, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type OnChangeFn,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Checkbox } from './Input'
import { Skeleton } from './Spinner'

export type { ColumnDef, SortingState, RowSelectionState }

export interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T, any>[]
  getRowId: (row: T) => string
  loading?: boolean
  /** Server-side sorting (manual). */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  selectable?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  onRowClick?: (row: T) => void
  activeRowId?: string | null
  empty?: ReactNode
  /** Optional grouping: rows are rendered under group header rows in data order. */
  groupBy?: (row: T) => string
  className?: string
}

/**
 * The single table used by every list in the app (history, agents, departments, shortcuts,
 * banned, triggers, tickets, customers, ...). Behaviour is configured, never forked.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading,
  sorting,
  onSortingChange,
  selectable,
  rowSelection,
  onRowSelectionChange,
  onRowClick,
  activeRowId,
  empty,
  groupBy,
  className,
}: DataTableProps<T>) {
  const cols = useMemo<ColumnDef<T, any>[]>(() => {
    if (!selectable) return columns
    return [
      {
        id: '__select',
        size: 32,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all rows"
            checked={table.getIsAllRowsSelected()}
            indeterminate={table.getIsSomeRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox aria-label="Select row" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
          </span>
        ),
      },
      ...columns,
    ]
  }, [columns, selectable])

  const table = useReactTable({
    data,
    columns: cols,
    getRowId,
    state: { sorting: sorting ?? [], rowSelection: rowSelection ?? {} },
    manualSorting: true,
    enableRowSelection: !!selectable,
    onSortingChange,
    onRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
  })

  const rows = table.getRowModel().rows
  let lastGroup: string | null = null

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => {
                const canSort = h.column.getCanSort() && !!onSortingChange
                const dir = h.column.getIsSorted()
                return (
                  <th
                    key={h.id}
                    scope="col"
                    style={{ width: h.column.columnDef.size && h.column.columnDef.size !== 150 ? h.column.columnDef.size : undefined }}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    className="h-9 px-2 text-left text-xs font-bold text-fg"
                  >
                    {canSort ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 hover:text-primary">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === 'asc' && <ArrowUp size={10} />}
                        {dir === 'desc' && <ArrowDown size={10} />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={`sk${i}`} className="border-b border-border">
                {cols.map((c, j) => (
                  <td key={j} className="h-9 px-2">
                    <Skeleton width={c.id === '__select' ? 14 : '70%'} />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows.map((row) => {
              const group = groupBy?.(row.original)
              const header =
                groupBy && group !== lastGroup ? (
                  <tr key={`g-${group}`} className="bg-surface-subtle">
                    <td colSpan={cols.length} className="h-8 px-2 text-xs font-bold text-fg-secondary">
                      {group}
                    </td>
                  </tr>
                ) : null
              lastGroup = group ?? null
              return [
                header,
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row.original) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={activeRowId === row.id || undefined}
                  className={cn(
                    'border-b border-border',
                    onRowClick && 'cursor-pointer hover:bg-surface-hover focus:bg-surface-hover focus:outline-none',
                    (activeRowId === row.id || row.getIsSelected()) && 'bg-surface-muted',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="h-9 max-w-0 truncate px-2 align-middle text-fg">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>,
              ]
            })}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <div className="py-4 text-center text-md text-fg-secondary">{empty ?? 'No results'}</div>}
    </div>
  )
}
