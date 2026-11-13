import type { Chat } from '@/types'

let audioCtx: AudioContext | null = null

export const SOUND_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'alert', label: 'Alert' },
  { value: 'bright', label: 'Bright' },
  { value: 'chime', label: 'Chime' },
  { value: 'soft', label: 'Soft' },
]

// [frequency Hz, duration s, oscillator type] sequences, generated with WebAudio (no bundled audio assets)
const TONES: Record<string, [number, number, OscillatorType][]> = {
  alert: [[880, 0.12, 'square'], [660, 0.12, 'square'], [880, 0.12, 'square']],
  bright: [[660, 0.15, 'sine'], [880, 0.18, 'sine']],
  chime: [[1046, 0.2, 'triangle'], [784, 0.3, 'triangle']],
  soft: [[520, 0.25, 'sine']],
}

/** Play a named tone at a 0–100 volume, optionally repeated. */
export function playSound(tone: string, volume = 100, repeat = 1) {
  const steps = TONES[tone]
  if (!steps || volume <= 0) return
  try {
    audioCtx ??= new AudioContext()
    const ctx = audioCtx
    const gain = Math.max(0.0002, (volume / 100) * 0.2)
    let t = ctx.currentTime
    for (let r = 0; r < repeat; r++) {
      for (const [freq, dur, type] of steps) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = type
        o.frequency.value = freq
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
        o.connect(g).connect(ctx.destination)
        o.start(t)
        o.stop(t + dur + 0.02)
        t += dur + 0.03
      }
      t += 0.5
    }
  } catch {
    /* audio unavailable */
  }
}

/** Plays the sound configured for an event (Personal › Sounds & notifications). */
export function playEvent(prefs: Record<string, any>, event: 'incoming_visitor' | 'incoming_chat' | 'new_message' | 'status_change') {
  playSound(String(prefs[`sound_${event}`] ?? 'none'), Number(prefs[`volume_${event}`] ?? 100), event === 'incoming_chat' ? Math.max(1, Math.min(10, Number(prefs.sound_incoming_chat_repeat) || 1)) : 1)
}

export function notifyIncoming(c: Chat, prefs: Record<string, any>) {
  playEvent(prefs, 'incoming_chat')
  if (prefs.notify_chat_request && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification('New chat request', { body: `${c.visitor_name ?? 'A visitor'}: ${c.preview ?? c.question ?? ''}`.slice(0, 140), tag: c.id })
  }
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission()
}
