import { getAccessToken, refreshAccessToken } from './api'

export interface RealtimeEvent<T = any> {
  id: string
  topic: string
  seq: number
  type: string
  ts: string
  data: T
}

type Handler = (e: RealtimeEvent) => void
type StatusHandler = (s: 'connecting' | 'open' | 'closed') => void

/**
 * Agent realtime client.
 * - Reconnects with exponential backoff (max 15s), refreshing the access token first.
 * - Re-subscribes topics after reconnect and emits `resync` so screens refetch from REST
 *   (MySQL is the source of truth; events are hints).
 * - De-duplicates by event id and detects per-topic seq gaps (→ `resync`).
 */
export interface RealtimeStats {
  status: 'connecting' | 'open' | 'closed'
  connectedAt: number | null
  connectAttempts: number
  connectedCount: number
  disconnects: number
  sentMessages: number
  receivedMessages: number
  sentBytes: number
  receivedBytes: number
  lostFrames: number // sequence gaps detected
  duplicateFrames: number
  latencyMs: number | null
  lastPongAt: number | null
}

class RealtimeClient {
  stats: RealtimeStats = { status: 'closed', connectedAt: null, connectAttempts: 0, connectedCount: 0, disconnects: 0, sentMessages: 0, receivedMessages: 0, sentBytes: 0, receivedBytes: 0, lostFrames: 0, duplicateFrames: 0, latencyMs: null, lastPongAt: null }
  private pingSentAt = 0
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private statusHandlers = new Set<StatusHandler>()
  private topics = new Set<string>()
  private seen = new Set<string>()
  private lastSeq = new Map<string, number>()
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private stopped = true

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
    this.ws = null
  }

  private async connect() {
    if (this.stopped) return
    this.emitStatus('connecting')
    let token = getAccessToken()
    if (this.attempt > 0) token = (await refreshAccessToken()) ?? token
    if (!token) return this.scheduleReconnect()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/ws?token=${encodeURIComponent(token)}`)
    this.ws = ws
    this.stats.connectAttempts++
    ws.onopen = () => {
      const wasReconnect = this.attempt > 0
      this.attempt = 0
      this.stats.connectedAt = Date.now()
      this.stats.connectedCount++
      this.emitStatus('open')
      this.topics.forEach((t) => this.raw(ws, { op: 'subscribe', topic: t }))
      const doPing = () => {
        if (ws.readyState !== 1) return
        this.pingSentAt = performance.now()
        this.raw(ws, { op: 'ping' })
      }
      doPing()
      this.pingTimer = setInterval(doPing, 25000)
      if (wasReconnect) this.dispatch({ id: `resync-${Date.now()}`, topic: '*', seq: 0, type: 'resync', ts: new Date().toISOString(), data: {} })
    }
    ws.onmessage = (m) => {
      this.stats.receivedMessages++
      this.stats.receivedBytes += typeof m.data === 'string' ? m.data.length : 0
      const e = JSON.parse(m.data) as RealtimeEvent
      if ((e as any).type === 'pong') {
        this.stats.latencyMs = Math.round(performance.now() - this.pingSentAt)
        this.stats.lastPongAt = Date.now()
      }
      if (!e.id) return // pong / subscribed / error control frames
      if (this.seen.has(e.id)) {
        this.stats.duplicateFrames++
        return
      }
      this.seen.add(e.id)
      if (this.seen.size > 2000) this.seen = new Set(Array.from(this.seen).slice(-1000))
      const prev = this.lastSeq.get(e.topic)
      this.lastSeq.set(e.topic, e.seq)
      if (prev !== undefined && e.seq > prev + 1) {
        this.stats.lostFrames += e.seq - prev - 1
        this.dispatch({ ...e, type: 'resync' })
      }
      this.dispatch(e)
    }
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.stats.disconnects++
      this.stats.connectedAt = null
      this.emitStatus('closed')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return
    this.attempt++
    const delay = Math.min(15000, 500 * 2 ** this.attempt) + Math.random() * 300
    this.timer = setTimeout(() => this.connect(), delay)
  }

  private dispatch(e: RealtimeEvent) {
    this.handlers.get(e.type)?.forEach((h) => h(e))
    this.handlers.get('*')?.forEach((h) => h(e))
  }

  private emitStatus(s: 'connecting' | 'open' | 'closed') {
    this.stats.status = s
    this.statusHandlers.forEach((h) => h(s))
  }

  private raw(ws: WebSocket, payload: object) {
    const s = JSON.stringify(payload)
    this.stats.sentMessages++
    this.stats.sentBytes += s.length
    ws.send(s)
  }

  on(type: string, h: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(h)
    return () => this.handlers.get(type)?.delete(h)
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h)
    return () => this.statusHandlers.delete(h)
  }

  subscribe(topic: string): () => void {
    this.topics.add(topic)
    if (this.ws?.readyState === 1) this.raw(this.ws, { op: 'subscribe', topic })
    return () => {
      this.topics.delete(topic)
      if (this.ws?.readyState === 1) this.raw(this.ws, { op: 'unsubscribe', topic })
    }
  }

  send(payload: object) {
    if (this.ws?.readyState === 1) this.raw(this.ws, payload)
  }

  /** Measure round-trip time on demand (Check connection). */
  ping(): Promise<number | null> {
    return new Promise((resolve) => {
      if (this.ws?.readyState !== 1) return resolve(null)
      this.pingSentAt = performance.now()
      this.raw(this.ws, { op: 'ping' })
      setTimeout(() => resolve(this.stats.latencyMs), 600)
    })
  }
}

export const realtime = new RealtimeClient()
