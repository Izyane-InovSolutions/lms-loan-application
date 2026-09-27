import React from 'react'
import {
  Briefcase,
  Building2,
  Calculator,
  Fingerprint,
  FolderOpen,
  Home,
  Phone,
  Plus,
  Printer,
  Trash2,
  User,
  Users,
  Wallet,
} from 'lucide-react'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import { aiFailureMessage, isRetryableAiFailure } from '../../services/aiApi'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { FormField } from '@/components/form/FormField'
import { FieldGroup } from '@/components/form/FieldGroup'
import { FileUploadField } from '@/components/form/FileUploadField'
import {
  ApplicationSummary,
  AttachmentList,
  SummaryHighlights,
  SummaryRow,
  SummarySection,
} from '@/components/application/ApplicationSummary'
import { PrescreenGuidance } from '@/components/application/PrescreenGuidance'
import { SubmitConsents } from '@/components/application/SubmitConsents'

import {
  BUSINESS_TYPE_OPTIONS,
  CRB_ENABLED,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  NATIONALITY_OPTIONS,
  RELATIONSHIP_OPTIONS,
} from './formDefaults'

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

/**
 * The wizard's field renderers and the content of each step, for both products. Split
 * out of DashboardPage.tailwind.jsx, which keeps the state, validation and submission;
 * everything here reads what it needs from the props it is given.
 */
export function WizardStep(props) {
  const {
    addDirector,
    addDirectorUpload,
    allowCrb,
    analysisFor,
    applicantEmail,
    assistedBy,
    businessData,
    consentCode,
    consentCodeState,
    currentStep,
    getUploadStatus,
    goToStep,
    handleDirectorDocumentInputChange,
    handleDocumentInputChange,
    hasCamera,
    interestLabel,
    loanData,
    maxAmount,
    maxTenure,
    minAmount,
    minTenure,
    monthlyRepayment,
    personalData,
    prescreen,
    prescreenView,
    price,
    removeDirector,
    removeDirectorUpload,
    retryPrescreen,
    selectedLoanType,
    sendConsentCode,
    setAllowCrb,
    setConsentCode,
    setLoanData,
    setPreviewAttachment,
    setShareLocation,
    setShowCameraCapture,
    shareLocation,
    totalRepayable,
    updateDirectorField,
    updateSectionField,
    validationErrors,
  } = props

  // ---------------------------------------------------------------------------
  // Field renderers
  // ---------------------------------------------------------------------------

  const renderField = (label, value, onChange, type = 'text', placeholder = '', inputProps = {}, required = false, errorKey = '') => {
    const name = errorKey || label
    return (
      <FormField key={label} name={name} label={label} required={required} error={validationErrors[errorKey]}>
        {(field) => (
          type === 'tel' ? (
            <div className="flex h-11 overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 has-[input[aria-invalid=true]]:border-destructive">
              <span className="flex items-center border-r border-input bg-muted px-3.5 text-base text-muted-foreground">+260</span>
              <Input
                {...field}
                type={type}
                value={value ?? ''}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="h-full rounded-none border-0 px-3.5 focus-visible:ring-0"
                {...inputProps}
              />
            </div>
          ) : (
            <Input
              {...field}
              type={type}
              value={value ?? ''}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              {...inputProps}
            />
          )
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
      analysis={analysisFor(field)}
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
    renderSummaryRow(interestLabel, `K${price.interest.toFixed(2)}`),
    renderSummaryRow('Facility fee', `K${price.fee.toFixed(2)}`),
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
          if (tenure >= minTenure && tenure <= maxTenure) {
            setLoanData((prev) => ({ ...prev, tenure }))
          }
        }, 'number', `${minTenure} to ${maxTenure}`, { min: minTenure, max: maxTenure }, true)}
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
            <SummaryRow label={interestLabel} value={`K${price.interest.toFixed(2)}`} />
            <SummaryRow label="Facility fee" value={`K${price.fee.toFixed(2)}`} />
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
    <>
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
      <SubmitConsents
        shareLocation={shareLocation}
        onShareLocation={setShareLocation}
        allowCrb={allowCrb}
        onAllowCrb={setAllowCrb}
        crbEnabled={CRB_ENABLED}
        assistedBy={assistedBy}
        customerEmail={applicantEmail}
        consentCode={consentCode}
        onConsentCode={setConsentCode}
        consentCodeState={consentCodeState}
        onSendConsentCode={sendConsentCode}
      />
      <PrescreenGuidance
        status={prescreenView.status}
        guidance={prescreen.result?.applicantGuidance}
        message={prescreenView.status === 'error' ? aiFailureMessage(prescreenView.reason) : undefined}
        onRetry={prescreenView.status === 'error' && isRetryableAiFailure(prescreenView.reason) ? retryPrescreen : undefined}
      />
    </>
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
                {renderField('Phone', personalData.personalInfo.phone, (value) => updateSectionField('personalInfo', 'phone', value, 'phone'), 'tel', '123456789', { maxLength: 9, autoComplete: 'tel' }, true, 'personalInfo.phone')}
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
                {renderField('Next of kin phone', personalData.employmentInfo.nextOfKinPhone, (value) => updateSectionField('employmentInfo', 'nextOfKinPhone', value, 'phone'), 'tel', '123456789', { maxLength: 9 }, true, 'employmentInfo.nextOfKinPhone')}
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
                      {renderField(`Director ${index + 1} phone`, director.phone, (value) => updateDirectorField(index, 'phone', value, 'phone'), 'tel', '123456789', { maxLength: 9 }, true, `directorInfo.directors[${index}].phone`)}
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
              {renderField('Applicant phone', businessData.directorInfo.applicantPhone, (value) => updateSectionField('directorInfo', 'applicantPhone', value, 'phone'), 'tel', '123456789', { maxLength: 9 }, true, 'directorInfo.applicantPhone')}
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
                        accept="application/pdf,.pdf"
                        required
                        error={validationErrors[`documents.directorUploads[${index}].nrc`]}
                        status={getUploadStatus(`director.${index}.nrc`)}
                        onChange={(event) => handleDirectorDocumentInputChange(index, 'nrc', event)}
                        analysis={analysisFor(`director.${index}.nrc`)}
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
                        analysis={analysisFor(`director.${index}.passportPhoto`)}
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

  return renderStepContent()
}
