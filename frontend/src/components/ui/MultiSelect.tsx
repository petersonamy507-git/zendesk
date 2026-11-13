import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Popover } from './Popover'
import { Checkbox } from './Input'
import { Tag } from './Badge'
import type { SelectOption } from './Input'

export interface MultiSelectProps {
  options: SelectOption[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  /** Allow creating values that are not in options (e.g. free-form tags). */
  creatable?: boolean
  label?: string
}

export function MultiSelect({ options, value, onChange, placeholder = 'Select…', creatable, label }: MultiSelectProps) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q])
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  return (
    <Popover
      className="w-full min-w-[240px]"
      trigger={(p) => (
        <button {...p} type="button" aria-label={label} className="flex min-h-[30px] w-full flex-wrap items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-left text-sm">
          {value.length === 0 && <span className="text-fg-secondary">{placeholder}</span>}
          {value.map((v) => (
            <Tag key={v} onRemove={() => toggle(v)}>
              {labelOf(v)}
            </Tag>
          ))}
          <ChevronDown size={12} className="ml-auto text-fg-secondary" />
        </button>
      )}
    >
      <div className="p-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && creatable && q.trim()) {
              e.preventDefault()
              if (!value.includes(q.trim())) onChange([...value, q.trim()])
              setQ('')
            }
          }}
          placeholder={creatable ? 'Search or press Enter to add' : 'Search'}
          className="mb-2 h-[26px] w-full rounded-sm border border-border px-2 text-sm"
        />
        <div className="max-h-56 overflow-auto">
          {filtered.map((o) => (
            <div key={o.value} className="px-1 py-1">
              <Checkbox label={o.label} checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
            </div>
          ))}
          {filtered.length === 0 && <p className="px-1 py-1 text-fg-secondary">No matches</p>}
        </div>
      </div>
    </Popover>
  )
}
