import React from 'react'

import { Logo } from '@/components/brand/Logo'
import wordmark from '@/assets/izyane.png'

const FOOTER_LINKS = [
  { href: '#loans', label: 'Loans' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#requirements', label: 'What you need' },
  { href: '#faq', label: 'FAQ' },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="container flex flex-col gap-8 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm space-y-4">
          <Logo />
          <p className="text-sm leading-relaxed text-muted-foreground">
            A secure online loan application for personal and business borrowers in Zambia. Start on one device, finish
            on another.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Explore</h2>
          {FOOTER_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Powered by</span>
          <span className="inline-flex w-fit rounded-md bg-white p-2 ring-1 ring-border">
            <img src={wordmark} alt="iZyane InovSolutions and Payments" className="h-9 w-auto object-contain" />
          </span>
        </div> */}
      </div>

      <div className="border-t border-border/70">
        <div className="container flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} iZyane InovSolutions and Payments. All rights reserved.</p>
          <p>All amounts are shown in Zambian Kwacha (K).</p>
        </div>
      </div>
    </footer>
  )
}
