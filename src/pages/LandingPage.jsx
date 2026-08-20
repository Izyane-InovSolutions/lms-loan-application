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
import { applyPath } from '@/config/applicationSteps'
import { getLoanApplicationsByEmail } from '@/services/lmsApi'
import { mapApplicationToFormState, selectLatestApplication } from '@/utils/applicationPrefillMapper'

function LandingPage() {
  const [resumeOpen, setResumeOpen] = useState(false)
  const [pendingLoanType, setPendingLoanType] = useState(null)
  const navigate = useNavigate()

  // Every "apply" entry point asks for an email first so the draft can sync from
  // the very first field; the wizard prefills it and carries on.
  const handleApply = useCallback((type) => setPendingLoanType(type), [])

  const handleStart = useCallback(
    async (email) => {
      const type = pendingLoanType || 'personal'
      if (!email) {
        setPendingLoanType(null)
        navigate(applyPath(type, 0))
        return
      }

      const applications = await getLoanApplicationsByEmail(email)
      const latestApplication = selectLatestApplication(applications, type)
      if (!latestApplication) {
        setPendingLoanType(null)
        navigate(applyPath(type, 0), { state: { startEmail: email } })
        return
      }

      const formState = mapApplicationToFormState(latestApplication, type)
      setPendingLoanType(null)
      navigate(applyPath(type, 0), { state: { startEmail: email, prefilledApplication: formState } })
    },
    [navigate, pendingLoanType]
  )

  const handleResume = useCallback(() => setResumeOpen(true), [])

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
        <Hero onApply={handleApply} onResume={handleResume} />
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
    </div>
  )
}

export default LandingPage
