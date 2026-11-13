/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'node:path'

// Where the app lives in development
//   http://localhost:<UI_PORT>          (always works on this PC)
//   http://parley.localhost:<UI_PORT>   (own origin + cookie jar, so it never mixes with other apps on localhost)
//
// Ports are deliberately unusual so they do not collide with other dev servers (5173, 5181, 8000, 8010...).
// Override with UI_PORT / API_PORT.
//
// Network access (opt-in, see scripts/dev.ps1 -Lan): set UI_HOST=0.0.0.0. Only the UI port is then exposed.
// The browser talks to the API *through* this dev server's /api proxy (HTTP and WebSocket), so the API itself
// stays bound to loopback and needs no firewall rule or CORS entry.
const UI_PORT = Number(process.env.UI_PORT ?? 5643)
const API_PORT = Number(process.env.API_PORT ?? 8643)
const API_TARGET = process.env.API_TARGET ?? `http://127.0.0.1:${API_PORT}`
const UI_HOST = process.env.UI_HOST ?? '127.0.0.1' // loopback only unless explicitly opened up
// Extra host names the dev server answers to (e.g. this PC's computer name on a LAN). IP addresses are always allowed.
const EXTRA_HOSTS = (process.env.UI_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) // browsers send lowercase Host headers
const allowedHosts = ['.localhost', ...EXTRA_HOSTS]

// xfwd: pass the real client address to the API (X-Forwarded-For) so visitor IPs, bans and rate limits
// work per visitor instead of seeing every request as 127.0.0.1.
const proxy = { '/api': { target: API_TARGET, changeOrigin: true, ws: true, xfwd: true } }

// Vite answers CORS preflights itself (before the proxy) and only allows localhost origins, which would block the
// chat widget when it is embedded on any other website in development. Turn it off: the API owns CORS
// (strict + credentialed for the web app, public + credential-less for the widget endpoints).
const cors = false

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: UI_HOST,
    port: UI_PORT,
    strictPort: true, // fail loudly if the port is taken instead of silently moving to another one
    allowedHosts,
    cors,
    proxy,
  },
  preview: { host: UI_HOST, port: UI_PORT, strictPort: true, allowedHosts, cors, proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
