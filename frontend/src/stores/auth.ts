import { create } from 'zustand'
import { api, refreshAccessToken, setAccessToken } from '@/services/api'
import { realtime } from '@/services/realtime'
import type { Me } from '@/types'

type Status = 'unknown' | 'authenticated' | 'anonymous'

interface AuthState {
  status: Status
  me: Me | null
  bootstrap: () => Promise<void>
  login: (email: string, password: string, otp?: string) => Promise<void>
  register: (body: { company: string; subdomain: string; name: string; email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  reloadMe: () => Promise<void>
  setMe: (me: Me) => void
  can: (perm: string) => boolean
  endSession: () => void
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'unknown',
  me: null,
  async bootstrap() {
    const token = await refreshAccessToken()
    if (!token) return set({ status: 'anonymous' })
    try {
      const me = await api.get<Me>('/users/me')
      set({ me, status: 'authenticated' })
      realtime.start()
    } catch {
      set({ status: 'anonymous' })
    }
  },
  async login(email, password, otp) {
    const r = await api.post<{ access_token: string }>('/auth/login', { email, password, otp: otp || undefined })
    setAccessToken(r.access_token)
    const me = await api.get<Me>('/users/me')
    set({ me, status: 'authenticated' })
    realtime.start()
  },
  async register(body) {
    const r = await api.post<{ access_token: string }>('/auth/register', body)
    setAccessToken(r.access_token)
    const me = await api.get<Me>('/users/me')
    set({ me, status: 'authenticated' })
    realtime.start()
  },
  async logout() {
    try {
      await api.post('/auth/logout')
    } finally {
      get().endSession()
    }
  },
  async reloadMe() {
    set({ me: await api.get<Me>('/users/me') })
  },
  setMe(me) {
    set({ me })
  },
  can(perm) {
    return !!get().me?.permissions.includes(perm)
  },
  endSession() {
    realtime.stop()
    setAccessToken(null)
    set({ me: null, status: 'anonymous' })
  },
}))
