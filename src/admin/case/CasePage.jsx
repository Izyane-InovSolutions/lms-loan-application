import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  ShieldAlert,
  Sparkles,
  UserPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { LOAN_TYPE_LABELS, OPEN_STATUSES, WITHDRAWABLE_STATUSES, channelLabel, requestableSlots, statusLabel } from '@/config/applications'
import { hasPermission, roleLabel } from '@/config/roles'
import { checklistOf } from '@/config/stages'
import { SignaturePad } from '@/components/application/SignaturePad'
import { findFormMismatches } from '@/utils/documentChecks'
import { api } from '../api'
import { caseOwnership } from './ownership'
import { useAuth } from '../auth'
import { FormError, Panel, StatusBadge, dateTime, money, timeAgo, useToast } from '../components'
import { ActionDialog } from './ActionDialog'
import {
  AffordabilityPanel,
  AppraisalsPanel,
  ConditionsPanel,
  ConsentPanel,
  CrbPanel,
  LmsPanel,
  LocationPanel,
  SignaturesPanel,
  StageDocumentsPanel,
  StagesPanel,
  VerificationChecklist,
  QualificationPanel,
} from './CasePanels'
import { CaseSummary, expectedForSlot } from './CaseSummary'
import { sectionsFor } from './fields'
import { conditionsOf } from '@/config/conditions'
import { CALCULATIONS, FREQUENCIES, perPeriod } from '@/config/loanTerms'
import { lendingCover } from '@/config/appraisal'
import { LegalReview } from './LegalReview'
import { LoanTermsPanel } from './LoanTermsPanel'
import { CoverWarning, UnderwritingPanel } from './UnderwritingPanel'
import { PreApprovalPanel } from './PreApprovalPanel'
import { KycPanel } from './KycPanel'
import { PrescreenStats } from './PrescreenStats'
import { allowsCreditCheck } from '@/config/consent'
import { crbApplies } from '@/config/applicantRules'
import { MouBadge } from '@/components/MouBadge'
import { heldForPartner, heldReason, mayActOnHeldCase } from '@/config/partners'

const withinAssignmentRange = (person, amount) =>
  Number(amount) >= (person.approvalMin ?? 0) && (person.approvalMax == null || Number(amount) <= person.approvalMax)
// A report younger than this is reused when a case is opened, as the Django adapter did.
const CRB_FRESH_HOURS = 24

