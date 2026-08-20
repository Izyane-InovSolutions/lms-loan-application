import React, { useState } from 'react'
import { ArrowRight, ScanFace, Search, ShieldCheck, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DRAFT_RETENTION_DAYS,
  DEFAULT_TENURE_MONTHS,
  formatKwacha,
  getProduct,
  monthlyInstalment,
  totalRepayable,
} from '@/config/loanProducts'
import heroImage from '@/assets/hero1.png'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ASSURANCES = [
  { icon: Save, label: `Progress saved for ${DRAFT_RETENTION_DAYS} days` },
  { icon: ShieldCheck, label: 'Resume by email verification' },
  { icon: ScanFace, label: 'Identity check runs on your device' },
]

export function Hero({ onApply, onCheckStatus }) {
  const personal = getProduct('personal')
  const business = getProduct('business')
  const example = personal.exampleAmount

  const [statusEmail, setStatusEmail] = useState('')
  const [statusError, setStatusError] = useState('')

  const handleCheckStatus = (event) => {
    event.preventDefault()
    const normalized = statusEmail.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalized)) {
      setStatusError('Enter a valid email address.')
      return
    }
    setStatusError('')
    onCheckStatus(normalized)
  }

  return (
    <section id="top" className="relative overflow-hidden border-b border-border">
      {/* Decorative wash — kept behind content and hidden from assistive tech. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -right-24 -top-32 size-[34rem] rounded-full bg-accent blur-3xl" />
        <div className="absolute -left-40 bottom-0 size-[26rem] rounded-full bg-secondary blur-3xl" />
      </div>

      <div className="container grid items-center gap-12 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className="max-w-xl">
          <Badge variant="accent">Personal &amp; business lending · Zambia</Badge>

          <h1 className="mt-6 text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]">
            Apply for a loan, <span className="text-primary">start to finish</span>, online.
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
            Personal loans from {formatKwacha(personal.minAmount)} to {formatKwacha(personal.maxAmount)}, and business
            loans up to {formatKwacha(business.maxAmount)}. Work through the form at your own pace — everything you
            enter is saved as you go, so you can stop on your phone and finish on a laptop.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="flex-1" onClick={() => onApply('personal')}>
              Apply for a personal loan
              <ArrowRight />
            </Button>
            <Button size="lg" variant="outline" className="flex-1" onClick={() => onApply('business')}>
              Apply for a business loan
            </Button>
          </div>

          <form
            onSubmit={handleCheckStatus}
            className="mt-5 flex flex-col gap-2 rounded-full border border-border bg-card p-1.5 shadow-sm sm:flex-row sm:items-center"
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="email"
                value={statusEmail}
                onChange={(event) => setStatusEmail(event.target.value)}
                placeholder="Enter the email you applied with"
                aria-label="Email address"
                className="border-0 bg-transparent pl-10 shadow-none focus-visible:ring-0"
              />
            </div>
            <Button type="submit" variant="secondary" className="rounded-full sm:shrink-0 left-4">
              Check application status
            </Button>
          </form>
          {statusError ? (
            <p role="alert" className="mt-2 text-sm font-medium text-destructive">
              {statusError}
            </p>
          ) : null}

          <ul className="mt-10 grid gap-3 border-t border-border pt-8 sm:grid-cols-3">
            {ASSURANCES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="relative mx-auto aspect-square w-full max-w-lg overflow-hidden rounded-[2rem] bg-gradient-to-br from-accent via-secondary to-background ring-1 ring-border">
            <img
              src={heroImage}
              alt="An applicant completing a loan application on a laptop"
              className="absolute inset-x-0 bottom-0 mx-auto w-[92%] object-contain"
              loading="eager"
              width={827}
              height={719}
            />
          </div>

          {/* Worked example, computed from the same constants the wizard uses. */}
          <div className="absolute -bottom-6 left-1/2 w-[min(22rem,90%)] -translate-x-1/2 rounded-lg border bg-card p-5 shadow-lift lg:-left-6 lg:translate-x-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Worked example</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatKwacha(example)} over {DEFAULT_TENURE_MONTHS} months
            </p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-foreground">
              {formatKwacha(Math.round(monthlyInstalment(example, DEFAULT_TENURE_MONTHS)))}
              <span className="ml-1.5 text-sm font-medium text-muted-foreground">/ month</span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {formatKwacha(Math.round(totalRepayable(example)))} total repayable, including the facility fee.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
