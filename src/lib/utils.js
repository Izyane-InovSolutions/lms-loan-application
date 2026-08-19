import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Merges conditional class lists while letting later Tailwind utilities win over
// earlier ones (so a caller's `className` can always override a component default).
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
