import React from 'react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { SectionHeading } from '@/components/landing/SectionHeading'
import { DRAFT_RETENTION_DAYS, OTP_EXPIRY_MINUTES, describeFee, describeInterest, formatKwacha, priceLoan } from '@/config/loanProducts'
import { useProduct } from '@/hooks/useProducts'

/** The pricing answer, worked from the configured personal-loan pricing. */
const pricingFaq = (personal) => {
  const price = priceLoan(personal.exampleAmount, personal.defaultTenure, personal)
  return {
    question: 'How is my repayment worked out?',
    answer: `Interest is ${describeInterest(personal)} on the amount you borrow, plus a one-off fee (the facility fee) of ${describeFee(
      personal
    )}. Borrow ${formatKwacha(personal.exampleAmount)} over ${personal.defaultTenure} months and you repay ${formatKwacha(
      Math.round(price.total)
    )} in total, or about ${formatKwacha(Math.round(price.monthly))} a month. Nothing compounds, and the full breakdown appears on screen before you submit.`,
  }
}

const FAQS = [
  {
    question: 'Who can apply?',
    answer:
      'Anyone with a valid NRC (or a passport) and the documents the loan asks for. Each loan has its own minimum income and a limit on how much of your income can go to repayments. Enter your figures in "Our loans" above and every loan shows whether it fits, and how much it could lend you.',
  },
  {
    question: 'Will applying affect my credit record?',
    answer:
      'A credit bureau check is part of every application. It happens only when you submit, and the last screen tells you about it — or asks for your permission — before anything is sent. Looking at loans and entering your figures on this page never touches your credit record.',
  },
  {
    question: 'Why do I need a code to start?',
    answer: `Before the form opens we send a six-digit code to your email (or by text to your mobile, where available). It proves the contact details are yours, so updates about your loan reach you and nobody else can open your application. The code is valid for ${OTP_EXPIRY_MINUTES} minutes.`,
  },
  {
    question: 'Why am I asked for my NRC first?',
    answer:
      'If we already hold your details, entering your NRC (or a TPIN for a business) lets us fill in most of the form for you. We then send the code to the contact we have on record. If we don’t find you, you simply carry on with an empty form.',
  },
  {
    question: 'Can I start on my phone and finish on my laptop?',
    answer: `Yes. Once you have confirmed your email at the start, your progress syncs in the background. On the other device, choose "My application", then "Finish an application I started", enter the same email, and we send a code that is valid for ${OTP_EXPIRY_MINUTES} minutes. Your documents come back attached.`,
  },
  {
    question: 'What happens if I close the tab halfway through?',
    answer: `Nothing is lost. Your answers and uploads are saved as you type, so reopening the page offers to pick up where you stopped. Drafts are kept for ${DRAFT_RETENTION_DAYS} days and then deleted automatically.`,
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
    question: 'How long does a decision take, and how do I follow it?',
    answer:
      'Submitting sends your application straight to the lending team and you get a reference on screen. Assessment time depends on the loan and on how complete your documents are. To follow it, choose "My application", then "Track a submitted application" — you can also answer there if the team asks for anything.',
  },
]


export function Faq() {
  const personal = useProduct('personal')
  const faqs = [pricingFaq(personal), ...FAQS]
  return (
    <section id="faq" className="border-b border-border py-20 lg:py-24">
      <div className="container">
        <SectionHeading eyebrow="FAQ" title="Questions applicants ask us" />

        <div className="mx-auto mt-12 max-w-3xl">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
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
