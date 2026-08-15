import React, { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SiteHeader } from '@/components/landing/SiteHeader'
import { Hero } from '@/components/landing/Hero'
import { LoanProducts } from '@/components/landing/LoanProducts'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Requirements } from '@/components/landing/Requirements'
import { TrustSection } from '@/components/landing/TrustSection'
import { Faq } from '@/components/landing/Faq'
import { CallToAction } from '@/components/landing/CallToAction'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { ResumeApplicationDialog } from '@/components/landing/ResumeApplicationDialog'

function LandingPage() {
  const [resumeOpen, setResumeOpen] = useState(false)
  const navigate = useNavigate()

  const handleApply = useCallback(
    (type) => {
      navigate('/apply', { state: { type } })
    },
    [navigate]
  )

  const handleResume = useCallback(() => setResumeOpen(true), [])

  const handleResumed = useCallback(
    (draft) => {
      navigate('/apply', { state: { type: draft.loanType, resumedDraft: draft } })
    },
    [navigate]
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader onApply={handleApply} onResume={handleResume} />

      <main className="flex-1">
        <Hero onApply={handleApply} onResume={handleResume} />
        <LoanProducts onApply={handleApply} />
        <HowItWorks />
        <Requirements />
        <TrustSection />
        <Faq />
        <CallToAction onApply={handleApply} onResume={handleResume} />
      </main>

      <SiteFooter />

      <ResumeApplicationDialog open={resumeOpen} onOpenChange={setResumeOpen} onResumed={handleResumed} />
    </div>
  )
}

export default LandingPage
