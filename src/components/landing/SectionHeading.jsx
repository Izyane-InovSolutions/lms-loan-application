import React from 'react'

import { cn } from '@/lib/utils'

/** Shared section header so every band on the page shares one type rhythm. */
export function SectionHeading({ eyebrow, title, description, align = 'center', className }) {
  const centered = align === 'center'

  return (
    <div className={cn('max-w-2xl', centered && 'mx-auto text-center', className)}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
      ) : null}
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {description ? <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  )
}
