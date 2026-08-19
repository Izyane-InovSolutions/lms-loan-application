import React from 'react'
import { ScanFace, MailCheck, Trash2, Smartphone } from 'lucide-react'

import { SectionHeading } from '@/components/landing/SectionHeading'
import { DRAFT_RETENTION_DAYS, OTP_EXPIRY_MINUTES } from '@/config/loanProducts'

const GUARANTEES = [
  {
    icon: ScanFace,
    title: 'The identity check never leaves your device',
    description:
      'The liveness check runs in your browser. It asks you to turn your head, smile and blink to confirm a real person is present — the video feed is processed locally and is never uploaded.',
  },
  {
    icon: MailCheck,
    title: 'Only you can pick your application back up',
    description: `Resuming on a new device needs a ${OTP_EXPIRY_MINUTES}-minute code sent to the email address on your application. Without that code, your draft cannot be opened.`,
  },
  {
    icon: Trash2,
    title: 'Drafts do not linger',
    description: `An unfinished application and everything attached to it is deleted automatically after ${DRAFT_RETENTION_DAYS} days. You can also clear it yourself at any time.`,
  },
  {
    icon: Smartphone,
    title: 'Built for the connection you actually have',
    description:
      'Your progress is written to your device first, so the form keeps working through a dropped signal and syncs again once you are back online.',
  },
]

export function TrustSection() {
  return (
    <section className="border-b border-border bg-secondary/40 py-20 lg:py-24">
      <div className="container">
        <SectionHeading
          eyebrow="Your data"
          title="Handled carefully, and not kept longer than needed"
          description="Applying for credit means handing over sensitive documents. Here is exactly what happens to them."
        />

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {GUARANTEES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-lg border bg-card p-6 shadow-soft">
              <span className="grid size-11 place-items-center rounded-md bg-accent text-accent-foreground">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
