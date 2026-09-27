import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { UserCheck } from 'lucide-react'

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
import { roleLabel } from '@/config/roles'
import { fetchPrefill, fetchReferrer } from '@/services/applicationsApi'
import { readReferral, rememberReferral } from '@/lib/referral'

function LandingPage() {
  const [resumeOpen, setResumeOpen] = useState(false)
  const [pendingLoanType, setPendingLoanType] = useState(null)
  const [referrer, setReferrer] = useState(null)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // An agent's link (/?ref=CODE): remembered so the application is credited to them,
  // and named on the page so the customer knows who referred them.
  useEffect(() => {
    const code = rememberReferral(searchParams.get('ref')) || readReferral()
    if (!code) return
    fetchReferrer(code).then(setReferrer)
  }, [searchParams])

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

      // A failed lookup just means starting blank, never a blocked start.
      const formState = await fetchPrefill(email, type).catch(() => null)
      if (!formState) {
        setPendingLoanType(null)
        navigate(applyPath(type, 0), { state: { startEmail: email } })
        return
      }

      setPendingLoanType(null)
      navigate(applyPath(type, 0), { state: { startEmail: email, prefilledApplication: formState } })
    },
    [navigate, pendingLoanType]
  )

  const handleResume = useCallback(() => setResumeOpen(true), [])

  const handleCheckStatus = useCallback((email) => navigate('/my-applications', { state: { email } }), [navigate])

  const handleResumed = useCallback(
    (draft) => {
      navigate(applyPath(draft.loanType, draft.currentStep || 0), { state: { resumedDraft: draft } })
    },
    [navigate]
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader onApply={handleApply} onResume={handleResume} />

      {referrer ? (
        <div className="border-b bg-primary/5">
          <p className="container flex items-center gap-2 py-2.5 text-sm text-foreground">
            <UserCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            You’re applying with {referrer.firstName}, your {roleLabel(referrer.role).toLowerCase()}. Your application will be
            passed to them.
          </p>
        </div>
      ) : null}

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

    </div>
  )
}

export default LandingPage
