/**
 * Browser-API helpers that keep working when the app is opened over plain HTTP from another PC
 * (e.g. http://192.168.1.20:5643). Browsers only expose `crypto.randomUUID` and the async Clipboard API in
 * "secure contexts" (HTTPS or localhost), so both need a fallback.
 */

/** RFC 4122 v4 id. Uses crypto.randomUUID when available, else crypto.getRandomValues (works on plain HTTP). */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`
}

/** Copy text to the clipboard. Resolves true on success. Falls back to a hidden textarea + execCommand on insecure pages. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
  document.body.append(ta)
  ta.select()
  try {
    return document.execCommand('copy')
  } finally {
    ta.remove()
  }
}
