import React from 'react'
import { Globe, Mail, MapPin, Phone } from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { useBranding } from '@/components/brand/BrandingProvider'
import wordmark from '@/assets/izyane.png'

const FOOTER_LINKS = [
  { href: '#loans', label: 'Loans' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#requirements', label: 'What you need' },
  { href: '#faq', label: 'FAQ' },
]

const linkClass =
  'text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** "+260 97 1234567" → "tel:+260971234567". */
const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`
const webHref = (site) => (/^https?:\/\//i.test(site) ? site : `https://${site}`)

export function SiteFooter() {
  // The contacts from Settings → Branding → Letterhead; the column shows only once one is set.
  const { contact = {} } = useBranding()
  const contacts = [
    contact.phone && { icon: Phone, label: contact.phone, href: telHref(contact.phone) },
    contact.email && { icon: Mail, label: contact.email, href: `mailto:${contact.email}` },
    contact.website && { icon: Globe, label: contact.website.replace(/^https?:\/\//i, ''), href: webHref(contact.website), external: true },
    contact.address && { icon: MapPin, label: contact.address },
  ].filter(Boolean)

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
              className={linkClass}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {contacts.length ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Get in touch</h2>
            <ul className="flex flex-col gap-3">
              {contacts.map(({ icon: Icon, label, href, external }) => (
                <li key={label} className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                  {href ? (
                    <a href={href} className={linkClass} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                      {label}
                    </a>
                  ) : (
                    <span className="max-w-[16rem] whitespace-pre-line text-sm text-muted-foreground">{label}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
