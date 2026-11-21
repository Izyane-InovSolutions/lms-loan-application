import React, { useEffect, useState } from 'react'
import { Menu, UserRound, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/Logo'
import { useBranding } from '@/components/brand/BrandingProvider'
import { cn } from '@/lib/utils'

export const NAV_LINKS = [
  { href: '#loans', label: 'Loans' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#requirements', label: 'What you need' },
  { href: '#faq', label: 'FAQ' },
]

/**
 * The landing page header: section links, "My application" (finish a draft or track one),
 * "Apply and get matched", and the main action, "Find your loan", which opens the loan finder. Below `lg` the
 * section links move into a menu, so they are reachable on a phone too.
 */
export function SiteHeader({ onApply, onMatch, onMyApplication }) {
  const { name } = useBranding()
  const [menuOpen, setMenuOpen] = useState(false)

  // Escape closes the menu, as it would a dialog.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (event) => event.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const close = () => setMenuOpen(false)

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="container flex h-16 items-center justify-between gap-4">
        <a href="#top" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <Logo />
          <span className="sr-only">{name} — back to top</span>
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

        <div className="flex items-center gap-1.5 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onMyApplication} aria-label="My application: finish or track an application">
            <UserRound />
            <span className="hidden sm:inline">My application</span>
          </Button>
          {/* Apply first, and the documents decide which loans fit ("we'll match you"). */}
          {onMatch ? (
            <Button variant="outline" size="sm" className="hidden md:inline-flex lg:hidden xl:inline-flex" onClick={onMatch}>
              Apply and get matched
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onApply('personal')}>
            Find your loan
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>
        </div>
      </div>

      <nav
        id="mobile-menu"
        aria-label="Sections"
        hidden={!menuOpen}
        className={cn('border-t border-border/70 bg-background lg:hidden', !menuOpen && 'hidden')}
      >
        <div className="container flex flex-col py-2">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={close}
              className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => {
              close()
              onMyApplication()
            }}
            className="rounded-md px-3 py-3 text-left text-base font-medium text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Finish or track my application
          </button>
          {onMatch ? (
            <button
              type="button"
              onClick={() => {
                close()
                onMatch()
              }}
              className="rounded-md px-3 py-3 text-left text-base font-medium text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            >
              Apply and get matched
            </button>
          ) : null}
        </div>
      </nav>
    </header>
  )
}
