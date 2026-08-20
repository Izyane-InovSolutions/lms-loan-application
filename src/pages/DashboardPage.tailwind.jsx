import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Calculator,
  Fingerprint,
  FolderOpen,
  Home,
  Loader2,
  LogOut,
  Phone,
  Plus,
  Printer,
  Send,
  Trash2,
  User,
  Users,
  Wallet,
} from 'lucide-react'
import TermsModal from '../components/TermsModal'
import SuccessModal from '../components/SuccessModal'
import { FaceCaptureCamera } from '../components/FaceCaptureCamera'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import footerLogo from '../assets/izyane-black.svg'
import { createLoanApplication, extractErrorMessage, uploadFile } from '../services/lmsApi'
import { buildPersonalPayload, buildBusinessPayload } from '../utils/loanPayloadMapper'
import { useApplicationDraft } from '../hooks/useApplicationDraft'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormField } from '@/components/form/FormField'
import { FieldGroup } from '@/components/form/FieldGroup'
import { FileUploadField } from '@/components/form/FileUploadField'
import { StepProgress } from '@/components/application/StepProgress'
import { ErrorSummary } from '@/components/application/ErrorSummary'
import {
  ApplicationSummary,
  AttachmentList,
  SummaryHighlights,
  SummaryRow,
  SummarySection,
} from '@/components/application/ApplicationSummary'
import { DocumentPreviewDialog } from '@/components/application/DocumentPreviewDialog'
import { STEP_TITLES, applyPath, isLoanType, isValidStepSlug, stepIndex } from '@/config/applicationSteps'

const GENDER_OPTIONS = ['Male', 'Female']
const MARITAL_STATUS_OPTIONS = ['Single', 'Married', 'Widowed', 'Divorced', 'Separated']
const NATIONALITY_OPTIONS = ['Kenya', 'Malawi', 'Rwanda', 'Uganda', 'Zambia', 'Zimbabwe']
const RELATIONSHIP_OPTIONS = [
  'Parent',
  'Sibling',
  'Spouse',
  'Child',
  'Grandparent',
  'Grandchild',
  'Uncle/Aunt',
  'Nephew/Niece',
  'Cousin',
  'Guardian',
  'Friend',
]
const BUSINESS_TYPE_OPTIONS = [
  'Sole Proprietorship',
  'Partnership',
  'Limited Liability Company (LLC)',
  'Corporation',
]

/** Shared MUI DatePicker styling, mapped onto our design tokens. */
const datePickerSlotProps = (id) => ({
  textField: {
    id,
    fullWidth: true,
    size: 'small',
    sx: {
      '& .MuiOutlinedInput-root': {
        height: '2.75rem',
        borderRadius: 'calc(var(--radius) - 2px)',
        backgroundColor: 'hsl(var(--background))',
        fontFamily: 'inherit',
        fontSize: '1rem',
        color: 'hsl(var(--foreground))',
        '& fieldset': { borderColor: 'hsl(var(--input))' },
        '&:hover fieldset': { borderColor: 'hsl(var(--input))' },
        '&.Mui-focused fieldset': { borderColor: 'hsl(var(--ring))', borderWidth: '2px' },
      },
      '& .MuiInputBase-input': { padding: '0.5rem 0.875rem' },
    },
  },
})

const personalInitial = {
  personalInfo: {
    firstName: '',
    middleName: '',
    surname: '',
    phone: '',
    email: '',
    nrc: '',
    gender: '',
    maritalStatus: '',
    birthDate: '',
  },
  employmentInfo: {
    residentialAddress: '',
    occupation: '',
    employerName: '',
    nationality: '',
    principalObjectiveOfLoan: '',
    nextOfKinName: '',
    nextOfKinPhone: '',
    nextOfKinEmail: '',
    nextOfKinRelationship: '',
  },
  documents: {
    payslips: null,
    bankStatements: null,
    nrcCopy: null,
    passportPhoto: null,
    tpin: null,
  },
}

