import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui'
import { api, apiError } from '@/services/api'

/**
 * Generic Save / Revert / Reset-to-defaults state for one settings section.
 * Every settings tab (routing, widget.*, account.*) uses this — no per-page fetch logic.
 */
export function useSettingsSection<T extends Record<string, any>>(section: string) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings', section], queryFn: () => api.get<T>(`/settings/${section}`) })
  const [draft, setDraft] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (q.data) setDraft(q.data)
  }, [q.data])
  const dirty = useMemo(() => !!q.data && !!draft && JSON.stringify(q.data) !== JSON.stringify(draft), [q.data, draft])

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const set = <K extends keyof T>(k: K, v: T[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await api.put<T>(`/settings/${section}`, draft)
      qc.setQueryData(['settings', section], saved)
      toast.success('Changes saved')
    } catch (e) {
      toast.error(apiError(e).message)
    } finally {
      setSaving(false)
    }
  }
  const revert = () => q.data && setDraft(q.data)
  const reset = async () => {
    try {
      const d = await api.post<T>(`/settings/${section}/reset`)
      qc.setQueryData(['settings', section], d)
      toast.success('Reset to defaults')
    } catch (e) {
      toast.error(apiError(e).message)
    }
  }
  return { data: draft, loading: q.isLoading, error: q.error, dirty, saving, set, save, revert, reset, setDraft }
}
