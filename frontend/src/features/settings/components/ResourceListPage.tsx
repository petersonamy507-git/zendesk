import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Page, PageToolbar } from '@/components/layout/Page'
import { Button, ConfirmDialog, DataTable, ErrorState, SearchInput, toast, type ColumnDef, type RowSelectionState } from '@/components/ui'
import { useDebounce } from '@/hooks/useDebounce'
import { api, apiError } from '@/services/api'

export interface ResourceListConfig<T> {
  title: string
  queryKey: string
  endpoint: string
  params?: Record<string, unknown>
  columns: ColumnDef<T, any>[]
  getRowId: (r: T) => string
  addLabel?: string
  onAdd?: () => void
  onRowClick?: (r: T) => void
  summary?: (data: { total: number; enabled_count?: number } | undefined) => ReactNode
  toolbarExtra?: ReactNode
  empty: ReactNode
  /** Bulk actions shown when rows are selected. */
  bulkDelete?: { endpoint: string; noun: string }
  bulkActions?: (ids: string[], done: () => void) => ReactNode
  canManage?: boolean
}

/**
 * The single list-page implementation behind Agents, Departments, Shortcuts, Banned, Triggers,
 * Roles, Customers, Organizations, Macros… Pages only provide configuration.
 */
export function ResourceListPage<T>({ title, queryKey, endpoint, params, columns, getRowId, addLabel, onAdd, onRowClick, summary, toolbarExtra, empty, bulkDelete, bulkActions, canManage = true }: ResourceListConfig<T>) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<RowSelectionState>({})
  const [confirm, setConfirm] = useState(false)
  const dq = useDebounce(q)
  const query = useQuery({ queryKey: [queryKey, dq, params], queryFn: () => api.get<{ items: T[]; total: number; enabled_count?: number }>(endpoint, { q: dq || undefined, ...params }) })
  const ids = Object.keys(sel).filter((k) => sel[k])
  const done = () => {
    setSel({})
    qc.invalidateQueries({ queryKey: [queryKey] })
  }
  const del = async () => {
    if (!bulkDelete) return
    try {
      await api.post(bulkDelete.endpoint, { ids })
      toast.success(`${ids.length} ${bulkDelete.noun}${ids.length === 1 ? '' : 's'} deleted`)
      setConfirm(false)
      done()
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  return (
    <Page title={title}>
      <PageToolbar
        left={
          <>
            <SearchInput value={q} onChange={setQ} />
            {onAdd && canManage && (
              <Button variant="primary" onClick={onAdd}>
                {addLabel}
              </Button>
            )}
            {ids.length > 0 && canManage && (
              <>
                {bulkActions?.(ids, done)}
                {bulkDelete && (
                  <Button variant="danger" leftIcon={<Trash2 size={12} />} onClick={() => setConfirm(true)}>
                    Delete {ids.length}
                  </Button>
                )}
              </>
            )}
          </>
        }
        right={
          <>
            {summary?.(query.data)}
            {toolbarExtra}
          </>
        }
      />
      {query.error ? (
        <ErrorState error={apiError(query.error).message} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          data={query.data?.items ?? []}
          columns={columns}
          getRowId={getRowId}
          loading={query.isLoading}
          selectable={canManage && (!!bulkDelete || !!bulkActions)}
          rowSelection={sel}
          onRowSelectionChange={setSel}
          onRowClick={onRowClick}
          empty={empty}
        />
      )}
      <ConfirmDialog open={confirm} title={`Delete ${ids.length} item(s)?`} message="This can't be undone." confirmLabel="Delete" danger onConfirm={del} onCancel={() => setConfirm(false)} />
    </Page>
  )
}
