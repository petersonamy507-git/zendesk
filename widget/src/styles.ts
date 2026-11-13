/** Readable foreground (dark or white) for a hex background. */
export function contrastOn(hex: string): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return l > 0.5 ? '#1f2933' : '#ffffff'
}

export const css = (theme: string, left: boolean, badgeBg: string = theme) => `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.root { position: fixed; bottom: 16px; ${left ? 'left' : 'right'}: 16px; z-index: 2147483000; font-size: 14px; color: #2b3640; }
.launcher { display: flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; background: ${badgeBg}; color: ${contrastOn(badgeBg)}; height: 56px; padding: 0 20px 0 16px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.25); font-size: 15px; font-weight: 600; }
.launcher.round { width: 56px; padding: 0; justify-content: center; }
.launcher:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${theme}; outline-offset: 2px; }
.badge { position: absolute; top: -4px; ${left ? 'left' : 'right'}: -4px; background: #c8323f; color: #fff; border-radius: 999px; font-size: 11px; min-width: 18px; height: 18px; display: none; align-items: center; justify-content: center; font-weight: 700; }
.badge.on { display: flex; }
.panel { position: absolute; bottom: 68px; ${left ? 'left' : 'right'}: 0; width: 360px; height: min(600px, calc(100vh - 100px)); background: #fff; border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,.28); display: none; flex-direction: column; overflow: hidden; }
.panel.open { display: flex; }
@media (max-width: 480px) { .panel { position: fixed; inset: 0; width: 100%; height: 100%; border-radius: 0; bottom: 0; } .root { bottom: 12px; } }
header { background: ${theme}; color: ${contrastOn(theme)}; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }
header .t { flex: 1; min-width: 0; } header .t b { display: block; font-size: 15px; } header .t span { font-size: 12px; opacity: .9; }
header button { background: transparent; border: 0; color: inherit; cursor: pointer; font-size: 18px; padding: 4px 8px; border-radius: 6px; } header button:hover { background: rgba(255,255,255,.2); }
.av { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.3); display: flex; align-items: center; justify-content: center; font-weight: 700; overflow: hidden; flex: none; } .av img { width: 100%; height: 100%; object-fit: cover; }
.body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: #f6f8f8; }
.m { max-width: 82%; padding: 8px 12px; border-radius: 14px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
.m.v { align-self: flex-end; background: ${theme}; color: ${contrastOn(theme)}; border-bottom-right-radius: 4px; }
.m.a { align-self: flex-start; background: #fff; border: 1px solid #d9dde0; border-bottom-left-radius: 4px; }
.m .n { display: block; font-size: 11px; color: #66727c; margin-bottom: 2px; font-weight: 600; }
.m.failed { opacity: .6; } .m .ts { display: block; font-size: 10px; opacity: .7; margin-top: 2px; text-align: right; }
.ev { align-self: center; font-size: 12px; color: #66727c; font-style: italic; text-align: center; }
.opts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; } .opts button { border: 1px solid ${theme}; background: #fff; color: ${theme}; border-radius: 999px; padding: 4px 12px; cursor: pointer; font-size: 13px; }
.typing { align-self: flex-start; font-size: 12px; color: #66727c; font-style: italic; }
form.f, .pad { padding: 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
label { font-size: 12px; font-weight: 600; display: flex; flex-direction: column; gap: 4px; }
input, textarea, select { font: inherit; padding: 8px 10px; border: 1px solid #b8bfc5; border-radius: 6px; background: #fff; } textarea { resize: vertical; min-height: 70px; }
.err { color: #c8323f; font-size: 12px; }
.btn { border: 0; background: ${theme}; color: ${contrastOn(theme)}; padding: 10px 14px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 14px; } .btn:disabled { opacity: .6; cursor: not-allowed; } .btn.ghost { background: #eaedef; color: #2b3640; }
.composer { border-top: 1px solid #d9dde0; padding: 8px; display: flex; gap: 6px; align-items: flex-end; background: #fff; }
.composer textarea { flex: 1; min-height: 38px; max-height: 110px; resize: none; } .composer button { border: 0; background: transparent; cursor: pointer; font-size: 18px; padding: 6px 8px; border-radius: 6px; } .composer .send { background: ${theme}; color: ${contrastOn(theme)}; font-size: 14px; font-weight: 700; padding: 8px 12px; }
.rate { display: flex; gap: 10px; justify-content: center; } .rate button { font-size: 26px; background: #fff; border: 1px solid #d9dde0; border-radius: 50%; width: 48px; height: 48px; cursor: pointer; } .rate button[aria-pressed=true] { border-color: ${theme}; background: #e6f0f8; }
.hint { font-size: 12px; color: #66727c; } .center { text-align: center; }
a { color: inherit; }

.launcher.img { padding: 0; height: auto; background: transparent; box-shadow: none; } .launcher.img img { height: 64px; max-width: 220px; border-radius: 12px; display: block; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
.link { color: ${theme}; font-size: 13px; text-align: center; }
`
