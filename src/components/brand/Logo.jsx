import React from 'react'

import { cn } from '@/lib/utils'
import mark from '@/assets/Icon.png'

/**
 * The IISP mark plus optional wordmark.
 *
 * Icon.png ships with a white (not transparent) background, so the mark is always
 * placed on an explicit white tile — that reads as a deliberate app icon instead of
 * a white rectangle floating on a tinted surface.
 */
export function Logo({ className, showWordmark = true, size = 'default' }) {
  const tile = size === 'sm' ? 'size-8' : 'size-10'

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-border', tile)}>
        <img src={mark} alt="" aria-hidden="true" className="size-full object-contain p-0.5" />
      </span>
      {showWordmark ? (
        <span className="flex flex-col leading-none">
          <span className={cn('font-semibold tracking-tight', size === 'sm' ? 'text-sm' : 'text-base')}>iZyane</span>
          <span className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Loan Portal
          </span>
        </span>
      ) : null}
    </span>
  )
}
