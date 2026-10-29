import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  LogOut,
  Send,
} from 'lucide-react'
import TermsModal from '../components/TermsModal'
import SuccessModal from '../components/SuccessModal'
// The face-detection model is large; it loads only when someone opens the camera.
const FaceCaptureCamera = lazy(() => import('../components/FaceCaptureCamera').then((module) => ({ default: module.FaceCaptureCamera })))
import dayjs from 'dayjs'
import footerLogo from '../assets/izyane-black.svg'
import { submitApplication, fetchSession, requestConsentCode, extractApiError } from '../services/applicationsApi'
import { extractFiles } from '../utils/fileTree'
import { readReferral } from '../lib/referral'
import { isAssistedFlagSet, clearAssistedFlag } from '../lib/assisted'
import { useProductCatalog } from '../hooks/useProducts'
import { describeInterest, getProduct, priceLoan } from '../config/loanProducts'
import { collateralErrors, MAX_COLLATERAL_ITEMS } from '../config/collateral'
import { EMPLOYMENT_OPTIONS, businessPeople, employerField, isValidPassportNumber, isZambian, positionsFor, presentDocuments } from '../config/applicantRules'
import { useApplicationDraft } from '../hooks/useApplicationDraft'
import { useDocumentAnalysis } from '../hooks/useDocumentAnalysis'
import {
  prescreenApplication,
  isAiUnavailable,
  aiFailureReason,
  aiFailureMessage,
  isRetryableAiFailure,
} from '../services/aiApi'
import { describeRequestError } from '../lib/requestError'
import { documentNotes, findFormMismatches } from '../utils/documentChecks'
import { acceptsPhotos, readDocument, removeCollateralProof, writeDocument } from '../utils/documentSlots'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StepProgress } from '@/components/application/StepProgress'
import { ErrorSummary } from '@/components/application/ErrorSummary'
import { DocumentPreviewDialog } from '@/components/application/DocumentPreviewDialog'
import {
  STEP_TITLES,
  applyPath,
  isLoanType,
  isProductSlug,
  isValidStepSlug,
  stepIndex,
} from '@/config/applicationSteps'
import { WizardStep } from './apply/WizardSteps'
import { DraftContactConsent } from '@/components/application/DraftContactConsent'
import { useCustomerOptions } from '@/hooks/useCustomerOptions'
import { CRB_ENABLED, businessInitial, personalInitial } from './apply/formDefaults'

/**
 * The device's position, which every submission records: { point } or { error } saying,
 * in words the applicant can act on, why it couldn't be had.
 */
const currentPosition = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: 'This browser can’t share a location. Open the application in another browser, such as Chrome, to submit.' })
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ point: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy } }),
      (failure) =>
        resolve({
          error:
            failure.code === 1
              ? 'We need your location to submit. Allow location for this site (in your browser’s address bar or settings), then press Submit again.'
              : 'We couldn’t get your location. Turn on location (GPS) on your device, then press Submit again.',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    )
  })

const newSubmissionKey = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const initialLoanState = {
  amount: 4000,
  tenure: 6,
}

function DashboardPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { type: typeParam, step: stepParam } = useParams()

  // The URL owns which loan product and which step we are on. Everything else stays
  // component state, so a refresh or a Back press lands on the right screen while
  // the draft layer restores the answers. The product's form (personal or business)
  // decides the steps, the questions and the checks; the product its name, pricing,
  // documents and collateral.
  const { products, collateralTypes, loaded: productsLoaded } = useProductCatalog()
  const routeProduct = products.find((entry) => entry.id === typeParam)
  const fallbackForm = typeParam === 'business' || location.state?.type === 'business' ? 'business' : 'personal'
  const product =
    routeProduct ||
    products.find((entry) => entry.id === fallbackForm) ||
    products.find((entry) => entry.form === fallbackForm) ||
    products[0] ||
    getProduct(fallbackForm)
  // An added product is only known once the workspace's products have loaded; until
  // then its URL is left alone rather than "corrected" to a built-in product.
  const awaitingProduct = !routeProduct && !productsLoaded && isProductSlug(typeParam) && !isLoanType(typeParam)
  const selectedProductId = product.id
  const selectedLoanType = product.form
  // Collateral is pledged on the loan terms step, so its name says so when the product asks for it.
  const stepTitles = STEP_TITLES[selectedLoanType].map((title) =>
    title === 'Loan Terms' && product.collateral?.requirement && product.collateral.requirement !== 'none' ? 'Loan & Collateral' : title
  )
  const currentStep = stepIndex(selectedLoanType, stepParam)

  // Mirrors of the derived values, updated eagerly by the setters below so that
  // two setter calls in the same tick (draft hydration sets product *and* step)
  // compose instead of the second one reading a stale product.
  const productRef = useRef(product)
  const stepRef = useRef(currentStep)
  productRef.current = product
  stepRef.current = currentStep
  const productsRef = useRef(products)
  productsRef.current = products

  const navigateToStep = useCallback(
    (target, index, { replace = false } = {}) => {
      navigate(applyPath(target.id, index, target.form), { replace })
    },
    [navigate]
  )

  /**
   * Passed to useApplicationDraft: resuming a draft should not push history. A draft
   * names its form and (since products) its product, in loanData.productId; a product
   * since switched off or changed to the other form falls back to the form's built-in one.
   */
  const setSelectedLoanType = useCallback(
    (type, productId) => {
      const form = isLoanType(type) ? type : 'personal'
      const known = productsRef.current
      const next = known.find((entry) => entry.id === productId && entry.form === form) || known.find((entry) => entry.id === form) || getProduct(form)
      productRef.current = next
      navigateToStep(next, stepRef.current, { replace: true })
    },
    [navigateToStep]
  )

  const setCurrentStep = useCallback(
    (index) => {
      stepRef.current = index
      navigateToStep(productRef.current, index, { replace: true })
    },
    [navigateToStep]
  )

  // Normalise bare or unknown URLs (/apply, /apply/personal, a switched-off product, a
  // bad slug) onto the canonical path, carrying router state through so a resumed draft survives.
  useEffect(() => {
    if (awaitingProduct) return
    if (typeParam !== selectedProductId || !isValidStepSlug(selectedLoanType, stepParam)) {
      navigate(applyPath(selectedProductId, isValidStepSlug(selectedLoanType, stepParam) ? currentStep : 0, selectedLoanType), { replace: true, state: location.state })
    }
  }, [awaitingProduct, typeParam, stepParam, selectedProductId, selectedLoanType, currentStep, navigate, location.state])

  const [personalData, setPersonalData] = useState(personalInitial)
  const [businessData, setBusinessData] = useState(businessInitial)
  const [loanData, setLoanData] = useState(initialLoanState)
  // The product applied for travels in loanData (drafted, synced and submitted with it),
  // so a resumed draft returns to its product. It always follows the URL's product.
  const loanDataWithProduct = useMemo(() => ({ ...loanData, productId: selectedProductId }), [loanData, selectedProductId])
  const [previewAttachment, setPreviewAttachment] = useState(null)
  const [showTerms, setShowTerms] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})
  const [submittedApplication, setSubmittedApplication] = useState(null)
  // First step, self-service only: staff may see this draft and help finish it.
  const [contactConsent, setContactConsent] = useState(false)
  const customerOptions = useCustomerOptions()
  const [allowCrb, setAllowCrb] = useState(false)
  // One key per application: a retried submit files it once (see api/_handlers/applications.js).
  const submissionKeyRef = useRef(newSubmissionKey())

  // Assisted: a signed-in agent or RM filling this in with a customer. Started from the
  // workspace ("New application"), which sets the flag; the session confirms the role.
  const [assistedBy, setAssistedBy] = useState(null)
  const [consentCode, setConsentCode] = useState('')
  const [consentCodeState, setConsentCodeState] = useState({ status: 'idle', message: '' })
  useEffect(() => {
    if (!isAssistedFlagSet()) return
    fetchSession().then((user) => {
      if (user?.permissions?.includes('applications.assist')) setAssistedBy(user)
      else clearAssistedFlag()
    })
  }, [])

  const resumedDraft = location.state?.resumedDraft
  const prefilledApplication = location.state?.prefilledApplication
  const hydratedResumedDraftRef = useRef(false)
  const hydratedPrefilledApplicationRef = useRef(false)
  const errorSummaryRef = useRef(null)

  const {
    localDraftSummary,
    resumeLocalDraft,
    startFresh: startFreshDraft,
    hydrateFrom: hydrateResumedDraft,
    clearDraft,
    resumeAutosave,
    invalidateDraftToken,
    ensureDocumentsUploaded,
    flushLocalDraft,
    flushRemoteDraft,
    canSyncRemotely,
    remoteSyncError,
    draftExists,
    syncConflictMessage,
    documentSyncError,
    draftToken,
  } = useApplicationDraft({
    selectedLoanType,
    currentStep,
    personalData,
    businessData,
    loanData: loanDataWithProduct,
    setSelectedLoanType,
    setCurrentStep,
    setPersonalData,
    setBusinessData,
    setLoanData,
    contactConsent,
    setContactConsent,
    assisted: Boolean(assistedBy),
    referralCode: assistedBy ? null : readReferral(),
    // A staff machine keeps nothing of the customer's; the flag covers the moment
    // before the session has confirmed the agent.
    keepLocalCopy: !assistedBy && !isAssistedFlagSet(),
    // Agents start every customer's application afresh on their device.
    skipLocalCheck: Boolean(resumedDraft || prefilledApplication || isAssistedFlagSet()),
  })

  useEffect(() => {
    if (resumedDraft && !hydratedResumedDraftRef.current) {
      hydratedResumedDraftRef.current = true
      hydrateResumedDraft(resumedDraft)
    }
  }, [resumedDraft, hydrateResumedDraft])

  useEffect(() => {
    if (!prefilledApplication || hydratedPrefilledApplicationRef.current || resumedDraft) return
    hydratedPrefilledApplicationRef.current = true
    setPersonalData(prefilledApplication.personalData)
    setBusinessData(prefilledApplication.businessData)
    setLoanData(prefilledApplication.loanData)
  }, [prefilledApplication, resumedDraft])

  // Email captured on the landing page. Seeding it here means useApplicationDraft
  // has a sync key immediately, rather than only once the applicant reaches the
  // email field (step 1 personal / step 2 business). Never overrides a resumed
  // draft or an address the applicant has already typed.
  const startEmail = location.state?.startEmail
  const seededEmailRef = useRef(false)

  useEffect(() => {
    if (!startEmail || seededEmailRef.current || resumedDraft) return
    seededEmailRef.current = true

    if (selectedLoanType === 'personal') {
      setPersonalData((prev) =>
        prev.personalInfo.email
          ? prev
          : { ...prev, personalInfo: { ...prev.personalInfo, email: startEmail } }
      )
    } else {
      setBusinessData((prev) =>
        prev.directorInfo.applicantEmail
          ? prev
          : { ...prev, directorInfo: { ...prev.directorInfo, applicantEmail: startEmail } }
      )
    }
  }, [startEmail, selectedLoanType, resumedDraft])

  // Each step starts at the top, including on browser Back/Forward.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentStep])

  // Limits and pricing come from the workspace's product settings (useProductCatalog).
  const { minAmount, maxAmount, minTenure, maxTenure } = product
  const price = useMemo(() => priceLoan(loanData.amount, loanData.tenure, product), [loanData.amount, loanData.tenure, product])
  const totalRepayable = price.total
  const monthlyRepayment = price.monthly
  const interestLabel = `Interest (${describeInterest(product)})`

  // Keep the chosen amount and tenure inside the product's limits when they load or change.
  useEffect(() => {
    setLoanData((prev) => {
      const amount = Math.min(Math.max(prev.amount, minAmount), maxAmount)
      const tenure = Math.min(Math.max(prev.tenure, minTenure), maxTenure)
      return amount === prev.amount && tenure === prev.tenure ? prev : { ...prev, amount, tenure }
    })
  }, [minAmount, maxAmount, minTenure, maxTenure])

  const normalizeValue = (value, fieldType = 'default') => {
    if (fieldType === 'alpha') {
      return value.replace(/[^A-Za-z\s]/g, '')
    }

    if (fieldType === 'numeric') {
      return value.replace(/\D/g, '')
    }

    if (fieldType === 'nrc') {
      const digits = value.replace(/\D/g, '').slice(0, 9)
      if (digits.length <= 6) {
        return digits
      }
      if (digits.length <= 8) {
        return `${digits.slice(0, 6)}/${digits.slice(6, 8)}`
      }
      return `${digits.slice(0, 6)}/${digits.slice(6, 8)}/${digits.slice(8, 9)}`
    }

    if (fieldType === 'phone') {
      return value.replace(/\D/g, '').slice(0, 9)
    }

    return value
  }

  const isValidNRC = (value) => /^[0-9]{6}\/[0-9]{2}\/[0-9]{1,2}$/.test(value)
  const isValidPhone = (value) => /^\d{9}$/.test(value)
  const isValidEmail = (value) => /^[^\s@]+@[A-Za-z0-9-]+\.com$/.test(value)
  const isValidBirthDate = (value) => {
    if (!value) return false
    const selectedDate = dayjs(value)
    if (!selectedDate.isValid()) return false
    const age = dayjs().diff(selectedDate, 'year')
    return age >= 18 && age <= 65
  }

  // Capped below Vercel's 4.5 MB request-body limit for serverless functions: a larger
  // file is rejected by the platform before /api/draft/documents runs, so the applicant
  // would get an opaque 413 instead of this message.
  const PDF_MAX_FILE_SIZE = 4 * 1024 * 1024
  const PHOTO_MAX_FILE_SIZE = 3 * 1024 * 1024
  const isPdfFile = (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const isImageFile = (file) => file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(file.name)

  const validatePdfFile = (file) => {
    if (!file) return ''
    if (!isPdfFile(file)) return 'Not a valid format. PDF only.'
    if (file.size > PDF_MAX_FILE_SIZE) return 'File must be 4 MB or smaller.'
    return ''
  }

  const validatePassportFile = (file) => {
    if (!file) return ''
    if (!isPdfFile(file) && !isImageFile(file)) return 'Not a valid format. PDF or image only.'
    if (file.size > PHOTO_MAX_FILE_SIZE) return 'File must be 3 MB or smaller.'
    return ''
  }

  const setValidationError = (key, message) => {
    setValidationErrors((prev) => {
      const next = { ...prev }
      if (message) {
        next[key] = message
      } else {
        delete next[key]
      }
      return next
    })
  }

  const updateSectionField = (section, field, value, fieldType = 'default') => {
    const normalizedValue = normalizeValue(value, fieldType)
    const setter = selectedLoanType === 'personal' ? setPersonalData : setBusinessData
    setter((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: normalizedValue,
      },
    }))

    if (fieldType === 'nrc') {
      setValidationError(
        `${section}.${field}`,
        normalizedValue && !isValidNRC(normalizedValue) ? 'NRC must be 9 digits.' : ''
      )
    }

    if (fieldType === 'phone') {
      setValidationError(
        `${section}.${field}`,
        normalizedValue && !isValidPhone(normalizedValue)
          ? 'Enter 9 digits.'
          : ''
      )
    }

    if (fieldType === 'email') {
      setValidationError(
        `${section}.${field}`,
        normalizedValue && !isValidEmail(normalizedValue) ? 'Email must end with a .com domain.' : ''
      )
    }
  }

  const [uploadStatuses, setUploadStatuses] = useState({})

  const setUploadStatus = (field, status) => {
    setUploadStatuses((prev) => ({
      ...prev,
      [field]: status,
    }))
  }

  const getUploadStatus = (field) => uploadStatuses[field] || 'idle'

  // The form's answers and documents for the product's form.
  const activeData = selectedLoanType === 'personal' ? personalData : businessData
  const setActiveData = selectedLoanType === 'personal' ? setPersonalData : setBusinessData
  const collateralAsked = Boolean(product.collateral?.requirement) && product.collateral.requirement !== 'none'
  const collateralRows = collateralAsked ? activeData.collateral?.items || [] : []

  // What each built-in document should agree with on the form (the server checks the same
  // pairs, api/_lib/prescreen/facts.js expectedFor). A product's own documents and
  // collateral proofs are only checked for being what was asked for.
  const expectedForSlot = (slot) => {
    if (selectedLoanType === 'personal') {
      const { firstName, middleName, surname, nrc, passportNumber } = personalData.personalInfo
      const applicant = { name: [firstName, middleName, surname].filter(Boolean).join(' '), nrc }
      if (slot === 'payslips' || slot === 'nrcCopy') return applicant
      if (slot === 'passportCopy') return { name: applicant.name, passport: passportNumber }
      if (slot === 'bankStatements' || slot === 'tpin') return { name: applicant.name }
      return {}
    }
    const company = { companyName: businessData.businessInfo.companyName, holderIsCompany: true }
    // ZRA documents also print the company's TPIN, checked against the one entered.
    if (slot === 'taxClearance' || slot === 'latestTaxComplianceReturn') return { ...company, tpin: businessData.businessInfo.tpin }
    if (['pacraCertificate', 'form2', 'bankStatements', 'boardResolution'].includes(slot)) return company
    return {}
  }

  // Every upload slot the AI checks, with what its document should agree with on the
  // form. `slot` is the label staff see in the prescreen; fieldKey is the slot itself,
  // which the upload fields use for status and the server matches the analysis by.
  const analysisSlots = (() => {
    const docs = activeData.documents
    const productSlots = presentDocuments(product, activeData).filter((document) => !document.skipped).map((document) => ({
      fieldKey: document.slot,
      docType: document.docType,
      slot: document.label,
      required: document.required,
      file: readDocument(docs, document.slot),
      expected: expectedForSlot(document.slot),
      // A product's own document is checked against what the product says it is.
      ...(document.docType === 'custom' ? { productId: selectedProductId } : {}),
    }))
    const collateralSlots = collateralRows.map((_, index) => ({
      fieldKey: `collateral.${index}`,
      docType: 'collateral',
      slot: `Collateral ${index + 1} proof`,
      required: false,
      file: readDocument(docs, `collateral.${index}`),
      expected: {},
    }))
    if (selectedLoanType === 'personal') return [...productSlots, ...collateralSlots]

    const directors = businessData.directorInfo.directors || []
    return [
      ...productSlots,
      ...collateralSlots,
      ...(docs.directorUploads || []).flatMap((upload, index) => [
        {
          fieldKey: `director.${index}.nrc`,
          docType: 'directorNrc',
          slot: `Director ${index + 1} NRC`,
          required: true,
          file: upload.nrc,
          expected: { name: directors[index]?.name, nrc: directors[index]?.nrc },
        },
        {
          fieldKey: `director.${index}.passportPhoto`,
          docType: 'directorPassportPhoto',
          slot: `Director ${index + 1} passport photo`,
          required: true,
          file: upload.passportPhoto,
          expected: {},
        },
      ]),
    ]
  })()

  const {
    analyses: documentAnalyses,
    paused: aiChecksPaused,
    retry: retryDocumentChecks,
  } = useDocumentAnalysis({ token: draftToken, slots: analysisSlots, onInvalidToken: invalidateDraftToken })

  /** What FileUploadField shows for a slot, with form mismatches computed against current answers. */
  const analysisFor = (fieldKey) => {
    const entry = documentAnalyses[fieldKey]
    if (!entry) return undefined
    const slot = analysisSlots.find((candidate) => candidate.fieldKey === fieldKey)
    return {
      status: entry.status,
      notes: documentNotes(entry.analysis, slot?.expected),
      message: entry.status === 'error' ? aiFailureMessage(entry.reason) : undefined,
      onRetry: entry.status === 'error' && isRetryableAiFailure(entry.reason) ? retryDocumentChecks : undefined,
    }
  }

  const handleDocumentInputChange = (field, event) => {
    const file = event.target.files?.[0] ?? null
    if (!file) {
      setUploadStatus(field, 'idle')
      updateDocumentField(field, null)
      return
    }

    setUploadStatus(field, 'loading')
    updateDocumentField(field, file, event.target)
  }

  // Actual device presence (not just API support) — the passport photo field is
  // camera-only when a camera exists, so this has to reflect real hardware, not
  // just whether getUserMedia is defined.
  const [hasCamera, setHasCamera] = useState(false)
  const [showCameraCapture, setShowCameraCapture] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return

    let cancelled = false
    const detect = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!cancelled) setHasCamera(devices.some((device) => device.kind === 'videoinput'))
        })
        .catch(() => {})
    }

    detect()
    navigator.mediaDevices.addEventListener?.('devicechange', detect)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener?.('devicechange', detect)
    }
  }, [])

  const handleCameraCapture = (dataUrl) => {
    setShowCameraCapture(false)
    const [meta, base64] = dataUrl.split(',')
    const mimeMatch = /data:(.*?);base64/.exec(meta)
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const file = new File([bytes], `passport-photo-${Date.now()}.png`, { type: mimeType })
    handleDocumentInputChange('passportPhoto', { target: { files: [file], value: '' } })
  }

  const handleDirectorDocumentInputChange = (index, field, event) => {
    const file = event.target.files?.[0] ?? null
    const fieldKey = `director.${index}.${field}`
    if (!file) {
      setUploadStatus(fieldKey, 'idle')
      updateDirectorDocumentField(index, field, null)
      return
    }

    setUploadStatus(fieldKey, 'loading')
    updateDirectorDocumentField(index, field, file, event.target)
  }

  // `field` is the document's slot: payslips, custom.title-deed, collateral.0 (utils/documentSlots.js).
  const updateDocumentField = (field, file, inputElement = null) => {
    const errorKey = `documents.${field}`
    let validationMessage = ''

    if (file) {
      validationMessage = acceptsPhotos(field) ? validatePassportFile(file) : validatePdfFile(file)
      if (validationMessage) {
        setValidationError(errorKey, validationMessage)
        setUploadStatus(field, 'error')
        if (inputElement) {
          inputElement.value = ''
        }
        return
      }
    }

    setValidationError(errorKey, '')
    setActiveData((prev) => ({ ...prev, documents: writeDocument(prev.documents, field, file) }))
    if (file) {
      setTimeout(() => {
        setUploadStatus(field, 'success')
      }, 600)
    } else {
      setUploadStatus(field, 'idle')
    }
  }

  // ---------------------------------------------------------------------------
  // Collateral (Loan terms step), when the product asks for it: the items pledged at
  // <form>Data.collateral.items, each with an optional proof at documents.collateral[i].
  // ---------------------------------------------------------------------------

  const addCollateralItem = () => {
    setActiveData((prev) => {
      const items = prev.collateral?.items || []
      if (items.length >= MAX_COLLATERAL_ITEMS) return prev
      return { ...prev, collateral: { ...(prev.collateral || {}), items: [...items, { type: '', description: '', value: '' }] } }
    })
  }

  const updateCollateralItem = (index, field, value) => {
    const next = field === 'value' ? value.replace(/[^0-9]/g, '') : value
    setActiveData((prev) => ({
      ...prev,
      collateral: {
        ...(prev.collateral || {}),
        items: (prev.collateral?.items || []).map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: next } : item)),
      },
    }))
    setValidationError(`collateral.items.${index}.${field}`, '')
    setValidationError('collateral', '')
  }

  // Removes the item and its proof; later items (and their proofs, statuses and errors) move up one.
  const removeCollateralItem = (index) => {
    setActiveData((prev) => ({
      ...prev,
      collateral: { ...(prev.collateral || {}), items: (prev.collateral?.items || []).filter((_, itemIndex) => itemIndex !== index) },
      documents: removeCollateralProof(prev.documents, index),
    }))
    const shift = (record) => {
      const next = {}
      Object.entries(record).forEach(([key, value]) => {
        const match = /^(documents\.)?collateral(\.items)?\.(\d+)(.*)$/.exec(key)
        if (!match) {
          next[key] = value
          return
        }
        const position = Number(match[3])
        if (position === index) return
        next[`${match[1] || ''}collateral${match[2] || ''}.${position > index ? position - 1 : position}${match[4]}`] = value
      })
      return next
    }
    setUploadStatuses((prev) => shift(prev))
    setValidationErrors((prev) => shift(prev))
  }

  const updateDirectorDocumentField = (index, field, file, inputElement = null) => {
    const fieldKey = `director.${index}.${field}`
    const errorKey = `documents.directorUploads[${index}].${field}`
    let validationMessage = ''

    if (file) {
      validationMessage = field === 'passportPhoto' ? validatePassportFile(file) : validatePdfFile(file)
      if (validationMessage) {
        setValidationError(errorKey, validationMessage)
        setUploadStatus(fieldKey, 'error')
        if (inputElement) {
          inputElement.value = ''
        }
        return
      }
    }

    setValidationError(errorKey, '')
    if (file) {
      setBusinessData((prev) => ({
        ...prev,
        documents: {
          ...prev.documents,
          directorUploads: (prev.documents.directorUploads || []).map((upload, uploadIndex) =>
            uploadIndex === index ? { ...upload, [field]: file } : upload
          ),
        },
      }))
      setTimeout(() => {
        setUploadStatus(fieldKey, 'success')
      }, 600)
    } else {
      setUploadStatus(fieldKey, 'idle')
      setBusinessData((prev) => ({
        ...prev,
        documents: {
          ...prev.documents,
          directorUploads: (prev.documents.directorUploads || []).map((upload, uploadIndex) =>
            uploadIndex === index ? { ...upload, [field]: file } : upload
          ),
        },
      }))
    }
  }

  const addDirectorUpload = () => {
    setBusinessData((prev) => ({
      ...prev,
      documents: {
        ...prev.documents,
        directorUploads: (prev.documents.directorUploads || []).length < businessPeople(prev.businessInfo.businessType).max
          ? [...(prev.documents.directorUploads || []), { nrc: null, passportPhoto: null }]
          : prev.documents.directorUploads || [{ nrc: null, passportPhoto: null }],
      },
    }))
  }

  const removeDirectorUpload = (index) => {
    setBusinessData((prev) => ({
      ...prev,
      documents: {
        ...prev.documents,
        directorUploads: (prev.documents.directorUploads || []).filter((_, uploadIndex) => uploadIndex !== index),
      },
    }))
  }

  const updateDirectorField = (index, field, value, fieldType = 'default') => {
    const normalizedValue = normalizeValue(value, fieldType)
    setBusinessData((prev) => ({
      ...prev,
      directorInfo: {
        ...prev.directorInfo,
        directors: prev.directorInfo.directors.map((director, directorIndex) =>
          directorIndex === index
            ? { ...director, [field]: normalizedValue }
            : director
        ),
      },
    }))

    if (fieldType === 'phone') {
      setValidationError(
        `directorInfo.directors[${index}].${field}`,
        normalizedValue && !isValidPhone(normalizedValue)
          ? 'Enter 9 digits.'
          : ''
      )
    }
  }

  const addDirector = () => {
    setBusinessData((prev) => ({
      ...prev,
      directorInfo: {
        ...prev.directorInfo,
        directors: prev.directorInfo.directors.length < businessPeople(prev.businessInfo.businessType).max
          ? [...prev.directorInfo.directors, { name: '', phone: '', email: '', nrc: '' }]
          : prev.directorInfo.directors,
      },
    }))
  }

  const removeDirector = (index) => {
    setBusinessData((prev) => ({
      ...prev,
      directorInfo: {
        ...prev.directorInfo,
        directors: prev.directorInfo.directors.filter((_, directorIndex) => directorIndex !== index),
      },
    }))
  }

  const resetForm = () => {
    setCurrentStep(0)
    setLoanData(initialLoanState)
    setPersonalData(personalInitial)
    setBusinessData(businessInitial)
    setValidationErrors({})
    setUploadStatuses({})
    setSubmitError('')
    // A new application: autosave was paused when the last one was submitted.
    resumeAutosave()
  }

  const validateCurrentStep = () => {
    const errors = {}
    const recordError = (key, message) => {
      if (message) {
        errors[key] = message
      }
    }

    const requiredField = (value, key, message) => {
      if (!value?.toString().trim()) {
        recordError(key, message)
      }
    }

    // The documents the product asks for, in the slots they live in (utils/documentSlots.js).
    const validateProductDocuments = () => {
      // Only those that apply to the answers given (no payslips without a salary, applicantRules.js).
      presentDocuments(product, activeData).filter((document) => !document.skipped).forEach((document) => {
        const key = `documents.${document.slot}`
        const file = readDocument(activeData.documents, document.slot)
        if (document.required && !file) recordError(key, `${document.label} is required.`)
        if (file) recordError(key, acceptsPhotos(document.slot) ? validatePassportFile(file) : validatePdfFile(file))
      })
    }

    // Loan terms: the collateral the product asks for, and each proof attached.
    if (currentStep === 3 && collateralAsked) {
      Object.entries(collateralErrors(product, activeData, loanData.amount, collateralTypes)).forEach(([key, message]) => recordError(key, message))
      collateralRows.forEach((_, index) => {
        const file = readDocument(activeData.documents, `collateral.${index}`)
        if (file) recordError(`documents.collateral.${index}`, validatePassportFile(file))
      })
    }

    if (selectedLoanType === 'personal') {
      if (currentStep === 0) {
        requiredField(personalData.personalInfo.firstName, 'personalInfo.firstName', 'First name is required.')
        requiredField(personalData.personalInfo.surname, 'personalInfo.surname', 'Surname is required.')
        requiredField(personalData.personalInfo.phone, 'personalInfo.phone', 'Phone is required.')
        requiredField(personalData.personalInfo.email, 'personalInfo.email', 'Email is required.')
        // Nationality decides the ID asked for: an NRC for Zambians, a passport number for anyone else.
        requiredField(personalData.employmentInfo.nationality, 'employmentInfo.nationality', 'Nationality is required.')
        if (isZambian(personalData.employmentInfo.nationality)) requiredField(personalData.personalInfo.nrc, 'personalInfo.nrc', 'NRC is required.')
        else if (!isValidPassportNumber(personalData.personalInfo.passportNumber)) recordError('personalInfo.passportNumber', 'Enter your passport number: 6 to 12 letters and numbers.')
        requiredField(personalData.personalInfo.gender, 'personalInfo.gender', 'Gender is required.')
        requiredField(personalData.personalInfo.maritalStatus, 'personalInfo.maritalStatus', 'Marital status is required.')
        requiredField(personalData.personalInfo.birthDate, 'personalInfo.birthDate', 'Birth date is required.')
        if (personalData.personalInfo.birthDate && !isValidBirthDate(personalData.personalInfo.birthDate)) {
          recordError('personalInfo.birthDate', 'Age must be between 18 and 65.')
        }
        if (personalData.personalInfo.phone && !isValidPhone(personalData.personalInfo.phone)) {
          recordError('personalInfo.phone', 'Enter 9 digits.')
        }
        if (personalData.personalInfo.email && !isValidEmail(personalData.personalInfo.email)) {
          recordError('personalInfo.email', 'Email must end with a .com domain.')
        }
        if (isZambian(personalData.employmentInfo.nationality) && personalData.personalInfo.nrc && !isValidNRC(personalData.personalInfo.nrc)) {
          recordError('personalInfo.nrc', 'NRC must be 6 digits, slash, 2 digits, slash, then 1–2 digits.')
        }
      }

      if (currentStep === 1) {
        requiredField(personalData.employmentInfo.residentialAddress, 'employmentInfo.residentialAddress', 'Residential address is required.')
        // Earlier drafts typed it freely; it is now one of the listed choices.
        if (!EMPLOYMENT_OPTIONS.some((option) => option.value === personalData.employmentInfo.occupation)) recordError('employmentInfo.occupation', 'Choose your occupation.')
        const employer = employerField(personalData.employmentInfo.occupation)
        if (employer) requiredField(personalData.employmentInfo.employerName, 'employmentInfo.employerName', `${employer.label} is required.`)
        requiredField(personalData.employmentInfo.principalObjectiveOfLoan, 'employmentInfo.principalObjectiveOfLoan', 'Principal objective of loan is required.')
        requiredField(personalData.employmentInfo.nextOfKinName, 'employmentInfo.nextOfKinName', 'Next of kin name is required.')
        requiredField(personalData.employmentInfo.nextOfKinPhone, 'employmentInfo.nextOfKinPhone', 'Next of kin phone is required.')
        requiredField(personalData.employmentInfo.nextOfKinEmail, 'employmentInfo.nextOfKinEmail', 'Next of kin email is required.')
        requiredField(personalData.employmentInfo.nextOfKinRelationship, 'employmentInfo.nextOfKinRelationship', 'Relationship is required.')
        if (personalData.employmentInfo.nextOfKinPhone && !isValidPhone(personalData.employmentInfo.nextOfKinPhone)) {
          recordError('employmentInfo.nextOfKinPhone', 'Enter 9 digits.')
        }
        if (personalData.employmentInfo.nextOfKinEmail && !isValidEmail(personalData.employmentInfo.nextOfKinEmail)) {
          recordError('employmentInfo.nextOfKinEmail', 'Email must end with a .com domain.')
        }
      }

      if (currentStep === 2) validateProductDocuments()
    }

    if (selectedLoanType === 'business') {
      if (currentStep === 0) {
        requiredField(businessData.businessInfo.companyName, 'businessInfo.companyName', 'Company name is required.')
        if (!businessData.businessInfo.tpin?.trim()) recordError('businessInfo.tpin', 'The company TPIN is required.')
        else if (!/^\d{10}$/.test(businessData.businessInfo.tpin.trim())) recordError('businessInfo.tpin', 'A TPIN is 10 digits.')
        requiredField(businessData.businessInfo.businessType, 'businessInfo.businessType', 'Type of business is required.')
        requiredField(businessData.businessInfo.establishedDate, 'businessInfo.establishedDate', 'Established date is required.')
        requiredField(businessData.businessInfo.natureOfBusiness, 'businessInfo.natureOfBusiness', 'Nature of business is required.')
        requiredField(businessData.businessInfo.registeredOffice, 'businessInfo.registeredOffice', 'Registered office is required.')
        requiredField(businessData.businessInfo.purposeOfLoan, 'businessInfo.purposeOfLoan', 'Purpose of loan is required.')
      }

      if (currentStep === 1) {
        const directors = businessData.directorInfo.directors || []
        // Directors, partners or the owner, as the business type has them.
        const people = businessPeople(businessData.businessInfo.businessType)
        if (directors.length > people.max) recordError(`directorInfo.directors[${people.max}].name`, `A ${businessData.businessInfo.businessType.toLowerCase()} has one ${people.one.toLowerCase()}. Remove the others.`)
        directors.forEach((director, index) => {
          requiredField(director.name, `directorInfo.directors[${index}].name`, `${people.one} ${index + 1} name is required.`)
          requiredField(director.phone, `directorInfo.directors[${index}].phone`, `${people.one} ${index + 1} phone is required.`)
          requiredField(director.email, `directorInfo.directors[${index}].email`, `${people.one} ${index + 1} email is required.`)
          requiredField(director.nrc, `directorInfo.directors[${index}].nrc`, `${people.one} ${index + 1} NRC is required.`)
          if (director.phone && !isValidPhone(director.phone)) {
            recordError(`directorInfo.directors[${index}].phone`, 'Enter 9 digits.')
          }
          if (director.email && !isValidEmail(director.email)) {
            recordError(`directorInfo.directors[${index}].email`, 'Email must end with a .com domain.')
          }
          if (director.nrc && !isValidNRC(director.nrc)) {
            recordError(`directorInfo.directors[${index}].nrc`, 'NRC must be 6 digits, slash, 2 digits, slash, then 1–2 digits.')
          }
        })
        requiredField(businessData.directorInfo.applicantFirstName, 'directorInfo.applicantFirstName', 'Applicant first name is required.')
        requiredField(businessData.directorInfo.applicantLastName, 'directorInfo.applicantLastName', 'Applicant last name is required.')
        requiredField(businessData.directorInfo.applicantPhone, 'directorInfo.applicantPhone', 'Applicant phone is required.')
        requiredField(businessData.directorInfo.applicantEmail, 'directorInfo.applicantEmail', 'Applicant email is required.')
        if (isZambian(businessData.directorInfo.applicantNationality)) requiredField(businessData.directorInfo.applicantNrc, 'directorInfo.applicantNrc', 'Applicant NRC is required.')
        else if (!isValidPassportNumber(businessData.directorInfo.applicantPassportNumber)) recordError('directorInfo.applicantPassportNumber', 'Enter the applicant’s passport number: 6 to 12 letters and numbers.')
        requiredField(businessData.directorInfo.applicantGender, 'directorInfo.applicantGender', 'Applicant gender is required.')
        requiredField(businessData.directorInfo.applicantMaritalStatus, 'directorInfo.applicantMaritalStatus', 'Applicant marital status is required.')
        requiredField(businessData.directorInfo.applicantBirthDate, 'directorInfo.applicantBirthDate', 'Applicant birth date is required.')
        if (businessData.directorInfo.applicantBirthDate && !isValidBirthDate(businessData.directorInfo.applicantBirthDate)) {
          recordError('directorInfo.applicantBirthDate', 'Age must be between 18 and 65.')
        }
        requiredField(businessData.directorInfo.applicantAddress, 'directorInfo.applicantAddress', 'Applicant address is required.')
        // One of the positions the business's legal form has (free text from earlier drafts is asked again).
        if (!positionsFor(businessData.businessInfo.businessType).includes(businessData.directorInfo.applicantPosition)) recordError('directorInfo.applicantPosition', 'Choose the applicant’s position.')
        else if (businessData.directorInfo.applicantPosition === 'Other') requiredField(businessData.directorInfo.applicantPositionOther, 'directorInfo.applicantPositionOther', 'Say what the applicant’s position is.')
        requiredField(businessData.directorInfo.applicantNationality, 'directorInfo.applicantNationality', 'Applicant nationality is required.')
        if (businessData.directorInfo.applicantPhone && !isValidPhone(businessData.directorInfo.applicantPhone)) {
          recordError('directorInfo.applicantPhone', 'Enter 9 digits.')
        }
        if (businessData.directorInfo.applicantEmail && !isValidEmail(businessData.directorInfo.applicantEmail)) {
          recordError('directorInfo.applicantEmail', 'Email must end with a .com domain.')
        }
        if (isZambian(businessData.directorInfo.applicantNationality) && businessData.directorInfo.applicantNrc && !isValidNRC(businessData.directorInfo.applicantNrc)) {
          recordError('directorInfo.applicantNrc', 'NRC must be 6 digits, slash, 2 digits, slash, then 1–2 digits.')
        }
      }

      if (currentStep === 2) {
        validateProductDocuments()

        const directorUploads = businessData.documents.directorUploads || []
        directorUploads.forEach((upload, index) => {
          requiredField(upload.nrc, `documents.directorUploads[${index}].nrc`, `Director ${index + 1} NRC is required.`)
          requiredField(upload.passportPhoto, `documents.directorUploads[${index}].passportPhoto`, `Director ${index + 1} passport photo is required.`)
          if (upload.nrc) {
            const validationMessage = validatePdfFile(upload.nrc)
            if (validationMessage) {
              recordError(`documents.directorUploads[${index}].nrc`, validationMessage)
            }
          }
          if (upload.passportPhoto) {
            const validationMessage = validatePassportFile(upload.passportPhoto)
            if (validationMessage) {
              recordError(`documents.directorUploads[${index}].passportPhoto`, validationMessage)
            }
          }
        })
      }
    }

    setValidationErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleLoanTypeChange = (type) => {
    setSelectedLoanType(type)
    setCurrentStep(0)
    setLoanData(initialLoanState)
  }

  /** Moves focus to the error summary so an invalid step never looks like a dead button. */
  const revealValidationErrors = () => {
    window.requestAnimationFrame(() => {
      errorSummaryRef.current?.focus()
      errorSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const handleNext = () => {
    if (!validateCurrentStep()) {
      revealValidationErrors()
      return
    }

    if (currentStep < stepTitles.length - 1) {
      // Completing a step is a natural checkpoint: sync it now rather than waiting
      // out the debounce, so an abandoned application is still resumable up to the
      // last step the applicant finished. Fire-and-forget — never block navigation.
      flushRemoteDraft()
      // Pushed, not replaced, so browser Back returns to the previous step
      // rather than abandoning the application.
      navigateToStep(product, currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      navigateToStep(product, currentStep - 1)
    } else {
      navigate('/')
    }
  }

  const goToStep = (index) => {
    navigateToStep(product, index)
  }

  const [exiting, setExiting] = useState(false)

  const handleSaveAndExit = async () => {
    setExiting(true)
    try {
      // Local first (always succeeds, instant), then push to the server so the
      // application can be picked up on another device. Awaiting the remote call is
      // the point: leaving used to cancel the pending sync, so nothing was stored.
      await flushLocalDraft()
      const synced = await flushRemoteDraft()
      // Staying put on a failed sync is deliberate: the banner explains the draft
      // only exists on this device, so the applicant can retry rather than discover
      // on their phone that the application is unreachable.
      if (canSyncRemotely && !synced) return
      // An agent goes back to their pipeline, where the draft now waits in the Draft column.
      if (assistedBy) {
        clearAssistedFlag()
        navigate('/admin/pipeline')
        return
      }
      navigate('/')
    } finally {
      setExiting(false)
    }
  }

  // The server already holds an application for this email that this browser has no
  // token for; only the emailed code proves it is theirs. The answers here stay saved locally.
  const handleResumeExisting = async () => {
    await flushLocalDraft()
    navigate('/?resume=1')
  }

  const handleSubmitApplication = () => {
    if (!validateCurrentStep()) {
      revealValidationErrors()
      return
    }
    setShowTerms(true)
  }

  const isFinalStep = currentStep === stepTitles.length - 1

  // ---------------------------------------------------------------------------
  // AI prescreen
  // ---------------------------------------------------------------------------

  // Runs on reaching Overview (for the applicant guidance) and is reused at submit when
  // nothing has changed since. Only non-sensitive sections are sent; the server picks the
  // exact fields again rather than trusting this list.
  const buildPrescreenRequest = () => ({
    loanType: selectedLoanType,
    applicant: {
      ...(selectedLoanType === 'personal'
        ? { employmentInfo: personalData.employmentInfo }
        : {
            businessInfo: businessData.businessInfo,
            directorInfo: {
              applicantPosition: businessData.directorInfo.applicantPosition,
              applicantPositionOther: businessData.directorInfo.applicantPositionOther,
              directors: (businessData.directorInfo.directors || []).map(() => ({})),
            },
          }),
      // Pledged kinds and values; the server drops the descriptions before the model sees them.
      ...(collateralAsked ? { collateral: activeData.collateral } : {}),
    },
    loan: { ...loanData, monthlyInstalment: price.monthly, totalRepayable: price.total },
    documents: analysisSlots.map(({ fieldKey, docType, slot, required, file, expected }) => {
      const entry = documentAnalyses[fieldKey]
      const analysis = entry?.status === 'done' ? entry.analysis : null
      return {
        docType,
        slot,
        required,
        attached: Boolean(file),
        analysis,
        formMismatches: analysis ? findFormMismatches(analysis, expected) : [],
      }
    }),
  })

  const [prescreen, setPrescreen] = useState({ status: 'idle', result: null, reason: null })
  const prescreenRunRef = useRef({ key: null, promise: null })
  const aiUnavailableRef = useRef(false)
  // Bumped by "Try again" so the Overview effect re-runs for an unchanged application.
  const [prescreenNonce, setPrescreenNonce] = useState(0)

  /** Starts a prescreen for `request`. The promise resolves to the result or null, never rejects. */
  const runPrescreen = (request, key) => {
    setPrescreen({ status: 'loading', result: null, reason: null })
    const promise = prescreenApplication(draftToken, request)
      .then((result) => {
        if (prescreenRunRef.current.key === key) setPrescreen({ status: 'done', result, reason: null })
        return result
      })
      .catch((error) => {
        if (isAiUnavailable(error)) {
          aiUnavailableRef.current = true
          if (prescreenRunRef.current.key === key) setPrescreen({ status: 'idle', result: null, reason: null })
        } else {
          const reason = aiFailureReason(error)
          console.warn(`[ai] prescreen failed: ${describeRequestError(error)}`)
          if (reason === 'invalid_token') invalidateDraftToken()
          if (prescreenRunRef.current.key === key) setPrescreen({ status: 'error', result: null, reason, key })
        }
        prescreenRunRef.current = { key: null, promise: null }
        return null
      })
    prescreenRunRef.current = { key, promise }
    return promise
  }

  const retryPrescreen = () => {
    prescreenRunRef.current = { key: null, promise: null }
    if (aiChecksPaused) retryDocumentChecks()
    setPrescreen({ status: 'idle', result: null, reason: null })
    setPrescreenNonce((value) => value + 1)
  }

  // Waits for document checks still in flight, so the prescreen sees their findings.
  const documentChecksPending = Object.values(documentAnalyses).some((entry) => entry.status === 'analyzing')
  const prescreenKey =
    isFinalStep && draftToken && !documentChecksPending ? JSON.stringify(buildPrescreenRequest()) : null

  useEffect(() => {
    if (!prescreenKey || aiUnavailableRef.current || aiChecksPaused) return
    if (prescreenRunRef.current.key === prescreenKey) return
    // A failed run stays failed until "Try again" or a change to the application, so
    // a provider outage is reported once rather than re-requested on every render.
    if (prescreen.status === 'error' && prescreen.key === prescreenKey && prescreen.reason !== 'invalid_token') return
    runPrescreen(JSON.parse(prescreenKey), prescreenKey)
    // runPrescreen reads draftToken, which is already part of prescreenKey's inputs; it
    // is listed so a recovered token re-runs a prescreen that failed with a 401.
  }, [prescreenKey, draftToken, aiChecksPaused, prescreenNonce])

  // With checks paused, the prescreen would fail the same way; show the pause instead.
  const prescreenView =
    aiChecksPaused && prescreen.status !== 'done' && prescreen.status !== 'loading'
      ? { status: 'error', reason: aiChecksPaused.reason }
      : prescreen

  const handleFormSubmit = (event) => {
    event.preventDefault()
    if (isFinalStep) {
      handleSubmitApplication()
    } else {
      handleNext()
    }
  }

  const applicantEmail =
    selectedLoanType === 'personal' ? personalData.personalInfo.email : businessData.directorInfo.applicantEmail

  const sendConsentCode = async () => {
    setConsentCodeState({ status: 'sending', message: '' })
    try {
      await requestConsentCode(applicantEmail.trim(), assistedBy?.name)
      setConsentCodeState({ status: 'sent', message: `We emailed a code to ${applicantEmail.trim()}. Ask the customer to read it to you.` })
    } catch (error) {
      setConsentCodeState({ status: 'error', message: extractApiError(error) })
    }
  }

  /**
   * Files the application with this project's own API: the draft is saved and every file
   * confirmed in draft storage first, then one submit call that the server makes
   * idempotent with the submission key. The LMS hand-off happens server-side.
   */
  const onAcceptTerms = async () => {
    setShowTerms(false)
    setSubmitting(true)
    setSubmitError(null)
    try {
      // Asked first, so a refusal is explained before anything is uploaded.
      const position = await currentPosition()
      if (position.error) throw new Error(position.error)
      const location = position.point
      const token = await flushRemoteDraft()
      if (!token) {
        throw new Error(
          syncConflictMessage() || 'We couldn’t save your application to our server. Check your connection and try again.'
        )
      }
      await ensureDocumentsUploaded(token)

      const scope = selectedLoanType === 'personal' ? 'personal' : 'business'
      const result = await submitApplication(token, {
        submissionKey: submissionKeyRef.current,
        loanType: selectedLoanType,
        data: extractFiles(activeData, scope).sanitized,
        loanData: loanDataWithProduct,
        referralCode: assistedBy ? null : readReferral(),
        consents: { dataProcessing: true, location: true, crb: CRB_ENABLED && allowCrb },
        location,
        assisted: Boolean(assistedBy),
        consentCode: assistedBy ? consentCode.trim() : undefined,
      })

      setSubmittedApplication(result)
      setShowSuccess(true)
      submissionKeyRef.current = newSubmissionKey()
      clearDraft({ remote: false })
    } catch (error) {
      if (error?.response?.status === 401) invalidateDraftToken()
      setSubmitError(error?.response ? extractApiError(error) : error.message)
    } finally {
      setSubmitting(false)
    }
  }


  // An added product's own URL, before the workspace's products have loaded.
  if (awaitingProduct) {
    return (
      <div className="grid min-h-screen place-items-center bg-secondary/30">
        <Loader2 className="size-8 animate-spin text-primary" aria-label="Loading" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-secondary/30">
      <main className="container flex-1 py-8">
        <div className="mx-auto max-w-6xl">
          {/* No site chrome on the wizard — a single deliberate exit lives here,
              and it flushes the draft before leaving so the label is accurate. */}
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="accent">{product.name}</Badge>
              <span className="text-sm text-muted-foreground">
                Step {currentStep + 1} of {stepTitles.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {/* Who is filling this in, when an agent or RM is doing it for a customer. */}
              {assistedBy ? <AssistingAs user={assistedBy} /> : null}
              <Button type="button" variant="ghost" size="sm" onClick={handleSaveAndExit} disabled={exiting}>
                {exiting ? <Loader2 className="animate-spin" /> : <LogOut />}
                {exiting ? 'Saving…' : 'Save & exit'}
              </Button>
            </div>
          </div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl print:hidden">
            Apply for {product.name}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground print:hidden">
            {stepTitles[currentStep]} — fields marked with an asterisk are required. Your progress is saved as you go.
          </p>

          {remoteSyncError ? (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm font-medium text-destructive print:hidden"
            >
              {assistedBy
                ? `We couldn’t save this application to the server (${remoteSyncError}). Nothing is kept on this device, so keep this page open until it saves.`
                : `Your progress is saved on this device, but we couldn’t sync it to your account (${remoteSyncError}) — until it syncs, this application won’t be available if you resume on another device.`}
            </div>
          ) : null}

          {draftExists ? (
            <div
              role="alert"
              className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between print:hidden"
            >
              <p className="font-medium text-destructive">
                {assistedBy
                  ? `An application is already in progress for ${applicantEmail.trim()}, so this one can’t be saved. Find it in the pipeline, or use a different email address.`
                  : `An application is already in progress for ${applicantEmail.trim()}. To carry on with it, resume it with a code we’ll email you — or use a different email address. Until then, your answers are saved on this device only.`}
              </p>
              {assistedBy ? null : (
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={handleResumeExisting}>
                  Resume with a code
                </Button>
              )}
            </div>
          ) : null}

          {/* Deliberately milder than the draft-sync warning above: the application
              itself synced, so it stays resumable — the attachments just need
              re-uploading once the upload problem is resolved. */}
          {documentSyncError ? (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm font-medium text-destructive print:hidden"
            >
              Your application is saved, but some attached documents couldn’t be uploaded ({documentSyncError}). You can
              carry on — re-attach them before submitting, or they won’t be included.
            </div>
          ) : null}

          {assistedBy ? (
            <div className="mt-6 flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between print:hidden">
              <p className="text-foreground">
                You’re filling this in for a customer as <span className="font-semibold">{assistedBy.name}</span>. It will
                be credited to you. Use the customer’s own email address.
              </p>
              <button
                type="button"
                className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  clearAssistedFlag()
                  navigate('/admin/applications')
                }}
              >
                Back to the workspace
              </button>
            </div>
          ) : null}

          {localDraftSummary ? (
            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-primary/25 bg-accent/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-accent-foreground">
                We found an application in progress ({products.find((entry) => entry.id === localDraftSummary.loanData?.productId)?.name || (localDraftSummary.loanType === 'personal' ? 'Personal loan' : 'Business loan')},
                step {localDraftSummary.currentStep + 1}, saved {new Date(localDraftSummary.savedAt).toLocaleString()}). Resume it, or start a new application?
              </p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={startFreshDraft}>
                  Start fresh
                </Button>
                <Button type="button" size="sm" onClick={resumeLocalDraft}>
                  Resume
                </Button>
              </div>
            </div>
          ) : null}

          {prefilledApplication && currentStep < stepTitles.length - 1 ? (
            <div className="mt-6 rounded-lg border border-primary/25 bg-accent/60 p-4 text-sm text-accent-foreground print:hidden">
              Your application has been auto-filled from your existing application. Kindly edit where necessary and
              upload all the required fresh documents.
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border bg-card p-5 shadow-soft sm:p-6 print:hidden">
            <StepProgress steps={stepTitles} currentStep={currentStep} onStepSelect={goToStep} />
          </div>

          <form onSubmit={handleFormSubmit} noValidate className="relative mt-6">
            {submitting && (
              <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
                <div className="inline-flex flex-col items-center gap-3 rounded-lg border bg-card p-8 shadow-lift">
                  <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
                  <p className="text-sm font-semibold" role="status">
                    Submitting application…
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-6">
              <ErrorSummary ref={errorSummaryRef} errors={validationErrors} />

              {currentStep === 0 && !assistedBy && customerOptions.helpWithFinishing ? <DraftContactConsent /> : null}

              <WizardStep
                addCollateralItem={addCollateralItem}
                addDirector={addDirector}
                addDirectorUpload={addDirectorUpload}
                collateralTypes={collateralTypes}
                allowCrb={allowCrb}
                analysisFor={analysisFor}
                applicantEmail={applicantEmail}
                assistedBy={assistedBy}
                businessData={businessData}
                consentCode={consentCode}
                consentCodeState={consentCodeState}
                currentStep={currentStep}
                getUploadStatus={getUploadStatus}
                goToStep={goToStep}
                handleDirectorDocumentInputChange={handleDirectorDocumentInputChange}
                handleDocumentInputChange={handleDocumentInputChange}
                hasCamera={hasCamera}
                interestLabel={interestLabel}
                loanData={loanData}
                maxAmount={maxAmount}
                maxTenure={maxTenure}
                minAmount={minAmount}
                minTenure={minTenure}
                monthlyRepayment={monthlyRepayment}
                personalData={personalData}
                prescreen={prescreen}
                prescreenView={prescreenView}
                price={price}
                product={product}
                removeCollateralItem={removeCollateralItem}
                removeDirector={removeDirector}
                removeDirectorUpload={removeDirectorUpload}
                retryPrescreen={retryPrescreen}
                selectedLoanType={selectedLoanType}
                sendConsentCode={sendConsentCode}
                setAllowCrb={setAllowCrb}
                setConsentCode={setConsentCode}
                setLoanData={setLoanData}
                setPreviewAttachment={setPreviewAttachment}
                setShowCameraCapture={setShowCameraCapture}
                totalRepayable={totalRepayable}
                updateCollateralItem={updateCollateralItem}
                updateDirectorField={updateDirectorField}
                updateSectionField={updateSectionField}
                validationErrors={validationErrors}
              />

              {submitError ? (
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm font-medium text-destructive">
                  {submitError}
                </div>
              ) : null}
            </div>

            <div className="sticky bottom-0 z-10 mt-6 flex flex-col gap-3 rounded-lg border bg-background/95 p-4 shadow-lift backdrop-blur sm:flex-row sm:items-center sm:justify-between print:hidden">
              {/* Step 0 has nothing to go back to, and leaving is already offered
                  once by "Save & exit" above — so no duplicate exit down here. */}
              {currentStep > 0 ? (
                <Button type="button" variant="outline" onClick={handleBack} disabled={submitting}>
                  <ArrowLeft />
                  Previous step
                </Button>
              ) : (
                <span className="hidden sm:block" aria-hidden="true" />
              )}

              {!isFinalStep ? (
                <Button type="submit">
                  Continue
                  <ArrowRight />
                </Button>
              ) : (
                <Button type="submit" disabled={submitting || (Boolean(assistedBy) && consentCode.length < 6)}>
                  {submitting ? <Loader2 className="animate-spin" /> : <Send />}
                  {submitting ? 'Submitting…' : 'Submit application'}
                </Button>
              )}
            </div>
          </form>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-2 pb-6 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground print:hidden">
        <span>Powered by</span>
        <img src={footerLogo} alt="Powered by Izyane" className="h-5 w-auto object-contain" />
      </footer>

      <DocumentPreviewDialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null)
        }}
        attachment={previewAttachment}
      />

      <Dialog open={showCameraCapture} onOpenChange={setShowCameraCapture}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Take passport photo</DialogTitle>
          </DialogHeader>
          <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Starting the camera…</p>}>
            <FaceCaptureCamera onCapture={handleCameraCapture} onCancel={() => setShowCameraCapture(false)} />
          </Suspense>
        </DialogContent>
      </Dialog>

      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} onAccept={onAcceptTerms} />
      <SuccessModal
        open={showSuccess}
        reference={submittedApplication?.reference}
        assisted={Boolean(assistedBy)}
        onClose={() => {
          setShowSuccess(false)
          resetForm()
          if (assistedBy && submittedApplication) {
            clearAssistedFlag()
            navigate(`/admin/applications/${submittedApplication.id}`)
          } else {
            navigate('/my-applications', { state: { email: applicantEmail } })
          }
        }}
        loanType={selectedLoanType}
        productName={product.name}
        amount={loanData.amount}
        tenure={loanData.tenure}
        monthlyRepayment={monthlyRepayment}
        totalRepayable={totalRepayable}
        submitting={submitting}
      />
    </div>
  )
}

export default DashboardPage

/* eslint-disable react/prop-types */
/** The staff member filling in an application for a customer: their initials, name and role. */
function AssistingAs({ user }) {
  const initials = String(user.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <div className="flex items-center gap-2.5 rounded-full border bg-card py-1 pl-1 pr-3.5 shadow-sm" aria-label={`Filling in as ${user.name}, ${user.roleLabel || 'staff'}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">
        {initials}
      </span>
      <span className="min-w-0 leading-tight" aria-hidden="true">
        <span className="block max-w-[11rem] truncate text-sm font-semibold text-foreground">{user.name}</span>
        <span className="block max-w-[11rem] truncate text-xs text-muted-foreground">{user.roleLabel || 'Staff'}</span>
      </span>
    </div>
  )
}
