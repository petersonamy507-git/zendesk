import { useEffect } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { BarChart3, Clock, Cog, Home, Activity, MessageSquare, Users, UsersRound } from 'lucide-react'
import { Logo } from './Logo'
import { SidebarGroup, SidebarItem } from './Sidebar'
import { AgentStatusSelector } from '@/components/domain/AgentStatusSelector'
import { Badge, Button, Modal } from '@/components/ui'
import { DockedChatPanel } from '@/components/domain/DockedChatPanel'
import { useAuth } from '@/stores/auth'
import { useOpenChats } from '@/features/chat/hooks/useOpenChats'
import { requestNotificationPermission } from '@/features/chat/utils/notify'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import { StatusBadge } from '@/components/ui'
import type { Agent } from '@/types'
import { useInvalidateOn } from '@/hooks/useRealtime'

export function AppShell() {
  const can = useAuth((s) => s.can)
  const { incoming, mine } = useOpenChats({ notify: true })
  const idle = useIdleTimeout()
  useEffect(requestNotificationPermission, [])
  const team = useQuery({ queryKey: ['agents', 'sidebar'], queryFn: () => api.get<{ items: Agent[] }>('/agents', { per_page: 50 }) })
  useInvalidateOn(['presence.updated', 'agent.updated'], [['agents']])

  const settings = [
    { to: '/settings/agents', label: 'Agents' },
    { to: '/settings/departments', label: 'Departments' },
    { to: '/settings/roles', label: 'Roles' },
    { to: '/settings/routing', label: 'Routing' },
    { to: '/settings/shortcuts', label: 'Shortcuts' },
    { to: '/settings/banned', label: 'Banned' },
    { to: '/settings/triggers', label: 'Triggers' },
    { to: '/settings/widget', label: 'Widget' },
    { to: '/settings/personal', label: 'Personal' },
    { to: '/settings/account', label: 'Account', hidden: !can('settings.manage') },
  ]
  const agents = team.data?.items.filter((a) => a.enabled) ?? []

  return (
    <div className="flex h-full">
      <nav aria-label="Main" className="flex w-[var(--sidebar-width)] shrink-0 flex-col bg-sidebar text-sidebar-fg">
        <Link to="/home" className="flex h-[var(--header-height)] items-center justify-center" aria-label="Parley home">
          <Logo />
        </Link>
        <div className="flex justify-center pb-3">
          <AgentStatusSelector />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarItem item={{ to: '/home', label: 'Home', icon: <Home size={16} /> }} />
          <SidebarItem item={{ to: '/visitors', label: 'Visitors', icon: <Users size={16} />, hidden: !can('visitors.view') }} />
          <SidebarItem item={{ to: '/chats', label: 'Chats', icon: <MessageSquare size={16} />, badge: mine.length ? <Badge tone="primary">{mine.length}</Badge> : undefined }} />
          <SidebarItem item={{ to: '/history', label: 'History', icon: <Clock size={16} /> }} />
          <SidebarItem item={{ to: '/analytics', label: 'Analytics', icon: <BarChart3 size={16} />, hidden: !can('reports.view') }} />
          <SidebarItem item={{ to: '/monitor', label: 'Monitor', icon: <Activity size={16} />, hidden: !can('reports.view') }} />
          <SidebarGroup label="Settings" icon={<Cog size={16} />} items={settings} basePaths={['/settings']} />
          <SidebarGroup
            label="Team"
            icon={<UsersRound size={16} />}
            basePaths={['/team']}
            items={[
              ...agents.slice(0, 8).map((a) => ({
                to: `/team/${a.id}`,
                label: a.display_name || a.name,
                icon: <StatusBadge status={a.presence} />,
              })),
              { to: '/team', label: 'View all' },
            ]}
          />
        </div>
        <div className="p-2.5">
          <Link
            to="/chats"
            className="flex h-10 items-center justify-center rounded-full bg-sidebar-deep text-md hover:bg-black/25"
            aria-label={`${incoming.length} incoming chat requests`}
          >
            {incoming.length > 0 && <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-away" aria-hidden />}
            {incoming.length} {incoming.length === 1 ? 'request' : 'requests'}
          </Link>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
      <DockedChatPanel />
      <Modal open={!!idle.alert} onClose={idle.dismiss} title="You're no longer online" size="sm" footer={<><Button onClick={idle.dismiss}>Dismiss</Button><Button variant="primary" onClick={idle.goOnline}>Go online</Button></>}>
        <p className="text-fg-secondary">Your status changed to <b>{idle.alert === 'invisible' ? 'Invisible' : 'Away'}</b> because you were inactive. You won't receive new chat requests until you go online.</p>
      </Modal>
    </div>
  )
}
