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
  CheckCircle2,
  Loader2,
  LogOut,
  ShieldCheck,
  Send,
} from 'lucide-react'
import TermsModal from '../components/TermsModal'
import SuccessModal from '../components/SuccessModal'
// The face-detection model is large; it loads only when someone opens the camera.
const FaceCaptureCamera = lazy(() => import('../components/FaceCaptureCamera').then((module) => ({ default: module.FaceCaptureCamera })))
import dayjs from 'dayjs'
import footerLogo from '../assets/izyane-black.svg'
import { submitApplication, fetchSession, requestConsentCode, lookupZraApplicant, extractApiError } from '../services/applicationsApi'
import { extractFiles } from '../utils/fileTree'
import { readReferral } from '../lib/referral'
import { isAssistedFlagSet, clearAssistedFlag } from '../lib/assisted'
import { useProduct } from '../hooks/useProducts'
import { describeInterest, priceLoan } from '../config/loanProducts'
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

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StepProgress } from '@/components/application/StepProgress'
import { ErrorSummary } from '@/components/application/ErrorSummary'
import { DocumentPreviewDialog } from '@/components/application/DocumentPreviewDialog'
import {
  STEP_TITLES,
  applyPath,
  isLoanType,
  isValidStepSlug,
  stepIndex,
} from '@/config/applicationSteps'
import { WizardStep } from './apply/WizardSteps'
import { DraftContactConsent } from '@/components/application/DraftContactConsent'
import { CRB_ENABLED, businessInitial, personalInitial } from './apply/formDefaults'

