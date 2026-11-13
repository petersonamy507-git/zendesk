import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiError } from '@/services/api'

/**
 * Standard mutation: shows success/error toasts and invalidates the given queries.
 * All feature mutations use this so error handling is consistent everywhere.
 */
export function useApiMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>, opts: { success?: string | ((d: TData) => string); invalidate?: QueryKey[]; onSuccess?: (d: TData, v: TVars) => void; silentError?: boolean } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (d, v) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }))
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(d) : opts.success)
      opts.onSuccess?.(d, v)
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(apiError(e).message)
    },
  })
}
