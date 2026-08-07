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
]

const businessStepTitles = [
  'Business information',
  'Directors & Applicant',
  'Documents',
  'Loan Terms',
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
  },
  directorInfo: {
    director1Name: '',
    director1Phone: '',
    director1Email: '',
    director1Nrc: '',
    director2Name: '',
    director2Phone: '',
    director2Email: '',
    director2Nrc: '',
    applicantName: '',
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
  const [selectedLoanType, setSelectedLoanType] = useState(
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

  const updateDocumentField = (field, file) => {
    const setter = selectedLoanType === 'personal' ? setPersonalData : setBusinessData
    setter((prev) => ({
      ...prev,
      documents: {
        ...prev.documents,
        [field]: file,
      },
    }))
  }

  const resetForm = () => {
    setCurrentStep(0)
    setLoanData(initialLoanState)
    setPersonalData(personalInitial)
    setBusinessData(businessInitial)
    setValidationErrors({})
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
    }

    if (selectedLoanType === 'business') {
      if (currentStep === 0) {
        requiredField(businessData.businessInfo.companyName, 'businessInfo.companyName', 'Company name is required.')
        requiredField(businessData.businessInfo.businessType, 'businessInfo.businessType', 'Type of business is required.')
        requiredField(businessData.businessInfo.establishedDate, 'businessInfo.establishedDate', 'Established date is required.')
        requiredField(businessData.businessInfo.natureOfBusiness, 'businessInfo.natureOfBusiness', 'Nature of business is required.')
        requiredField(businessData.businessInfo.registeredOffice, 'businessInfo.registeredOffice', 'Registered office is required.')
        requiredField(businessData.businessInfo.collateralPledged, 'businessInfo.collateralPledged', 'Collateral pledged is required.')
      }

      if (currentStep === 1) {
        requiredField(businessData.directorInfo.director1Name, 'directorInfo.director1Name', 'Director name is required.')
        requiredField(businessData.directorInfo.director1Phone, 'directorInfo.director1Phone', 'Director phone is required.')
        requiredField(businessData.directorInfo.director1Email, 'directorInfo.director1Email', 'Director email is required.')
        requiredField(businessData.directorInfo.director1Nrc, 'directorInfo.director1Nrc', 'Director NRC is required.')
        requiredField(businessData.directorInfo.applicantName, 'directorInfo.applicantName', 'Applicant name is required.')
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
        if (businessData.directorInfo.director1Phone && !isValidPhone(businessData.directorInfo.director1Phone)) {
          recordError('directorInfo.director1Phone', 'Phone must be 10 digits and start with 0.')
        }
        if (businessData.directorInfo.director1Email && !isValidEmail(businessData.directorInfo.director1Email)) {
          recordError('directorInfo.director1Email', 'Email must end with a .com domain.')
        }
        if (businessData.directorInfo.director1Nrc && !isValidNRC(businessData.directorInfo.director1Nrc)) {
          recordError('directorInfo.director1Nrc', 'NRC must be 6 digits, slash, 2 digits, slash, then 1–2 digits.')
        }
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
    }

    setValidationErrors((prev) => ({ ...prev, ...errors }))
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
      setCurrentStep((prev) => prev + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
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
      setSubmitting(false)
      setShowSuccess(true)
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
        className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        {...inputProps}
      />
      {errorKey && validationErrors[errorKey] ? (
        <span className="text-sm text-red-600">{validationErrors[errorKey]}</span>
      ) : null}
    </label>
  )

  const renderDateField = (label, value, onChange, required = false) => (
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
              className: 'rounded-2xl bg-slate-50',
              sx: {
                '& .MuiOutlinedInput-root': {
                  borderRadius: '1rem',
                  backgroundColor: '#f8fafc',
                  borderColor: '#cbd5e1',
                },
              },
            },
          }}
        />
      </LocalizationProvider>
    </label>
  )

  const renderBirthDateField = (label, value, onChange, required = false) => (
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
              className: 'rounded-2xl bg-slate-50',
              sx: {
                '& .MuiOutlinedInput-root': {
                  borderRadius: '1rem',
                  backgroundColor: '#f8fafc',
                  borderColor: '#cbd5e1',
                },
              },
            },
          }}
        />
      </LocalizationProvider>
    </label>
  )

  const renderUploadField = (label, field, file, required = false) => (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      <input
        type="file"
        onChange={(event) => updateDocumentField(field, event.target.files?.[0] ?? null)}
        className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        accept="image/*,.pdf,.doc,.docx"
      />
      <span className="text-xs text-slate-500">
        {file ? file.name : 'Upload document or choose file'}
      </span>
    </label>
  )

  const renderStepContent = () => {
    if (selectedLoanType === 'personal') {
      switch (currentStep) {
        case 0:
          return (
            <div className="grid gap-6 xl:grid-cols-2">
              {renderField('First name', personalData.personalInfo.firstName, (value) => updateSectionField('personalInfo', 'firstName', value, 'alpha'), 'text', '', {}, true)}
              {renderField('Middle name (Optional)', personalData.personalInfo.middleName, (value) => updateSectionField('personalInfo', 'middleName', value, 'alpha'), 'text', '', {}, false)}
              {renderField('Surname', personalData.personalInfo.surname, (value) => updateSectionField('personalInfo', 'surname', value, 'alpha'), 'text', '', {}, true)}
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
                  className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
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
                  className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
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
              {renderBirthDateField('Birth date', personalData.personalInfo.birthDate, (value) => updateSectionField('personalInfo', 'birthDate', value), true)}
            </div>
          )
        case 1:
          return (
            <div className="grid gap-6 xl:grid-cols-2">
              {renderField('Residential address', personalData.employmentInfo.residentialAddress, (value) => updateSectionField('employmentInfo', 'residentialAddress', value), 'text', '', {}, true)}
              {renderField('Occupation', personalData.employmentInfo.occupation, (value) => updateSectionField('employmentInfo', 'occupation', value), 'text', '', {}, true)}
              {renderField('Employer name', personalData.employmentInfo.employerName, (value) => updateSectionField('employmentInfo', 'employerName', value), 'text', '', {}, true)}
              {renderField('Nationality', personalData.employmentInfo.nationality, (value) => updateSectionField('employmentInfo', 'nationality', value), 'text', '', {}, true)}
              {renderField('Next of kin name', personalData.employmentInfo.nextOfKinName, (value) => updateSectionField('employmentInfo', 'nextOfKinName', value, 'alpha'), 'text', '', {}, true)}
              {renderField('Next of kin phone', personalData.employmentInfo.nextOfKinPhone, (value) => updateSectionField('employmentInfo', 'nextOfKinPhone', value, 'phone'), 'tel', '', { maxLength: 10 }, true)}
              {renderField('Next of kin email', personalData.employmentInfo.nextOfKinEmail, (value) => updateSectionField('employmentInfo', 'nextOfKinEmail', value, 'email'), 'email', '', {}, true)}
              {renderField('Relationship', personalData.employmentInfo.nextOfKinRelationship, (value) => updateSectionField('employmentInfo', 'nextOfKinRelationship', value, 'alpha'), 'text', '', {}, true)}
            </div>
          )
        case 2:
          return (
            <div className="grid gap-6 xl:grid-cols-2">
              {renderUploadField('Latest three payslips', 'payslips', personalData.documents.payslips, true)}
              {renderUploadField('Bank statements (3 months)', 'bankStatements', personalData.documents.bankStatements, true)}
              {renderUploadField('NRC copy', 'nrcCopy', personalData.documents.nrcCopy, true)}
              {renderUploadField('Passport-sized photo', 'passportPhoto', personalData.documents.passportPhoto, true)}
              {renderUploadField('TPIN certificate', 'tpin', personalData.documents.tpin, true)}
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
                <button className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/50 transition hover:bg-sky-700" type="button" onClick={handleSubmitApplication}>
                  Review terms & submit
                </button>
              </div>
            </div>
          )
        default:
          return null
      }
    }

    switch (currentStep) {
      case 0:
        return (
          <div className="grid gap-6 xl:grid-cols-2">
            {renderField('Company name', businessData.businessInfo.companyName, (value) => updateSectionField('businessInfo', 'companyName', value), 'text', '', {}, true)}
            {renderField('Type of business', businessData.businessInfo.businessType, (value) => updateSectionField('businessInfo', 'businessType', value), 'text', '', {}, true)}
            {renderDateField('Established date', businessData.businessInfo.establishedDate, (value) => updateSectionField('businessInfo', 'establishedDate', value), true)}
            {renderField('Nature of business', businessData.businessInfo.natureOfBusiness, (value) => updateSectionField('businessInfo', 'natureOfBusiness', value), 'text', '', {}, true)}
            {renderField('Registered office', businessData.businessInfo.registeredOffice, (value) => updateSectionField('businessInfo', 'registeredOffice', value), 'text', '', {}, true)}
            {renderField('Collateral pledged', businessData.businessInfo.collateralPledged, (value) => updateSectionField('businessInfo', 'collateralPledged', value), 'text', '', {}, true)}
          </div>
        )
      case 1:
        return (
          <div className="grid gap-6 xl:grid-cols-2">
            {renderField('Director 1 name', businessData.directorInfo.director1Name, (value) => updateSectionField('directorInfo', 'director1Name', value, 'alpha'), 'text', '', {}, true)}
            {renderField('Director 1 phone', businessData.directorInfo.director1Phone, (value) => updateSectionField('directorInfo', 'director1Phone', value, 'phone'), 'tel', '', { maxLength: 10 }, true, 'directorInfo.director1Phone')}
            {renderField('Director 1 email', businessData.directorInfo.director1Email, (value) => updateSectionField('directorInfo', 'director1Email', value, 'email'), 'email', '', {}, true, 'directorInfo.director1Email')}
            {renderField('Director 1 NRC', businessData.directorInfo.director1Nrc, (value) => updateSectionField('directorInfo', 'director1Nrc', value, 'nrc'), 'text', '', { maxLength: 12 }, true, 'directorInfo.director1Nrc')}
            {renderField('Director 2 name', businessData.directorInfo.director2Name, (value) => updateSectionField('directorInfo', 'director2Name', value, 'alpha'), 'text', '', {}, false)}
            {renderField('Director 2 phone', businessData.directorInfo.director2Phone, (value) => updateSectionField('directorInfo', 'director2Phone', value, 'phone'), 'tel', '', { maxLength: 10 }, false)}
            {renderField('Director 2 email', businessData.directorInfo.director2Email, (value) => updateSectionField('directorInfo', 'director2Email', value, 'email'), 'email', '', {}, false)}
            {renderField('Director 2 NRC', businessData.directorInfo.director2Nrc, (value) => updateSectionField('directorInfo', 'director2Nrc', value, 'nrc'), 'text', '', { maxLength: 12 }, false)}
            {renderField('Applicant name', businessData.directorInfo.applicantName, (value) => updateSectionField('directorInfo', 'applicantName', value, 'alpha'), 'text', '', {}, true)}
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
                className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
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
                className="w-full min-w-0 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
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
            {renderBirthDateField('Birth date', businessData.directorInfo.applicantBirthDate, (value) => updateSectionField('directorInfo', 'applicantBirthDate', value), true)}
            {renderField('Applicant address', businessData.directorInfo.applicantAddress, (value) => updateSectionField('directorInfo', 'applicantAddress', value), 'text', '', {}, true)}
            {renderField('Applicant position', businessData.directorInfo.applicantPosition, (value) => updateSectionField('directorInfo', 'applicantPosition', value), 'text', '', {}, true)}
            {renderField('Applicant nationality', businessData.directorInfo.applicantNationality, (value) => updateSectionField('directorInfo', 'applicantNationality', value), 'text', '', {}, true)}
          </div>
        )
      case 2:
        return (
          <div className="grid gap-6 xl:grid-cols-2">
            {renderUploadField('PACRA certificate', 'pacraCertificate', businessData.documents.pacraCertificate, true)}
            {renderUploadField('Tax clearance certificate / TPIN', 'taxClearance', businessData.documents.taxClearance, true)}
            {renderUploadField('Bank statements (6 months)', 'bankStatements', businessData.documents.bankStatements, true)}
            {renderUploadField('Passport-sized photo', 'passportPhoto', businessData.documents.passportPhoto, true)}
            {renderUploadField('Board resolution', 'boardResolution', businessData.documents.boardResolution, true)}
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
              <button className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/50 transition hover:bg-sky-700" type="button" onClick={handleSubmitApplication}>
                Review terms & submit
              </button>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[2rem] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-8">
          <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex rounded-full bg-sky-100 px-4 py-2 text-xs font-semibold uppercase tracking-[0.27em] text-sky-700">
                Loan application
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                Welcome to {selectedLoanType === 'personal' ? 'Personal' : 'Business'} Loan Application
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                Complete step {currentStep + 1} of {stepTitles.length} to move forward. Required fields are marked with an asterisk.
              </p>
            </div>
</div>

          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {stepTitles.map((title, index) => {
              const active = currentStep >= index
              return (
                <div
                  key={title}
                  className={`flex items-center gap-3 rounded-3xl border px-4 py-3 transition ${
                    active ? 'border-sky-500 bg-sky-100/80 text-slate-950' : 'border-slate-200 bg-slate-100 text-slate-500'
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${active ? 'border-sky-500 bg-sky-500 text-white' : 'border-slate-300 bg-white text-slate-500'}`}>
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-8 rounded-[2rem] border border-slate-200 bg-slate-50 p-6 sm:p-8">
            {renderStepContent()}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
                onClick={handleBack}
              >
                {currentStep === 0 ? 'Back to home' : 'Previous step'}
              </button>
              {currentStep < stepTitles.length - 1 && (
                <button
                  type="button"
                  className="rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/50 transition hover:bg-sky-700"
                  onClick={handleNext}
                >
                  Continue
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
