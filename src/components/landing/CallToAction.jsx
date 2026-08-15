import React from 'react'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function CallToAction({ onApply, onResume }) {
  return (
    <section className="py-20 lg:py-24">
      <div className="container">
        <div className="relative overflow-hidden rounded-[1.75rem] bg-primary px-8 py-14 text-center text-primary-foreground shadow-lift sm:px-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-brand/20 blur-2xl"
          />

          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ready when you are</h2>
            <p className="mt-4 text-lg leading-relaxed text-primary-foreground/80">
              The first step takes a couple of minutes, and you can stop whenever you need to.
            </p>

            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button size="lg" variant="secondary" onClick={() => onApply('personal')}>
                Start an application
                <ArrowRight />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onResume}
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                Resume application
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
