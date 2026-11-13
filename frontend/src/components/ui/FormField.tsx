import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface FormFieldProps {
  label: ReactNode
  /** Helper text under the control. */
  hint?: ReactNode
  error?: string
  required?: boolean
  /** "inline" = label column on the left (reference settings layout); "stacked" = label above. */
  layout?: 'inline' | 'stacked'
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; invalid?: boolean }>
  className?: string
}

export function FormField({ label, hint, error, required, layout = 'inline', children, className }: FormFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const control = isValidElement(children)
    ? cloneElement(children, { id: children.props.id ?? id, 'aria-describedby': hint || error ? hintId : undefined, invalid: !!error || undefined })
    : children
  return (
    <div className={cn(layout === 'inline' ? 'grid grid-cols-[110px_1fr] items-start gap-x-4' : 'flex flex-col gap-1', 'py-2', className)}>
      <label htmlFor={children.props.id ?? id} className={cn('text-sm text-fg', layout === 'inline' && 'pt-1.5')}>
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      <div className="min-w-0">
        {control}
        {(error || hint) && (
          <p id={hintId} className={cn('mt-1 text-xs', error ? 'text-danger' : 'text-fg-secondary')}>
            {error ?? hint}
          </p>
        )}
      </div>
    </div>
  )
}
