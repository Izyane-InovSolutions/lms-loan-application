import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import icon from '@/assets/Icon.png'

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-white ring-1 ring-border">
            <img src={icon} alt="" aria-hidden="true" className="size-full object-contain p-0.5" />
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-base font-semibold tracking-tight">Loan Application</span>
            <span className="mt-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Limited
            </span>
          </div>
        </div>

        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft />
            Back to Home
          </Link>
        </Button>
      </div>
    </header>
  )
}

export default Header