/** The device's position for the location consent, or null if it is refused or unavailable. */
const currentPosition = () =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
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

  // The URL owns which loan type and which step we are on. Everything else stays
  // component state, so a refresh or a Back press lands on the right screen while
  // the draft layer restores the answers.
  const selectedLoanType = isLoanType(typeParam)
    ? typeParam
    : location.state?.type === 'business'
      ? 'business'
      : 'personal'
  const stepTitles = STEP_TITLES[selectedLoanType]
  const currentStep = stepIndex(selectedLoanType, stepParam)

  // Mirrors of the derived values, updated eagerly by the setters below so that
  // two setter calls in the same tick (draft hydration sets type *and* step)
  // compose instead of the second one reading a stale type.
  const loanTypeRef = useRef(selectedLoanType)
  const stepRef = useRef(currentStep)
  loanTypeRef.current = selectedLoanType
  stepRef.current = currentStep

  const navigateToStep = useCallback(
    (type, index, { replace = false } = {}) => {
      navigate(applyPath(type, index), { replace })
    },
    [navigate]
  )

  // Passed to useApplicationDraft: resuming a draft should not push history.
  const setSelectedLoanType = useCallback(
    (type) => {
      const next = isLoanType(type) ? type : 'personal'
      loanTypeRef.current = next
      navigateToStep(next, stepRef.current, { replace: true })
    },
    [navigateToStep]
  )

  const setCurrentStep = useCallback(
    (index) => {
      stepRef.current = index
      navigateToStep(loanTypeRef.current, index, { replace: true })
    },
    [navigateToStep]
  )

  // Normalise bare or unknown URLs (/apply, /apply/personal, bad slug) onto the
  // canonical path, carrying router state through so a resumed draft survives.
  useEffect(() => {
    if (!isLoanType(typeParam) || !isValidStepSlug(typeParam, stepParam)) {
      navigate(applyPath(selectedLoanType, 0), { replace: true, state: location.state })
    }
  }, [typeParam, stepParam, selectedLoanType, navigate, location.state])

  const [personalData, setPersonalData] = useState(personalInitial)
  const [businessData, setBusinessData] = useState(businessInitial)
  const [loanData, setLoanData] = useState(initialLoanState)
  const [previewAttachment, setPreviewAttachment] = useState(null)
  const [showTerms, setShowTerms] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [validationErrors, setValidationErrors] = useState({})
  const [zraLookupType, setZraLookupType] = useState(selectedLoanType === 'personal' ? 'NRC' : 'TPIN')
  const [zraConsent, setZraConsent] = useState(false)
  const [zraLookupState, setZraLookupState] = useState({ status: 'idle', message: '', taxpayer: null })
  const [submittedApplication, setSubmittedApplication] = useState(null)
  const [shareLocation, setShareLocation] = useState(false)
  // First step, self-service only: staff may see this draft and help finish it.
  const [contactConsent, setContactConsent] = useState(false)
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
    loanData,
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

  // Limits and pricing come from the workspace's product settings (useProducts).
  const product = useProduct(selectedLoanType)
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

  const isPassportPhotoField = (field) => field === 'passportPhoto'

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

  useEffect(() => {
    setZraLookupType(selectedLoanType === 'personal' ? 'NRC' : 'TPIN')
    setZraConsent(false)
    setZraLookupState({ status: 'idle', message: '', taxpayer: null })
  }, [selectedLoanType])

  const changeZraLookupType = (type) => {
    setZraLookupType(type)
    setZraConsent(false)
    setZraLookupState({ status: 'idle', message: '', taxpayer: null })
  }

  const zraLookupValue = selectedLoanType === 'personal'
    ? zraLookupType === 'NRC'
      ? personalData.personalInfo.nrc
      : zraLookupType === 'TPIN'
        ? personalData.personalInfo.tpin
        : personalData.personalInfo.passportNumber
    : zraLookupType === 'BRN'
      ? businessData.businessInfo.brn
      : businessData.businessInfo.tpin

  const updateZraLookupValue = (value) => {
    if (selectedLoanType === 'personal') {
      const field = zraLookupType === 'NRC' ? 'nrc' : zraLookupType === 'TPIN' ? 'tpin' : 'passportNumber'
      updateSectionField('personalInfo', field, value, field === 'nrc' ? 'nrc' : 'default')
    } else {
      updateSectionField('businessInfo', zraLookupType === 'BRN' ? 'brn' : 'tpin', value)
    }
    setZraLookupState({ status: 'idle', message: '', taxpayer: null })
  }

  const handleZraLookup = async () => {
    if (!zraConsent || !zraLookupValue?.trim() || zraLookupState.status === 'loading') return
    setZraLookupState({ status: 'loading', message: '', taxpayer: null })
    try {
      const result = await lookupZraApplicant(zraLookupType, zraLookupValue.trim())
      if (!result?.found) {
        setZraLookupState({ status: 'not-found', message: 'No ZRA record was found. Check the identifier and try again.', taxpayer: null })
        return
      }

      const taxpayer = result.taxpayer || {}
      if (!taxpayer.tpin?.trim()) {
        setZraLookupState({ status: 'error', message: 'A ZRA record was found, but no TPIN mapping was returned. Check the identifier or contact support.', taxpayer: null })
        return
      }

      if (selectedLoanType === 'personal') {
        updateSectionField('personalInfo', 'tpin', taxpayer.tpin.trim())
        if (taxpayer.name?.trim()) {
          const nameParts = taxpayer.name.trim().split(/\s+/)
          updateSectionField('personalInfo', 'zraVerifiedName', taxpayer.name.trim())
          updateSectionField('personalInfo', 'firstName', nameParts[0], 'alpha')
          updateSectionField('personalInfo', 'middleName', nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '', 'alpha')
          updateSectionField('personalInfo', 'surname', nameParts.length > 1 ? nameParts.at(-1) : '', 'alpha')
        }
      } else {
        updateSectionField('businessInfo', 'tpin', taxpayer.tpin.trim())
        if (taxpayer.name?.trim()) {
          updateSectionField('businessInfo', 'zraVerifiedName', taxpayer.name.trim())
          updateSectionField('businessInfo', 'companyName', taxpayer.name.trim())
        }
      }
      setZraLookupState({
        status: 'found',
        message: taxpayer.name?.trim()
          ? 'Identifier verified with ZRA. The returned details have been filled into the form.'
          : 'TPIN verified with ZRA, but no name mapping was returned. Enter the name in the form.',
        taxpayer,
      })
    } catch (error) {
      setZraLookupState({ status: 'error', message: extractApiError(error), taxpayer: null })
    }
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

  // Every upload slot the AI checks, with what its document should agree with on the
  // form. `slot` is the label staff see in the prescreen; fieldKey matches the keys the
  // upload fields already use for status.
  const analysisSlots = (() => {
    if (selectedLoanType === 'personal') {
      const { firstName, middleName, surname, nrc } = personalData.personalInfo
      const applicant = { name: [firstName, middleName, surname].filter(Boolean).join(' '), nrc }
      const docs = personalData.documents
      return [
        { fieldKey: 'payslips', docType: 'payslips', slot: 'Latest three payslips', required: true, file: docs.payslips, expected: applicant },
        { fieldKey: 'bankStatements', docType: 'bankStatements', slot: 'Bank statements', required: true, file: docs.bankStatements, expected: { name: applicant.name } },
        { fieldKey: 'nrcCopy', docType: 'nrcCopy', slot: 'NRC copy', required: true, file: docs.nrcCopy, expected: applicant },
        { fieldKey: 'tpin', docType: 'tpin', slot: 'TPIN certificate', required: true, file: docs.tpin, expected: { name: applicant.name } },
        { fieldKey: 'passportPhoto', docType: 'passportPhoto', slot: 'Passport photo', required: true, file: docs.passportPhoto, expected: {} },
      ]
    }

    const company = { companyName: businessData.businessInfo.companyName, holderIsCompany: true }
    const docs = businessData.documents
    const directors = businessData.directorInfo.directors || []
    return [
      { fieldKey: 'pacraCertificate', docType: 'pacraCertificate', slot: 'PACRA certificate', required: true, file: docs.pacraCertificate, expected: company },
      { fieldKey: 'form2', docType: 'form2', slot: 'Form 2', required: true, file: docs.form2, expected: company },
      { fieldKey: 'taxClearance', docType: 'taxClearance', slot: 'Tax clearance certificate / TPIN', required: true, file: docs.taxClearance, expected: company },
      { fieldKey: 'latestTaxComplianceReturn', docType: 'latestTaxComplianceReturn', slot: 'Latest tax compliance return', required: true, file: docs.latestTaxComplianceReturn, expected: company },
      { fieldKey: 'orderOrInvoice', docType: 'orderOrInvoice', slot: 'Order / Invoice', required: false, file: docs.orderOrInvoice, expected: {} },
      { fieldKey: 'bankStatements', docType: 'bankStatements', slot: 'Bank statements', required: true, file: docs.bankStatements, expected: company },
      { fieldKey: 'boardResolution', docType: 'boardResolution', slot: 'Board resolution', required: true, file: docs.boardResolution, expected: company },
      { fieldKey: 'passportPhoto', docType: 'passportPhoto', slot: 'Applicant passport photo', required: true, file: docs.passportPhoto, expected: {} },
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

  const updateDocumentField = (field, file, inputElement = null) => {
    const setter = selectedLoanType === 'personal' ? setPersonalData : setBusinessData
    const errorKey = `documents.${field}`
    let validationMessage = ''

    if (file) {
      validationMessage = isPassportPhotoField(field) ? validatePassportFile(file) : validatePdfFile(file)
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
    if (file) {
      setter((prev) => ({
        ...prev,
        documents: {
          ...prev.documents,
          [field]: file,
        },
      }))
      setTimeout(() => {
        setUploadStatus(field, 'success')
      }, 600)
    } else {
      setUploadStatus(field, 'idle')
      setter((prev) => ({
        ...prev,
        documents: {
          ...prev.documents,
          [field]: file,
        },
      }))
    }
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
        directorUploads: (prev.documents.directorUploads || []).length < 3
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
        directors: prev.directorInfo.directors.length < 3
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

    // With an agent, the customer agrees at submit, by code; on their own, up front.
    if (currentStep === 0 && !assistedBy && !contactConsent) {
      recordError('contactConsent', 'Please agree that we may help you finish your application.')
    }

    if (selectedLoanType === 'personal') {
      if (currentStep === 0) {
        requiredField(personalData.personalInfo.firstName, 'personalInfo.firstName', 'First name is required.')
        requiredField(personalData.personalInfo.surname, 'personalInfo.surname', 'Surname is required.')
        requiredField(personalData.personalInfo.phone, 'personalInfo.phone', 'Phone is required.')
        requiredField(personalData.personalInfo.email, 'personalInfo.email', 'Email is required.')
        requiredField(personalData.personalInfo.nrc, 'personalInfo.nrc', 'NRC is required.')
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
        if (personalData.personalInfo.nrc && !isValidNRC(personalData.personalInfo.nrc)) {
          recordError('personalInfo.nrc', 'NRC must be 6 digits, slash, 2 digits, slash, then 1–2 digits.')
        }
      }

      if (currentStep === 1) {
        requiredField(personalData.employmentInfo.residentialAddress, 'employmentInfo.residentialAddress', 'Residential address is required.')
        requiredField(personalData.employmentInfo.occupation, 'employmentInfo.occupation', 'Occupation is required.')
        requiredField(personalData.employmentInfo.employerName, 'employmentInfo.employerName', 'Employer name is required.')
        requiredField(personalData.employmentInfo.nationality, 'employmentInfo.nationality', 'Nationality is required.')
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

      if (currentStep === 2) {
        requiredField(personalData.documents.payslips, 'documents.payslips', 'Latest three payslips are required.')
        requiredField(personalData.documents.bankStatements, 'documents.bankStatements', 'Bank statements are required.')
        requiredField(personalData.documents.nrcCopy, 'documents.nrcCopy', 'NRC copy is required.')
        requiredField(personalData.documents.passportPhoto, 'documents.passportPhoto', 'Passport photo is required.')
        requiredField(personalData.documents.tpin, 'documents.tpin', 'TPIN certificate is required.')
        const pdfFields = [
          { value: personalData.documents.payslips, key: 'documents.payslips' },
          { value: personalData.documents.bankStatements, key: 'documents.bankStatements' },
          { value: personalData.documents.nrcCopy, key: 'documents.nrcCopy' },
          { value: personalData.documents.tpin, key: 'documents.tpin' },
        ]

        pdfFields.forEach(({ value, key }) => {
          if (value) {
            const validationMessage = validatePdfFile(value)
            if (validationMessage) {
              recordError(key, validationMessage)
            }
          }
        })

        if (personalData.documents.passportPhoto) {
          const validationMessage = validatePassportFile(personalData.documents.passportPhoto)
          if (validationMessage) {
            recordError('documents.passportPhoto', validationMessage)
          }
        }
      }
    }

    if (selectedLoanType === 'business') {
      if (currentStep === 0) {
        requiredField(businessData.businessInfo.companyName, 'businessInfo.companyName', 'Company name is required.')
        requiredField(businessData.businessInfo.businessType, 'businessInfo.businessType', 'Type of business is required.')
        requiredField(businessData.businessInfo.establishedDate, 'businessInfo.establishedDate', 'Established date is required.')
        requiredField(businessData.businessInfo.natureOfBusiness, 'businessInfo.natureOfBusiness', 'Nature of business is required.')
        requiredField(businessData.businessInfo.registeredOffice, 'businessInfo.registeredOffice', 'Registered office is required.')
        requiredField(businessData.businessInfo.collateralPledged, 'businessInfo.collateralPledged', 'Collateral pledged is required.')
        requiredField(businessData.businessInfo.purposeOfLoan, 'businessInfo.purposeOfLoan', 'Purpose of loan is required.')
      }

      if (currentStep === 1) {
        const directors = businessData.directorInfo.directors || []
        directors.forEach((director, index) => {
          requiredField(director.name, `directorInfo.directors[${index}].name`, `Director ${index + 1} name is required.`)
          requiredField(director.phone, `directorInfo.directors[${index}].phone`, `Director ${index + 1} phone is required.`)
          requiredField(director.email, `directorInfo.directors[${index}].email`, `Director ${index + 1} email is required.`)
          requiredField(director.nrc, `directorInfo.directors[${index}].nrc`, `Director ${index + 1} NRC is required.`)
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
        requiredField(businessData.directorInfo.applicantNrc, 'directorInfo.applicantNrc', 'Applicant NRC is required.')
        requiredField(businessData.directorInfo.applicantGender, 'directorInfo.applicantGender', 'Applicant gender is required.')
        requiredField(businessData.directorInfo.applicantMaritalStatus, 'directorInfo.applicantMaritalStatus', 'Applicant marital status is required.')
        requiredField(businessData.directorInfo.applicantBirthDate, 'directorInfo.applicantBirthDate', 'Applicant birth date is required.')
        if (businessData.directorInfo.applicantBirthDate && !isValidBirthDate(businessData.directorInfo.applicantBirthDate)) {
          recordError('directorInfo.applicantBirthDate', 'Age must be between 18 and 65.')
        }
        requiredField(businessData.directorInfo.applicantAddress, 'directorInfo.applicantAddress', 'Applicant address is required.')
        requiredField(businessData.directorInfo.applicantPosition, 'directorInfo.applicantPosition', 'Applicant position is required.')
        requiredField(businessData.directorInfo.applicantNationality, 'directorInfo.applicantNationality', 'Applicant nationality is required.')
        if (businessData.directorInfo.applicantPhone && !isValidPhone(businessData.directorInfo.applicantPhone)) {
          recordError('directorInfo.applicantPhone', 'Enter 9 digits.')
        }
        if (businessData.directorInfo.applicantEmail && !isValidEmail(businessData.directorInfo.applicantEmail)) {
          recordError('directorInfo.applicantEmail', 'Email must end with a .com domain.')
        }
        if (businessData.directorInfo.applicantNrc && !isValidNRC(businessData.directorInfo.applicantNrc)) {
          recordError('directorInfo.applicantNrc', 'NRC must be 6 digits, slash, 2 digits, slash, then 1–2 digits.')
        }
      }

      if (currentStep === 2) {
        requiredField(businessData.documents.pacraCertificate, 'documents.pacraCertificate', 'PACRA certificate is required.')
        requiredField(businessData.documents.form2, 'documents.form2', 'Form 2 is required.')
        requiredField(businessData.documents.latestTaxComplianceReturn, 'documents.latestTaxComplianceReturn', 'Latest tax compliance return is required.')
        requiredField(businessData.documents.taxClearance, 'documents.taxClearance', 'Tax clearance certificate is required.')
        requiredField(businessData.documents.bankStatements, 'documents.bankStatements', 'Bank statements are required.')
        requiredField(businessData.documents.passportPhoto, 'documents.passportPhoto', 'Passport photo is required.')
        requiredField(businessData.documents.boardResolution, 'documents.boardResolution', 'Board resolution is required.')

        const pdfFields = [
          { value: businessData.documents.pacraCertificate, key: 'documents.pacraCertificate' },
          { value: businessData.documents.form2, key: 'documents.form2' },
          { value: businessData.documents.latestTaxComplianceReturn, key: 'documents.latestTaxComplianceReturn' },
          { value: businessData.documents.taxClearance, key: 'documents.taxClearance' },
          { value: businessData.documents.bankStatements, key: 'documents.bankStatements' },
          { value: businessData.documents.boardResolution, key: 'documents.boardResolution' },
          { value: businessData.documents.orderOrInvoice, key: 'documents.orderOrInvoice' },
        ]

        pdfFields.forEach(({ value, key }) => {
          if (value) {
            const validationMessage = validatePdfFile(value)
            if (validationMessage) {
              recordError(key, validationMessage)
            }
          }
        })

        if (businessData.documents.passportPhoto) {
          const validationMessage = validatePassportFile(businessData.documents.passportPhoto)
          if (validationMessage) {
            recordError('documents.passportPhoto', validationMessage)
          }
        }

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
      navigateToStep(selectedLoanType, currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      navigateToStep(selectedLoanType, currentStep - 1)
    } else {
      navigate('/')
    }
  }

  const goToStep = (index) => {
    navigateToStep(selectedLoanType, index)
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
    applicant:
      selectedLoanType === 'personal'
        ? { employmentInfo: personalData.employmentInfo }
        : {
            businessInfo: businessData.businessInfo,
            directorInfo: {
              applicantPosition: businessData.directorInfo.applicantPosition,
              directors: (businessData.directorInfo.directors || []).map(() => ({})),
            },
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
      const token = await flushRemoteDraft()
      if (!token) {
        throw new Error(
          syncConflictMessage() || 'We couldn’t save your application to our server. Check your connection and try again.'
        )
      }
      await ensureDocumentsUploaded(token)

      const location = shareLocation ? await currentPosition() : null
      const scope = selectedLoanType === 'personal' ? 'personal' : 'business'
      const activeData = selectedLoanType === 'personal' ? personalData : businessData
      const result = await submitApplication(token, {
        submissionKey: submissionKeyRef.current,
        loanType: selectedLoanType,
        data: extractFiles(activeData, scope).sanitized,
        loanData,
        referralCode: assistedBy ? null : readReferral(),
        consents: { dataProcessing: true, location: Boolean(location), crb: CRB_ENABLED && allowCrb },
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


  return (
    <div className="flex min-h-screen flex-col bg-secondary/30">
      <main className="container flex-1 py-8">
        <div className="mx-auto max-w-6xl">
          {/* No site chrome on the wizard — a single deliberate exit lives here,
              and it flushes the draft before leaving so the label is accurate. */}
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="accent">
                {selectedLoanType === 'personal' ? 'Personal loan' : 'Business loan'}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Step {currentStep + 1} of {stepTitles.length}
              </span>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={handleSaveAndExit} disabled={exiting}>
              {exiting ? <Loader2 className="animate-spin" /> : <LogOut />}
              {exiting ? 'Saving…' : 'Save & exit'}
            </Button>
          </div>

          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl print:hidden">
            Apply for {selectedLoanType === 'personal' ? 'Personal' : 'Business'} Loan
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
                We found an application in progress ({localDraftSummary.loanType === 'personal' ? 'Personal' : 'Business'} loan,
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

              {currentStep === 0 && !assistedBy ? (
                <DraftContactConsent
                  checked={contactConsent}
                  onChange={(value) => {
                    setContactConsent(value)
                    if (value) setValidationError('contactConsent', '')
                  }}
                  error={validationErrors.contactConsent}
                />
              ) : null}

              {currentStep === 0 ? (
                <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-5 shadow-soft print:hidden sm:p-6 dark:border-blue-900/60 dark:bg-blue-950/20">
                  <div className="mb-5 flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-blue-100 text-blue-800 dark:bg-blue-900/70 dark:text-blue-200">
                      <ShieldCheck className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-base font-semibold text-blue-950 dark:text-blue-100">ZRA taxpayer verification</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Verify your details before continuing. Your consent is required to check this identifier with ZRA.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-medium" htmlFor="zra-lookup-type">
                      Identifier type
                      <Select
                        id="zra-lookup-type"
                        value={zraLookupType}
                        disabled={zraLookupState.status === 'loading'}
                        onChange={(event) => changeZraLookupType(event.target.value)}
                      >
                        {(selectedLoanType === 'personal' ? ['NRC', 'TPIN', 'PASSPORT'] : ['TPIN', 'BRN']).map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </Select>
                    </label>
                    <label className="grid gap-1.5 text-sm font-medium" htmlFor="zra-lookup-value">
                      {zraLookupType === 'PASSPORT' ? 'Passport number' : zraLookupType === 'BRN' ? 'Business registration number (BRN)' : zraLookupType}
                      <Input
                        id="zra-lookup-value"
                        value={zraLookupValue ?? ''}
                        disabled={zraLookupState.status === 'loading'}
                        onChange={(event) => updateZraLookupValue(event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex max-w-2xl items-start gap-2.5 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={zraConsent}
                        disabled={zraLookupState.status === 'loading'}
                        onChange={(event) => setZraConsent(event.target.checked)}
                        className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
                      />
                      <span>I consent to this identifier being checked with the Zambia Revenue Authority (ZRA).</span>
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!zraConsent || !zraLookupValue?.trim() || zraLookupState.status === 'loading'}
                      onClick={handleZraLookup}
                      className="shrink-0"
                    >
                      {zraLookupState.status === 'loading' ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                      Verify with ZRA
                    </Button>
                  </div>

                  {zraLookupState.status !== 'idle' ? (
                    <div
                      className={`mt-4 flex items-start gap-2 text-sm ${zraLookupState.status === 'found' ? 'text-success' : zraLookupState.status === 'loading' ? 'text-muted-foreground' : 'text-destructive'}`}
                      role={zraLookupState.status === 'error' || zraLookupState.status === 'not-found' ? 'alert' : 'status'}
                    >
                      {zraLookupState.status === 'found' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : null}
                      <span>
                        {zraLookupState.message}
                        {zraLookupState.status === 'found' ? (
                          <span className="mt-1 block font-medium text-foreground">
                            {zraLookupState.taxpayer?.name ? `ZRA name: ${zraLookupState.taxpayer.name} · ` : ''}
                            TPIN: {zraLookupState.taxpayer?.tpin}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <WizardStep
                addDirector={addDirector}
                addDirectorUpload={addDirectorUpload}
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
                removeDirector={removeDirector}
                removeDirectorUpload={removeDirectorUpload}
                retryPrescreen={retryPrescreen}
                selectedLoanType={selectedLoanType}
                sendConsentCode={sendConsentCode}
                setAllowCrb={setAllowCrb}
                setConsentCode={setConsentCode}
                setLoanData={setLoanData}
                setPreviewAttachment={setPreviewAttachment}
                setShareLocation={setShareLocation}
                setShowCameraCapture={setShowCameraCapture}
                shareLocation={shareLocation}
                totalRepayable={totalRepayable}
                updateDirectorField={updateDirectorField}
                updateSectionField={updateSectionField}
                validationErrors={validationErrors}
                zraLookupState={zraLookupState}
                zraLookupType={zraLookupType}
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
