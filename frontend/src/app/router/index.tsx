import { useEffect, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui'
import { useAuth } from '@/stores/auth'
import { AcceptInvitePage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from '@/features/auth'
import { HomePage } from '@/features/dashboard'
import { ChatsPage, HistoryPage, VisitorsPage } from '@/features/chat'
import { AccountSettingsPage, AgentEditPage, AgentsPage, BannedPage, DepartmentEditPage, DepartmentsPage, PersonalSettingsPage, RolesPage, RoutingPage, ShortcutEditPage, ShortcutsPage, TeamPage, TriggerEditPage, TriggersPage, WidgetSettingsPage } from '@/features/settings'
import { AnalyticsPage, MonitorPage } from '@/features/reports'
import { NotFoundPage, PrivacyPage } from './StaticPages'

function RequireAuth() {
  const status = useAuth((s) => s.status)
  const location = useLocation()
  if (status === 'unknown') return <div className="flex h-full items-center justify-center"><Spinner size={24} /></div>
  if (status === 'anonymous') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const can = useAuth((s) => s.can)
  return can(perm) ? <>{children}</> : <NotFoundPage message="You don't have access to this page." />
}

function GuestOnly() {
  const status = useAuth((s) => s.status)
  if (status === 'authenticated') return <Navigate to="/home" replace />
  return <Outlet />
}

export function Bootstrap({ children }: { children: ReactNode }) {
  const bootstrap = useAuth((s) => s.bootstrap)
  useEffect(() => void bootstrap(), [bootstrap])
  return <>{children}</>
}

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Navigate to="/home" replace /> },
          { path: '/home', element: <HomePage /> },
          { path: '/visitors', element: <RequirePerm perm="visitors.view"><VisitorsPage /></RequirePerm> },
          { path: '/chats', element: <ChatsPage /> },
          { path: '/chats/:chatId', element: <ChatsPage /> },
          { path: '/history', element: <HistoryPage /> },
          { path: '/analytics', element: <RequirePerm perm="reports.view"><AnalyticsPage /></RequirePerm> },
          { path: '/monitor', element: <RequirePerm perm="reports.view"><MonitorPage /></RequirePerm> },
          { path: '/team', element: <TeamPage /> },
          { path: '/team/:agentId', element: <TeamPage /> },
          { path: '/settings', element: <Navigate to="/settings/agents" replace /> },
          { path: '/settings/agents', element: <AgentsPage /> },
          { path: '/settings/agents/:agentId', element: <RequirePerm perm="agents.manage"><AgentEditPage /></RequirePerm> },
          { path: '/settings/departments', element: <DepartmentsPage /> },
          { path: '/settings/departments/:deptId', element: <RequirePerm perm="departments.manage"><DepartmentEditPage /></RequirePerm> },
          { path: '/settings/roles', element: <RolesPage /> },
          { path: '/settings/routing', element: <RoutingPage /> },
          { path: '/settings/shortcuts', element: <ShortcutsPage /> },
          { path: '/settings/shortcuts/:shortcutId', element: <ShortcutEditPage /> },
          { path: '/settings/banned', element: <BannedPage /> },
          { path: '/settings/triggers', element: <TriggersPage /> },
          { path: '/settings/triggers/:triggerId', element: <RequirePerm perm="triggers.manage"><TriggerEditPage /></RequirePerm> },
          { path: '/settings/widget/:tab?', element: <WidgetSettingsPage /> },
          { path: '/settings/personal/:tab?', element: <PersonalSettingsPage /> },
          { path: '/settings/account/:tab?', element: <RequirePerm perm="settings.manage"><AccountSettingsPage /></RequirePerm> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
