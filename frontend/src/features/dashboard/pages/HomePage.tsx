import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { BarChart3, CheckCircle2, Circle, Settings2, Users, Zap } from 'lucide-react'
import { Page } from '@/components/layout/Page'
import { Card, SegmentedControl, Skeleton } from '@/components/ui'
import { ReportChart, CHART_COLORS } from '@/components/domain/ReportChart'
import { api } from '@/services/api'
import { useAuth } from '@/stores/auth'
import { useInvalidateOn } from '@/hooks/useRealtime'

type Bucket = 'hour' | 'day' | 'week' | 'month'
interface Website {
  points: { t: string; page_views: number; visits: number; unique_visitors: number; chats: number }[]
  totals: Record<string, number>
}

const CARDS = [
  { icon: <Settings2 size={14} />, title: 'Widget', body: 'Embed and customize the chat widget on your website.', link: 'Manage widget', to: '/settings/widget' },
  { icon: <Users size={14} />, title: 'Visitors', body: 'See who is on your website right now and start a conversation.', link: 'View visitors list', to: '/visitors' },
  { icon: <BarChart3 size={14} />, title: 'Analytics', body: 'Track the conversations you have with customers.', link: 'View analytics', to: '/analytics' },
  { icon: <Zap size={14} />, title: 'Triggers', body: 'Proactively start conversations or send custom messages to leads.', link: 'Manage triggers', to: '/settings/triggers' },
]

const SERIES = [
  { key: 'page_views', label: 'Page views', color: CHART_COLORS[0] },
  { key: 'visits', label: 'Total visits', color: CHART_COLORS[1] },
  { key: 'unique_visitors', label: 'Unique visitors', color: CHART_COLORS[2] },
  { key: 'chats', label: 'Chats', color: CHART_COLORS[3] },
]

export function HomePage() {
  const me = useAuth((s) => s.me)!
  const can = useAuth((s) => s.can)
  const [bucket, setBucket] = useState<Bucket>('hour')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const web = useQuery({ queryKey: ['reports', 'website', bucket], queryFn: () => api.get<Website>('/reports/website', { bucket }), enabled: can('reports.view') })
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api.get<{ id: string; message: string; created_at: string }[]>('/users/me/activity') })
  const setup = useQuery({
    queryKey: ['home', 'setup'],
    queryFn: async () => {
      const [agents, triggers, shortcuts, depts] = await Promise.all([
        api.get<{ total: number }>('/agents'),
        api.get<{ total: number }>('/triggers'),
        api.get<{ total: number }>('/shortcuts'),
        api.get<{ total: number }>('/departments'),
      ])
      return { agents: agents.total, triggers: triggers.total, shortcuts: shortcuts.total, depts: depts.total }
    },
  })
  useInvalidateOn(['presence.updated'], [['activity']])
  useInvalidateOn(['visitor.arrived', 'chat.incoming'], [['reports', 'website']])

  const fmt = (t: string) => format(parseISO(t), bucket === 'hour' ? 'HH:mm' : bucket === 'month' ? 'MMM yyyy' : 'MMM d')
  const steps = setup.data
    ? [
        { done: true, label: 'Create your workspace', to: '/settings/account' },
        { done: setup.data.agents > 1, label: 'Invite your team', to: '/settings/agents' },
        { done: setup.data.depts > 0, label: 'Organize agents into departments', to: '/settings/departments' },
        { done: setup.data.shortcuts > 0, label: 'Add canned responses (shortcuts)', to: '/settings/shortcuts' },
        { done: setup.data.triggers > 0, label: 'Engage visitors with a trigger', to: '/settings/triggers' },
      ]
    : []

  return (
    <Page title="Home" padded={false}>
      <div className="flex min-h-full">
        <div className="min-w-0 flex-1 px-[30px] py-5">
          <h2 className="mb-4 inline-block border-b-2 border-primary pb-2 text-lg font-bold text-fg-strong">Hello, {me.user.display_name || me.user.name}!</h2>
          <div className="mb-6 grid max-w-[1010px] grid-cols-[repeat(auto-fill,minmax(240px,320px))] gap-2.5 border-t border-border pt-4">
            {CARDS.map((c) => (
              <Card key={c.title} className="flex h-[190px] flex-col">
                <h3 className="flex items-center gap-2 text-md font-bold text-fg">
                  {c.icon}
                  {c.title}
                </h3>
                <p className="mt-2 flex-1 text-md text-fg-secondary">{c.body}</p>
                <Link to={c.to} className="text-md text-primary hover:underline">
                  {c.link}
                </Link>
              </Card>
            ))}
          </div>
          {can('reports.view') && (
            <section className="max-w-[1010px] border-t border-border pt-5" aria-labelledby="web-analytics">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="web-analytics" className="text-lg text-fg-strong">Website analytics</h2>
                <SegmentedControl
                  label="Time range"
                  value={bucket}
                  onChange={setBucket}
                  items={[
                    { value: 'hour', label: 'Hourly' },
                    { value: 'day', label: 'Daily' },
                    { value: 'week', label: 'Weekly' },
                    { value: 'month', label: 'Monthly' },
                  ]}
                />
              </div>
              {web.isLoading ? (
                <Skeleton height={260} />
              ) : web.data ? (
                <>
                  <div className="mb-2 flex flex-wrap gap-4">
                    {SERIES.map((s) => (
                      <label key={s.key} className="inline-flex items-center gap-1.5 text-sm">
                        <input type="checkbox" checked={!hidden.has(s.key)} onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })} style={{ accentColor: s.color }} />
                        {s.label} <span className="font-bold">{web.data.totals[s.key] ?? 0}</span>
                      </label>
                    ))}
                  </div>
                  <ReportChart data={web.data.points} x="t" xFormat={fmt} series={SERIES.filter((s) => !hidden.has(s.key))} />
                </>
              ) : null}
            </section>
          )}
        </div>
        <aside className="w-[var(--right-rail-width)] shrink-0 border-l border-border px-6 py-5" aria-label="Workspace">
          <h2 className="mb-3 text-sm text-fg">Get set up</h2>
          <ul className="mb-5 space-y-2 border-b border-border pb-5">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="flex items-center gap-2 text-sm hover:text-primary">
                  {s.done ? <CheckCircle2 size={14} className="text-success" /> : <Circle size={14} className="text-fg-secondary" />}
                  <span className={s.done ? 'text-fg-secondary line-through' : ''}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          <h2 className="mb-3 text-sm text-fg">Recent website activity</h2>
          <ul className="space-y-2">
            {activity.data?.length === 0 && <li className="text-sm text-fg-secondary">No activity yet</li>}
            {activity.data?.map((a) => (
              <li key={a.id} className="flex gap-2 text-sm">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-secondary" />
                <span>
                  {a.message} <span className="text-xs text-fg-secondary">· {format(parseISO(a.created_at), 'MMM d, HH:mm')}</span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Page>
  )
}
