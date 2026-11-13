import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { realtime, type RealtimeEvent } from '@/services/realtime'

/** Subscribe to realtime event types for the lifetime of a component. */
export function useRealtimeEvent(types: string | string[], handler: (e: RealtimeEvent) => void) {
  const ref = useRef(handler)
  ref.current = handler
  const key = Array.isArray(types) ? types.join('|') : types
  useEffect(() => {
    const offs = key.split('|').map((t) => realtime.on(t, (e) => ref.current(e)))
    return () => offs.forEach((o) => o())
  }, [key])
}

/** Invalidate queries when any of the given events (or a resync) arrives. */
export function useInvalidateOn(types: string[], queryKeys: QueryKey[]) {
  const qc = useQueryClient()
  useRealtimeEvent([...types, 'resync'], () => {
    queryKeys.forEach((k) => qc.invalidateQueries({ queryKey: k }))
  })
}

export function useTopic(topic: string | null | undefined) {
  useEffect(() => {
    if (!topic) return
    return realtime.subscribe(topic)
  }, [topic])
}
