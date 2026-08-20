import React, { useEffect, useState } from 'react'
import { ArrowLeft, FileText, Inbox, Loader2, MailCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OTP_EXPIRY_MINUTES, formatKwacha } from '@/config/loanProducts'
import { requestStatusOtp, verifyStatusOtp, extractStatusErrorMessage } from '@/services/statusApi'

const STATUS_BADGE_VARIANT = {
  approved: 'success',
  submitted: 'brand',
  pending: 'accent',
  rejected: 'outline',
  declined: 'outline',
}

const statusVariant = (status) => STATUS_BADGE_VARIANT[String(status || '').toLowerCase()] || 'secondary'

const applicationStatus = (application) => application.loan_application_status || application.status || 'Unknown'

/** Renders a label/value pair, or nothing when the field is empty. */
function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  )
}

/**
 * Full record for one application. Fields are read defensively because the LMS backend
 * returns the same shape for both loan types, with whichever side does not apply left null
 * (e.g. a personal loan has no `company_name`, a business loan has no plain `first_name`).
 */
function ApplicationDetail({ application }) {
  const isBusiness = application.application_type?.toLowerCase().includes('business')
  const applicantName = [
    application.applicant_first_name ?? application.first_name,
    application.applicant_middle_name ?? application.middle_name,
    application.applicant_last_name ?? application.last_name,
  ]
    .filter(Boolean)
    .join(' ')
  const documents = [...(application.business_documents || []), ...(application.documents || [])]

  return (
    <div className="max-h-[28rem] space-y-5 overflow-y-auto pr-1">
      <section>
        <h3 className="text-sm font-semibold text-foreground">Loan</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <DetailRow label="Application type" value={application.application_type} />
          <DetailRow label="Amount" value={application.amount != null ? formatKwacha(application.amount) : null} />
          <DetailRow
            label="Total repayable"
            value={application.total_amount != null ? formatKwacha(application.total_amount) : null}
          />
          <DetailRow label="Tenure" value={application.tenure ? `${application.tenure} months` : null} />
          <DetailRow label="Purpose" value={application.purpose_of_loan || application.loan_purpose} />
          <DetailRow label="Submitted" value={application.application_date} />
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Applicant</h3>
        <dl className="mt-2 grid grid-cols-2 gap-3">
          <DetailRow label="Name" value={applicantName || null} />
          <DetailRow label="Email" value={application.applicant_email || application.email} />
          <DetailRow label="Phone" value={application.applicant_phone || application.phone} />
          <DetailRow label="Gender" value={application.applicant_gender || application.gender} />
          <DetailRow
            label="Marital status"
            value={application.applicant_marital_status || application.marital_status}
          />
          <DetailRow label="Nationality" value={application.applicant_nationality || application.nationality} />
          <DetailRow
            label="NRC"
            value={application.applicant_national_registration_card || application.national_registration_card}
          />
          <DetailRow label="Address" value={application.applicant_address || application.residential_address} />
          <DetailRow label="Occupation" value={application.occupation} />
          <DetailRow label="Employer" value={application.employer_name} />
        </dl>
      </section>

      {isBusiness ? (
        <section>
          <h3 className="text-sm font-semibold text-foreground">Business</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <DetailRow label="Company" value={application.company_name} />
            <DetailRow label="Nature of business" value={application.nature_of_business} />
            <DetailRow label="Business type" value={application.type_of_business} />
            <DetailRow label="Registered office" value={application.registered_office} />
            <DetailRow label="Established" value={application.established_date} />
            <DetailRow label="Collateral pledged" value={application.collateral_pledged} />
          </dl>
        </section>
      ) : null}

      {application.next_of_kin_name || application.next_of_kin_phone ? (
        <section>
          <h3 className="text-sm font-semibold text-foreground">Next of kin</h3>
          <dl className="mt-2 grid grid-cols-2 gap-3">
            <DetailRow label="Name" value={application.next_of_kin_name} />
            <DetailRow label="Phone" value={application.next_of_kin_phone} />
            <DetailRow label="Email" value={application.next_of_kin_email} />
            <DetailRow label="Relationship" value={application.next_of_kin_relationship} />
          </dl>
        </section>
      ) : null}

      {application.directors?.length ? (
        <section>
          <h3 className="text-sm font-semibold text-foreground">Directors</h3>
          <ul className="mt-2 space-y-2">
            {application.directors.map((director) => (
              <li key={director.name} className="rounded-md border bg-card p-3 text-sm">
                <p className="font-medium text-foreground">{director.director_name}</p>
                <p className="text-xs text-muted-foreground">
                  {[director.director_phone, director.director_email].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {documents.length ? (
        <section>
          <h3 className="text-sm font-semibold text-foreground">Documents</h3>
          <ul className="mt-2 space-y-1.5">
            {documents.map((document) => (
              <li key={document.name} className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                {document.document_name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * Opens once an email has been entered in the Hero search bar. Sends an OTP to that
 * address, then on verification shows every submitted application tied to it, with a
 * click-through to the full record for any one application.
 */
export function ApplicationStatusDialog({ open, onOpenChange, email }) {
  const [otpCode, setOtpCode] = useState('')
  const [applications, setApplications] = useState(null)
  const [selectedApplication, setSelectedApplication] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (!open || !email) return
    setOtpCode('')
    setApplications(null)
    setSelectedApplication(null)
    setError('')
    setSending(true)
    requestStatusOtp(email)
      .then(() => setSending(false))
      .catch((requestError) => {
        setError(extractStatusErrorMessage(requestError))
        setSending(false)
      })
  }, [open, email])

  const handleOpenChange = (next) => {
    if (!next) {
      setOtpCode('')
      setApplications(null)
      setSelectedApplication(null)
      setError('')
    }
    onOpenChange(next)
  }

  const handleResend = async () => {
    setOtpCode('')
    setError('')
    setSending(true)
    try {
      await requestStatusOtp(email)
    } catch (requestError) {
      setError(extractStatusErrorMessage(requestError))
    } finally {
      setSending(false)
    }
  }

  const handleVerify = async (event) => {
    event.preventDefault()
    if (!otpCode.trim()) {
      setError('Enter the code sent to your email.')
      return
    }

    setVerifying(true)
    setError('')
    try {
      const result = await verifyStatusOtp(email, otpCode.trim())
      setApplications(Array.isArray(result) ? result : [])
    } catch (verifyError) {
      setError(extractStatusErrorMessage(verifyError))
    } finally {
      setVerifying(false)
    }
  }

  const stage = selectedApplication ? 'detail' : applications ? 'results' : 'otp'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={stage === 'otp' ? undefined : 'sm:max-w-lg'}>
        <DialogHeader>
          {stage === 'detail' ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedApplication(null)}
                aria-label="Back to applications"
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ArrowLeft className="size-4" />
              </button>
              <DialogTitle>{selectedApplication.name}</DialogTitle>
              <Badge variant={statusVariant(applicationStatus(selectedApplication))}>
                {applicationStatus(selectedApplication)}
              </Badge>
            </div>
          ) : (
            <DialogTitle>{stage === 'results' ? 'Your applications' : 'Check your application status'}</DialogTitle>
          )}

          {stage !== 'detail' ? (
            <DialogDescription>
              {stage === 'results'
                ? `Every application submitted with ${email}.`
                : sending
                  ? `Sending a verification code to ${email}…`
                  : `Enter the six-digit code sent to ${email}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {stage === 'detail' ? (
          <>
            <ApplicationDetail application={selectedApplication} />
            <DialogFooter>
              <Button type="button" variant="outline" className="w-full" onClick={() => setSelectedApplication(null)}>
                Back to applications
              </Button>
            </DialogFooter>
          </>
        ) : stage === 'results' ? (
          <div className="space-y-3">
            {applications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
                <Inbox className="size-6" aria-hidden="true" />
                No submitted applications found for this email.
              </div>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {applications.map((application) => (
                  <li key={application.name}>
                    <button
                      type="button"
                      onClick={() => setSelectedApplication(application)}
                      className="w-full rounded-md border bg-card p-3 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{application.name}</p>
                        <Badge variant={statusVariant(applicationStatus(application))}>
                          {applicationStatus(application)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {application.application_type}
                        {application.amount ? ` · ${formatKwacha(application.amount)}` : ''}
                        {application.application_date ? ` · ${application.application_date}` : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status-otp">Verification code</Label>
              <Input
                id="status-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="000000"
                value={otpCode}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'status-otp-error' : undefined}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center text-lg font-semibold tracking-[0.4em]"
              />
            </div>

            {error ? (
              <p id="status-otp-error" role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleResend} disabled={sending || verifying}>
                {sending ? <Loader2 className="animate-spin" /> : null}
                Resend code
              </Button>
              <Button type="submit" disabled={verifying || sending}>
                {verifying ? <Loader2 className="animate-spin" /> : <MailCheck />}
                {verifying ? 'Verifying…' : 'Verify and view status'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