export function CasePage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const notify = useToast()
  const [state, setState] = useState({ status: 'loading' })
  // The tab picked; null opens the one for the stage's own work (caseTabs).
  const [tab, setTab] = useState(null)
  const [documentId, setDocumentId] = useState(null)
  const tabs = useRef(null)
  const [dialog, setDialog] = useState(null)
  // Counted up by the summary's "Enter the figure", which opens the figures for editing.
  const [figureRequest, setFigureRequest] = useState(0)
  // Who the case can be assigned to at its stage ({ stage, people }); null until loaded.
  const [assignees, setAssignees] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await api(`/applications/${id}`)
      setState({ status: 'ready', ...data })
    } catch (error) {
      setState({ status: 'error', message: error.message, code: error.code })
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // The prescreen runs just after submit; poll briefly until it lands.
  useEffect(() => {
    if (state.status !== 'ready' || state.prescreen) return undefined
    const timer = setTimeout(load, 2500)
    return () => clearTimeout(timer)
  }, [state, load])

  // Held for its partner (pre-screening, then waiting for the partner): read-only here, but
  // for notes, unless this is a system administrator (src/config/partners.js).
  const held = state.status === 'ready' && heldForPartner(state.application) && !mayActOnHeldCase(user)
  // What this person's role lets them do here (Team → Roles); the server checks each again.
  // A case at a stage this role doesn't work on (one it worked on before) opens read-only: the server refuses
  // changes to it, so only what it still allows stays: withdraw, record acceptance, assign, add a note, log a
  // field visit, add a document, the LMS.
  const readOnly = state.status === 'ready' && state.workflow?.readOnly === true
  const may = useMemo(
    () => ({
      work: !held && !readOnly && hasPermission(user, 'cases.work'),
      assign: !held && hasPermission(user, 'cases.assign'),
      recommend: !held && !readOnly && hasPermission(user, 'cases.recommend'),
      decide: !held && !readOnly && hasPermission(user, 'cases.decide'),
      disburse: !held && !readOnly && hasPermission(user, 'cases.disburse'),
      // Reading the AI review doesn't change anything, so it stays on a read-only case.
      view: !held && (hasPermission(user, 'cases.work') || hasPermission(user, 'cases.decide')),
      lms: !held && hasPermission(user, 'cases.disburse'),
      record: !held && hasPermission(user, 'offers.record'),
      note: hasPermission(user, 'applications.note'),
      upload: hasPermission(user, 'applications.note'),
      verify: !held && !readOnly && hasPermission(user, 'legal.verify'),
    }),
    [user, held, readOnly]
  )
  // A case that moves to another stage opens on that stage's own tab again.
  const stageKey = state.status === 'ready' ? `${state.application.id}:${state.workflow?.state?.id || ''}` : null
  useEffect(() => {
    setTab(null)
  }, [stageKey])
  // Asked again whenever the case moves on: each stage has its own people.
  const caseKey = state.status === 'ready' ? `${state.application.id}:${state.application.state}:${state.application.version}` : null
  useEffect(() => {
    if (!may.assign || !caseKey) return undefined
    let cancelled = false
    api(`/applications/${id}/assignees`)
      .then((result) => !cancelled && setAssignees(result))
      .catch(() => !cancelled && setAssignees({ stage: '', people: [] }))
    return () => {
      cancelled = true
    }
  }, [may.assign, caseKey, id])

  /** Posts a workflow action against the version on screen; a stale screen is told to refresh. */
  const act = useCallback(
    async (action, payload = {}, message) => {
      try {
        const data = await api(`/applications/${id}/actions`, { method: 'POST', body: { action, version: state.application.version, ...payload } })
        setState({ status: 'ready', ...data })
        if (message) notify(message)
      } catch (error) {
        if (error.code === 'stale') load()
        throw error
      }
    },
    [id, state, notify, load]
  )

  const post = useCallback(
    async (path, body, message) => {
      const data = await api(`/applications/${id}${path}`, { method: 'POST', body })
      setState({ status: 'ready', ...data })
      if (message) notify(message)
    },
    [id, notify]
  )
  const put = useCallback(
    async (path, body, message) => {
      const data = await api(`/applications/${id}${path}`, { method: 'PUT', body })
      setState({ status: 'ready', ...data })
      if (message) notify(message)
    },
    [id, notify]
  )
  // A file to the case (multipart, as uploadStaffDocument sends), answered with the case.
  const upload = useCallback(
    async (path, form, message) => {
      const response = await fetch(`/api/v1/applications/${id}${path}`, { method: 'POST', body: form, credentials: 'same-origin' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || 'The upload failed.')
      setState({ status: 'ready', ...data })
      if (message) notify(message)
    },
    [id, notify]
  )

  const [crbPull, setCrbPull] = useState({ status: 'idle' })
  const pullCrb = useCallback(
    async (message) => {
      setCrbPull({ status: 'pulling' })
      try {
        await post('/crb', {}, message)
        setCrbPull({ status: 'idle' })
      } catch (error) {
        // Another officer (or tab) is already pulling: show their report once it lands.
        if (error.code === 'crb_in_progress') {
          setCrbPull({ status: 'pulling' })
          setTimeout(() => load().finally(() => setCrbPull({ status: 'idle' })), 5000)
          return
        }
        setCrbPull({ status: 'error', message: error.message })
      }
    },
    [post, load]
  )

  // Opening a case pulls its credit report when credit staff open it, the applicant
  // consented, and there is no report from the last CRB_FRESH_HOURS. Each pull is a
  // billable enquiry, so it runs once per visit and never repeats a fresh report.
  const autoPulledFor = useRef(null)
  useEffect(() => {
    if (state.status !== 'ready' || !may.work || autoPulledFor.current === id) return
    autoPulledFor.current = id
    const consented = allowsCreditCheck(state.consents)
    if (!state.crbProvider || !consented) return
    const latest = state.crbReports[0]
    const fresh = latest && Date.now() - new Date(latest.createdAt).getTime() < CRB_FRESH_HOURS * 3600000
    if (!fresh) pullCrb()
  }, [state, may.work, id, pullCrb])

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Opening the case…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="space-y-4">
        <BackLink />
        <FormError message={state.code === 'not_found' ? 'This application doesn’t exist, or it isn’t one your role can see.' : state.message} />
      </div>
    )
  }

  const { application, documents, prescreen, appraisals, consents, locations, crbReports, lmsConfigured, crbProvider, offersRequireSignature, signatures, stageDocuments, workflow, product, collateralCatalog } = state
  const canTake = withinAssignmentRange(user, application.amount)
  const lastRecommendation = appraisals.find((appraisal) => appraisal.kind === 'recommendation')
  const hasCrbConsent = allowsCreditCheck(consents)
  // From the summary: show that part of the case and bring it into view.
  const showTab = (value) => {
    setTab(value)
    tabs.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const checklistEditable = may.work && (['submitted', 'in_review', 'info_requested'].includes(application.status) || workflow?.state.checks.length > 0)
  const { tabs: tabList, initial: initialTab } = caseTabs({ application, documents, workflow, user })
  const currentTab = tab && tabList.some(([value]) => value === tab) ? tab : initialTab
  const caseOpen = OPEN_STATUSES.includes(application.status)
  const terms = application.terms

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="flex flex-col gap-4 border-b pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground">{application.companyName || application.applicantName}</h1>
            <StatusBadge status={application.status} label={statusLabel(application.status)} />
            {workflow && workflow.state.label !== statusLabel(application.status) ? <span className="text-sm font-medium text-muted-foreground">{workflow.state.label}</span> : null}
            {/* An MoU loan stays marked as one, on the route or moved to the full review. */}
            {application.preApproval ? <MouBadge partnerName={application.preApproval.partnerName} /> : null}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {application.reference}, {(product?.name || LOAN_TYPE_LABELS[application.loanType]).toLowerCase()}
            {application.companyName ? `, applicant ${application.applicantName}` : ''}, submitted {dateTime(application.submittedAt)}
            {hasPermission(user, 'audit.view') ? (
              <>
                {' · '}
                <Link to={`/admin/audit?entity=application:${application.id}`} className="underline underline-offset-2 hover:text-foreground">
                  View audit trail
                </Link>
              </>
            ) : null}
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Fact label="Asked for" value={`${money(application.amount)} over ${application.tenure} months`} />
            {application.approvedAmount ? (
              <Fact label="Approved" value={`${money(application.approvedAmount)} over ${application.approvedTenure} months`} />
            ) : terms ? (
              <Fact label="Proposed" value={`${money(terms.amount)} over ${terms.tenure} months`} />
            ) : null}
            {terms?.summary ? (
              <Fact
                label="Instalment"
                value={`${money(application.approvedAmount ? application.monthlyInstalment : terms.summary.instalment)} ${(FREQUENCIES[terms.frequency]?.label || '').toLowerCase()}`}
              />
            ) : (
              <Fact label="Monthly instalment" value={money(application.monthlyInstalment)} />
            )}
            <Fact label="Brought in by" value={application.sourcedByName ? `${application.sourcedByName} (${roleLabel(application.sourcedByRole).toLowerCase()})` : channelLabel(application.channel)} />
            <Fact label="Officer" value={application.assignedOfficerName || 'Unassigned'} />
            {application.status === 'approved' && application.offerExpiresAt ? (
              <Fact label="Offer" value={`Waiting for the customer, until ${dateTime(application.offerExpiresAt)}`} />
            ) : null}
            {application.acceptedAt ? <Fact label="Offer accepted" value={dateTime(application.acceptedAt)} /> : null}
          </dl>
          {readOnly ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="size-4 shrink-0" aria-hidden="true" />
              Read only — this case is at a stage your role doesn’t work on.
            </p>
          ) : null}
        </div>
        <CaseActions
          application={application}
          readOnly={readOnly}
          workflow={workflow}
          may={may}
          userId={user.id}
          canTake={canTake}
          hasEligibleOfficers={!assignees || assignees.people.some((person) => person.id !== application.assignedOfficer)}
          onOpen={setDialog}
          onClaim={(action) => act('transition', { actionId: action.id }, action.id === 'start_review' ? `${action.toLabel} started` : `Moved to ${action.toLabel}`)}
          onTake={() => act('assign', { officerId: user.id }, 'The case is yours')}
          onTakeHere={() => act('take', {}, 'The case is yours at this stage')}
          onShowWorkflow={() => showTab('workflow')}
        />
      </header>

      <PreApprovalPanel
        application={application}
        preApproval={workflow?.preApproval}
        canIssue={!held && !readOnly && (hasPermission(user, 'offers.issue') || mayActOnHeldCase(user))}
        heldMessage={held ? heldReason(application) : null}
        onIssue={(terms) => act('issue_offer', terms, 'Offer issued')}
        onLeave={(input) => act('leave_pre_approval', input, 'Sent to full review')}
      />

      {application.identityFlags?.length ? <IdentityFlags flags={application.identityFlags} /> : null}

      {application.status === 'info_requested' && application.infoRequest ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">Waiting on the applicant: </span>
            <span className="text-muted-foreground">
              {application.infoRequest.message} (asked by {application.infoRequest.requestedBy}, {timeAgo(application.infoRequest.requestedAt)})
            </span>
            {application.infoRequest.documents?.length ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                New copies asked for: {application.infoRequest.documents.map((entry) => entry.label).join(', ')}. Each is checked automatically when it arrives.
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="space-y-4">
        <nav ref={tabs} className="flex scroll-mt-4 gap-1 overflow-x-auto border-b" aria-label="Case sections">
          {tabList.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-current={currentTab === value ? 'page' : undefined}
              className={cn(
                '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                currentTab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* While the case is at pre-screening: its figures at a glance. */}
        {currentTab === 'prescreening' ? (
          <PrescreenStats
            application={application}
            product={product}
            prescreen={prescreen}
            crbReports={crbReports}
            affordability={
              <div id="case-figures" className="scroll-mt-4 self-start">
                <AffordabilityPanel application={application} prescreen={prescreen} editRequest={figureRequest} collapsible onSaveFigures={may.work ? (values) => post('/figures', values, 'Figures saved; the rules ran again') : null} />
              </div>
            }
          />
        ) : null}

        {/* The assessment, with the figures and bureau report the rules rest on. */}
        {currentTab === 'analysis' ? (
          <div className="space-y-4">
            <CaseSummary
              // The bureau report opens from the CRB score card, so it isn't shown on its own below.
              crbDetail={
                <CrbPanel
                  reports={crbReports}
                  provider={crbProvider}
                  hasConsent={hasCrbConsent}
                  applies={crbApplies(application.loanType, application.data)}
                  canRun={may.work}
                  pulling={crbPull.status === 'pulling'}
                  error={crbPull.status === 'error' ? crbPull.message : null}
                  onRun={() => pullCrb('Credit report added')}
                />
              }
              application={application}
              documents={documents}
              prescreen={prescreen}
              zra={application.checks?.zra}
              crb={{ reports: crbReports, provider: crbProvider, hasConsent: hasCrbConsent, applies: crbApplies(application.loanType, application.data) }}
              // Settings → AI: with insights off, no AI review shows, not even one made before.
              showAi={may.view && state.aiInsights !== false}
              canRerun={may.work}
              onRerun={() => post('/prescreen', {}, 'Policy rules run again')}
              onOpenDocument={(value) => {
                setDocumentId(value)
                showTab('documents')
              }}
              onOpenDetails={() => showTab('details')}
              // The buttons on rules it couldn't check, where this person may take the step.
              actions={{
                // Figures are entered in Affordability, on the Pre-screening tab: only while the case is there.
                enter_figure:
                  may.work && application.status === 'submitted'
                    ? () => {
                        setFigureRequest((count) => count + 1)
                        showTab('prescreening')
                        scrollToPanel('case-figures')
                      }
                    : null,
                ask_applicant:
                  may.work && caseOwnership(application, workflow, user.id).ownerMay && workflow?.state?.askApplicant && application.status !== 'info_requested'
                    ? () => setDialog({ type: 'request_info' })
                    : null,
                run_crb: may.work && crbProvider ? () => scrollToPanel('case-crb') : null,
                rerun: may.work ? () => post('/prescreen', {}, 'Policy rules run again') : null,
                settings: user?.role === 'admin' ? () => navigate('/admin/settings?tab=crb') : null,
              }}
            />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {application.data?.eligibility ? <QualificationPanel application={application} product={product} /> : null}
            </div>
          </div>
        ) : null}

        {/* What the applicant told us, where they were, and what they agreed to. */}
        {currentTab === 'details' ? (
          <Details
            application={application}
            collateralCatalog={collateralCatalog}
            cards={[
              ...(application.kyc ? [<KycPanel key="kyc" application={application} />] : []),
              ...(consents.length ? [<ConsentPanel key="consent" consents={consents} />] : []),
            ]}
            wide={<LocationPanel points={locations} facts={prescreen?.facts} onLogVisit={may.note ? (position) => post('/visits', position, 'Visit logged') : null} />}
          />
        ) : null}

        {/* What they sent, and what we sent them to sign. */}
        {currentTab === 'documents' ? (
          <div className="space-y-4">
            <Documents application={application} product={product} documents={documents} selectedId={documentId} onSelect={setDocumentId} onUpload={may.upload ? (form) => uploadStaffDocument(id, form, setState, notify) : null} />
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <StageDocumentsPanel
                documents={stageDocuments}
                applicationId={application.id}
                canWork={may.work && !['declined', 'withdrawn', 'expired'].includes(application.status)}
                onResend={() => post('/stage-documents/send', {}, 'Documents emailed to the applicant again')}
                onReceived={(document, note) => post(`/stage-documents/${document.id}/received`, { note }, `${document.label} marked received`)}
              />
              <SignaturesPanel signatures={signatures} applicationId={application.id} />
            </div>
          </div>
        ) : null}

        {/* The loan as the appraiser structures it: editable at the terms stage, by whoever works the case there. */}
        {currentTab === 'terms' ? (
          <LoanTermsPanel
            application={application}
            product={product}
            editable={may.work && workflow?.state?.work === 'terms' && caseOwnership(application, workflow, user.id).ownerMay}
            onSave={(values) => act('save_terms', { terms: values }, 'Loan terms saved')}
          />
        ) : null}

        {/* Underwriting: each asset's valuation and legal verification, and the required documents. */}
        {currentTab === 'underwriting' ? (
          <UnderwritingPanel
            application={application}
            documents={documents}
            product={product}
            collateralCatalog={collateralCatalog}
            status={workflow?.state?.underwriting}
            requires={workflow?.state?.underwritingRequires}
            canValue={may.work && caseOpen}
            canLegal={may.verify && caseOpen}
            canVerifyDocuments={(may.work || may.verify) && caseOpen}
            onSaveValuation={(index, values) => put(`/valuations/${index}`, values, 'Valuation saved; the rules ran again')}
            onUploadReport={(index, file) => {
              const form = new FormData()
              form.append('file', file)
              return upload(`/valuations/${index}/report`, form, 'Valuation report added')
            }}
            onSaveLegal={(index, values) => put(`/legal/${index}`, values, 'Legal verification saved')}
            onUploadLegal={(index, slot, file, label) => {
              const form = new FormData()
              if (label) form.append('label', label)
              form.append('file', file)
              return upload(`/legal/${index}/documents/${slot}`, form, 'Document attached')
            }}
            onVerifyDocument={(itemId, status, note) =>
              post('/verifications', { target: 'document', id: itemId, status, note }, status === 'verified' ? 'Marked verified' : status === 'issue' ? 'Issue recorded' : 'Check cleared')
            }
            onComment={(target, itemId, text) => post('/verifications/comments', { target, id: itemId, text }, 'Comment added')}
          />
        ) : null}

        {/* Older workflow versions: the collateral's valuation (Appraisal) and the legal officer's check (Underwriting). */}
        {currentTab === 'legal' ? (
          <LegalReview
            application={application}
            documents={documents}
            collateralCatalog={collateralCatalog}
            canVerify={may.verify}
            holdsApproval={Boolean(workflow?.state?.legalReview)}
            canValue={may.work}
            onValue={(index, values) => put(`/valuations/${index}`, values, 'Valuation saved; the rules ran again')}
            onUploadReport={(index, file) => {
              const form = new FormData()
              form.append('file', file)
              return upload(`/valuations/${index}/report`, form, 'Valuation report added')
            }}
            canComment={may.verify || may.work}
            onVerify={(target, itemId, status, note) =>
              post('/verifications', { target, id: itemId, status, note }, status === 'verified' ? 'Marked verified' : status === 'issue' ? 'Issue recorded' : 'Check cleared')
            }
            onComment={(target, itemId, text) => post('/verifications/comments', { target, id: itemId, text }, 'Comment added')}
          />
        ) : null}

        {/* Where the case is: its stages and checks, the decisions on it, and the hand-off to the LMS. */}
        {currentTab === 'workflow' ? (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <StagesPanel
              workflow={workflow}
              work={workStatus(application, workflow)}
              application={application}
              canReopen={may.work}
              onComplete={(stage) => setDialog({ type: 'complete_stage', stage })}
              onReopen={(stage) => setDialog({ type: 'reopen_stage', stage })}
            />
            <AppraisalsPanel appraisals={appraisals} />
            {conditionsOf(application).length ? (
              <ConditionsPanel application={application} canTick={may.work || may.disburse} onSet={(condition, met, note) => post(`/conditions/${condition.id}`, { met, note }, met ? 'Condition met' : 'Condition reopened')} />
            ) : null}
            <LmsPanel
              application={application}
              lmsConfigured={lmsConfigured}
              canAct={may.lms}
              onSend={() => post('/lms/send', {}, 'Sent to the LMS').catch((error) => notify(error.message, { tone: 'error' }))}
              onReconcile={() => setDialog({ type: 'reconcile' })}
            />
            {!workflow?.steps?.length && !appraisals.length && !(lmsConfigured || application.lmsSyncStatus !== 'not_configured') ? (
              <p className="text-sm text-muted-foreground">No stages, decisions or LMS hand-off for this case yet.</p>
            ) : null}
          </div>
        ) : null}

      </div>

      <CaseDialogs
        product={product}
        collateralCatalog={collateralCatalog}
        dialog={dialog}
        onClose={() => setDialog(null)}
        application={application}
        lastRecommendation={lastRecommendation}
        assignees={assignees}
        user={user}
        act={act}
        post={post}
        requireSignature={offersRequireSignature}
        verification={{
          workflow,
          editable: checklistEditable,
          onToggle: (check, done) => act('check', { check, done }, done ? 'Check recorded' : 'Check reopened').catch((error) => notify(error.message, { tone: 'error' })),
        }}
      />
    </div>
  )
}

/** Accepting the offer in person: the customer reads back the code emailed to them. */
function AcceptOfferDialog({ open, onOpenChange, application, user, act, requireSignature }) {
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [signature, setSignature] = useState(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setSent(false)
      setError('')
      setName(application.applicantName || '')
      setSignature(null)
    }
  }, [open, application.applicantName])

  const sendCode = async () => {
    setError('')
    const response = await fetch('/api/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: application.applicantEmail, purpose: 'offer', agentName: user.name }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) setError(body.message || 'The code could not be sent.')
    else setSent(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await act('record_acceptance', requireSignature ? { code, signature: { name: name.trim(), ...signature } } : { code }, requireSignature ? 'Offer signed and accepted' : 'Offer accepted')
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requireSignature ? 'The customer signs and accepts' : 'Record the customer’s acceptance'}</DialogTitle>
          <DialogDescription>
            {money(application.approvedAmount ?? application.amount)} over {application.approvedTenure ?? application.tenure} months, {money(application.monthlyInstalment)} {perPeriod(application.terms?.frequency)}, {money(application.totalRepayable)} in total.{application.terms?.summary ? ` Paid out after charges: ${money(application.terms.summary.netDisbursed)}.` : ''}
            {requireSignature
              ? ' Go through the offer letter with the customer (Documents tab). They sign below on this device, then read back the code we email them.'
              : ' We email the customer a code; when they read it to you, enter it here.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {requireSignature ? (
            <div className="space-y-3 rounded-lg border p-3">
              <label htmlFor="accept-signer" className="text-sm font-medium text-foreground">
                The customer’s full name
              </label>
              <Input id="accept-signer" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
              <SignaturePad name={name} onChange={setSignature} />
            </div>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={sendCode}>
            {sent ? 'Send another code' : `Email the code to ${application.applicantEmail}`}
          </Button>
          <Input
            aria-label="Customer’s code"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-44 text-center font-semibold tracking-[0.3em]"
          />
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={code.length < 6 || busy || (requireSignature && (!signature || name.trim().length < 3))}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {requireSignature ? 'Sign and accept' : 'Record acceptance'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Brings a panel on the assessment tab into view (after the render that opens it). */
const scrollToPanel = (id) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

const uploadStaffDocument = async (id, form, setState, notify) => {
  const response = await fetch(`/api/v1/applications/${id}/documents`, { method: 'POST', body: form, credentials: 'same-origin' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || 'The upload failed.')
  setState({ status: 'ready', ...body })
  notify('Document added')
}

/**
 * The case's tabs, and the one it opens on: Loan terms once the case has terms or is at the
 * terms stage; Underwriting at, or past, the underwriting stage; the older Collateral tab only
 * on workflow versions without those stages. The stage's own work opens by default (a legal
 * officer, who only verifies, starts on the collateral).
 */
const caseTabs = ({ application, documents, workflow, user }) => {
  const stages = workflow?.workStages || {}
  // Pre-screening's figures get their own tab while the case is at that stage, like Loan terms and Underwriting.
  const atPrescreening = application.status === 'submitted'
  const oldFlow = Boolean(workflow?.state?.appraisal) || (!stages.terms && !stages.underwriting)
  const verifications = application.verifications || {}
  const underwritingDone =
    Boolean(application.terms) || Object.keys(application.valuations || {}).length > 0 || Object.keys(verifications.legal || {}).length > 0 || Object.keys(verifications.documents || {}).length > 0
  const showTerms = Boolean(application.terms) || stages.terms === 'current'
  const showUnderwriting = stages.underwriting === 'current' || (stages.underwriting === 'passed' && underwritingDone)
  const tabs = [
    ['analysis', 'AI Analysis'],
    ...(atPrescreening ? [['prescreening', 'Pre-screening']] : []),
    ['details', 'Details'],
    ['documents', `Documents (${documents.length})`],
    ...(showTerms ? [['terms', 'Loan terms']] : []),
    ...(showUnderwriting ? [['underwriting', 'Underwriting']] : []),
    ...(oldFlow ? [['legal', 'Collateral']] : []),
    ['workflow', 'Workflow'],
  ]
  const verifierOnly = hasPermission(user, 'legal.verify') && !hasPermission(user, 'cases.work')
  const initial =
    stages.terms === 'current' && showTerms && !verifierOnly
      ? 'terms'
      : stages.underwriting === 'current'
        ? 'underwriting'
        : verifierOnly
          ? showUnderwriting
            ? 'underwriting'
            : oldFlow
              ? 'legal'
              : 'analysis'
          : 'analysis'
  return { tabs, initial }
}

/** Where the Loan terms and Underwriting stages stand, for the Stages panel: [{ key, label, state, detail }]. */
const workStatus = (application, workflow) => {
  const stages = workflow?.workStages || {}
  const lines = []
  if (stages.terms) {
    const saved = application.terms
    const current = stages.terms === 'current'
    lines.push({
      key: 'terms',
      label: 'Loan terms',
      state: current ? (workflow.state.termsHold ? 'current' : 'ready') : stages.terms === 'passed' ? 'done' : 'ahead',
      detail: saved ? `Saved: ${money(saved.amount)} over ${saved.tenure} months, ${saved.annualRate}% a year.` : current ? 'Not saved yet. The stage moves on once they are.' : stages.terms === 'ahead' ? 'Not reached yet.' : 'None saved.',
    })
  }
  if (stages.underwriting) {
    const status = workflow.state.underwriting
    const current = stages.underwriting === 'current'
    lines.push({
      key: 'underwriting',
      label: 'Underwriting',
      state: current ? (status?.complete ? 'ready' : 'current') : stages.underwriting === 'passed' ? 'done' : 'ahead',
      detail: current ? (status?.complete ? 'Complete.' : `Waiting for ${status?.hold || 'the checks'}.`) : stages.underwriting === 'passed' ? 'Done.' : 'Not reached yet.',
    })
  }
  return lines
}

function BackLink() {
  return (
    <Link to="/admin/applications" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Applications
    </Link>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

/**
 * Buttons for the current state's actions (the workflow, src/config/workflow.js), grouped
 * the way people think of them: approve, decline and send back in one state are one
 * "Decide"; one person's decision is a "Recommend"; a stage's own step is done from the
 * Stages panel. Actions this person can't take say why, instead of disappearing.
 */
// An action still named after where it goes ("Send to Underwriting", the editor's old default)
// is shown as what the person does: recommend it on.
const buttonLabel = (action) => (/^send to\b/i.test(action.label || '') ? 'Recommend' : action.label)

export const groupActions = (input) => {
  const actions = input.map((action) => ({ ...action, label: buttonLabel(action) }))
  const decide = actions.filter((action) => ['approve', 'reject', 'return'].includes(action.kind) && !action.singleStep)
  const hasDecision = decide.some((action) => action.kind === 'approve')
  const single = actions.filter((action) => action.singleStep)
  const groups = []
  if (single.length) groups.push({ key: 'single', type: 'recommend', label: 'Recommend', actions: single, single: true })
  for (const action of actions) {
    if (action.singleStep || (hasDecision && decide.includes(action))) continue
    if (action.kind === 'recommend') groups.push({ key: action.id, type: 'recommend', label: action.label, actions: [action] })
    else if (action.kind === 'pay_out') groups.push({ key: action.id, type: 'pay_out', label: action.label, actions: [action] })
    else if (action.kind === 'move') groups.push({ key: action.id, type: action.claim ? 'claim' : 'move', label: action.label, actions: [action] })
    else groups.push({ key: action.id, type: action.kind, label: action.label, actions: [action] })
  }
  if (hasDecision) groups.push({ key: 'decide', type: 'decide', label: 'Decide', actions: decide })
  return groups
}

/** A greyed-out button with why on hover (a disabled button shows no tooltip of its own) and for screen readers. */
function Held({ reason, children }) {
  return (
    <span title={reason || undefined} className="inline-flex cursor-not-allowed">
      {children}
      {reason ? <span className="sr-only">{reason}</span> : null}
    </span>
  )
}

function CaseActions({ application, workflow, readOnly, may, userId, canTake, hasEligibleOfficers, onOpen, onClaim, onTake, onTakeHere, onShowWorkflow }) {
  const [busy, setBusy] = useState(null)
  const notify = useToast()
  const run = (key, fn) => async () => {
    setBusy(key)
    try {
      await fn()
    } catch (error) {
      notify(error.message, { tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  const { status } = application
  const unassigned = !application.assignedOfficer
  const open = OPEN_STATUSES.includes(status)
  const withdrawable = WITHDRAWABLE_STATUSES.includes(status)
  const waiting = status === 'info_requested'
  const state = workflow?.state
  // A stage's step is marked done from the Stages panel; here it only says what's next.
  const stepHere = state?.trackProgress

  const { ownerMay } = caseOwnership(application, workflow, userId)
  // Never this person's to take here: left out, not greyed out.
  const groups = groupActions(
    (readOnly ? [] : workflow?.actions || []).filter((action) => !(stepHere && action.kind === 'move') && (ownerMay || action.fourEyes) && !action.roleBlocked)
  )

  // No sentences in the bar: what can't be done yet is greyed out, and says why on hover.
  const buttons = groups.map((group) => {
    const usable = group.actions.filter((action) => !action.blocked)
    // Part of a group held back (approving waits for the legal check while declining is open): said on hover.
    const heldBack = [...new Set(group.actions.filter((action) => action.blocked).map((action) => action.blocked))].join(' ')
    if (!usable.length) {
      return (
        <Held key={group.key} reason={heldBack}>
          <Button variant={group.type === 'reject' || group.type === 'pay_out' || group.type === 'return' ? 'outline' : 'default'} disabled>
            {group.label}
          </Button>
        </Held>
      )
    }
    const [first] = usable
    if (group.type === 'claim') {
      return (
        <Button key={group.key} onClick={run(group.key, () => onClaim(first))} disabled={Boolean(busy)}>
          {busy === group.key ? <Loader2 className="animate-spin" /> : null}
          {group.label}
        </Button>
      )
    }
    const dialogFor = { recommend: 'recommend', decide: 'decide', pay_out: 'disbursed', move: 'move', return: 'return', reject: 'reject' }
    return (
      <Button
        key={group.key}
        variant={group.type === 'reject' ? 'outline' : group.type === 'pay_out' || group.type === 'return' ? 'outline' : 'default'}
        title={heldBack || undefined}
        onClick={() => onOpen({ type: dialogFor[group.type], group, action: first })}
      >
        {group.type === 'pay_out' ? <CheckCircle2 /> : null}
        {group.label}
      </Button>
    )
  })

  const take = (key, onClick) =>
    canTake ? (
      <Button variant="outline" onClick={run(key, onClick)} disabled={Boolean(busy)}>
        {busy === key ? <Loader2 className="animate-spin" /> : <UserPlus />}
        Take the case
      </Button>
    ) : (
      <Held reason="This amount is outside your assignment range.">
        <Button variant="outline" disabled>
          <UserPlus />
          Take the case
        </Button>
      </Held>
    )

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {may.record && withdrawable && ownerMay ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'withdraw' })}>
          Withdraw
        </Button>
      ) : null}
      {!readOnly && state?.roles?.length && open && workflow.worksHere && !application.stateAssignee ? take('take-state', onTakeHere) : null}
      {!state?.roles?.length && may.work && open && unassigned ? take('take', onTake) : null}
      {/* Nobody to hand it to: no button. */}
      {may.assign && open && hasEligibleOfficers ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'assign' })}>
          {unassigned ? 'Assign' : 'Reassign'}
        </Button>
      ) : null}
      {may.work && ownerMay && state?.askApplicant && !waiting ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'request_info' })}>
          Ask the applicant
        </Button>
      ) : null}
      {may.work && ownerMay && waiting ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'cancel_request' })}>
          Cancel the request
        </Button>
      ) : null}
      {/* The step itself is marked done on the Workflow tab. */}
      {!readOnly && stepHere && ownerMay && !waiting ? (
        <Button variant="outline" onClick={onShowWorkflow}>
          Next: {state.stepName}
        </Button>
      ) : null}
      {may.record && state?.type === 'offer' ? (
        <Button variant="outline" onClick={() => onOpen({ type: 'accept' })}>
          Record acceptance
        </Button>
      ) : null}
      {buttons}
    </div>
  )
}

