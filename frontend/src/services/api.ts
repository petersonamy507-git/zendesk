import axios, { AxiosError, type AxiosRequestConfig } from 'axios'

/**
 * Single HTTP client for the whole app. Features never create their own axios instances.
 * - Access token kept in memory only (never localStorage).
 * - Refresh token is an httpOnly SameSite=Strict cookie handled by the browser.
 * - 401 → one shared refresh attempt → retry; on failure the session ends.
 */
let accessToken: string | null = null
let onSessionEnd: (() => void) | null = null
let refreshing: Promise<string | null> | null = null

export const http = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 20000 })

export function setAccessToken(token: string | null) {
  accessToken = token
}
export function getAccessToken() {
  return accessToken
}
export function onSessionExpired(cb: () => void) {
  onSessionEnd = cb
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post<{ access_token: string }>('/api/v1/auth/refresh', null, { withCredentials: true })
      .then((r) => {
        accessToken = r.data.access_token
        return accessToken
      })
      .catch(() => {
        accessToken = null
        return null
      })
      .finally(() => {
        setTimeout(() => (refreshing = null), 0)
      })
  }
  return refreshing
}

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const url = original?.url ?? ''
    if (error.response?.status === 401 && original && !original._retry && !url.startsWith('/auth/')) {
      original._retry = true
      const token = await refreshAccessToken()
      if (token) return http(original)
      onSessionEnd?.()
    }
    return Promise.reject(error)
  },
)

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

/** Normalised error message for toasts and form errors. */
export function apiError(e: unknown): { code: string; message: string; details?: unknown } {
  if (axios.isAxiosError(e)) {
    const body = e.response?.data as ApiErrorBody | undefined
    if (body?.error) return body.error
    if (!e.response) return { code: 'network', message: 'Network error — check your connection' }
    return { code: String(e.response.status), message: e.message }
  }
  return { code: 'unknown', message: e instanceof Error ? e.message : 'Something went wrong' }
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  page_count: number
}

/** Thin typed helpers so feature services stay one-liners. */
export const api = {
  get: <T>(url: string, params?: object) => http.get<T>(url, { params, paramsSerializer: { indexes: null } }).then((r) => r.data),
  post: <T>(url: string, body?: unknown) => http.post<T>(url, body).then((r) => r.data),
  put: <T>(url: string, body?: unknown) => http.put<T>(url, body).then((r) => r.data),
  patch: <T>(url: string, body?: unknown) => http.patch<T>(url, body).then((r) => r.data),
  del: <T>(url: string) => http.delete<T>(url).then((r) => r.data),
  upload: <T>(url: string, file: File, extraHeaders?: Record<string, string>) => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post<T>(url, fd, { headers: extraHeaders }).then((r) => r.data)
  },
}
