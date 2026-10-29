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
import { useProducts } from '@/hooks/useProducts'
import { roleLabel } from '@/config/roles'
import { fetchPrefill, fetchReferrer } from '@/services/applicationsApi'
import { readReferral, rememberReferral } from '@/lib/referral'

function LandingPage() {
  const [resumeOpen, setResumeOpen] = useState(false)
  // The product being started (its id), while the email step is open.
  const [pendingProductId, setPendingProductId] = useState(null)
  const products = useProducts()
  const pendingProduct = products.find((product) => product.id === pendingProductId) || null
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

  // The link in a "finish your application" reminder (/?resume=1) opens the resume step.
  useEffect(() => {
    if (searchParams.get('resume') === '1') setResumeOpen(true)
  }, [searchParams])

  // Every "apply" entry point asks for an email first so the draft can sync from
  // the very first field; the wizard prefills it and carries on.
  const handleApply = useCallback((productId) => setPendingProductId(productId), [])

  const handleStart = useCallback(
    async (email) => {
      const product = pendingProduct || products[0]
      const start = applyPath(product.id, 0, product.form)
      if (!email) {
        setPendingProductId(null)
        navigate(start)
        return
      }

      // A failed lookup just means starting blank, never a blocked start. Earlier
      // applications are looked up by form: the same questions, whatever the product.
      const formState = await fetchPrefill(email, product.form).catch(() => null)
      if (!formState) {
        setPendingProductId(null)
        navigate(start, { state: { startEmail: email } })
        return
      }

      setPendingProductId(null)
      navigate(start, { state: { startEmail: email, prefilledApplication: formState } })
    },
    [navigate, pendingProduct, products]
  )

  const handleResume = useCallback(() => setResumeOpen(true), [])

  const handleCheckStatus = useCallback((email) => navigate('/my-applications', { state: { email } }), [navigate])

  const handleResumed = useCallback(
    (draft) => {
      navigate(applyPath(draft.loanData?.productId || draft.loanType, draft.currentStep || 0, draft.loanType), { state: { resumedDraft: draft } })
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
            You’re applying with {referrer.firstName}, your {(referrer.roleLabel || roleLabel(referrer.role)).toLowerCase()}. Your application will be
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
        open={Boolean(pendingProductId)}
        onOpenChange={(open) => {
          if (!open) setPendingProductId(null)
        }}
        productName={pendingProduct?.name}
        onStart={handleStart}
      />

      <ResumeApplicationDialog open={resumeOpen} onOpenChange={setResumeOpen} onResumed={handleResumed} />

    </div>
  )
}

export default LandingPage