/** The recommend dialog's choices: both verdicts for a recommendation, or the decision actions a person may take. */
const recommendVerdicts = (dialog) => {
  if (dialog?.type !== 'recommend') return []
  const approve = { value: 'approve', label: 'Approve', tone: 'primary' }
  const decline = { value: 'decline', label: 'Decline', tone: 'destructive' }
  if (!dialog?.group?.single) return [approve, decline]
  const usable = dialog.group.actions.filter((action) => !action.blocked)
  return [...(usable.some((action) => action.kind === 'approve') ? [approve] : []), ...(usable.some((action) => action.kind === 'reject') ? [decline] : [])]
}

/** The decide dialog's choices: the approve, decline and send-back actions this person may take, labelled as the workflow names them. */
const decideVerdicts = (dialog) =>
  (dialog?.type === 'decide' ? dialog.group?.actions || [] : [])
    .filter((action) => !action.blocked)
    .map((action) => ({
      value: { approve: 'approve', reject: 'decline', return: 'return' }[action.kind],
      label: action.kind === 'return' ? action.label : { approve: 'Approve', reject: 'Decline' }[action.kind],
      tone: { approve: 'primary', reject: 'destructive' }[action.kind],
      actionId: action.id,
    }))

function CaseDialogs({ dialog, onClose, application, product, collateralCatalog, lastRecommendation, assignees, user, act, post, requireSignature, verification }) {
  const open = (type) => dialog?.type === type
  const common = (type) => ({ open: open(type), onOpenChange: (value) => !value && onClose() })

  // Verification is done where it's needed: in the dialog of the action that waits for it.
  // The checks an action needs are the server's: the state's own, plus the action's (for a
  // recommendation, only when it is to approve).
  const { workflow } = verification
  const actionChecks = (action) => workflow?.actions.find((entry) => entry.id === action?.id)?.checks || []
  const neededFor = (action, verdict) => [...new Set([...(workflow?.state.requiredChecks || []), ...(action?.kind === 'recommend' && verdict !== 'approve' ? [] : actionChecks(action))])]
  const outstanding = (keys) => {
    const missing = keys.filter((key) => !application.checks?.[key]?.done)
    const label = (key) => checklistOf({ checklist: workflow?.checklist }).find((check) => check.key === key)?.label.toLowerCase() || key
    return missing.length ? `Complete these checks first: ${missing.map(label).join(', ')}.` : null
  }
  const checklist = (required, only) => (
    <VerificationChecklist application={application} checklist={workflow?.checklist} required={required} only={only} editable={verification.editable} onToggle={verification.onToggle} showZra={!only} />
  )
  // The action a recommend or decide dialog would take for the verdict picked.
  const chosenAction = (values) => {
    if (dialog?.type === 'decide') return dialog.group?.actions.find((action) => action.id === decideVerdicts(dialog).find((option) => option.value === values.verdict)?.actionId)
    if (!dialog?.group?.single) return dialog?.action
    return dialog.group.actions.find((action) => (values.verdict === 'decline' ? action.kind === 'reject' : action.kind === 'approve'))
  }
  // Recommending or deciding asks only what can't be skipped: the checks still unticked, if any.
  const checksStillOpen = (values) => {
    const needed = neededFor(chosenAction(values), values.verdict)
    return needed.some((key) => !application.checks?.[key]?.done) ? checklist(needed, needed) : null
  }
  // Just why, then a button per outcome: the terms are the ones asked for (a recommendation) or recommended (a decision).
  const VERDICT_REASON = { name: 'rationale', label: 'Why', type: 'textarea', hint: 'Staff only. The applicant never sees this.' }
  // The outcome buttons, approving last (the filled one, on the right).
  const outcomeButtons = (options) => ({ name: 'verdict', options: [...options].sort((a, b) => (a.tone === 'primary') - (b.tone === 'primary')) })
  // The checks approving still needs, whichever button is then pressed.
  const approvalChecks = () => checksStillOpen({ verdict: 'approve' })
  // The terms the appraiser structured, read-only: the decision takes them as they are.
  const termsBlock = () => {
    const terms = application.terms
    if (!terms?.summary) return null
    const { summary } = terms
    const calculation = (CALCULATIONS[terms.calculation] || terms.calculation || '').toLowerCase()
    const frequency = (FREQUENCIES[terms.frequency]?.label || terms.frequency || '').toLowerCase()
    return (
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Terms from appraisal</p>
        <p>{money(terms.amount)} over {terms.tenure} months</p>
        <p>{terms.annualRate}% a year, {calculation}</p>
        <p>{money(summary.instalment)} {frequency} · {summary.periods} instalments</p>
        <p>Charges {money(summary.totalCharges)} · Paid out {money(summary.netDisbursed)}</p>
      </div>
    )
  }
  const decisionBefore = () => {
    const terms = termsBlock()
    const checks = approvalChecks()
    // Lending more than the assets cover is the approver's call: said, never held.
    const cover = lendingCover(application, collateralCatalog)
    if (!terms && !checks && !cover.short) return null
    return (
      <div className="space-y-4">
        {terms}
        {cover.short ? <CoverWarning cover={cover} /> : null}
        {checks}
      </div>
    )
  }
  const stageChecks = dialog?.stage ? [...new Set([...(dialog.stage.checks || []), ...actionChecks({ id: dialog.stage.moveActionId })])] : []
  return (
    <>
      <ActionDialog
        {...common('request_info')}
        title="Ask the applicant for something"
        description="They see this on their page and get an email. The case waits until they reply."
        fields={[
          {
            name: 'documents',
            label: 'Documents to send again (optional)',
            type: 'checkboxes',
            hint: 'Each one is checked by the AI when it arrives and replaces the earlier copy in the summary and the rules.',
            options: requestableSlots(product || application.loanType, application.data).map((entry) => ({ value: entry.slot, label: entry.label })),
          },
          { name: 'message', label: 'What do they need to send or explain?', type: 'textarea', rows: 4, hint: 'Optional when you pick documents above.' },
        ]}
        blocked={(values) => (values.documents?.length || (values.message || '').trim().length >= 3 ? null : 'Pick a document or say what you need.')}
        submitLabel="Send request"
        onSubmit={(values) => act('request_info', values, 'Request sent to the applicant')}
      />
      <ActionDialog
        {...common('complete_stage')}
        title={`Mark “${dialog?.stage?.label || ''}” as done`}
        description={dialog?.stage?.description || 'Recorded with your name and the time, on the case timeline.'}
        before={stageChecks.length ? () => checklist(stageChecks, stageChecks) : undefined}
        blocked={() => outstanding(stageChecks)}
        fields={[{ name: 'note', label: 'Note (optional)', type: 'textarea', rows: 3, optional: true, hint: 'For example: committee minutes reference, who you spoke to.' }]}
        submitLabel="Mark as done"
        onSubmit={(values) => act('transition', { actionId: dialog?.stage?.moveActionId, note: values.note }, `${dialog?.stage?.label} done`)}
      />
      <ActionDialog
        {...common('reopen_stage')}
        title={`Reopen “${dialog?.stage?.label || ''}”?`}
        description="It, and any later stage in the same part of the flow, will need doing again."
        fields={[{ name: 'reason', label: 'Why?', type: 'textarea', rows: 3 }]}
        submitLabel="Reopen"
        onSubmit={(values) => act('reopen_stage', { stage: dialog?.stage?.id, reason: values.reason }, 'Stage reopened')}
      />
      <ActionDialog
        {...common('recommend')}
        title={dialog?.group?.single ? 'Make the decision' : dialog?.group?.label && dialog.group.label !== 'Recommend' ? dialog.group.label : 'Recommend a decision'}
        description={dialog?.group?.single ? 'Your decision stands, within your approval limit.' : `A colleague reviews your recommendation and makes the final decision${dialog?.action?.toLabel ? ` (${dialog.action.toLabel})` : ''}.`}
        before={decisionBefore}
        blocked={(values) =>
          values.verdict === 'approve' && (dialog?.group?.single ? workflow?.state?.approvalHold : workflow?.state?.valuationHold)
            ? `${dialog?.group?.single ? 'Approval' : 'Recommending approval'} waits for ${dialog?.group?.single ? workflow.state.approvalHold : workflow.state.valuationHold}.`
            : outstanding(neededFor(chosenAction(values), values.verdict))
        }
        fields={[VERDICT_REASON]}
        outcomes={outcomeButtons(recommendVerdicts(dialog))}
        onSubmit={(values) => {
          const terms = { rationale: values.rationale }
          if (!dialog?.group?.single) return act('transition', { actionId: dialog?.action?.id, verdict: values.verdict, ...terms }, 'Recommendation recorded')
          const chosen = dialog.group.actions.find((action) => (values.verdict === 'decline' ? action.kind === 'reject' : action.kind === 'approve'))
          return act('transition', { actionId: chosen?.id, ...terms }, values.verdict === 'decline' ? 'Declined' : 'Approved')
        }}
      />
      <ActionDialog
        {...common('decide')}
        title="Make the decision"
        description={
          lastRecommendation
            ? `${lastRecommendation.officerName} recommended ${lastRecommendation.verdict === 'approve' ? `approving ${money(lastRecommendation.amount)} over ${lastRecommendation.tenure} months` : 'declining'}: “${lastRecommendation.rationale}”`
            : undefined
        }
        before={decisionBefore}
        blocked={(values) =>
          values.verdict === 'approve' && workflow?.state?.approvalHold ? `Approval waits for ${workflow.state.approvalHold}.` : outstanding(neededFor(chosenAction(values), values.verdict))
        }
        fields={[VERDICT_REASON]}
        outcomes={outcomeButtons(decideVerdicts(dialog))}
        onSubmit={(values) =>
          act(
            'transition',
            {
              actionId: decideVerdicts(dialog).find((option) => option.value === values.verdict)?.actionId,
              rationale: values.rationale,
            },
            { approve: 'Approved', decline: 'Declined', return: 'Sent back for more work' }[values.verdict]
          )
        }
      />
      <ActionDialog
        {...common('assign')}
        title="Assign the case"
        description={
          assignees?.stage
            ? `Only people who can act on “${assignees.stage}” for ${money(application.amount)} are listed, with the open cases each already has.`
            : undefined
        }
        initial={{
          officerId: (assignees?.people || []).find((person) => person.id !== application.assignedOfficer)?.id || assignees?.people?.[0]?.id || '',
        }}
        fields={[
          {
            name: 'officerId',
            label: 'Assign to',
            type: 'select',
            options: (assignees?.people || []).map((person) => ({
              value: person.id,
              label: `${person.name} · ${person.roleLabel}, ${person.openCases} open${person.id === application.assignedOfficer ? ' (has it now)' : ''}`,
            })),
          },
        ]}
        submitLabel="Assign"
        onSubmit={(values) => act('assign', values, 'Case assigned')}
      />
      <ActionDialog
        {...common('disbursed')}
        title="Mark as paid out"
        description="Record the payout when the LMS doesn’t report it back."
        fields={[{ name: 'reference', label: 'Payout or LMS reference (optional)' }]}
        submitLabel="Mark as paid out"
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, reference: values.reference }, 'Marked as paid out')}
      />
      <ActionDialog
        {...common('move')}
        title={dialog?.action?.label || ''}
        description={dialog?.action ? `The case moves to “${dialog.action.toLabel}”.` : undefined}
        fields={[{ name: 'note', label: dialog?.action?.requireNote ? 'Note' : 'Note (optional)', type: 'textarea', rows: 3, optional: !dialog?.action?.requireNote }]}
        submitLabel={dialog?.action?.label || 'Continue'}
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, note: values.note }, `Moved to ${dialog?.action?.toLabel}`)}
      />
      <ActionDialog
        {...common('return')}
        title={dialog?.action?.label || 'Send back'}
        description={dialog?.action ? `The case goes back to “${dialog.action.toLabel}”. Steps done since then need doing again.` : undefined}
        fields={[{ name: 'rationale', label: 'Why?', type: 'textarea', rows: 3 }]}
        submitLabel={dialog?.action?.label || 'Send back'}
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, rationale: values.rationale }, `Sent back to ${dialog?.action?.toLabel}`)}
      />
      <ActionDialog
        {...common('reject')}
        title={dialog?.action?.label || 'Reject'}
        description="The applicant is told it was not approved. They never see your reason."
        fields={[{ name: 'rationale', label: 'Why', type: 'textarea', hint: 'Staff only.' }]}
        submitLabel={dialog?.action?.label || 'Reject'}
        tone="destructive"
        onSubmit={(values) => act('transition', { actionId: dialog?.action?.id, rationale: values.rationale }, 'Declined')}
      />
      <ActionDialog
        {...common('cancel_request')}
        title="Cancel the request to the applicant?"
        description="The case carries on without their reply. They're told nothing more is needed for now."
        fields={[{ name: 'reason', label: 'Why (optional)', type: 'textarea', rows: 2, optional: true }]}
        submitLabel="Cancel the request"
        onSubmit={(values) => act('cancel_request', values, 'Request withdrawn')}
      />
      <ActionDialog
        {...common('withdraw')}
        title="Withdraw the application"
        description="Only at the customer’s request. They’re told it was withdrawn at their request."
        fields={[{ name: 'reason', label: 'What did the customer say?', type: 'textarea' }]}
        submitLabel="Withdraw"
        tone="destructive"
        onSubmit={(values) => act('withdraw', values, 'Withdrawn')}
      />
      <AcceptOfferDialog open={open('accept')} onOpenChange={(value) => !value && onClose()} application={application} user={user} act={act} requireSignature={requireSignature} />
      <ActionDialog
        {...common('reconcile')}
        title="Is it in the LMS?"
        description="The LMS didn’t confirm it received this application. Look it up there before doing anything else — sending again could create a duplicate loan."
        initial={{ found: 'yes' }}
        fields={[
          {
            name: 'found',
            label: 'What did you find?',
            type: 'choice',
            options: [
              { value: 'yes', label: 'It’s there', hint: 'Record its reference' },
              { value: 'no', label: 'It isn’t there', hint: 'Allow sending again' },
            ],
          },
          { name: 'reference', label: 'LMS loan reference', showIf: (values) => values.found === 'yes' },
        ]}
        submitLabel="Save"
        onSubmit={(values) => post('/lms/reconcile', { found: values.found === 'yes', reference: values.reference }, 'LMS status updated')}
      />
    </>
  )
}

