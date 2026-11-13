import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface Series {
  key: string
  label: string
  color: string
}

// Chart palette derived from tokens (kept in one place).
export const CHART_COLORS = ['#1d6fb0', '#2fa36b', '#e5a10f', '#8a5cb8', '#c8323f', '#4f7a7e']

/** Shared chart used by Home, Analytics and ticket reports. */
export function ReportChart({ data, x, series, type = 'area', height = 260, xFormat }: { data: Record<string, any>[]; x: string; series: Series[]; type?: 'area' | 'bar'; height?: number; xFormat?: (v: any) => string }) {
  const Chart = type === 'bar' ? BarChart : AreaChart
  return (
    <div style={{ height }} role="img" aria-label={`Chart of ${series.map((s) => s.label).join(', ')}`}>
      <ResponsiveContainer>
        <Chart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey={x} tickFormatter={xFormat} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
          <Tooltip labelFormatter={xFormat} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: 'var(--border)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) =>
            type === 'bar' ? (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[2, 2, 0, 0]} />
            ) : (
              <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  )
}

export interface VolumePoint {
  date: string
  served: number
  missed: number
  avg_wait_s: number | null
}

/** Stacked chats served/missed bars with an average-wait line on a secondary axis (Analytics). */
export function ChatVolumeChart({ data, height = 300, xFormat }: { data: VolumePoint[]; height?: number; xFormat?: (v: any) => string }) {
  return (
    <div style={{ height }} role="img" aria-label="Chats served and missed per day with average wait time">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={xFormat} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v}s`} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
          <Tooltip labelFormatter={xFormat} formatter={(v, n) => (n === 'Wait time' ? fmtDuration(Number(v)) : v)} contentStyle={{ fontSize: 12, borderRadius: 4, borderColor: 'var(--border)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="l" stackId="c" dataKey="served" name="Chats served" fill="var(--visitor-served)" />
          <Bar yAxisId="l" stackId="c" dataKey="missed" name="Chats missed" fill="var(--warning)" radius={[2, 2, 0, 0]} />
          <Line yAxisId="r" dataKey="avg_wait_s" name="Wait time" type="monotone" stroke="var(--sidebar-bg)" strokeWidth={2} dot={{ r: 4, fill: 'var(--surface)' }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string | number | null; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      <div className="text-xs text-fg-secondary">{label}</div>
      <div className="mt-1 text-xl font-bold text-fg">{value ?? '—'}</div>
      {hint && <div className="text-xs text-fg-secondary">{hint}</div>}
    </div>
  )
}

export function fmtDuration(s: number | null | undefined) {
  if (s == null) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`
}
