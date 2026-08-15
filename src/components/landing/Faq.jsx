import React from 'react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { SectionHeading } from '@/components/landing/SectionHeading'
import {
  DEFAULT_TENURE_MONTHS,
  DRAFT_RETENTION_DAYS,
  FACILITY_FEE,
  INTEREST_RATE,
  OTP_EXPIRY_MINUTES,
  formatKwacha,
  getProduct,
  monthlyInstalment,
  totalRepayable,
} from '@/config/loanProducts'

const example = getProduct('personal').exampleAmount

const FAQS = [
  {
    question: 'How is my repayment worked out?',
    answer: `Interest is a flat ${INTEREST_RATE * 100}% on the amount you borrow, plus a one-off facility fee of ${formatKwacha(
      FACILITY_FEE
    )}. Borrow ${formatKwacha(example)} over ${DEFAULT_TENURE_MONTHS} months and you repay ${formatKwacha(
      Math.round(totalRepayable(example))
    )} in total, or about ${formatKwacha(
      Math.round(monthlyInstalment(example, DEFAULT_TENURE_MONTHS))
    )} a month. Nothing compounds, and the full breakdown appears on screen before you submit.`,
  },
  {
    question: 'Can I start on my phone and finish on my laptop?',
    answer: `Yes. Enter your email address early in the form and your progress syncs in the background. On the other device, choose "Resume application", enter the same email, and we send a six-digit code that is valid for ${OTP_EXPIRY_MINUTES} minutes. Your documents come back attached.`,
  },
  {
    question: 'What happens if I close the tab halfway through?',
    answer: `Nothing is lost. Your answers and uploads are saved on your device as you type, so reopening the page offers to pick up where you stopped. Drafts are kept for ${DRAFT_RETENTION_DAYS} days and then deleted automatically.`,
  },
  {
    question: 'Why do I need to take a selfie?',
    answer:
      'It confirms a real person is completing the application rather than someone using a photograph. The check asks you to turn your head, smile and blink. It runs entirely inside your browser — the camera feed is never uploaded, and only the still image you approve is kept.',
  },
  {
    question: 'What format should my NRC and phone number be in?',
    answer:
      'Your NRC follows the standard Zambian pattern, for example 123456/78/9. Phone numbers are accepted either with the country code (+260…) or with a leading zero (09…). The form tells you straight away if something does not look right.',
  },
  {
    question: 'How long does a decision take?',
    answer:
      'Submitting sends your application straight into the lending team’s system and you get an on-screen confirmation. Assessment timelines depend on the loan and on how complete your documents are — you will be contacted using the phone number and email you provide.',
  },
]

export function Faq() {
  return (
    <section id="faq" className="border-b border-border py-20 lg:py-24">
      <div className="container">
        <SectionHeading eyebrow="FAQ" title="Questions applicants ask us" />

        <div className="mx-auto mt-12 max-w-3xl">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, index) => (
              <AccordionItem key={faq.question} value={`item-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
