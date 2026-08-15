import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base ring-offset-background transition-colors',
      'placeholder:text-muted-foreground/70',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
      className
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