const businessInitial = {
  businessInfo: {
    companyName: '',
    businessType: '',
    establishedDate: '',
    natureOfBusiness: '',
    registeredOffice: '',
    collateralPledged: '',
    purposeOfLoan: '',
  },
  directorInfo: {
    directors: [{ name: '', phone: '', email: '', nrc: '' }],
    applicantFirstName: '',
    applicantMiddleName: '',
    applicantLastName: '',
    applicantPhone: '',
    applicantEmail: '',
    applicantNrc: '',
    applicantGender: '',
    applicantMaritalStatus: '',
    applicantBirthDate: '',
    applicantAddress: '',
    applicantPosition: '',
    applicantNationality: '',
  },
  documents: {
    form2: null,
    latestTaxComplianceReturn: null,
    orderOrInvoice: null,
    directorUploads: [{ nrc: null, passportPhoto: null }],
    pacraCertificate: null,
    taxClearance: null,
    bankStatements: null,
    passportPhoto: null,
    boardResolution: null,
  },
}

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

  const resumedDraft = location.state?.resumedDraft
  const hydratedResumedDraftRef = useRef(false)
  const errorSummaryRef = useRef(null)

  const {
    localDraftSummary,
    resumeLocalDraft,
    startFresh: startFreshDraft,
    hydrateFrom: hydrateResumedDraft,
    clearDraft,
    flushLocalDraft,
    flushRemoteDraft,
    canSyncRemotely,
    remoteSyncError,
    documentSyncError,
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
    skipLocalCheck: Boolean(resumedDraft),
  })

  useEffect(() => {
    if (resumedDraft && !hydratedResumedDraftRef.current) {
      hydratedResumedDraftRef.current = true
      hydrateResumedDraft(resumedDraft)
    }
  }, [resumedDraft, hydrateResumedDraft])

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

  const maxAmount = selectedLoanType === 'personal' ? 8000 : 50000
  const minAmount = selectedLoanType === 'personal' ? 500 : 5000
  const interestRate = 0.05
  const facilityFee = 175

  const totalRepayable = useMemo(
    () => loanData.amount + loanData.amount * interestRate + facilityFee,
    [loanData.amount]
  )

  const monthlyRepayment = useMemo(
    () => (loanData.tenure > 0 ? totalRepayable / loanData.tenure : totalRepayable),
    [loanData.tenure, totalRepayable]
  )

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
      const digits = value.replace(/\D/g, '')
      if (digits.startsWith('0')) {
        return digits.slice(0, 10)
      }
      return digits.length > 0 ? digits.slice(0, 10) : ''
    }

    return value
  }

  const isValidNRC = (value) => /^[0-9]{6}\/[0-9]{2}\/[0-9]{1,2}$/.test(value)
  const isValidPhone = (value) => {
    const phone = value.replace(/\s+/g, '')
    return /^0\d{9}$/.test(phone)
  }
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
          ? 'Phone must be 10 digits and start with 0.'
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
    setBusinessData((prev) => ({
      ...prev,
      directorInfo: {
        ...prev.directorInfo,
        directors: prev.directorInfo.directors.map((director, directorIndex) =>
          directorIndex === index
            ? { ...director, [field]: normalizeValue(value, fieldType) }
            : director
        ),
      },
    }))
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
          recordError('personalInfo.phone', 'Phone must be 10 digits and start with 0.')
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
          recordError('employmentInfo.nextOfKinPhone', 'Phone must be 10 digits and start with 0.')
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
            recordError(`directorInfo.directors[${index}].phone`, 'Phone must be 10 digits and start with 0.')
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
          recordError('directorInfo.applicantPhone', 'Phone must be 10 digits and start with 0.')
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
      navigate('/')
    } finally {
      setExiting(false)
    }
  }

  const handleSubmitApplication = () => {
    if (!validateCurrentStep()) {
      revealValidationErrors()
      return
    }
    setShowTerms(true)
  }

  const isFinalStep = currentStep === stepTitles.length - 1

  const handleFormSubmit = (event) => {
    event.preventDefault()
    if (isFinalStep) {
      handleSubmitApplication()
    } else {
      handleNext()
    }
  }

  const uploadPersonalDocuments = async () => {
    const uploaded = {}
    for (const field of ['payslips', 'bankStatements', 'nrcCopy', 'passportPhoto', 'tpin']) {
      const file = personalData.documents[field]
      if (file) {
        uploaded[field] = await uploadFile(file)
      }
    }
    return uploaded
  }

  const uploadBusinessDocuments = async () => {
    const applicantFields = [
      'pacraCertificate',
      'form2',
      'latestTaxComplianceReturn',
      'orderOrInvoice',
      'taxClearance',
      'bankStatements',
      'passportPhoto',
      'boardResolution',
    ]
    const uploaded = {}
    for (const field of applicantFields) {
      const file = businessData.documents[field]
      if (file) {
        uploaded[field] = await uploadFile(file)
      }
    }

    const directorUploaded = []
    for (const upload of businessData.documents.directorUploads || []) {
      const entry = {}
      if (upload.nrc) {
        entry.nrc = await uploadFile(upload.nrc)
      }
      if (upload.passportPhoto) {
        entry.passportPhoto = await uploadFile(upload.passportPhoto)
      }
      directorUploaded.push(entry)
    }

    return { uploaded, directorUploaded }
  }

  const onAcceptTerms = async () => {
    setShowTerms(false)
    setSubmitting(true)
    setSubmitError(null)
    try {
      const loanDetails = {
        amount: loanData.amount,
        tenure: loanData.tenure,
        totalAmount: Number(totalRepayable.toFixed(2)),
      }

      if (selectedLoanType === 'personal') {
        const uploadedFiles = await uploadPersonalDocuments()
        const payload = buildPersonalPayload(personalData, uploadedFiles, loanDetails)
        await createLoanApplication(payload)
      } else {
        const { uploaded, directorUploaded } = await uploadBusinessDocuments()
        const payload = buildBusinessPayload(businessData, uploaded, directorUploaded, loanDetails)
        await createLoanApplication(payload)
      }
      setShowSuccess(true)
      clearDraft()
    } catch (error) {
      setSubmitError(extractErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Field renderers
  // ---------------------------------------------------------------------------

  const renderField = (label, value, onChange, type = 'text', placeholder = '', inputProps = {}, required = false, errorKey = '') => {
    const name = errorKey || label
    return (
      <FormField key={label} name={name} label={label} required={required} error={validationErrors[errorKey]}>
        {(field) => (
          <Input
            {...field}
            type={type}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            {...inputProps}
          />
        )}
      </FormField>
    )
  }

  const renderSelectField = (label, value, onChange, options, placeholder, required = false, errorKey = '') => {
    const name = errorKey || label
    return (
      <FormField key={label} name={name} label={label} required={required} error={validationErrors[errorKey]}>
        {(field) => (
          <Select {...field} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
            <option value="">{placeholder}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </FormField>
    )
  }

  const renderDateField = (label, value, onChange, required = false, errorKey = '') => {
    const name = errorKey || label
    return (
      <FormField key={label} name={name} label={label} required={required} error={validationErrors[errorKey]}>
        {({ id }) => (
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              value={value ? dayjs(value) : null}
              onChange={(selected) => onChange(selected ? selected.format('YYYY-MM-DD') : '')}
              slotProps={datePickerSlotProps(id)}
            />
          </LocalizationProvider>
        )}
      </FormField>
    )
  }

  const renderBirthDateField = (label, value, onChange, required = false, errorKey = '') => {
    const name = errorKey || label
    return (
      <FormField
        key={label}
        name={name}
        label={label}
        required={required}
        error={validationErrors[errorKey]}
        hint="You must be between 18 and 65."
      >
        {({ id }) => (
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              value={value ? dayjs(value) : null}
              onChange={(selected) => onChange(selected ? selected.format('YYYY-MM-DD') : '')}
              minDate={dayjs().subtract(65, 'year')}
              maxDate={dayjs().subtract(18, 'year')}
              slotProps={datePickerSlotProps(id)}
            />
          </LocalizationProvider>
        )}
      </FormField>
    )
  }

  const renderUploadField = (label, field, file, required = false, acceptTypes = '.pdf', errorKey = '', cameraCapable = false) => (
    <FileUploadField
      key={field}
      name={errorKey || `documents.${field}`}
      label={label}
      file={file}
      accept={acceptTypes}
      required={required}
      error={validationErrors[errorKey]}
      status={getUploadStatus(field)}
      onChange={(event) => handleDocumentInputChange(field, event)}
      cameraFirst={cameraCapable && hasCamera}
      onUseCamera={() => setShowCameraCapture(true)}
    />
  )

  const renderSummaryRow = (label, value) => <SummaryRow key={label} label={label} value={value} />

  const renderSummarySection = (title, rows, stepIndex) => (
    <SummarySection key={title} title={title} stepIndex={stepIndex} onEdit={goToStep}>
      {rows}
    </SummarySection>
  )

  /** Headline figures repeated at the top of the printed summary. */
  const summaryHighlights = [
    { label: 'Loan amount', value: `K${loanData.amount.toLocaleString()}` },
    { label: 'Tenure', value: `${loanData.tenure} months` },
    { label: 'Monthly repayment', value: `K${monthlyRepayment.toFixed(2)}` },
    { label: 'Total repayable', value: `K${totalRepayable.toFixed(2)}` },
  ]

  const loanTermRows = [
    renderSummaryRow('Loan amount', `K${loanData.amount.toLocaleString()}`),
    renderSummaryRow('Tenure', `${loanData.tenure} months`),
    renderSummaryRow('Monthly repayment', `K${monthlyRepayment.toFixed(2)}`),
    renderSummaryRow('Interest (5% flat)', `K${(loanData.amount * interestRate).toFixed(2)}`),
    renderSummaryRow('Facility fee', `K${facilityFee.toFixed(2)}`),
    renderSummaryRow('Total repayable', `K${totalRepayable.toFixed(2)}`),
  ]

  const personalAttachments = [
    { key: 'payslips', label: 'Latest three payslips', file: personalData.documents.payslips },
    { key: 'bankStatements', label: 'Bank statements', file: personalData.documents.bankStatements },
    { key: 'nrcCopy', label: 'NRC copy', file: personalData.documents.nrcCopy },
    { key: 'passportPhoto', label: 'Passport photo', file: personalData.documents.passportPhoto },
    { key: 'tpin', label: 'TPIN certificate', file: personalData.documents.tpin },
  ]

  const businessAttachments = [
    { key: 'pacraCertificate', label: 'PACRA certificate', file: businessData.documents.pacraCertificate },
    { key: 'form2', label: 'Form 2', file: businessData.documents.form2 },
    { key: 'taxClearance', label: 'Tax clearance certificate / TPIN', file: businessData.documents.taxClearance },
    {
      key: 'latestTaxComplianceReturn',
      label: 'Latest tax compliance return',
      file: businessData.documents.latestTaxComplianceReturn,
    },
    { key: 'orderOrInvoice', label: 'Order / Invoice', file: businessData.documents.orderOrInvoice },
    { key: 'bankStatements', label: 'Bank statements', file: businessData.documents.bankStatements },
    { key: 'passportPhoto', label: 'Passport photo', file: businessData.documents.passportPhoto },
    { key: 'boardResolution', label: 'Board resolution', file: businessData.documents.boardResolution },
    ...(businessData.documents.directorUploads || []).flatMap((upload, index) => [
      { key: `director-${index}-nrc`, label: `Director ${index + 1} NRC upload`, file: upload.nrc },
      { key: `director-${index}-photo`, label: `Director ${index + 1} passport photo`, file: upload.passportPhoto },
    ]),
  ]

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  const renderLoanTerms = () => (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <FieldGroup title="Choose your loan" description="Drag the slider or type an exact amount." icon={Wallet} columns={2}>
        <div className="md:col-span-2">
          <p className="text-sm text-muted-foreground">Loan amount</p>
          <p className="mt-1 text-4xl font-bold tracking-tight text-foreground">
            K{loanData.amount.toLocaleString()}
          </p>
          <input
            type="range"
            min={minAmount}
            max={maxAmount}
            step="100"
            value={loanData.amount}
            onChange={(event) => setLoanData((prev) => ({ ...prev, amount: Number(event.target.value) }))}
            aria-label="Loan amount"
            className="mt-5 w-full accent-primary"
          />
          <div className="mt-2 flex justify-between text-xs font-medium text-muted-foreground">
            <span>K{minAmount.toLocaleString()}</span>
            <span>K{maxAmount.toLocaleString()}</span>
          </div>
        </div>

        {renderField('Enter amount', loanData.amount, (value) => {
          const amount = Number(value.replace(/[^0-9]/g, '') || 0)
          const constrained = Math.min(Math.max(amount, minAmount), maxAmount)
          setLoanData((prev) => ({ ...prev, amount: constrained }))
        }, 'number', `Between ${minAmount} and ${maxAmount}`, { min: minAmount, max: maxAmount }, true)}

        {renderField('Tenure (months)', loanData.tenure, (value) => {
          const tenure = Number(value)
          if (tenure >= 1) {
            setLoanData((prev) => ({ ...prev, tenure }))
          }
        }, 'number', 'e.g. 6', { min: 1, max: 36 }, true)}
      </FieldGroup>

      <div className="xl:sticky xl:top-8 xl:self-start">
        <div className="rounded-lg border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-3 border-b border-border pb-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
              <Calculator className="size-4" aria-hidden="true" />
            </span>
            <h2 className="text-base font-semibold tracking-tight">Repayment summary</h2>
          </div>

          <div className="mt-5 rounded-md bg-secondary/60 p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Monthly repayment
            </p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight text-foreground">
              K{monthlyRepayment.toFixed(2)}
            </p>
          </div>

          <dl className="mt-5 space-y-0.5">
            <SummaryRow label="Loan amount" value={`K${loanData.amount.toLocaleString()}`} />
            <SummaryRow label="Tenure" value={`${loanData.tenure} months`} />
            <SummaryRow label="Interest (5% flat)" value={`K${(loanData.amount * interestRate).toFixed(2)}`} />
            <SummaryRow label="Facility fee" value={`K${facilityFee.toFixed(2)}`} />
          </dl>

          <div className="mt-5 flex items-center justify-between gap-4 rounded-md bg-primary px-4 py-3.5 text-primary-foreground">
            <span className="text-sm font-semibold">Total repayable</span>
            <span className="text-lg font-bold tabular-nums">K{totalRepayable.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  )

  const overviewIntro = (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <p className="text-sm text-muted-foreground">
        Please review your details below before submitting. Use Edit to change a section, or Preview to check an
        attachment.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
        <Printer />
        Print / Save as PDF
      </Button>
    </div>
  )

  const generatedOn = dayjs().format('D MMMM YYYY')

  const renderPersonalOverview = () => (
    <div className="grid gap-6">
      {overviewIntro}
      <ApplicationSummary loanTypeLabel="Personal Loan" generatedOn={generatedOn}>
        <div className="grid gap-5 pt-5">
          <SummaryHighlights items={summaryHighlights} />
          {renderSummarySection('Personal information', [
          renderSummaryRow('Full name', [personalData.personalInfo.firstName, personalData.personalInfo.middleName, personalData.personalInfo.surname].filter(Boolean).join(' ')),
          renderSummaryRow('Phone', personalData.personalInfo.phone),
          renderSummaryRow('Email', personalData.personalInfo.email),
          renderSummaryRow('NRC', personalData.personalInfo.nrc),
          renderSummaryRow('Gender', personalData.personalInfo.gender),
          renderSummaryRow('Marital status', personalData.personalInfo.maritalStatus),
          renderSummaryRow('Birth date', personalData.personalInfo.birthDate),
        ], 0)}
          {renderSummarySection('Residence & Employment', [
          renderSummaryRow('Residential address', personalData.employmentInfo.residentialAddress),
          renderSummaryRow('Occupation', personalData.employmentInfo.occupation),
          renderSummaryRow('Employer name', personalData.employmentInfo.employerName),
          renderSummaryRow('Nationality', personalData.employmentInfo.nationality),
          renderSummaryRow('Principal objective of loan', personalData.employmentInfo.principalObjectiveOfLoan),
          renderSummaryRow('Next of kin', personalData.employmentInfo.nextOfKinName),
          renderSummaryRow('Next of kin phone', personalData.employmentInfo.nextOfKinPhone),
          renderSummaryRow('Next of kin email', personalData.employmentInfo.nextOfKinEmail),
          renderSummaryRow('Relationship', personalData.employmentInfo.nextOfKinRelationship),
        ], 1)}

          <SummarySection title="Documents" stepIndex={2} onEdit={goToStep} plain>
            <AttachmentList attachments={personalAttachments} onPreview={setPreviewAttachment} />
          </SummarySection>

          {renderSummarySection('Loan terms', loanTermRows, 3)}
        </div>
      </ApplicationSummary>
    </div>
  )

  const renderBusinessOverview = () => (
    <div className="grid gap-6">
      {overviewIntro}
      <ApplicationSummary loanTypeLabel="Business Loan" generatedOn={generatedOn}>
        <div className="grid gap-5 pt-5">
          <SummaryHighlights items={summaryHighlights} />
          {renderSummarySection('Business information', [
            renderSummaryRow('Company name', businessData.businessInfo.companyName),
            renderSummaryRow('Type of business', businessData.businessInfo.businessType),
            renderSummaryRow('Established date', businessData.businessInfo.establishedDate),
            renderSummaryRow('Nature of business', businessData.businessInfo.natureOfBusiness),
            renderSummaryRow('Registered office', businessData.businessInfo.registeredOffice),
            renderSummaryRow('Collateral pledged', businessData.businessInfo.collateralPledged),
            renderSummaryRow('Purpose of loan', businessData.businessInfo.purposeOfLoan),
          ], 0)}
          {renderSummarySection('Applicant', [
            renderSummaryRow('Full name', [businessData.directorInfo.applicantFirstName, businessData.directorInfo.applicantMiddleName, businessData.directorInfo.applicantLastName].filter(Boolean).join(' ')),
            renderSummaryRow('Phone', businessData.directorInfo.applicantPhone),
            renderSummaryRow('Email', businessData.directorInfo.applicantEmail),
            renderSummaryRow('NRC', businessData.directorInfo.applicantNrc),
            renderSummaryRow('Gender', businessData.directorInfo.applicantGender),
            renderSummaryRow('Marital status', businessData.directorInfo.applicantMaritalStatus),
            renderSummaryRow('Birth date', businessData.directorInfo.applicantBirthDate),
            renderSummaryRow('Address', businessData.directorInfo.applicantAddress),
            renderSummaryRow('Position', businessData.directorInfo.applicantPosition),
            renderSummaryRow('Nationality', businessData.directorInfo.applicantNationality),
          ], 1)}
          {renderSummarySection(
            'Directors',
            businessData.directorInfo.directors.flatMap((director, index) => [
              renderSummaryRow(`Director ${index + 1} name`, director.name),
              renderSummaryRow(`Director ${index + 1} phone`, director.phone),
              renderSummaryRow(`Director ${index + 1} email`, director.email),
              renderSummaryRow(`Director ${index + 1} NRC`, director.nrc),
            ]),
            1
          )}

          <SummarySection title="Documents" stepIndex={2} onEdit={goToStep} plain>
            <AttachmentList attachments={businessAttachments} onPreview={setPreviewAttachment} />
          </SummarySection>

          {renderSummarySection('Loan terms', loanTermRows, 3)}
        </div>
      </ApplicationSummary>
    </div>
  )

  const renderStepContent = () => {
    if (selectedLoanType === 'personal') {
      switch (currentStep) {
        case 0:
          return (
            <div className="grid gap-6">
              <FieldGroup title="Your name" description="Enter your names exactly as they appear on your NRC." icon={User} columns={3}>
                {renderField('First name', personalData.personalInfo.firstName, (value) => updateSectionField('personalInfo', 'firstName', value, 'alpha'), 'text', '', {}, true, 'personalInfo.firstName')}
                {renderField('Middle name (Optional)', personalData.personalInfo.middleName, (value) => updateSectionField('personalInfo', 'middleName', value, 'alpha'), 'text', '', {}, false)}
                {renderField('Surname', personalData.personalInfo.surname, (value) => updateSectionField('personalInfo', 'surname', value, 'alpha'), 'text', '', {}, true, 'personalInfo.surname')}
              </FieldGroup>

              <FieldGroup title="Contact details" description="We use these to reach you about your application." icon={Phone} columns={2}>
                {renderField('Phone', personalData.personalInfo.phone, (value) => updateSectionField('personalInfo', 'phone', value, 'phone'), 'tel', '0977123456', { maxLength: 10, autoComplete: 'tel' }, true, 'personalInfo.phone')}
                {renderField('Email', personalData.personalInfo.email, (value) => updateSectionField('personalInfo', 'email', value, 'email'), 'email', 'you@example.com', { autoComplete: 'email' }, true, 'personalInfo.email')}
              </FieldGroup>

              <FieldGroup title="Identity" icon={Fingerprint} columns={2}>
                {renderField('NRC', personalData.personalInfo.nrc, (value) => updateSectionField('personalInfo', 'nrc', value, 'nrc'), 'text', '123456/78/9', { maxLength: 12 }, true, 'personalInfo.nrc')}
                {renderBirthDateField('Birth date', personalData.personalInfo.birthDate, (value) => updateSectionField('personalInfo', 'birthDate', value), true, 'personalInfo.birthDate')}
                {renderSelectField('Gender', personalData.personalInfo.gender, (value) => updateSectionField('personalInfo', 'gender', value, 'alpha'), GENDER_OPTIONS, 'Select gender', true, 'personalInfo.gender')}
                {renderSelectField('Marital status', personalData.personalInfo.maritalStatus, (value) => updateSectionField('personalInfo', 'maritalStatus', value, 'alpha'), MARITAL_STATUS_OPTIONS, 'Select marital status', true, 'personalInfo.maritalStatus')}
              </FieldGroup>
            </div>
          )
        case 1:
          return (
            <div className="grid gap-6">
              <FieldGroup title="Residence & employment" description="Where you live and what you do." icon={Briefcase} columns={3}>
                {renderField('Residential address', personalData.employmentInfo.residentialAddress, (value) => updateSectionField('employmentInfo', 'residentialAddress', value), 'text', '', {}, true, 'employmentInfo.residentialAddress')}
                {renderField('Occupation', personalData.employmentInfo.occupation, (value) => updateSectionField('employmentInfo', 'occupation', value), 'text', '', {}, true, 'employmentInfo.occupation')}
                {renderField('Employer name', personalData.employmentInfo.employerName, (value) => updateSectionField('employmentInfo', 'employerName', value), 'text', '', {}, true, 'employmentInfo.employerName')}
                {renderSelectField('Nationality', personalData.employmentInfo.nationality, (value) => updateSectionField('employmentInfo', 'nationality', value), NATIONALITY_OPTIONS, 'Select nationality', true, 'employmentInfo.nationality')}
                {renderField('Principal objective of loan', personalData.employmentInfo.principalObjectiveOfLoan, (value) => updateSectionField('employmentInfo', 'principalObjectiveOfLoan', value), 'text', '', {}, true, 'employmentInfo.principalObjectiveOfLoan')}
              </FieldGroup>

              <FieldGroup title="Next of kin" description="Someone we can contact if we cannot reach you." icon={Users} columns={2}>
                {renderField('Next of kin name', personalData.employmentInfo.nextOfKinName, (value) => updateSectionField('employmentInfo', 'nextOfKinName', value, 'alpha'), 'text', '', {}, true, 'employmentInfo.nextOfKinName')}
                {renderField('Next of kin phone', personalData.employmentInfo.nextOfKinPhone, (value) => updateSectionField('employmentInfo', 'nextOfKinPhone', value, 'phone'), 'tel', '0977123456', { maxLength: 10 }, true, 'employmentInfo.nextOfKinPhone')}
                {renderField('Next of kin email', personalData.employmentInfo.nextOfKinEmail, (value) => updateSectionField('employmentInfo', 'nextOfKinEmail', value, 'email'), 'email', 'name@example.com', {}, true, 'employmentInfo.nextOfKinEmail')}
                {renderSelectField('Relationship', personalData.employmentInfo.nextOfKinRelationship, (value) => updateSectionField('employmentInfo', 'nextOfKinRelationship', value), RELATIONSHIP_OPTIONS, 'Select relationship', true, 'employmentInfo.nextOfKinRelationship')}
              </FieldGroup>
            </div>
          )
        case 2:
          return (
            <FieldGroup title="Supporting documents" description="Attach each document below. They are sent when you submit the application." icon={FolderOpen} columns={2}>
              {renderUploadField('Latest three payslips', 'payslips', personalData.documents.payslips, true, '.pdf', 'documents.payslips')}
              {renderUploadField('Bank statements (3 months)', 'bankStatements', personalData.documents.bankStatements, true, '.pdf', 'documents.bankStatements')}
              {renderUploadField('NRC copy', 'nrcCopy', personalData.documents.nrcCopy, true, '.pdf', 'documents.nrcCopy')}
              {renderUploadField('TPIN certificate', 'tpin', personalData.documents.tpin, true, '.pdf', 'documents.tpin')}
              {renderUploadField('Passport-sized photo', 'passportPhoto', personalData.documents.passportPhoto, true, 'application/pdf,image/*', 'documents.passportPhoto', true)}
            </FieldGroup>
          )
        case 3:
          return renderLoanTerms()
        case 4:
          return renderPersonalOverview()
        default:
          return null
      }
    }

    switch (currentStep) {
      case 0:
        return (
          <div className="grid gap-6">
            <FieldGroup title="Company details" description="As registered with PACRA." icon={Building2} columns={2}>
              {renderField('Company name', businessData.businessInfo.companyName, (value) => updateSectionField('businessInfo', 'companyName', value), 'text', '', {}, true, 'businessInfo.companyName')}
              {renderSelectField('Type of business', businessData.businessInfo.businessType, (value) => updateSectionField('businessInfo', 'businessType', value), BUSINESS_TYPE_OPTIONS, 'Select business type', true, 'businessInfo.businessType')}
              {renderDateField('Established date', businessData.businessInfo.establishedDate, (value) => updateSectionField('businessInfo', 'establishedDate', value), true, 'businessInfo.establishedDate')}
              {renderField('Nature of business', businessData.businessInfo.natureOfBusiness, (value) => updateSectionField('businessInfo', 'natureOfBusiness', value), 'text', '', {}, true, 'businessInfo.natureOfBusiness')}
            </FieldGroup>

            <FieldGroup title="Office & loan purpose" icon={Home} columns={3}>
              {renderField('Registered office', businessData.businessInfo.registeredOffice, (value) => updateSectionField('businessInfo', 'registeredOffice', value), 'text', '', {}, true, 'businessInfo.registeredOffice')}
              {renderField('Collateral pledged', businessData.businessInfo.collateralPledged, (value) => updateSectionField('businessInfo', 'collateralPledged', value), 'text', '', {}, true, 'businessInfo.collateralPledged')}
              {renderField('Purpose of loan', businessData.businessInfo.purposeOfLoan, (value) => updateSectionField('businessInfo', 'purposeOfLoan', value), 'text', '', {}, true, 'businessInfo.purposeOfLoan')}
            </FieldGroup>
          </div>
        )
      case 1:
        return (
          <div className="grid gap-6">
            <fieldset className="rounded-lg border bg-card p-5 shadow-soft sm:p-6">
              <legend className="sr-only">Directors</legend>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Users className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">Directors</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add up to 3 directors. Each director requires a name, phone, email, and NRC.
                    </p>
                  </div>
                </div>
                {businessData.directorInfo.directors.length < 3 && (
                  <Button type="button" variant="outline" size="sm" onClick={addDirector}>
                    <Plus />
                    Add director
                  </Button>
                )}
              </div>

              <div className="mt-5 space-y-4">
                {businessData.directorInfo.directors.map((director, index) => (
                  <div key={index} className="rounded-md border border-border bg-secondary/40 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <Badge variant="secondary">Director {index + 1}</Badge>
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDirector(index)}
                          className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 />
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                      {renderField(`Director ${index + 1} name`, director.name, (value) => updateDirectorField(index, 'name', value, 'alpha'), 'text', '', {}, true, `directorInfo.directors[${index}].name`)}
                      {renderField(`Director ${index + 1} phone`, director.phone, (value) => updateDirectorField(index, 'phone', value, 'phone'), 'tel', '0977123456', { maxLength: 10 }, true, `directorInfo.directors[${index}].phone`)}
                      {renderField(`Director ${index + 1} email`, director.email, (value) => updateDirectorField(index, 'email', value, 'email'), 'email', 'name@example.com', {}, true, `directorInfo.directors[${index}].email`)}
                      {renderField(`Director ${index + 1} NRC`, director.nrc, (value) => updateDirectorField(index, 'nrc', value, 'nrc'), 'text', '123456/78/9', { maxLength: 12 }, true, `directorInfo.directors[${index}].nrc`)}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>

            <FieldGroup title="Applicant name" description="The person completing this application on behalf of the company." icon={User} columns={3}>
              {renderField('Applicant first name', businessData.directorInfo.applicantFirstName, (value) => updateSectionField('directorInfo', 'applicantFirstName', value, 'alpha'), 'text', '', {}, true, 'directorInfo.applicantFirstName')}
              {renderField('Applicant middle name (Optional)', businessData.directorInfo.applicantMiddleName, (value) => updateSectionField('directorInfo', 'applicantMiddleName', value, 'alpha'), 'text', '', {}, false)}
              {renderField('Applicant last name', businessData.directorInfo.applicantLastName, (value) => updateSectionField('directorInfo', 'applicantLastName', value, 'alpha'), 'text', '', {}, true, 'directorInfo.applicantLastName')}
            </FieldGroup>

            <FieldGroup title="Applicant contact & identity" icon={Fingerprint} columns={3}>
              {renderField('Applicant phone', businessData.directorInfo.applicantPhone, (value) => updateSectionField('directorInfo', 'applicantPhone', value, 'phone'), 'tel', '0977123456', { maxLength: 10 }, true, 'directorInfo.applicantPhone')}
              {renderField('Applicant email', businessData.directorInfo.applicantEmail, (value) => updateSectionField('directorInfo', 'applicantEmail', value, 'email'), 'email', 'you@example.com', {}, true, 'directorInfo.applicantEmail')}
              {renderField('Applicant NRC', businessData.directorInfo.applicantNrc, (value) => updateSectionField('directorInfo', 'applicantNrc', value, 'nrc'), 'text', '123456/78/9', { maxLength: 12 }, true, 'directorInfo.applicantNrc')}
              {renderBirthDateField('Birth date', businessData.directorInfo.applicantBirthDate, (value) => updateSectionField('directorInfo', 'applicantBirthDate', value), true, 'directorInfo.applicantBirthDate')}
              {renderSelectField('Applicant gender', businessData.directorInfo.applicantGender, (value) => updateSectionField('directorInfo', 'applicantGender', value, 'alpha'), GENDER_OPTIONS, 'Select gender', true, 'directorInfo.applicantGender')}
              {renderSelectField('Marital status', businessData.directorInfo.applicantMaritalStatus, (value) => updateSectionField('directorInfo', 'applicantMaritalStatus', value, 'alpha'), MARITAL_STATUS_OPTIONS, 'Select marital status', true, 'directorInfo.applicantMaritalStatus')}
            </FieldGroup>

            <FieldGroup title="Applicant address & role" icon={Home} columns={2}>
              {renderField('Applicant address', businessData.directorInfo.applicantAddress, (value) => updateSectionField('directorInfo', 'applicantAddress', value), 'text', '', {}, true, 'directorInfo.applicantAddress')}
              {renderField('Applicant position', businessData.directorInfo.applicantPosition, (value) => updateSectionField('directorInfo', 'applicantPosition', value), 'text', '', {}, true, 'directorInfo.applicantPosition')}
              {renderSelectField('Applicant nationality', businessData.directorInfo.applicantNationality, (value) => updateSectionField('directorInfo', 'applicantNationality', value), NATIONALITY_OPTIONS, 'Select nationality', true, 'directorInfo.applicantNationality')}
            </FieldGroup>
          </div>
        )
      case 2:
        return (
          <div className="grid gap-6">
            <FieldGroup title="Company documents" description="Attach each document below. They are sent when you submit the application." icon={FolderOpen} columns={2}>
              {renderUploadField('PACRA certificate', 'pacraCertificate', businessData.documents.pacraCertificate, true, '.pdf', 'documents.pacraCertificate')}
              {renderUploadField('Form 2', 'form2', businessData.documents.form2, true, '.pdf', 'documents.form2')}
              {renderUploadField('Tax clearance certificate / TPIN', 'taxClearance', businessData.documents.taxClearance, true, '.pdf', 'documents.taxClearance')}
              {renderUploadField('Latest tax compliance return', 'latestTaxComplianceReturn', businessData.documents.latestTaxComplianceReturn, true, '.pdf', 'documents.latestTaxComplianceReturn')}
              {renderUploadField('Order / Invoice (if applying for order financing or invoice discounting)', 'orderOrInvoice', businessData.documents.orderOrInvoice, false, '.pdf', 'documents.orderOrInvoice')}
              {renderUploadField('Bank statements (6 months)', 'bankStatements', businessData.documents.bankStatements, true, '.pdf', 'documents.bankStatements')}
              {renderUploadField('Board resolution', 'boardResolution', businessData.documents.boardResolution, true, '.pdf', 'documents.boardResolution')}
              {renderUploadField('Applicant Passport-sized photo', 'passportPhoto', businessData.documents.passportPhoto, true, 'application/pdf,image/*', 'documents.passportPhoto', true)}
            </FieldGroup>

            <fieldset className="rounded-lg border bg-card p-5 shadow-soft sm:p-6">
              <legend className="sr-only">Director documents</legend>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Users className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">Director documents</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add up to 3 director NRC and passport photo uploads.
                    </p>
                  </div>
                </div>
                {(businessData.documents.directorUploads || []).length < 3 && (
                  <Button type="button" variant="outline" size="sm" onClick={addDirectorUpload}>
                    <Plus />
                    Add director upload
                  </Button>
                )}
              </div>

              <div className="mt-5 space-y-4">
                {(businessData.documents.directorUploads || []).map((upload, index) => (
                  <div key={index} className="rounded-md border border-border bg-secondary/40 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <Badge variant="secondary">Director {index + 1}</Badge>
                      {index > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDirectorUpload(index)}
                          className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 />
                          Remove
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-5 md:grid-cols-2">
                      <FileUploadField
                        name={`documents.directorUploads[${index}].nrc`}
                        label={`Director ${index + 1} NRC`}
                        file={upload.nrc}
                        accept="image/*,.pdf,.doc,.docx"
                        required
                        error={validationErrors[`documents.directorUploads[${index}].nrc`]}
                        status={getUploadStatus(`director.${index}.nrc`)}
                        onChange={(event) => handleDirectorDocumentInputChange(index, 'nrc', event)}
                      />
                      <FileUploadField
                        name={`documents.directorUploads[${index}].passportPhoto`}
                        label={`Director ${index + 1} passport photo`}
                        file={upload.passportPhoto}
                        accept="application/pdf,image/*"
                        required
                        error={validationErrors[`documents.directorUploads[${index}].passportPhoto`]}
                        status={getUploadStatus(`director.${index}.passportPhoto`)}
                        onChange={(event) => handleDirectorDocumentInputChange(index, 'passportPhoto', event)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          </div>
        )
      case 3:
        return renderLoanTerms()
      case 4:
        return renderBusinessOverview()
      default:
        return null
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
              Your progress is saved on this device, but we couldn’t sync it to your account ({remoteSyncError}) — until
              it syncs, this application won’t be available if you resume on another device.
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

              {renderStepContent()}

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
                <Button type="submit" disabled={submitting}>
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
          <FaceCaptureCamera onCapture={handleCameraCapture} onCancel={() => setShowCameraCapture(false)} />
        </DialogContent>
      </Dialog>

      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} onAccept={onAcceptTerms} />
      <SuccessModal
        open={showSuccess}
        onClose={() => {
          setShowSuccess(false)
          resetForm()
          navigate('/')
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
