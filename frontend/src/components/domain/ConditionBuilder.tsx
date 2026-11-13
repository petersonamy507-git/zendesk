import { Minus, Plus } from 'lucide-react'
import { IconButton, Input, Select, type SelectOption } from '@/components/ui'
import type { Condition } from '@/types'

export interface FieldSpec {
  value: string
  label: string
  /** Value editor kind. */
  type?: 'text' | 'number' | 'boolean' | 'select' | 'none'
  options?: SelectOption[]
  operators?: string[]
  hint?: string
}

export const OPERATOR_LABELS: Record<string, string> = {
  eq: '= Equal',
  neq: '≠ Not equal',
  lt: '< Less than',
  lte: '≤ Less than or equal',
  gt: '> Greater than',
  gte: '≥ Greater than or equal',
  contains: 'Contains',
  not_contains: 'Does not contain',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  regex: 'Matches regex',
  in: 'Is one of',
  not_in: 'Is not one of',
  is_true: 'Is true',
  is_false: 'Is false',
  present: 'Is present',
  not_present: 'Is not present',
  includes_any: 'Includes any of',
  includes_none: 'Includes none of',
  includes_all: 'Includes all of',
}

const DEFAULT_OPS: Record<NonNullable<FieldSpec['type']>, string[]> = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'regex', 'present', 'not_present'],
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte'],
  boolean: ['is_true', 'is_false'],
  select: ['eq', 'neq'],
  none: ['gte'],
}

const NO_VALUE = new Set(['is_true', 'is_false', 'present', 'not_present'])

/** Reusable condition rows (field / operator / value, −/+) used by chat triggers, ticket triggers, automations, SLA policies and views. */
export function ConditionBuilder({ conditions, onChange, fields, minRows = 0 }: { conditions: Condition[]; onChange: (c: Condition[]) => void; fields: FieldSpec[]; minRows?: number }) {
  const spec = (f: string) => fields.find((x) => x.value === f) ?? fields[0]!
  const opsFor = (s: FieldSpec) => s.operators ?? DEFAULT_OPS[s.type ?? 'text']
  const update = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const add = (i: number) => {
    const f = fields[0]!
    const next = [...conditions]
    next.splice(i + 1, 0, { field: f.value, operator: opsFor(f)[0]!, value: '' })
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const s = spec(c.field)
        const ops = opsFor(s)
        return (
          <div key={i} className="rounded-sm bg-surface-subtle p-2.5">
            <div className="flex items-center gap-2">
              <Select aria-label="Field" className="w-[180px]" value={c.field} onChange={(e) => { const ns = spec(e.target.value); update(i, { field: e.target.value, operator: opsFor(ns)[0]!, value: '' }) }} options={fields.map((f) => ({ value: f.value, label: f.label }))} />
              {s.type !== 'none' && <Select aria-label="Operator" className="w-[150px]" value={c.operator} onChange={(e) => update(i, { operator: e.target.value })} options={ops.map((o) => ({ value: o, label: OPERATOR_LABELS[o] ?? o }))} />}
              {!NO_VALUE.has(c.operator) &&
                (s.type === 'select' ? (
                  <Select aria-label="Value" className="w-[150px]" value={String(c.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} options={s.options ?? []} placeholder="Choose…" />
                ) : (
                  <Input aria-label="Value" type={s.type === 'number' || s.type === 'none' ? 'number' : 'text'} className="w-[150px]" value={String(c.value ?? '')} onChange={(e) => update(i, { value: s.type === 'number' || s.type === 'none' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} />
                ))}
              <span className="flex-1" />
              <IconButton label="Remove condition" size="sm" icon={<Minus size={12} />} disabled={conditions.length <= minRows} onClick={() => onChange(conditions.filter((_, j) => j !== i))} />
              <IconButton label="Add condition" size="sm" icon={<Plus size={12} />} onClick={() => add(i)} />
            </div>
            {s.hint && <p className="mt-1 text-xs text-fg-secondary">{s.hint}</p>}
          </div>
        )
      })}
      {conditions.length === 0 && (
        <button type="button" onClick={() => add(-1)} className="text-sm text-primary hover:underline">
          + Add condition
        </button>
      )}
    </div>
  )
}

export interface ActionSpec {
  value: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'message'
  options?: SelectOption[]
  hint?: string
}

export interface ActionRow {
  type: string
  value: unknown
  name?: string | null
}

/** Reusable action rows — chat trigger actions, ticket trigger/automation/macro actions. */
export function ActionBuilder({ actions, onChange, specs }: { actions: ActionRow[]; onChange: (a: ActionRow[]) => void; specs: ActionSpec[] }) {
  const spec = (t: string) => specs.find((s) => s.value === t) ?? specs[0]!
  const update = (i: number, patch: Partial<ActionRow>) => onChange(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const add = (i: number) => {
    const next = [...actions]
    next.splice(i + 1, 0, { type: specs[0]!.value, value: '' })
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {actions.map((a, i) => {
        const s = spec(a.type)
        return (
          <div key={i} className="rounded-sm bg-surface-subtle p-2.5">
            <div className="flex items-start gap-2">
              <Select aria-label="Action" className="w-[180px]" value={a.type} onChange={(e) => update(i, { type: e.target.value, value: spec(e.target.value).type === 'boolean' ? true : '' })} options={specs.map((x) => ({ value: x.value, label: x.label }))} />
              {s.type === 'message' && <Input aria-label="Sender name" className="w-[130px]" placeholder="Sender name" value={a.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} />}
              {s.type === 'select' ? (
                <Select aria-label="Value" className="w-[180px]" value={String(a.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} options={s.options ?? []} placeholder="Choose…" />
              ) : s.type === 'boolean' ? (
                <Select aria-label="Value" className="w-[120px]" value={String(a.value ?? true)} onChange={(e) => update(i, { value: e.target.value === 'true' })} options={[{ value: 'true', label: 'Is true' }, { value: 'false', label: 'Is false' }]} />
              ) : s.type === 'textarea' || s.type === 'message' ? (
                <textarea aria-label="Value" rows={2} className="min-w-0 flex-1 rounded-sm border border-border px-2 py-1 text-sm" placeholder={s.type === 'message' ? 'Message' : ''} value={String(a.value ?? '')} onChange={(e) => update(i, { value: e.target.value })} />
              ) : (
                <Input aria-label="Value" type={s.type === 'number' ? 'number' : 'text'} className="w-[180px]" value={String(a.value ?? '')} onChange={(e) => update(i, { value: s.type === 'number' ? Number(e.target.value) : e.target.value })} />
              )}
              <span className="flex-1" />
              <IconButton label="Remove action" size="sm" icon={<Minus size={12} />} disabled={actions.length <= 1} onClick={() => onChange(actions.filter((_, j) => j !== i))} />
              <IconButton label="Add action" size="sm" icon={<Plus size={12} />} onClick={() => add(i)} />
            </div>
            {s.hint && <p className="mt-1 text-xs text-fg-secondary">{s.hint}</p>}
          </div>
        )
      })}
    </div>
  )
}
