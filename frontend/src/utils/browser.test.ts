import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, uuid } from './browser'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.unstubAllGlobals())

describe('uuid', () => {
  it('uses crypto.randomUUID when the browser provides it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555', getRandomValues: () => new Uint8Array(16) })
    expect(uuid()).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('falls back to getRandomValues on plain-HTTP pages (no randomUUID) and still yields valid v4 ids', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    const ids = new Set(Array.from({ length: 200 }, () => uuid()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(V4)
  })
})

describe('copyText', () => {
  it('uses the async Clipboard API in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('isSecureContext', true)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    expect(await copyText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand when the Clipboard API is unavailable (insecure page)', async () => {
    vi.stubGlobal('isSecureContext', false)
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec
    expect(await copyText('hello')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull() // temporary element cleaned up
  })
})
