import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'default' | 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'btn whitespace-nowrap',
        variant === 'primary' && 'btn-primary shadow-soft',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'border-err/40 text-err hover:border-err',
        size === 'sm' && 'px-3 py-1 text-xs',
        size === 'lg' && 'px-6 py-3 text-base',
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
