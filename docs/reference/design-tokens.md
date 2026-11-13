# Design tokens

Measured from computed styles in the reference at a 1920×889 viewport. Our tokens borrow the layout metrics
and the general palette family (dark teal sidebar, neutral greys), but every color has our own name and is
shifted a little, so the product has its own identity. Source of truth: `frontend/src/styles/tokens.css`.

| Token | Reference (measured) | Ours | Use |
|---|---|---|---|
| `--sidebar-bg` | #03363d | #0b3a40 | Sidebar background |
| `--sidebar-bg-deep` | #012c32 | #062e33 | Expanded group background |
| `--sidebar-active` | #56777a | #4f7a7e | Active nav item |
| `--sidebar-fg` | #ffffff | #ffffff | Sidebar text |
| `--text-primary` | #2f3941 | #2b3640 | Body and headings |
| `--text-secondary` | #68737d | #66727c | Descriptions |
| `--text-strong` | #4a4a4a (greeting) | #3a434b | Page greeting |
| `--border` | #d8dcde | #d9dde0 | Card and table borders |
| `--surface` | #ffffff | #ffffff | Cards, header |
| `--surface-muted` | #e9ebed | #eaedef | Active segment and hovered rows |
| `--link` / `--primary` | #1f73b7 | #1d6fb0 | Links, primary buttons |
| `--danger` | ~#cc3340 (Ban visitor) | #c8323f | Destructive |
| `--warning-bg` | ~#fff7cc (restricted banner) | #fff6d1 | Notice banners |
| `--status-online` | green | #2fa36b | Presence |
| `--status-away` | amber | #e5a10f | Presence |
| `--status-invisible` | grey | #8a949c | Presence |

## Typography
- Family: system UI stack (`system-ui, -apple-system, "Segoe UI", Roboto, …`). Verified.
- Base 12px; nav items 14px; status pill 13px; card body 14px; card title 14px/600; greeting 18px/700; segmented buttons 11px/700.

## Layout
- Sidebar width **200px** (V). Header height **50px** (V). Right rail on Home ≈ 350px (V).
- Nav item height 50px (top level) and 35px (sub items) (V).
- Cards: 320×190, radius 4px, 1px border (V). Buttons and segments: radius 3px, height 30px (V).
- Status pill and requests pill: radius 20px (V).

## Spacing, radius, shadow, z-index, motion (P)
- Spacing scale 2/4/8/12/16/20/24/32/40.
- Radius: sm 3, md 4, lg 8, pill 999.
- Shadow: popover `0 4px 16px rgba(0,0,0,.12)`; modal `0 12px 40px rgba(0,0,0,.2)`.
- Z-index: dropdown 1000, sticky 1100, drawer 1200, modal 1300, toast 1400, tooltip 1500.
- Durations: fast 120ms, base 200ms, slow 320ms.
