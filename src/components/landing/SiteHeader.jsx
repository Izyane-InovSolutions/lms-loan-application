import React from 'react'

import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/Logo'

const NAV_LINKS = [
  { href: '#loans', label: 'Loans' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#requirements', label: 'What you need' },
  { href: '#faq', label: 'FAQ' },
]

export function SiteHeader({ onApply, onResume }) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center justify-between gap-6">
        <a href="#top" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Logo />
          <span className="sr-only">iZyane Loan Portal — back to top</span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={onResume}>
            Resume application
          </Button>
          <Button size="sm" onClick={() => onApply('personal')}>
            Apply now
          </Button>
        </div>
      </div>
    </header>
  )
}
