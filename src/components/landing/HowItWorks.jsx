import React from 'react'

import { SectionHeading } from '@/components/landing/SectionHeading'
import { APPLICATION_JOURNEY } from '@/config/loanProducts'

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-border bg-secondary/40 py-20 lg:py-24">
      <div className="container">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps, and you can pause at any point"
          description="The form is broken into short stages. Each one saves on its own, so a lost connection or a flat battery never costs you the work you have already done."
        />

        <ol className="relative mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {/* Connector rail, desktop only. */}
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-5 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent lg:block"
          />

          {APPLICATION_JOURNEY.map((stage, index) => (
            <li key={stage.title} className="relative">
              <span className="relative z-10 grid size-10 place-items-center rounded-full border border-primary/25 bg-background text-sm font-bold text-primary shadow-soft">
                {index + 1}
              </span>
              <h3 className="mt-5 text-base font-semibold text-foreground">{stage.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{stage.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