/**
 * The applicant's answers, then `cards` (more half-width panels) and `wide` (one
 * full-width panel). Cards in a row share its height; an odd last card spans the row.
 */
function Details({ application, collateralCatalog, cards = [], wide = null }) {
  const sections = useMemo(() => sectionsFor(application, collateralCatalog).filter((section) => section.rows.some(([, value]) => value)), [application, collateralCatalog])
  const all = [
    ...sections.map((section) => (
      <Panel key={section.title} title={section.title}>
        <dl className="space-y-2.5">
          {section.rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-foreground [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
        </dl>
      </Panel>
    )),
    ...cards,
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {all.map((card, index) => (
        <div key={card.key} className={cn('[&>section]:h-full', all.length % 2 === 1 && index === all.length - 1 && 'lg:col-span-2')}>
          {card}
        </div>
      ))}
      {wide ? <div className="lg:col-span-2">{wide}</div> : null}
    </div>
  )
}

/** Document list beside a viewer, with the AI findings for the one on screen. */
function Documents({ application, product, documents, selectedId, onSelect: setSelectedId, onUpload }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  // Which document the next upload is: a known one replaces the earlier copy and is checked by the AI.
  const [slot, setSlot] = useState('')
  const input = useRef(null)
  const selected = documents.find((document) => document.id === selectedId) || documents[0]
  const src = selected ? `/api/v1/applications/${application.id}/documents/${selected.id}` : null
  const isImage = selected?.contentType?.startsWith('image/')

  const upload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('label', file.name)
      if (slot) form.append('slot', slot)
      form.append('file', file)
      await onUpload(form)
      setSlot('')
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-2">
        <ul className="space-y-1">
          {documents.map((document) => {
            const flagged = !document.supersededBy && document.aiAnalysis && (document.aiAnalysis.matchesExpectedType === false || document.aiAnalysis.authenticityConcerns?.length || document.aiAnalysis.issues?.length)
            return (
              <li key={document.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(document.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected?.id === document.id ? 'bg-card shadow-sm ring-1 ring-border' : 'hover:bg-card/60',
                    document.supersededBy && 'opacity-60'
                  )}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{document.label}</span>
                    <span className="block text-xs text-muted-foreground">{document.source === 'applicant' ? 'From the application' : document.source === 'info_response' ? 'Sent after a request' : document.source === 'signed_copy' ? 'Signed copy from the applicant' : document.source === 'system' ? (document.meta?.signed ? 'Signed by the customer' : `Generated, template version ${document.meta?.templateVersion ?? '?'}`) : 'Added by staff'}</span>
                    {document.supersededBy ? <span className="block text-xs text-muted-foreground">Replaced by a newer copy</span> : null}
                  </span>
                  {flagged ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Has findings" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
        {onUpload ? (
          <>
            <Select value={slot} onChange={(event) => setSlot(event.target.value)} aria-label="What the document is" className="h-9 text-sm">
              <option value="">Something else</option>
              {requestableSlots(product || application.loanType, application.data).map((entry) => (
                <option key={entry.slot} value={entry.slot}>
                  New copy of: {entry.label}
                </option>
              ))}
            </Select>
            <input ref={input} type="file" accept=".pdf,image/*" className="sr-only" onChange={upload} aria-label="Add a document" />
            <Button variant="outline" size="sm" className="w-full" onClick={() => input.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <Paperclip />}
              {slot ? 'Upload and check' : 'Add a document'}
            </Button>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </>
        ) : null}
      </div>

      {selected ? (
        <div className="min-w-0 space-y-3">
          {selected.supersededBy ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              A newer copy replaced this one. The rules, the AI review and the summary use the newer copy.{' '}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setSelectedId(selected.supersededBy)}>
                Open it
              </button>
            </p>
          ) : null}
          <DocumentFindings application={application} document={selected} />
          <div className="overflow-hidden rounded-xl border bg-muted/40">
            <div className="flex items-center justify-between border-b bg-card px-4 py-2 text-sm">
              <span className="truncate font-medium text-foreground">{selected.filename}</span>
              <a href={src} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
                Open
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </div>
            {isImage ? (
              <img src={src} alt={selected.label} className="mx-auto max-h-[70vh] object-contain p-4" />
            ) : (
              <iframe key={selected.id} src={src} title={selected.label} className="h-[70vh] w-full border-0 bg-white" />
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No documents.</p>
      )}
    </div>
  )
}

function DocumentFindings({ application, document }) {
  const analysis = document.aiAnalysis
  if (!analysis) {
    return <p className="text-xs text-muted-foreground">No automatic check for this document.</p>
  }
  const mismatches = findFormMismatches(analysis, expectedForSlot(application, document.slot))
  const extracted = Object.entries(analysis.extracted || {}).filter(([, value]) => value)
  const problems = [
    ...(analysis.matchesExpectedType === false ? [`Looks like a ${analysis.detectedType || 'different document'}, not the one asked for.`] : []),
    ...(analysis.issues || []).map((issue) => issue.message),
    ...mismatches,
  ]
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
        Automatic check{analysis.sample ? ' (sample data)' : ''}: {analysis.detectedType}, {analysis.legibility === 'clear' ? 'clear' : analysis.legibility === 'partly_legible' ? 'partly legible' : 'hard to read'}
      </p>
      {analysis.authenticityConcerns?.length ? (
        <div className="flex gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Possible tampering</p>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {analysis.authenticityConcerns.map((concern) => (
                <li key={concern}>{concern}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {problems.length ? (
        <ul className="space-y-1">
          {problems.map((problem) => (
            <li key={problem} className="flex gap-2 text-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              {problem}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Matches what was asked for and agrees with the form.
        </p>
      )}
      {extracted.length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-xs sm:grid-cols-3">
          {extracted.map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}


/**
 * The ID and contact check at submission (api/_lib/identityFlags.js): earlier applications
 * with this ID and other contact details, or these details and another ID. A warning only.
 */
function IdentityFlags({ flags }) {
  return (
    <section aria-labelledby="identity-flags-title" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="space-y-1">
        <h2 id="identity-flags-title" className="font-medium text-foreground">
          Check this applicant is who they say they are
        </h2>
        <ul className="space-y-0.5 text-muted-foreground">
          {flags.map((flag) => (
            <li key={`${flag.kind}-${flag.applicationId}`}>
              {flag.kind === 'id_other_contact'
                ? `This ID was used on `
                : `This ${flag.channel === 'email' ? 'email address' : 'phone number'} was used on `}
              <Link to={`/admin/applications/${flag.applicationId}`} className="font-medium text-foreground underline underline-offset-2">
                {flag.reference}
              </Link>
              {flag.kind === 'id_other_contact'
                ? ` with a different ${flag.channel === 'email' ? 'email' : 'phone'}, ${flag.contact}`
                : ` with a different ID, ${flag.id}`}
              {flag.verified ? ' (confirmed with a code there)' : ''}.
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">It may be the same person with new details. Check their ID document and live photo, and call them on a number you trust.</p>
      </div>
    </section>
  )
}
