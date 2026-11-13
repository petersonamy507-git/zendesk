import { useEffect, useRef, useState } from 'react'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { useOpenChats } from '@/features/chat/hooks/useOpenChats'
import { playEvent } from '@/features/chat/utils/notify'

/**
 * Personal › Idle timeout: switch to Away/Invisible after N minutes of no input, then show the
 * "Go online / Dismiss" alert. Returns the alert state for the shell to render.
 */
export function useIdleTimeout() {
  const me = useAuth((s) => s.me)
  const setMe = useAuth((s) => s.setMe)
  const { mine } = useOpenChats()
  const last = useRef(Date.now())
  const chatting = mine.length > 0
  const [alert, setAlert] = useState<null | 'away' | 'invisible'>(null)

  useEffect(() => {
    const bump = () => (last.current = Date.now())
    const evs = ['mousemove', 'keydown', 'mousedown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    return () => evs.forEach((e) => window.removeEventListener(e, bump))
  }, [])

  useEffect(() => {
    if (!me) return
    const p = me.preferences
    if (!p.idle_enabled) return
    const t = setInterval(async () => {
      if (me.user.presence !== 'online') return
      if (p.idle_ignore_if_chatting && chatting) return
      if (Date.now() - last.current < Number(p.idle_minutes || 15) * 60000) return
      const next = p.idle_status === 'invisible' ? 'invisible' : 'away'
      await api.put('/users/me/presence', { status: next })
      setMe({ ...me, user: { ...me.user, presence: next } })
      if (p.notify_status_change) setAlert(next)
      playEvent(p, 'status_change')
    }, 15000)
    return () => clearInterval(t)
  }, [me, chatting, setMe])

  const goOnline = async () => {
    if (!me) return
    await api.put('/users/me/presence', { status: 'online' })
    setMe({ ...me, user: { ...me.user, presence: 'online' } })
    last.current = Date.now()
    setAlert(null)
  }
  return { alert, dismiss: () => setAlert(null), goOnline }
}
