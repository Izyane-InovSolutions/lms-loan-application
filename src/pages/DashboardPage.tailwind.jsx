import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/Header'
import TermsModal from '../components/TermsModal'
import SuccessModal from '../components/SuccessModal'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import TextField from '@mui/material/TextField'
import dayjs from 'dayjs'

const personalStepTitles = [
  'Personal information',
  'Residence & Employment',
  'Documents',
  'Loan Terms',
  'Overview',
]

const businessStepTitles = [
  'Business information',
  'Directors & Applicant',
  'Documents',
  'Loan Terms',
  'Overview',
]

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
  const [selectedLoanType] = useState(
    location.state?.type === 'business' ? 'business' : 'personal'
  )
  const [currentStep, setCurrentStep] = useState(0)
  const [personalData, setPersonalData] = useState(personalInitial)
  const [businessData, setBusinessData] = useState(businessInitial)
  const [loanData, setLoanData] = useState(initialLoanState)
  const [showTerms, setShowTerms] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState({})

  const stepTitles = selectedLoanType === 'personal' ? personalStepTitles : businessStepTitles
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

  const PDF_MAX_FILE_SIZE = 5 * 1024 * 1024
  const PHOTO_MAX_FILE_SIZE = 3 * 1024 * 1024
  const isPdfFile = (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const isImageFile = (file) => file.type.startsWith('image/') || /\.(jpe?g|png)$/i.test(file.name)

  const validatePdfFile = (file) => {
    if (!file) return ''
    if (!isPdfFile(file)) return 'Not a valid format. PDF only.'
    if (file.size > PDF_MAX_FILE_SIZE) return 'File must be 5 MB or smaller.'
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
  const [stepLoading, setStepLoading] = useState(false)

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
      validationMessage = isPassportPhotoField(field)
        ? validatePassportFile(file)
        : validatePdfFile(file)
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

  const handleNext = () => {
    if (!validateCurrentStep()) {
      return
    }

    if (currentStep < stepTitles.length - 1) {
      setStepLoading(true)
      setTimeout(() => {
      setCurrentStep((prev) => prev + 1)
      setStepLoading(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      }, 300)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setStepLoading(true)
      setTimeout(() => {
        setCurrentStep((prev) => prev - 1)
        setStepLoading(false)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }, 300)
    } else {
      navigate('/')
    }
  }

  const handleSubmitApplication = () => {
    setShowTerms(true)
  }

  const onAcceptTerms = () => {
    setShowTerms(false)
    setSubmitting(true)
    setTimeout(() => {
      setShowSuccess(true)
      setSubmitting(false)
    }, 900)
  }

  const renderField = (label, value, onChange, type = 'text', placeholder = '', inputProps = {}, required = false, errorKey = '') => (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        {...inputProps}
      />
      {errorKey && validationErrors[errorKey] ? (
        <span className="text-sm text-red-600">{validationErrors[errorKey]}</span>
      ) : null}
    </label>
  )

  const renderDateField = (label, value, onChange, required = false, errorKey = '') => (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker
          value={value ? dayjs(value) : null}
          onChange={(selected) => onChange(selected ? selected.format('YYYY-MM-DD') : '')}
          slotProps={{
            textField: {
              fullWidth: true,
              size: 'small',
              className: 'rounded-lg bg-slate-50',
              sx: {
                '& .MuiOutlinedInput-root': {
                  borderRadius: '0.5rem',
                  backgroundColor: '#f8fafc',
                  borderColor: '#cbd5e1',
                },
              },
            },
          }}
        />
      </LocalizationProvider>
      {errorKey && validationErrors[errorKey] ? (
        <span className="text-sm text-red-600">{validationErrors[errorKey]}</span>
      ) : null}
    </label>
  )

  const renderBirthDateField = (label, value, onChange, required = false, errorKey = '') => (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker
          value={value ? dayjs(value) : null}
          onChange={(selected) => onChange(selected ? selected.format('YYYY-MM-DD') : '')}
          minDate={dayjs().subtract(65, 'year')}
          maxDate={dayjs().subtract(18, 'year')}
          slotProps={{
            textField: {
              fullWidth: true,
              size: 'small',
              className: 'rounded-lg bg-slate-50',
              sx: {
                '& .MuiOutlinedInput-root': {
                  borderRadius: '0.5rem',
                  backgroundColor: '#f8fafc',
                  borderColor: '#cbd5e1',
                },
              },
            },
          }}
        />
      </LocalizationProvider>
      {errorKey && validationErrors[errorKey] ? (
        <span className="text-sm text-red-600">{validationErrors[errorKey]}</span>
      ) : null}
    </label>
  )

   const renderUploadField = (label, field, file, required = false, acceptTypes = '.pdf', errorKey = '') => {
    const status = uploadStatuses[field] || 'idle'

    return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type="file"
        onChange={(event) => handleDocumentInputChange(field, event)}
        className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        accept={acceptTypes}
      />
      <span className="text-xs text-slate-500">
        {file ? file.name : 'Upload document or choose file'}
      </span>
      {status === 'loading' && (
          <span className="text-sm text-slate-500 flex items-center gap-2">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"></span>
            Uploading...
          </span>
        )}
        {status === 'success' && (
          <span className="text-sm text-emerald-700">Upload successful</span>
        )}
        {errorKey && validationErrors[errorKey] ? (
          <span className="text-sm text-red-600">{validationErrors[errorKey]}</span>
        ) : null}
    </label>
  )
}

  const renderSummaryRow = (label, value) => (
    <div key={label} className="flex items-start justify-between gap-4 border-b border-slate-200 py-2 text-sm last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value || '—'}</span>
      
    </div>
  )

  const renderSummaryCard = (title, rows) => (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <div className="mt-3">{rows}</div>
    </div>
  )

  const fileName = (file) => (file ? file.name : 'Not uploaded')

  const renderPersonalOverview = () => (
    <div className="grid gap-6">
      <p className="text-sm text-slate-600">
        Please review your details below before submitting your application. Use "Previous step" to make changes.
      </p>
      <div className="grid gap-6 xl:grid-cols-2">
        {renderSummaryCard('Personal information', [
          renderSummaryRow('Full name', [personalData.personalInfo.firstName, personalData.personalInfo.middleName, personalData.personalInfo.surname].filter(Boolean).join(' ')),
          renderSummaryRow('Phone', personalData.personalInfo.phone),
          renderSummaryRow('Email', personalData.personalInfo.email),
          renderSummaryRow('NRC', personalData.personalInfo.nrc),
          renderSummaryRow('Gender', personalData.personalInfo.gender),
          renderSummaryRow('Marital status', personalData.personalInfo.maritalStatus),
          renderSummaryRow('Birth date', personalData.personalInfo.birthDate),
        ])}
        {renderSummaryCard('Residence & Employment', [
          renderSummaryRow('Residential address', personalData.employmentInfo.residentialAddress),
          renderSummaryRow('Occupation', personalData.employmentInfo.occupation),
          renderSummaryRow('Employer name', personalData.employmentInfo.employerName),
          renderSummaryRow('Nationality', personalData.employmentInfo.nationality),
          renderSummaryRow('Principal objective of loan', personalData.employmentInfo.principalObjectiveOfLoan),
          renderSummaryRow('Next of kin', personalData.employmentInfo.nextOfKinName),
          renderSummaryRow('Next of kin phone', personalData.employmentInfo.nextOfKinPhone),
          renderSummaryRow('Next of kin email', personalData.employmentInfo.nextOfKinEmail),
          renderSummaryRow('Relationship', personalData.employmentInfo.nextOfKinRelationship),
        ])}
        {renderSummaryCard('Documents', [
          renderSummaryRow('Latest three payslips', fileName(personalData.documents.payslips)),
          renderSummaryRow('Bank statements', fileName(personalData.documents.bankStatements)),
          renderSummaryRow('NRC copy', fileName(personalData.documents.nrcCopy)),
          renderSummaryRow('Passport photo', fileName(personalData.documents.passportPhoto)),
          renderSummaryRow('TPIN certificate', fileName(personalData.documents.tpin)),
        ])}
        {renderSummaryCard('Loan terms', [
          renderSummaryRow('Loan amount', `K${loanData.amount.toLocaleString()}`),
          renderSummaryRow('Tenure', `${loanData.tenure} months`),
          renderSummaryRow('Monthly repayment', `K${monthlyRepayment.toFixed(2)}`),
          renderSummaryRow('Facility fee', `K${facilityFee.toFixed(2)}`),
          renderSummaryRow('Total repayable', `K${totalRepayable.toFixed(2)}`),
        ])}
      </div>
    </div>
  )

  const renderBusinessOverview = () => {
    const directorUploads = businessData.documents.directorUploads || []
    return (
      <div className="grid gap-6">
        <p className="text-sm text-slate-600">
          Please review your details below before submitting your application. Use "Previous step" to make changes.
        </p>
        <div className="grid gap-6 xl:grid-cols-2">
          {renderSummaryCard('Business information', [
            renderSummaryRow('Company name', businessData.businessInfo.companyName),
            renderSummaryRow('Type of business', businessData.businessInfo.businessType),
            renderSummaryRow('Established date', businessData.businessInfo.establishedDate),
            renderSummaryRow('Nature of business', businessData.businessInfo.natureOfBusiness),
            renderSummaryRow('Registered office', businessData.businessInfo.registeredOffice),
            renderSummaryRow('Collateral pledged', businessData.businessInfo.collateralPledged),
            renderSummaryRow('Purpose of loan', businessData.businessInfo.purposeOfLoan),
          ])}
          {renderSummaryCard('Applicant', [
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
          ])}
          {renderSummaryCard(
            'Directors',
            businessData.directorInfo.directors.flatMap((director, index) => [
              renderSummaryRow(`Director ${index + 1} name`, director.name),
              renderSummaryRow(`Director ${index + 1} phone`, director.phone),
              renderSummaryRow(`Director ${index + 1} email`, director.email),
              renderSummaryRow(`Director ${index + 1} NRC`, director.nrc),
            ])
          )}
          {renderSummaryCard('Documents', [
            renderSummaryRow('PACRA certificate', fileName(businessData.documents.pacraCertificate)),
            renderSummaryRow('Form 2', fileName(businessData.documents.form2)),
            renderSummaryRow('Tax clearance certificate / TPIN', fileName(businessData.documents.taxClearance)),
            renderSummaryRow('Latest tax compliance return', fileName(businessData.documents.latestTaxComplianceReturn)),
            renderSummaryRow('Order / Invoice', fileName(businessData.documents.orderOrInvoice)),
            renderSummaryRow('Bank statements', fileName(businessData.documents.bankStatements)),
            renderSummaryRow('Passport photo', fileName(businessData.documents.passportPhoto)),
            renderSummaryRow('Board resolution', fileName(businessData.documents.boardResolution)),
            ...directorUploads.flatMap((upload, index) => [
              renderSummaryRow(`Director ${index + 1} NRC upload`, fileName(upload.nrc)),
              renderSummaryRow(`Director ${index + 1} passport photo`, fileName(upload.passportPhoto)),
            ]),
          ])}
          {renderSummaryCard('Loan terms', [
            renderSummaryRow('Loan amount', `K${loanData.amount.toLocaleString()}`),
            renderSummaryRow('Tenure', `${loanData.tenure} months`),
            renderSummaryRow('Monthly repayment', `K${monthlyRepayment.toFixed(2)}`),
            renderSummaryRow('Facility fee', `K${facilityFee.toFixed(2)}`),
            renderSummaryRow('Total repayable', `K${totalRepayable.toFixed(2)}`),
          ])}
        </div>
      </div>
    )
  }

  const renderStepContent = () => {
    if (selectedLoanType === 'personal') {
      switch (currentStep) {
        case 0:
          return (
            <div className="grid gap-6 xl:grid-cols-3">
              {renderField('First name', personalData.personalInfo.firstName, (value) => updateSectionField('personalInfo', 'firstName', value, 'alpha'), 'text', '', {}, true, 'personalInfo.firstName')}
              {renderField('Middle name (Optional)', personalData.personalInfo.middleName, (value) => updateSectionField('personalInfo', 'middleName', value, 'alpha'), 'text', '', {}, false)}
              {renderField('Surname', personalData.personalInfo.surname, (value) => updateSectionField('personalInfo', 'surname', value, 'alpha'), 'text', '', {}, true, 'personalInfo.surname')}
              {renderField('Phone', personalData.personalInfo.phone, (value) => updateSectionField('personalInfo', 'phone', value, 'phone'), 'tel', '', { maxLength: 10 }, true, 'personalInfo.phone')}
              {renderField('Email', personalData.personalInfo.email, (value) => updateSectionField('personalInfo', 'email', value, 'email'), 'email', '', {}, true, 'personalInfo.email')}
              {renderField('NRC', personalData.personalInfo.nrc, (value) => updateSectionField('personalInfo', 'nrc', value, 'nrc'), 'text', '', { maxLength: 12 }, true, 'personalInfo.nrc')}
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-700">
                  Gender
                  <span className="text-red-500"> *</span>
                </span>
                <select
                  value={personalData.personalInfo.gender}
                  onChange={(event) => updateSectionField('personalInfo', 'gender', event.target.value, 'alpha')}
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                {validationErrors['personalInfo.gender'] ? (
                  <span className="text-sm text-red-600">{validationErrors['personalInfo.gender']}</span>
                ) : null}
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-700">
                  Marital status
                  <span className="text-red-500"> *</span>
                </span>
                <select
                  value={personalData.personalInfo.maritalStatus}
                  onChange={(event) => updateSectionField('personalInfo', 'maritalStatus', event.target.value, 'alpha')}
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Select marital status</option>
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Widowed">Widowed</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Separated">Separated</option>
                </select>
                {validationErrors['personalInfo.maritalStatus'] ? (
                  <span className="text-sm text-red-600">{validationErrors['personalInfo.maritalStatus']}</span>
                ) : null}
              </label>
              {renderBirthDateField('Birth date', personalData.personalInfo.birthDate, (value) => updateSectionField('personalInfo', 'birthDate', value), true, 'personalInfo.birthDate')}
            </div>
          )
        case 1:
          return (
            <div className="grid gap-6 xl:grid-cols-3">
              {renderField('Residential address', personalData.employmentInfo.residentialAddress, (value) => updateSectionField('employmentInfo', 'residentialAddress', value), 'text', '', {}, true, 'employmentInfo.residentialAddress')}
              {renderField('Occupation', personalData.employmentInfo.occupation, (value) => updateSectionField('employmentInfo', 'occupation', value), 'text', '', {}, true, 'employmentInfo.occupation')}
              {renderField('Employer name', personalData.employmentInfo.employerName, (value) => updateSectionField('employmentInfo', 'employerName', value), 'text', '', {}, true, 'employmentInfo.employerName')}
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-700">
                  Nationality
                  <span className="text-red-500"> *</span>
                </span>
                <select
                  value={personalData.employmentInfo.nationality}
                  onChange={(event) => updateSectionField('employmentInfo', 'nationality', event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Select nationality</option>
                  <option value="Kenya">Kenya</option>
                  <option value="Malawi">Malawi</option>
                  <option value="Rwanda">Rwanda</option>
                  <option value="Uganda">Uganda</option>
                  <option value="Zambia">Zambia</option>
                  <option value="Zimbabwe">Zimbabwe</option>
                </select>
                {validationErrors['employmentInfo.nationality'] ? (
                  <span className="text-sm text-red-600">{validationErrors['employmentInfo.nationality']}</span>
                ) : null}
              </label>
              {renderField('Principal objective of loan', personalData.employmentInfo.principalObjectiveOfLoan, (value) => updateSectionField('employmentInfo', 'principalObjectiveOfLoan', value), 'text', '', {}, true, 'employmentInfo.principalObjectiveOfLoan')}
              {renderField('Next of kin name', personalData.employmentInfo.nextOfKinName, (value) => updateSectionField('employmentInfo', 'nextOfKinName', value, 'alpha'), 'text', '', {}, true, 'employmentInfo.nextOfKinName')}
              {renderField('Next of kin phone', personalData.employmentInfo.nextOfKinPhone, (value) => updateSectionField('employmentInfo', 'nextOfKinPhone', value, 'phone'), 'tel', '', { maxLength: 10 }, true, 'employmentInfo.nextOfKinPhone')}
              {renderField('Next of kin email', personalData.employmentInfo.nextOfKinEmail, (value) => updateSectionField('employmentInfo', 'nextOfKinEmail', value, 'email'), 'email', '', {}, true, 'employmentInfo.nextOfKinEmail')}
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-700">
                  Relationship
                  <span className="text-red-500"> *</span>
                </span>
                <select
                  value={personalData.employmentInfo.nextOfKinRelationship}
                  onChange={(event) => updateSectionField('employmentInfo', 'nextOfKinRelationship', event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                >
                  <option value="">Select relationship</option>
                  <option value="Parent">Parent</option>
                  <option value="Sibling">Sibling</option>
                  <option value="Spouse">Spouse</option>
                  <option value="Child">Child</option>
                  <option value="Grandparent">Grandparent</option>
                  <option value="Grandchild">Grandchild</option>
                  <option value="Uncle/Aunt">Uncle/Aunt</option>
                  <option value="Nephew/Niece">Nephew/Niece</option>
                  <option value="Cousin">Cousin</option>
                  <option value="Guardian">Guardian</option>
                  <option value="Friend">Friend</option>
                </select>
                {validationErrors['employmentInfo.nextOfKinRelationship'] ? (
                  <span className="text-sm text-red-600">{validationErrors['employmentInfo.nextOfKinRelationship']}</span>
                ) : null}
              </label>
              </div>
          )
        case 2:
          return (
            <div className="grid gap-6 xl:grid-cols-3">
              {renderUploadField('Latest three payslips', 'payslips', personalData.documents.payslips, true, '.pdf', 'documents.payslips')}
              {renderUploadField('Bank statements (3 months)', 'bankStatements', personalData.documents.bankStatements, true, '.pdf', 'documents.bankStatements')}
              {renderUploadField('NRC copy', 'nrcCopy', personalData.documents.nrcCopy, true, '.pdf', 'documents.nrcCopy')}
              {renderUploadField('Passport-sized photo', 'passportPhoto', personalData.documents.passportPhoto, true, 'application/pdf,image/*', 'documents.passportPhoto')}
              {renderUploadField('TPIN certificate', 'tpin', personalData.documents.tpin, true, '.pdf', 'documents.tpin')}
            </div>
          )
        case 3:
          return (
            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
                <div className="text-lg font-semibold text-slate-800">Loan amount</div>
                <div className="mt-4 text-4xl font-bold text-slate-950">K{loanData.amount.toLocaleString()}</div>
                <input
                  type="range"
                  min={minAmount}
                  max={maxAmount}
                  step="100"
                  value={loanData.amount}
                  onChange={(event) => setLoanData((prev) => ({ ...prev, amount: Number(event.target.value) }))}
                  className="mt-6 w-full accent-sky-500"
                />
                <div className="mt-3 flex justify-between text-sm text-slate-500">
                  <span>K{minAmount.toLocaleString()}</span>
                  <span>K{maxAmount.toLocaleString()}</span>
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
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-lg font-semibold text-slate-800">Repayment summary</div>
                <div className="mt-6 space-y-4 text-sm text-slate-600">
                  <div className="flex justify-between">
                    <span>Loan amount</span>
                    <span className="font-semibold">K{loanData.amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tenure</span>
                    <span className="font-semibold">{loanData.tenure} months</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Monthly repayment</span>
                    <span className="font-semibold">K{monthlyRepayment.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Facility fee</span>
                    <span className="font-semibold">K{facilityFee.toFixed(2)}</span>
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-900">
                  <span>Total repayable</span>
                  <span>K{totalRepayable.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )
        case 4:
          return renderPersonalOverview()
        default:
          return null
      }
    }

    switch (currentStep) {
      case 0:
        return (
          <div className="grid gap-6 xl:grid-cols-3">
            {renderField('Company name', businessData.businessInfo.companyName, (value) => updateSectionField('businessInfo', 'companyName', value), 'text', '', {}, true, 'businessInfo.companyName')}
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">
                Type of business
                <span className="text-red-500"> *</span>
              </span>
              <select
                value={businessData.businessInfo.businessType}
                onChange={(event) => updateSectionField('businessInfo', 'businessType', event.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">Select business type</option>
                <option value="Sole Proprietorship">Sole Proprietorship</option>
                <option value="Partnership">Partnership</option>
                <option value="Limited Liability Company (LLC)">Limited Liability Company (LLC)</option>
                <option value="Corporation">Corporation</option>
              </select>
              {validationErrors['businessInfo.businessType'] ? (
                <span className="text-sm text-red-600">{validationErrors['businessInfo.businessType']}</span>
              ) : null}
            </label>
            {renderDateField('Established date', businessData.businessInfo.establishedDate, (value) => updateSectionField('businessInfo', 'establishedDate', value), true, 'businessInfo.establishedDate')}
            {renderField('Nature of business', businessData.businessInfo.natureOfBusiness, (value) => updateSectionField('businessInfo', 'natureOfBusiness', value), 'text', '', {}, true, 'businessInfo.natureOfBusiness')}
            {renderField('Registered office', businessData.businessInfo.registeredOffice, (value) => updateSectionField('businessInfo', 'registeredOffice', value), 'text', '', {}, true, 'businessInfo.registeredOffice')}
            {renderField('Collateral pledged', businessData.businessInfo.collateralPledged, (value) => updateSectionField('businessInfo', 'collateralPledged', value), 'text', '', {}, true, 'businessInfo.collateralPledged')}
            {renderField('Purpose of loan', businessData.businessInfo.purposeOfLoan, (value) => updateSectionField('businessInfo', 'purposeOfLoan', value), 'text', '', {}, true, 'businessInfo.purposeOfLoan')}
          </div>
        )
      case 1:
        return (
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Directors</h3>
                  <p className="text-sm text-slate-500">Add up to 3 directors. Each director requires a name, phone, email, and NRC.</p>
                </div>
                {businessData.directorInfo.directors.length < 3 && (
                  <button
                    type="button"
                    onClick={addDirector}
                    className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
                  >
                    Add director
                  </button>
                )}
              </div>
              <div className="mt-4 space-y-4">
                {businessData.directorInfo.directors.map((director, index) => (
                  <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-700">Director {index + 1}</div>
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => removeDirector(index)}
                          className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid gap-6 xl:grid-cols-4">
                      {renderField(`Director ${index + 1} name`, director.name, (value) => updateDirectorField(index, 'name', value, 'alpha'), 'text', '', {}, true, `directorInfo.directors[${index}].name`)}
                      {renderField(`Director ${index + 1} phone`, director.phone, (value) => updateDirectorField(index, 'phone', value, 'phone'), 'tel', '', { maxLength: 10 }, true, `directorInfo.directors[${index}].phone`)}
                      {renderField(`Director ${index + 1} email`, director.email, (value) => updateDirectorField(index, 'email', value, 'email'), 'email', '', {}, true, `directorInfo.directors[${index}].email`)}
                      {renderField(`Director ${index + 1} NRC`, director.nrc, (value) => updateDirectorField(index, 'nrc', value, 'nrc'), 'text', '', { maxLength: 12 }, true, `directorInfo.directors[${index}].nrc`)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {renderField('Applicant first name', businessData.directorInfo.applicantFirstName, (value) => updateSectionField('directorInfo', 'applicantFirstName', value, 'alpha'), 'text', '', {}, true, 'directorInfo.applicantFirstName')}
            {renderField('Applicant middle name (Optional)', businessData.directorInfo.applicantMiddleName, (value) => updateSectionField('directorInfo', 'applicantMiddleName', value, 'alpha'), 'text', '', {}, false)}
            {renderField('Applicant last name', businessData.directorInfo.applicantLastName, (value) => updateSectionField('directorInfo', 'applicantLastName', value, 'alpha'), 'text', '', {}, true, 'directorInfo.applicantLastName')}
            {renderField('Applicant phone', businessData.directorInfo.applicantPhone, (value) => updateSectionField('directorInfo', 'applicantPhone', value, 'phone'), 'tel', '', { maxLength: 10 }, true, 'directorInfo.applicantPhone')}
            {renderField('Applicant email', businessData.directorInfo.applicantEmail, (value) => updateSectionField('directorInfo', 'applicantEmail', value, 'email'), 'email', '', {}, true, 'directorInfo.applicantEmail')}
            {renderField('Applicant NRC', businessData.directorInfo.applicantNrc, (value) => updateSectionField('directorInfo', 'applicantNrc', value, 'nrc'), 'text', '', { maxLength: 12 }, true, 'directorInfo.applicantNrc')}
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">
                Applicant gender
                <span className="text-red-500"> *</span>
              </span>
              <select
                value={businessData.directorInfo.applicantGender}
                onChange={(event) => updateSectionField('directorInfo', 'applicantGender', event.target.value, 'alpha')}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              {validationErrors['directorInfo.applicantGender'] ? (
                <span className="text-sm text-red-600">{validationErrors['directorInfo.applicantGender']}</span>
              ) : null}
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">
                Marital status
                <span className="text-red-500"> *</span>
              </span>
              <select
                value={businessData.directorInfo.applicantMaritalStatus}
                onChange={(event) => updateSectionField('directorInfo', 'applicantMaritalStatus', event.target.value, 'alpha')}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">Select marital status</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Widowed">Widowed</option>
                <option value="Divorced">Divorced</option>
                <option value="Separated">Separated</option>
              </select>
              {validationErrors['directorInfo.applicantMaritalStatus'] ? (
                <span className="text-sm text-red-600">{validationErrors['directorInfo.applicantMaritalStatus']}</span>
              ) : null}
            </label>
            {renderBirthDateField('Birth date', businessData.directorInfo.applicantBirthDate, (value) => updateSectionField('directorInfo', 'applicantBirthDate', value), true, 'directorInfo.applicantBirthDate')}
            {renderField('Applicant address', businessData.directorInfo.applicantAddress, (value) => updateSectionField('directorInfo', 'applicantAddress', value), 'text', '', {}, true, 'directorInfo.applicantAddress')}
            {renderField('Applicant position', businessData.directorInfo.applicantPosition, (value) => updateSectionField('directorInfo', 'applicantPosition', value), 'text', '', {}, true, 'directorInfo.applicantPosition')}
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">
                Applicant nationality
                <span className="text-red-500"> *</span>
              </span>
              <select
                value={businessData.directorInfo.applicantNationality}
                onChange={(event) => updateSectionField('directorInfo', 'applicantNationality', event.target.value)}
                className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">Select nationality</option>
                <option value="Kenya">Kenya</option>
                <option value="Malawi">Malawi</option>
                <option value="Rwanda">Rwanda</option>
                <option value="Uganda">Uganda</option>
                <option value="Zambia">Zambia</option>
                <option value="Zimbabwe">Zimbabwe</option>
              </select>
              {validationErrors['directorInfo.applicantNationality'] ? (
                <span className="text-sm text-red-600">{validationErrors['directorInfo.applicantNationality']}</span>
              ) : null}
            </label>
          </div>
        )
      case 2:
        return (
          <div className="grid gap-6 xl:grid-cols-3">
            {renderUploadField('PACRA certificate', 'pacraCertificate', businessData.documents.pacraCertificate, true, '.pdf', 'documents.pacraCertificate')}
            {renderUploadField('Form 2', 'form2', businessData.documents.form2, true, '.pdf', 'documents.form2')}
            {renderUploadField('Tax clearance certificate / TPIN', 'taxClearance', businessData.documents.taxClearance, true, '.pdf', 'documents.taxClearance')}
            {renderUploadField('Latest tax compliance return', 'latestTaxComplianceReturn', businessData.documents.latestTaxComplianceReturn, true, '.pdf', 'documents.latestTaxComplianceReturn')}
            {renderUploadField('Order / Invoice (if applying for order financing or invoice discounting)', 'orderOrInvoice', businessData.documents.orderOrInvoice, false, '.pdf', 'documents.orderOrInvoice')}
            {renderUploadField('Bank statements (6 months)', 'bankStatements', businessData.documents.bankStatements, true, '.pdf', 'documents.bankStatements')}
            {renderUploadField('Applicant Passport-sized photo', 'passportPhoto', businessData.documents.passportPhoto, true, 'application/pdf,image/*', 'documents.passportPhoto')}
            {renderUploadField('Board resolution', 'boardResolution', businessData.documents.boardResolution, true, '.pdf', 'documents.boardResolution')}

            <div className="xl:col-span-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Director documents</h3>
                  <p className="text-sm text-slate-500">Add up to 3 director NRC and passport photo uploads.</p>
                </div>
                {(businessData.documents.directorUploads || []).length < 3 && (
                  <button
                    type="button"
                    onClick={addDirectorUpload}
                    className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100"
                  >
                    Add director upload
                  </button>
                )}
              </div>
              <div className="mt-4 space-y-4">
                {(businessData.documents.directorUploads || []).map((upload, index) => (
                  <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-700">Director {index + 1}</div>
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => removeDirectorUpload(index)}
                          className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="grid gap-6 xl:grid-cols-2">
                      <label className="grid gap-2">
                        <span className="text-sm font-semibold text-slate-700">
                          Director {index + 1} NRC
                          <span className="text-red-500"> *</span>
                        </span>
                        <input
                          type="file"
                          onChange={(event) => handleDirectorDocumentInputChange(index, 'nrc', event)}
                          className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          accept="image/*,.pdf,.doc,.docx"
                        />
                        <span className="text-xs text-slate-500">
                          {upload.nrc ? upload.nrc.name : 'Upload director NRC'}
                        </span>
                        {getUploadStatus(`director.${index}.nrc`) === 'loading' && (
                          <span className="text-sm text-slate-500 flex items-center gap-2">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                            Uploading...
                          </span>
                        )}
                        {getUploadStatus(`director.${index}.nrc`) === 'success' && (
                          <span className="text-sm text-emerald-700">Upload successful</span>
                        )}
                        {validationErrors[`documents.directorUploads[${index}].nrc`] ? (
                          <span className="text-sm text-red-600">{validationErrors[`documents.directorUploads[${index}].nrc`]}</span>
                        ) : null}
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm font-semibold text-slate-700">
                          Director {index + 1} passport photo
                          <span className="text-red-500"> *</span>
                        </span>
                        <input
                          type="file"
                          onChange={(event) => handleDirectorDocumentInputChange(index, 'passportPhoto', event)}
                          className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          accept="application/pdf,image/*"
                        />
                        <span className="text-xs text-slate-500">
                          {upload.passportPhoto ? upload.passportPhoto.name : 'Upload director passport photo'}
                        </span>
                        {getUploadStatus(`director.${index}.passportPhoto`) === 'loading' && (
                          <span className="text-sm text-slate-500 flex items-center gap-2">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                            Uploading...
                          </span>
                        )}
                        {getUploadStatus(`director.${index}.passportPhoto`) === 'success' && (
                          <span className="text-sm text-emerald-700">Upload successful</span>
                        )}
                        {validationErrors[`documents.directorUploads[${index}].passportPhoto`] ? (
                          <span className="text-sm text-red-600">{validationErrors[`documents.directorUploads[${index}].passportPhoto`]}</span>
                        ) : null}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      case 3:
        return (
          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
              <div className="text-lg font-semibold text-slate-800">Loan amount</div>
              <div className="mt-4 text-4xl font-bold text-slate-950">K{loanData.amount.toLocaleString()}</div>
              <input
                type="range"
                min={minAmount}
                max={maxAmount}
                step="100"
                value={loanData.amount}
                onChange={(event) => setLoanData((prev) => ({ ...prev, amount: Number(event.target.value) }))}
                className="mt-6 w-full accent-sky-500"
              />
              <div className="mt-3 flex justify-between text-sm text-slate-500">
                <span>K{minAmount.toLocaleString()}</span>
                <span>K{maxAmount.toLocaleString()}</span>
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
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-lg font-semibold text-slate-800">Repayment summary</div>
              <div className="mt-6 space-y-4 text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>Loan amount</span>
                  <span className="font-semibold">K{loanData.amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tenure</span>
                  <span className="font-semibold">{loanData.tenure} months</span>
                </div>
                <div className="flex justify-between">
                  <span>Monthly repayment</span>
                  <span className="font-semibold">K{monthlyRepayment.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Facility fee</span>
                  <span className="font-semibold">K{facilityFee.toFixed(2)}</span>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-100 p-4 text-sm font-semibold text-slate-900">
                <span>Total repayable</span>
                <span>K{totalRepayable.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )
      case 4:
        return renderBusinessOverview()
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Header />
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-6">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.27em] text-sky-700">
                Loan application
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                Welcome to {selectedLoanType === 'personal' ? 'Personal' : 'Business'} Loan Application
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
                Complete step {currentStep + 1} of {stepTitles.length} to move forward. Required fields are marked with an asterisk.
              </p>
            </div>
</div>

          <div className="relative px-2">
            <div
              className="absolute top-4 h-0.5 bg-slate-200"
              style={{ left: `${50 / stepTitles.length}%`, right: `${50 / stepTitles.length}%` }}
            />
            <div
              className="absolute top-4 h-0.5 bg-sky-600 transition-all duration-300"
              style={{
                left: `${50 / stepTitles.length}%`,
                width: `calc((100% - ${100 / stepTitles.length}%) * ${
                  stepTitles.length > 1 ? currentStep / (stepTitles.length - 1) : 0
                })`,
              }}
            />
            <div
              className="relative grid"
              style={{ gridTemplateColumns: `repeat(${stepTitles.length}, minmax(0, 1fr))` }}
            >
              {stepTitles.map((title, index) => {
                const isCompleted = currentStep > index
                const isActive = currentStep === index
                return (
                  <div key={title} className="flex flex-col items-center gap-2 text-center">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${
                        isCompleted || isActive
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-slate-300 bg-white text-slate-400'
                      }`}
                    >
                      {index + 1}
                    </div>
                    <p
                      className={`text-xs font-semibold leading-tight ${
                        isActive ? 'text-sky-700' : isCompleted ? 'text-slate-700' : 'text-slate-400'
                      }`}
                    >
                      {title}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="relative mt-6 rounded-[2rem] border border-slate-200 bg-slate-50 p-5 sm:p-6">
            {(stepLoading || submitting) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[2rem] bg-white/90 backdrop-blur-sm p-6">
                <div className="inline-flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white/95 p-8 shadow-lg shadow-slate-200/40">
                  <span className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-600" />
                  <div className="text-center text-sm font-semibold text-slate-900">
                    {submitting ? 'Submitting application...' : 'Loading next step...'}
                  </div>
                </div>
              </div>
            )}

            {renderStepContent()}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={handleBack}
                disabled={stepLoading}
              >
                {stepLoading && currentStep > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                    Loading...
                  </span>
                ) : currentStep === 0 ? 'Back to home' : 'Previous step'}
              </button>
              {currentStep < stepTitles.length - 1 ? (
                <button
                  type="button"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/50 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
                  onClick={handleNext}
                  disabled={stepLoading}
                >
                  {stepLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                      Loading...
                    </span>
                  ) : 'Continue'}
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/50 transition hover:bg-sky-700"
                  onClick={handleSubmitApplication}
                  disabled={stepLoading || submitting}
                >
                {stepLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                    Loading...
                  </span>
                  ) : 'Submit application'}
                </button>
              )}
            </div>
          </div>
        </section>
      </main>

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
