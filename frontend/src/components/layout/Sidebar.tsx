import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface NavItem {
  to: string
  label: string
  icon?: ReactNode
  badge?: ReactNode
  hidden?: boolean
}

/** Top-level sidebar link (50px row, active = lighter teal). */
export function SidebarItem({ item, sub = false }: { item: NavItem; sub?: boolean }) {
  if (item.hidden) return null
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 text-sidebar-fg transition-colors focus-visible:outline-offset-[-2px]',
          sub ? 'h-[35px] pl-12 text-sm' : 'h-[50px] px-5 text-md',
          isActive ? (sub ? 'font-bold' : 'bg-sidebar-active') : 'hover:bg-sidebar-hover',
        )
      }
    >
      {item.icon && <span className="w-4 shrink-0 opacity-90">{item.icon}</span>}
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge}
    </NavLink>
  )
}

/** Collapsible group (Settings, Team) — expanded body uses the deeper teal. */
export function SidebarGroup({ label, icon, items, basePaths }: { label: string; icon: ReactNode; items: NavItem[]; basePaths: string[] }) {
  const { pathname } = useLocation()
  const inside = basePaths.some((b) => pathname.startsWith(b))
  const [open, setOpen] = useState(inside)
  const expanded = open || inside
  return (
    <div className={cn(expanded && 'bg-sidebar-deep')}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className={cn('flex h-[50px] w-full items-center gap-3 px-5 text-md text-sidebar-fg hover:bg-sidebar-hover', inside && 'bg-sidebar-active/60')}
      >
        <span className="w-4 shrink-0 opacity-90">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={14} className={cn('opacity-70 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="pb-2">
          {items.map((i) => (
            <SidebarItem key={i.to} item={i} sub />
          ))}
        </div>
      )}
    </div>
  )
}
