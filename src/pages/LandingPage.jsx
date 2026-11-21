import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, UserCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'

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
import { applyPath } from '@/config/applicationSteps'
import { useProductCatalog } from '@/hooks/useProducts'
import { MATCHING_PREFIX, isMatchingId, matchingProduct } from '@/config/loanProducts'
import { roleLabel } from '@/config/roles'
import { fetchReferrer } from '@/services/applicationsApi'
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
  // "My application": closed, or open on its choice ('choose') or straight on finishing a draft ('resume').
  const [myApplication, setMyApplication] = useState(null)
  // The mobile "Find your loan" bar shows until the loan finder is on screen.
  const [finderInView, setFinderInView] = useState(false)
  // The loan finder (LoanProducts): who is borrowing, and what they earn, per loan type.
  const [loanType, setLoanType] = useState('personal')
  const [figures, setFigures] = useState(readSavedFigures)
  const { products, loanTypes } = useProductCatalog()
  // A product chosen in the finder, or a loan type's "we'll match you" application (loanProducts.js).
  const productFor = useCallback(
    (productId) => {
      const found = products.find((product) => product.id === productId)
      if (found || !isMatchingId(productId)) return found || null
      const type = loanTypes.find((entry) => `${MATCHING_PREFIX}${entry.key}` === productId)
      return type ? matchingProduct(type, products) : null
    },
    [products, loanTypes]
  )
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
    if (searchParams.get('resume') === '1') setMyApplication('resume')
  }, [searchParams])

  useEffect(() => {
    const finder = document.getElementById('loans')
    if (!finder || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(([entry]) => setFinderInView(entry.isIntersecting), { rootMargin: '0px 0px -30% 0px' })
    observer.observe(finder)
    return () => observer.disconnect()
  }, [])

  // "Apply": straight to the application, which starts by confirming it's them (their ID,
  // then a code to the contact on record, or one they give), so nothing is asked twice.
  const handleApply = useCallback(
    (productId) => {
      const product = productFor(productId) || products[0]
      // The figures they qualified on go with them: the wizard caps the amount by them, and submits them.
      navigate(applyPath(product.id, 0, product.form), { state: { eligibility: figures[product.loanType] || null } })
    },
    [productFor, products, figures, navigate]
  )

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

  const handleMyApplication = useCallback(() => setMyApplication('choose'), [])

  const handleTrack = useCallback((email) => navigate('/my-applications', { state: { email } }), [navigate])

  const handleResumed = useCallback(
    (draft) => {
      navigate(applyPath(draft.loanData?.productId || draft.loanType, draft.currentStep || 0, draft.loanType), { state: { resumedDraft: draft } })
    },
    [navigate]
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* "Apply and get matched": the loan category chosen in the finder (personal at first). */}
      <SiteHeader onApply={handleChooseType} onMatch={() => handleApply(`${MATCHING_PREFIX}${loanType}`)} onMyApplication={handleMyApplication} />

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
        <Hero onChooseType={handleChooseType} onMyApplication={handleMyApplication} />
        <LoanProducts loanType={loanType} onLoanTypeChange={setLoanType} figures={figures} onFiguresChange={handleFiguresChange} onApply={handleApply} />
        <HowItWorks />
        <Requirements loanType={loanType} />
        <TrustSection />
        <Faq />
        <CallToAction onApply={handleChooseType} onMyApplication={handleMyApplication} />
      </main>

      <SiteFooter />

      {/* Phones: the main action stays in reach while scrolling, until the finder itself is on screen. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur transition-transform md:hidden ${
          finderInView ? 'translate-y-full' : 'translate-y-0'
        }`}
        aria-hidden={finderInView}
      >
        <Button className="w-full" size="lg" tabIndex={finderInView ? -1 : 0} onClick={() => handleChooseType(loanType)}>
          Find your loan
          <ArrowRight />
        </Button>
      </div>
      {/* Room for that bar, so it never covers the footer. */}
      <div aria-hidden="true" className="h-20 md:hidden" />

      <ResumeApplicationDialog
        open={Boolean(myApplication)}
        initialMode={myApplication || 'choose'}
        onOpenChange={(open) => !open && setMyApplication(null)}
        onResumed={handleResumed}
        onTrack={handleTrack}
      />

    </div>
  )
}

export default LandingPage
