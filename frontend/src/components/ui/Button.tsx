import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  fullWidth?: boolean
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white border border-primary hover:bg-primary-hover hover:border-primary-hover',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong',
  danger: 'bg-danger text-white border border-danger hover:bg-danger-hover',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-hover',
  link: 'bg-transparent text-primary border border-transparent hover:underline px-0',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-[26px] px-2.5 text-xs',
  md: 'h-[30px] px-3 text-xs',
  lg: 'h-9 px-4 text-md',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, leftIcon, rightIcon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-sm font-bold whitespace-nowrap select-none',
        'transition-colors duration-[var(--duration-fast)] disabled:opacity-50',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  )
})
