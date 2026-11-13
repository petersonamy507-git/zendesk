import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  /** Accessible label (required — icon-only buttons have no text). */
  label: string
  variant?: 'outline' | 'ghost' | 'inverse'
  size?: 'sm' | 'md'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'outline', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-full transition-colors disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-[30px] w-[30px]',
        variant === 'outline' && 'border border-border bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg',
        variant === 'ghost' && 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
        variant === 'inverse' && 'text-sidebar-fg hover:bg-sidebar-hover',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
})
