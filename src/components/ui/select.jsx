import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Native <select> with our field styling. Deliberately native rather than a Radix
 * listbox: it inherits platform keyboard behaviour and the mobile wheel picker,
 * which matters more on the low-end Android devices this form targets.
 */
const Select = React.forwardRef(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full appearance-none rounded-md border border-input bg-background px-3.5 py-2 pr-10 text-base ring-offset-background transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
        // Placeholder option renders muted until a real value is chosen.
        'invalid:text-muted-foreground/70',
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
))
Select.displayName = 'Select'

export { Select }
