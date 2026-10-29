import React from 'react'
import {
  Briefcase,
  Building2,
  Calculator,
  Fingerprint,
  FolderOpen,
  Home,
  Landmark,
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
import { COLLATERAL_REQUIREMENTS, MAX_COLLATERAL_ITEMS, acceptedTypes, collateralValue, typeLabel } from '@/config/collateral'
import { formatKwacha } from '@/config/loanProducts'
import { acceptsPhotos, readDocument } from '@/utils/documentSlots'
import { EMPLOYMENT_OPTIONS, businessPeople, employerField, idField, positionLabel, positionsFor, presentDocuments } from '@/config/applicantRules'

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
    addCollateralItem,
    addDirector,
    addDirectorUpload,
    allowCrb,
    analysisFor,
    applicantEmail,
    assistedBy,
    businessData,
    collateralTypes,
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
    product,
    removeCollateralItem,
    removeDirector,
    removeDirectorUpload,
    retryPrescreen,
    selectedLoanType,
    sendConsentCode,
    setAllowCrb,
    setConsentCode,
    setLoanData,
    setPreviewAttachment,
    setShowCameraCapture,
    totalRepayable,
    updateCollateralItem,
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
            {options.map((option) => {
              const { value: optionValue, label: optionLabel } = typeof option === 'string' ? { value: option, label: option } : option
              return (
                <option key={optionValue} value={optionValue}>
                  {optionLabel}
                </option>
              )
            })}
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

  const renderUploadField = (label, field, file, required = false, acceptTypes = '.pdf', errorKey = '', cameraCapable = false, description = '') => (
    <FileUploadField
      key={field}
      name={errorKey || `documents.${field}`}
      label={label}
      description={description}
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

  const activeData = selectedLoanType === 'personal' ? personalData : businessData
  const collateralRule = product.collateral?.requirement || 'none'
  // A company's directors, a partnership's partners, or a sole proprietor (applicantRules.js).
  const people = businessPeople(businessData.businessInfo.businessType)
  const isZambianApplicant = idField(personalData.employmentInfo.nationality).kind === 'nrc'
  const collateralItems = collateralRule === 'none' ? [] : activeData.collateral?.items || []

  // The product's documents, in the order it lists them, each where its file lives (utils/documentSlots.js).
  const productAttachments = presentDocuments(product, activeData).filter((document) => !document.skipped).map((document) => ({ key: document.slot, label: document.label, file: readDocument(activeData.documents, document.slot) }))
  const collateralAttachments = collateralItems
    .map((item, index) => ({ key: `collateral-${index}`, label: `Collateral ${index + 1} proof`, file: readDocument(activeData.documents, `collateral.${index}`) }))
    .filter((attachment) => attachment.file)

  const personalAttachments = [...productAttachments, ...collateralAttachments]

  const businessAttachments = [
    ...productAttachments,
    ...collateralAttachments,
    ...(businessData.documents.directorUploads || []).flatMap((upload, index) => [
      { key: `director-${index}-nrc`, label: `${people.one} ${index + 1} NRC upload`, file: upload.nrc },
      { key: `director-${index}-photo`, label: `${people.one} ${index + 1} passport photo`, file: upload.passportPhoto },
    ]),
  ]

  /** The upload fields for the product's documents, or a note when it asks for none. */
  const renderProductDocuments = () =>
    product.documents.length ? (
      presentDocuments(product, activeData).map((document) =>
        document.skipped ? (
          <div key={document.slot} className="rounded-md border border-dashed bg-muted/30 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">{document.label}</p>
            <p className="mt-0.5 text-muted-foreground">{document.skipped}</p>
          </div>
        ) : renderUploadField(
          document.label,
          document.slot,
          readDocument(activeData.documents, document.slot),
          document.required,
          acceptsPhotos(document.slot) ? 'application/pdf,image/*' : '.pdf',
          `documents.${document.slot}`,
          document.slot === 'passportPhoto',
          document.description
        )
      )
    ) : (
      <p className="text-sm text-muted-foreground md:col-span-2">This loan doesn’t need any documents from you.</p>
    )

  // Said on the documents step, so collateral proof isn't looked for here.
  const collateralNext =
    collateralRule !== 'none' ? (
      <p className="flex items-start gap-2 rounded-md bg-accent/60 px-4 py-3 text-sm text-accent-foreground md:col-span-2">
        <Landmark className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          This loan {collateralRule === 'required' ? 'needs' : 'can take'} collateral. You’ll list what you’re pledging, and attach its proof, on the next step.
        </span>
      </p>
    ) : null

  const collateralSummaryRows = collateralItems.map((item, index) =>
    renderSummaryRow(
      `${typeLabel(item.type, collateralTypes)}${collateralItems.length > 1 ? ` (${index + 1})` : ''}`,
      [item.description, Number(item.value) > 0 ? formatKwacha(item.value) : ''].filter(Boolean).join(' · ')
    )
  )

  const renderCollateralSummary = () =>
    collateralRule === 'none' ? null : renderSummarySection('Collateral', collateralSummaryRows.length ? collateralSummaryRows : [renderSummaryRow('Pledged', 'None')], 3)

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  /**
   * What the applicant pledges, when the product asks: a row per item (kind, description,
   * estimated value) with an optional proof each. The minimum cover follows the amount.
   */
  const renderCollateral = () => {
    const types = acceptedTypes(product, collateralTypes)
    const cover = Number(product.collateral?.minCoverage) || 0
    const needed = cover > 0 ? Math.ceil(loanData.amount * cover) : 0
    const pledged = collateralValue(collateralItems)
    const required = collateralRule === 'required'
    return (
      <fieldset className="rounded-lg border bg-card p-5 shadow-soft sm:p-6">
        <legend className="sr-only">Collateral</legend>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
              <Landmark className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
                Collateral
                <span className={required ? 'text-xs font-medium text-destructive' : 'text-xs font-normal text-muted-foreground'}>
                  {COLLATERAL_REQUIREMENTS[collateralRule]?.label.toLowerCase()}
                </span>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {required ? 'This loan needs security. List what you are pledging and what each item is worth.' : 'You can pledge security for this loan. List each item and what it is worth.'}
                {needed ? ` Pledge at least ${formatKwacha(needed)}: ${Math.round(cover * 100)}% of the loan.` : ''}
              </p>
            </div>
          </div>
          {collateralItems.length < MAX_COLLATERAL_ITEMS ? (
            <Button type="button" variant="outline" size="sm" onClick={addCollateralItem}>
              <Plus />
              {collateralItems.length ? 'Add another item' : 'Add an item'}
            </Button>
          ) : null}
        </div>

        {validationErrors.collateral ? (
          <p id="field-collateral" tabIndex={-1} role="alert" className="mt-4 text-sm font-medium text-destructive">
            {validationErrors.collateral}
          </p>
        ) : null}

        <div className="mt-5 space-y-4">
          {collateralItems.length ? (
            collateralItems.map((item, index) => (
              <div key={index} className="rounded-md border border-border bg-secondary/40 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <Badge variant="secondary">Item {index + 1}</Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCollateralItem(index)}
                    className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 />
                    Remove
                  </Button>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  <FormField name={`collateral.items.${index}.type`} label="Kind of collateral" required error={validationErrors[`collateral.items.${index}.type`]} hint={types.find((type) => type.key === item.type)?.description}>
                    {(field) => (
                      <Select {...field} value={item.type || ''} onChange={(event) => updateCollateralItem(index, 'type', event.target.value)}>
                        <option value="">Select a kind</option>
                        {types.map((type) => (
                          <option key={type.key} value={type.key}>
                            {type.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField name={`collateral.items.${index}.description`} label="Description" required error={validationErrors[`collateral.items.${index}.description`]} hint="For example make and registration, or plot number.">
                    {(field) => <Input {...field} value={item.description || ''} maxLength={200} onChange={(event) => updateCollateralItem(index, 'description', event.target.value)} />}
                  </FormField>
                  <FormField name={`collateral.items.${index}.value`} label="Estimated value (K)" required error={validationErrors[`collateral.items.${index}.value`]}>
                    {(field) => <Input {...field} inputMode="numeric" value={item.value || ''} placeholder="e.g. 150000" onChange={(event) => updateCollateralItem(index, 'value', event.target.value)} />}
                  </FormField>
                  <div className="md:col-span-3">
                    {renderUploadField(
                      'Proof of ownership or value',
                      `collateral.${index}`,
                      readDocument(activeData.documents, `collateral.${index}`),
                      false,
                      'application/pdf,image/*',
                      `documents.collateral.${index}`,
                      false,
                      'For example a title deed, white book, valuation or invoice.'
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{required ? 'Add at least one item.' : 'No collateral added.'}</p>
          )}
          {collateralItems.length ? (
            <p className="text-sm text-muted-foreground">
              Total pledged: <span className="font-semibold text-foreground">{formatKwacha(pledged)}</span>
              {needed ? ` of ${formatKwacha(needed)} needed` : ''}
            </p>
          ) : null}
        </div>
      </fieldset>
    )
  }

  const renderLoanTerms = () => (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <div className="grid content-start gap-6">
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

        {collateralRule !== 'none' ? renderCollateral() : null}
      </div>

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
      <ApplicationSummary loanTypeLabel={product.name} generatedOn={generatedOn}>
        <div className="grid gap-5 pt-5">
          <SummaryHighlights items={summaryHighlights} />
          {renderSummarySection('Personal information', [
          renderSummaryRow('Full name', [personalData.personalInfo.firstName, personalData.personalInfo.middleName, personalData.personalInfo.surname].filter(Boolean).join(' ')),
          renderSummaryRow('Phone', personalData.personalInfo.phone),
          renderSummaryRow('Email', personalData.personalInfo.email),
          isZambianApplicant ? renderSummaryRow('NRC', personalData.personalInfo.nrc) : renderSummaryRow('Passport number', personalData.personalInfo.passportNumber),
          renderSummaryRow('Gender', personalData.personalInfo.gender),
          renderSummaryRow('Marital status', personalData.personalInfo.maritalStatus),
          renderSummaryRow('Birth date', personalData.personalInfo.birthDate),
        ], 0)}
          {renderSummarySection('Residence & Employment', [
          renderSummaryRow('Residential address', personalData.employmentInfo.residentialAddress),
          renderSummaryRow('Occupation', personalData.employmentInfo.occupation),
          employerField(personalData.employmentInfo.occupation) ? renderSummaryRow(employerField(personalData.employmentInfo.occupation).label, personalData.employmentInfo.employerName) : null,
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
          {renderCollateralSummary()}
        </div>
      </ApplicationSummary>
    </div>
  )

  const renderBusinessOverview = () => (
    <div className="grid gap-6">
      {overviewIntro}
      <ApplicationSummary loanTypeLabel={product.name} generatedOn={generatedOn}>
        <div className="grid gap-5 pt-5">
          <SummaryHighlights items={summaryHighlights} />
          {renderSummarySection('Business information', [
            renderSummaryRow('Company name', businessData.businessInfo.companyName),
            renderSummaryRow('TPIN', businessData.businessInfo.tpin),
            renderSummaryRow('Type of business', businessData.businessInfo.businessType),
            renderSummaryRow('Established date', businessData.businessInfo.establishedDate),
            renderSummaryRow('Nature of business', businessData.businessInfo.natureOfBusiness),
            renderSummaryRow('Registered office', businessData.businessInfo.registeredOffice),
            renderSummaryRow('Purpose of loan', businessData.businessInfo.purposeOfLoan),
          ], 0)}
          {renderSummarySection('Applicant', [
            renderSummaryRow('Full name', [businessData.directorInfo.applicantFirstName, businessData.directorInfo.applicantMiddleName, businessData.directorInfo.applicantLastName].filter(Boolean).join(' ')),
            renderSummaryRow('Phone', businessData.directorInfo.applicantPhone),
            renderSummaryRow('Email', businessData.directorInfo.applicantEmail),
            idField(businessData.directorInfo.applicantNationality).kind === 'nrc' ? renderSummaryRow('NRC', businessData.directorInfo.applicantNrc) : renderSummaryRow('Passport number', businessData.directorInfo.applicantPassportNumber),
            renderSummaryRow('Gender', businessData.directorInfo.applicantGender),
            renderSummaryRow('Marital status', businessData.directorInfo.applicantMaritalStatus),
            renderSummaryRow('Birth date', businessData.directorInfo.applicantBirthDate),
            renderSummaryRow('Address', businessData.directorInfo.applicantAddress),
            renderSummaryRow('Position', positionLabel(businessData.directorInfo)),
            renderSummaryRow('Nationality', businessData.directorInfo.applicantNationality),
          ], 1)}
          {renderSummarySection(
            people.many,
            businessData.directorInfo.directors.flatMap((director, index) => [
              renderSummaryRow(`${people.one} ${index + 1} name`, director.name),
              renderSummaryRow(`${people.one} ${index + 1} phone`, director.phone),
              renderSummaryRow(`${people.one} ${index + 1} email`, director.email),
              renderSummaryRow(`${people.one} ${index + 1} NRC`, director.nrc),
            ]),
            1
          )}

          <SummarySection title="Documents" stepIndex={2} onEdit={goToStep} plain>
            <AttachmentList attachments={businessAttachments} onPreview={setPreviewAttachment} />
          </SummarySection>

          {renderSummarySection('Loan terms', loanTermRows, 3)}
          {renderCollateralSummary()}
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
              <FieldGroup title="Your name" description="Enter your names exactly as they appear on your NRC or passport." icon={User} columns={3}>
                {renderField('First name', personalData.personalInfo.firstName, (value) => updateSectionField('personalInfo', 'firstName', value, 'alpha'), 'text', '', {}, true, 'personalInfo.firstName')}
                {renderField('Middle name (Optional)', personalData.personalInfo.middleName, (value) => updateSectionField('personalInfo', 'middleName', value, 'alpha'), 'text', '', {}, false)}
                {renderField('Surname', personalData.personalInfo.surname, (value) => updateSectionField('personalInfo', 'surname', value, 'alpha'), 'text', '', {}, true, 'personalInfo.surname')}
              </FieldGroup>

              <FieldGroup title="Contact details" description="We use these to reach you about your application." icon={Phone} columns={2}>
                {renderField('Phone', personalData.personalInfo.phone, (value) => updateSectionField('personalInfo', 'phone', value, 'phone'), 'tel', '123456789', { maxLength: 9, autoComplete: 'tel' }, true, 'personalInfo.phone')}
                {renderField('Email', personalData.personalInfo.email, (value) => updateSectionField('personalInfo', 'email', value, 'email'), 'email', 'you@example.com', { autoComplete: 'email' }, true, 'personalInfo.email')}
              </FieldGroup>

              <FieldGroup title="Identity" icon={Fingerprint} columns={2}>
                {/* Asked first, so the ID that follows is the right one: an NRC for Zambians, a passport for anyone else. */}
                {renderSelectField('Nationality', personalData.employmentInfo.nationality, (value) => updateSectionField('employmentInfo', 'nationality', value), NATIONALITY_OPTIONS, 'Select nationality', true, 'employmentInfo.nationality')}
                {idField(personalData.employmentInfo.nationality).kind === 'nrc'
                  ? renderField('NRC', personalData.personalInfo.nrc, (value) => updateSectionField('personalInfo', 'nrc', value, 'nrc'), 'text', '123456/78/9', { maxLength: 12 }, true, 'personalInfo.nrc')
                  : renderField('Passport number', personalData.personalInfo.passportNumber, (value) => updateSectionField('personalInfo', 'passportNumber', value.toUpperCase().replace(/[^A-Z0-9]/g, '')), 'text', 'As printed in your passport', { maxLength: 12 }, true, 'personalInfo.passportNumber')}
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
                {renderSelectField('Occupation', personalData.employmentInfo.occupation, (value) => {
                  updateSectionField('employmentInfo', 'occupation', value)
                  // Retired, students and those not working have no employer or business to name.
                  if (!employerField(value)) updateSectionField('employmentInfo', 'employerName', '')
                }, EMPLOYMENT_OPTIONS, 'Select occupation', true, 'employmentInfo.occupation')}
                {employerField(personalData.employmentInfo.occupation) ? renderField(employerField(personalData.employmentInfo.occupation).label, personalData.employmentInfo.employerName, (value) => updateSectionField('employmentInfo', 'employerName', value), 'text', '', {}, true, 'employmentInfo.employerName') : null}
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
              {renderProductDocuments()}
              {collateralNext}
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
              {renderField('TPIN', businessData.businessInfo.tpin, (value) => updateSectionField('businessInfo', 'tpin', value, 'numeric'), 'text', '10-digit ZRA taxpayer number', { maxLength: 10, inputMode: 'numeric' }, true, 'businessInfo.tpin')}
              {renderSelectField('Type of business', businessData.businessInfo.businessType, (value) => updateSectionField('businessInfo', 'businessType', value), BUSINESS_TYPE_OPTIONS, 'Select business type', true, 'businessInfo.businessType')}
              {renderDateField('Established date', businessData.businessInfo.establishedDate, (value) => updateSectionField('businessInfo', 'establishedDate', value), true, 'businessInfo.establishedDate')}
              {renderField('Nature of business', businessData.businessInfo.natureOfBusiness, (value) => updateSectionField('businessInfo', 'natureOfBusiness', value), 'text', '', {}, true, 'businessInfo.natureOfBusiness')}
            </FieldGroup>

            <FieldGroup title="Office & loan purpose" icon={Home} columns={2}>
              {renderField('Registered office', businessData.businessInfo.registeredOffice, (value) => updateSectionField('businessInfo', 'registeredOffice', value), 'text', '', {}, true, 'businessInfo.registeredOffice')}
              {renderField('Purpose of loan', businessData.businessInfo.purposeOfLoan, (value) => updateSectionField('businessInfo', 'purposeOfLoan', value), 'text', '', {}, true, 'businessInfo.purposeOfLoan')}
            </FieldGroup>
          </div>
        )
      case 1:
        return (
          <div className="grid gap-6">
            <fieldset className="rounded-lg border bg-card p-5 shadow-soft sm:p-6">
              <legend className="sr-only">{people.many}</legend>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Users className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">{people.many}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {people.max === 1
                        ? `The ${people.one.toLowerCase()}’s name, phone, email and NRC.`
                        : `Add up to ${people.max} ${people.many.toLowerCase()}. Each needs a name, phone, email and NRC.`}
                    </p>
                  </div>
                </div>
                {businessData.directorInfo.directors.length < people.max && (
                  <Button type="button" variant="outline" size="sm" onClick={addDirector}>
                    <Plus />
                    Add {people.one.toLowerCase()}
                  </Button>
                )}
              </div>

              <div className="mt-5 space-y-4">
                {businessData.directorInfo.directors.map((director, index) => (
                  <div key={index} className="rounded-md border border-border bg-secondary/40 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <Badge variant="secondary">
                        {people.one} {index + 1}
                      </Badge>
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
                      {renderField(`${people.one} ${index + 1} name`, director.name, (value) => updateDirectorField(index, 'name', value, 'alpha'), 'text', '', {}, true, `directorInfo.directors[${index}].name`)}
                      {renderField(`${people.one} ${index + 1} phone`, director.phone, (value) => updateDirectorField(index, 'phone', value, 'phone'), 'tel', '123456789', { maxLength: 9 }, true, `directorInfo.directors[${index}].phone`)}
                      {renderField(`${people.one} ${index + 1} email`, director.email, (value) => updateDirectorField(index, 'email', value, 'email'), 'email', 'name@example.com', {}, true, `directorInfo.directors[${index}].email`)}
                      {renderField(`${people.one} ${index + 1} NRC`, director.nrc, (value) => updateDirectorField(index, 'nrc', value, 'nrc'), 'text', '123456/78/9', { maxLength: 12 }, true, `directorInfo.directors[${index}].nrc`)}
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
              {renderSelectField('Applicant nationality', businessData.directorInfo.applicantNationality, (value) => updateSectionField('directorInfo', 'applicantNationality', value), NATIONALITY_OPTIONS, 'Select nationality', true, 'directorInfo.applicantNationality')}
              {idField(businessData.directorInfo.applicantNationality).kind === 'nrc'
                ? renderField('Applicant NRC', businessData.directorInfo.applicantNrc, (value) => updateSectionField('directorInfo', 'applicantNrc', value, 'nrc'), 'text', '123456/78/9', { maxLength: 12 }, true, 'directorInfo.applicantNrc')
                : renderField('Applicant passport number', businessData.directorInfo.applicantPassportNumber, (value) => updateSectionField('directorInfo', 'applicantPassportNumber', value.toUpperCase().replace(/[^A-Z0-9]/g, '')), 'text', 'As printed in the passport', { maxLength: 12 }, true, 'directorInfo.applicantPassportNumber')}
              {renderBirthDateField('Birth date', businessData.directorInfo.applicantBirthDate, (value) => updateSectionField('directorInfo', 'applicantBirthDate', value), true, 'directorInfo.applicantBirthDate')}
              {renderSelectField('Applicant gender', businessData.directorInfo.applicantGender, (value) => updateSectionField('directorInfo', 'applicantGender', value, 'alpha'), GENDER_OPTIONS, 'Select gender', true, 'directorInfo.applicantGender')}
              {renderSelectField('Marital status', businessData.directorInfo.applicantMaritalStatus, (value) => updateSectionField('directorInfo', 'applicantMaritalStatus', value, 'alpha'), MARITAL_STATUS_OPTIONS, 'Select marital status', true, 'directorInfo.applicantMaritalStatus')}
            </FieldGroup>

            <FieldGroup title="Applicant address & role" icon={Home} columns={2}>
              {renderField('Applicant address', businessData.directorInfo.applicantAddress, (value) => updateSectionField('directorInfo', 'applicantAddress', value), 'text', '', {}, true, 'directorInfo.applicantAddress')}
              {renderSelectField('Applicant position', businessData.directorInfo.applicantPosition, (value) => updateSectionField('directorInfo', 'applicantPosition', value), positionsFor(businessData.businessInfo.businessType), 'Select position', true, 'directorInfo.applicantPosition')}
              {businessData.directorInfo.applicantPosition === 'Other' ? renderField('Your position', businessData.directorInfo.applicantPositionOther, (value) => updateSectionField('directorInfo', 'applicantPositionOther', value), 'text', 'e.g. Finance manager', {}, true, 'directorInfo.applicantPositionOther') : null}
            </FieldGroup>
          </div>
        )
      case 2:
        return (
          <div className="grid gap-6">
            <FieldGroup title="Company documents" description="Attach each document below. They are sent when you submit the application." icon={FolderOpen} columns={2}>
              {renderProductDocuments()}
              {collateralNext}
            </FieldGroup>

            <fieldset className="rounded-lg border bg-card p-5 shadow-soft sm:p-6">
              <legend className="sr-only">Director documents</legend>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Users className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">{people.one} documents</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      An NRC and a passport photo for each {people.one.toLowerCase()}.
                    </p>
                  </div>
                </div>
                {(businessData.documents.directorUploads || []).length < people.max && (
                  <Button type="button" variant="outline" size="sm" onClick={addDirectorUpload}>
                    <Plus />
                    Add {people.one.toLowerCase()} upload
                  </Button>
                )}
              </div>

              <div className="mt-5 space-y-4">
                {(businessData.documents.directorUploads || []).map((upload, index) => (
                  <div key={index} className="rounded-md border border-border bg-secondary/40 p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <Badge variant="secondary">
                        {people.one} {index + 1}
                      </Badge>
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
