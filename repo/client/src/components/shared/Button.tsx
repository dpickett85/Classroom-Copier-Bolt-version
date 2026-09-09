/**
 * Paperwork controls, not app-store pills: rectangular, 3px radius, solid teal
 * primary / outlined secondary (03-ui-direction.md §3). The `link` variant is
 * the header's "Switch account" / "Sign out" treatment.
 *
 * Minimum 44x44px hit area and the never-suppressed `:focus-visible` ring come
 * from `tokens.css`, so they cannot be dropped per-instance.
 */
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'link'

const CLASS: Record<Variant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  link: 'link-btn',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'primary', className, type, ...rest }: ButtonProps) {
  return (
    <button type={type ?? 'button'} className={`${CLASS[variant]}${className ? ` ${className}` : ''}`} {...rest} />
  )
}
