import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/utils/cn'

const fieldBase =
  'w-full rounded-sm border bg-surface px-2 text-sm text-fg placeholder:text-fg-secondary/70 ' +
  'transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ' +
  'disabled:bg-surface-subtle disabled:text-fg-secondary'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-[30px]', invalid ? 'border-danger' : 'border-border', className)}
      {...rest}
    />
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, rows = 4, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'py-1.5 resize-y', invalid ? 'border-danger' : 'border-border', className)}
      {...rest}
    />
  )
})

export interface SelectOption<V extends string = string> {
  value: V
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[]
  placeholder?: string
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, placeholder, invalid, className, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldBase, 'h-[30px] pr-6 font-bold', invalid ? 'border-danger' : 'border-border', className)}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
})

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
}

export function SearchInput({ value, onChange, className, placeholder = 'Search', ...rest }: SearchInputProps) {
  return (
    <div className={cn('relative w-[170px]', className)}>
      <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary" aria-hidden />
      <input
        type="search"
        role="searchbox"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldBase, 'h-[26px] rounded-full border-border pl-7 pr-6 [&::-webkit-search-cancel-button]:hidden')}
        {...rest}
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary hover:text-fg">
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
  description?: ReactNode
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, indeterminate, className, id, ...rest }, ref) {
  const autoId = useId()
  const cid = id ?? autoId
  return (
    <label htmlFor={cid} className={cn('inline-flex items-start gap-2 text-sm', rest.disabled && 'opacity-60', className)}>
      <input
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        id={cid}
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]"
        {...rest}
      />
      {(label || description) && (
        <span>
          {label && <span className="text-fg">{label}</span>}
          {description && <span className="block text-fg-secondary">{description}</span>}
        </span>
      )}
    </label>
  )
})

export interface RadioGroupProps<V extends string> {
  name: string
  value: V
  onChange: (v: V) => void
  options: { value: V; label: ReactNode; description?: ReactNode }[]
  direction?: 'row' | 'column'
  disabled?: boolean
}

export function RadioGroup<V extends string>({ name, value, onChange, options, direction = 'column', disabled }: RadioGroupProps<V>) {
  return (
    <div role="radiogroup" className={cn('flex gap-2', direction === 'column' ? 'flex-col' : 'flex-row flex-wrap')}>
      {options.map((o) => (
        <label key={o.value} className={cn('inline-flex items-start gap-2 text-sm', disabled && 'opacity-60')}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            className="mt-0.5 accent-[var(--primary)]"
          />
          <span>
            {o.label}
            {o.description && <span className="block text-fg-secondary">{o.description}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

export interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
  /** Render as the reference's On/Off segmented pair instead of a slider. */
  appearance?: 'toggle' | 'onoff'
}

export function Switch({ checked, onChange, label, disabled, appearance = 'toggle' }: SwitchProps) {
  if (appearance === 'onoff') {
    return (
      <div role="group" aria-label={label} className={cn('inline-flex overflow-hidden rounded-sm border border-border', disabled && 'opacity-50')}>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            disabled={disabled}
            aria-pressed={checked === v}
            onClick={() => onChange(v)}
            className={cn('h-[26px] px-3 text-xs font-bold', checked === v ? 'bg-surface-muted text-fg' : 'bg-surface text-fg-secondary', !v && 'border-l border-border')}
          >
            {v ? 'On' : 'Off'}
          </button>
        ))}
      </div>
    )
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-primary' : 'bg-border-strong')}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

export interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  mode?: 'date' | 'time' | 'datetime-local'
  onChange: (value: string) => void
}

/** Native date/time picker styled with the shared field look. TimePicker = <DatePicker mode="time" />. */
export function DatePicker({ mode = 'date', onChange, className, ...rest }: DatePickerProps) {
  return <input type={mode} onChange={(e) => onChange(e.target.value)} className={cn(fieldBase, 'h-[30px] border-border', className)} {...rest} />
}

export function TimePicker(props: Omit<DatePickerProps, 'mode'>) {
  return <DatePicker mode="time" {...props} />
}
