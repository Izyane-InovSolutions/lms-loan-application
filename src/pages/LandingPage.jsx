import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useProductCatalog } from '@/hooks/useProducts'
import { MATCHING_PREFIX, isMatchingId, matchingProduct } from '@/config/loanProducts'
import { roleLabel } from '@/config/roles'
import { fetchPrefill, fetchReferrer } from '@/services/applicationsApi'
import { readReferral, rememberReferral } from '@/lib/referral'

// What the visitor typed into the loan finder, kept for this browser tab only (it is about their pay).
const FIGURES_KEY = 'los:qualify'
const readSavedFigures = () => {
  try {
    return JSON.parse(window.sessionStorage.getItem(FIGURES_KEY) || 'null') || {}
  } catch {
    return {}
  }
}
const saveFigures = (figures) => {
  try {
    window.sessionStorage.setItem(FIGURES_KEY, JSON.stringify(figures))
  } catch {
    // Storage blocked: the figures last until the page is left.
  }
}

function LandingPage() {
  const [resumeOpen, setResumeOpen] = useState(false)
  // The product being started (its id), while the email step is open.
  const [pendingProductId, setPendingProductId] = useState(null)
  // The loan finder (LoanProducts): who is borrowing, and what they earn, per loan type.
  const [loanType, setLoanType] = useState('personal')
  const [figures, setFigures] = useState(readSavedFigures)
  const { products, loanTypes } = useProductCatalog()
  // A product chosen in the finder, or a loan type's "we'll match you" application (loanProducts.js).
  const pendingProduct = useMemo(() => {
    const found = products.find((product) => product.id === pendingProductId)
    if (found || !isMatchingId(pendingProductId)) return found || null
    const type = loanTypes.find((entry) => `${MATCHING_PREFIX}${entry.key}` === pendingProductId)
    return type ? matchingProduct(type, products) : null
  }, [products, loanTypes, pendingProductId])
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

  // "Apply" from the header, hero and footer: the loan finder, on the type chosen (its first, if that one isn't offered).
  const handleChooseType = useCallback((type) => {
    setLoanType(type)
    requestAnimationFrame(() => document.getElementById('loans')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const handleFiguresChange = useCallback((type, values) => {
    setFigures((prev) => {
      const next = { ...prev, [type]: values }
      saveFigures(next)
      return next
    })
  }, [])

  const handleStart = useCallback(
    async (email) => {
      const product = pendingProduct || products[0]
      const start = applyPath(product.id, 0, product.form)
      // The figures they qualified on go with them: the wizard caps the amount by them, and submits them.
      const eligibility = figures[product.loanType] || null
      if (!email) {
        setPendingProductId(null)
        navigate(start, { state: { eligibility } })
        return
      }

      // A failed lookup just means starting blank, never a blocked start. Earlier
      // applications are looked up by form: the same questions, whatever the product.
      const formState = await fetchPrefill(email, product.form).catch(() => null)
      if (!formState) {
        setPendingProductId(null)
        navigate(start, { state: { startEmail: email, eligibility } })
        return
      }

      setPendingProductId(null)
      navigate(start, { state: { startEmail: email, prefilledApplication: formState, eligibility } })
    },
    [navigate, pendingProduct, products, figures]
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
      <SiteHeader onApply={handleChooseType} onResume={handleResume} />

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
        <Hero onChooseType={handleChooseType} onCheckStatus={handleCheckStatus} />
        <LoanProducts loanType={loanType} onLoanTypeChange={setLoanType} figures={figures} onFiguresChange={handleFiguresChange} onApply={handleApply} />
        <HowItWorks />
        <Requirements />
        <TrustSection />
        <Faq />
        <CallToAction onApply={handleChooseType} onResume={handleResume} />
      </main>

      <SiteFooter />

      <StartApplicationDialog
        open={Boolean(pendingProductId)}
        onOpenChange={(open) => {
          if (!open) setPendingProductId(null)
        }}
        productName={pendingProduct?.matching ? `${pendingProduct.name.toLowerCase()} application` : pendingProduct?.name}
        onStart={handleStart}
      />

      <ResumeApplicationDialog open={resumeOpen} onOpenChange={setResumeOpen} onResumed={handleResumed} />

    </div>
  )
}

export default LandingPage
