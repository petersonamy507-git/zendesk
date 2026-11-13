import { useEffect, useState } from 'react'
import { realtime } from '@/services/realtime'

export function useConnectionStatus() {
  const [s, setS] = useState<'connecting' | 'open' | 'closed'>('open')
  useEffect(() => realtime.onStatus(setS), [])
  return s
}
