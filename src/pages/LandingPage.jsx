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
import { StartApplicationDialog } from '@/components/landing/StartApplicationDialog'
import { ApplicationStatusDialog } from '@/components/landing/ApplicationStatusDialog'
import { applyPath } from '@/config/applicationSteps'

function LandingPage() {
  const [resumeOpen, setResumeOpen] = useState(false)
  const [pendingLoanType, setPendingLoanType] = useState(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusEmail, setStatusEmail] = useState('')
  const navigate = useNavigate()

  // Every "apply" entry point asks for an email first so the draft can sync from
  // the very first field; the wizard prefills it and carries on.
  const handleApply = useCallback((type) => setPendingLoanType(type), [])

  const handleStart = useCallback(
    (email) => {
      const type = pendingLoanType || 'personal'
      setPendingLoanType(null)
      navigate(applyPath(type, 0), { state: email ? { startEmail: email } : undefined })
    },
    [navigate, pendingLoanType]
  )

  const handleResume = useCallback(() => setResumeOpen(true), [])

  const handleCheckStatus = useCallback((email) => {
    setStatusEmail(email)
    setStatusOpen(true)
  }, [])

  const handleResumed = useCallback(
    (draft) => {
      navigate(applyPath(draft.loanType, draft.currentStep || 0), { state: { resumedDraft: draft } })
    },
    [navigate]
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader onApply={handleApply} onResume={handleResume} />

      <main className="flex-1">
        <Hero onApply={handleApply} onCheckStatus={handleCheckStatus} />
        <LoanProducts onApply={handleApply} />
        <HowItWorks />
        <Requirements />
        <TrustSection />
        <Faq />
        <CallToAction onApply={handleApply} onResume={handleResume} />
      </main>

      <SiteFooter />

      <StartApplicationDialog
        open={Boolean(pendingLoanType)}
        onOpenChange={(open) => {
          if (!open) setPendingLoanType(null)
        }}
        loanType={pendingLoanType}
        onStart={handleStart}
      />

      <ResumeApplicationDialog open={resumeOpen} onOpenChange={setResumeOpen} onResumed={handleResumed} />

      <ApplicationStatusDialog open={statusOpen} onOpenChange={setStatusOpen} email={statusEmail} />
    </div>
  )
}

export default LandingPage
