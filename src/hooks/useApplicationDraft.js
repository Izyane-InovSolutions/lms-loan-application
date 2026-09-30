import { useCallback, useEffect, useRef, useState } from 'react'
import { extractFiles } from '../utils/fileTree'
import { saveLocalDraft, loadLocalDraft, clearLocalDraft } from '../utils/localDraftStore'
import {
  createDraft,
  updateDraft,
  deleteDraft,
  uploadDraftDocument,
  extractDraftErrorMessage,
} from '../services/draftApi'
import { describeRequestError, isInvalidTokenError } from '../lib/requestError'

const LOCAL_SAVE_DEBOUNCE_MS = 800
const REMOTE_SAVE_DEBOUNCE_MS = 5000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RETRY_DELAYS_MS = [1000, 3000]

// No status at all means the request never got an answer (offline, DNS, timeout) —
// the transient case worth repeating. A 4xx is a verdict on this specific request
// (file too large, bad token, no draft) and will fail identically however often it
// is sent, so repeating it just triples the noise and delays the error the applicant
// needs to see.
const isRetryable = (error) => {
  const status = error?.response?.status
  return status === undefined || status >= 500
}

// Upstash is reached over HTTP, so a cold start, rate limit or dropped connection
// fails the whole write rather than queueing it. Retrying twice turns the common
// transient case back into a successful sync instead of a missing server copy.
const withRetry = async (operation) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}

const getEmail = (loanType, personalData, businessData) =>
  loanType === 'personal'
    ? personalData?.personalInfo?.email?.trim()
    : businessData?.directorInfo?.applicantEmail?.trim()

const fileSignature = (file) => `${file.name}:${file.size}:${file.lastModified}`

// Orchestrates the application draft: an instant local cache (localStorage + IndexedDB,
// works offline, no email needed) plus a debounced background sync to the mini-backend
// once an email is available (enables resuming from a different device via OTP).
export function useApplicationDraft({
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
  // Whether the applicant agreed on the first step that staff may see and follow up this
  // draft (CONSENT_NOTICES.draft_contact). Saved with the draft; restored on resume.
  contactConsent = false,
  setContactConsent = () => {},
  // An agent filling it in with the customer: the server credits the draft to them.
  assisted = false,
  // The agent's link the applicant came through, so the draft shows in their pipeline.
  referralCode = null,
  skipLocalCheck = false,
}) {
  const [localDraftSummary, setLocalDraftSummary] = useState(null)
  const [draftToken, setDraftToken] = useState(null)
  // Kept apart from remoteSyncError on purpose: a failed attachment upload leaves the
  // draft itself perfectly resumable, so warning that the whole application is
  // unreachable would be false. Only the documents are missing.
  const [remoteSyncError, setRemoteSyncError] = useState(null)
  const [documentSyncError, setDocumentSyncError] = useState(null)
  const uploadedSignaturesRef = useRef(new Map())
  // Uploads still in flight, by draft path, so submit can wait for them.
  const inflightUploadsRef = useRef(new Map())
  // Set when the server no longer recognises draftToken; the next render re-saves the
  // draft to obtain a new one (see the recovery effect below).
  const tokenRecoveryRef = useRef(false)
  const localSaveTimer = useRef(null)
  const remoteSaveTimer = useRef(null)
  const checkedLocalRef = useRef(false)

  useEffect(() => {
    if (checkedLocalRef.current || skipLocalCheck) {
      checkedLocalRef.current = true
      return
    }
    checkedLocalRef.current = true
    loadLocalDraft().then((draft) => {
      if (draft && draft.currentStep > 0) {
        if (draft.draftToken) setDraftToken(draft.draftToken)
        setLocalDraftSummary(draft)
      }
    })
  }, [skipLocalCheck])

  const resumeLocalDraft = useCallback(() => {
    if (!localDraftSummary) return
    setSelectedLoanType(localDraftSummary.loanType)
    setCurrentStep(localDraftSummary.currentStep)
    setPersonalData(localDraftSummary.personalData)
    setBusinessData(localDraftSummary.businessData)
    setLoanData(localDraftSummary.loanData)
    setContactConsent(Boolean(localDraftSummary.contactConsent))
    setLocalDraftSummary(null)
  }, [localDraftSummary, setSelectedLoanType, setCurrentStep, setPersonalData, setBusinessData, setLoanData, setContactConsent])

  const startFresh = useCallback(() => {
    setLocalDraftSummary(null)
    setDraftToken(null)
    setRemoteSyncError(null)
    setDocumentSyncError(null)
    clearLocalDraft()
  }, [])

  // Used by the OTP-verified cross-device resume path — intent is already explicit,
  // so this hydrates immediately with no "resume vs start fresh" prompt.
  const hydrateFrom = useCallback(
    (draft) => {
      setDraftToken(draft.draftToken || null)
      setSelectedLoanType(draft.loanType)
      setCurrentStep(draft.currentStep || 0)
      setPersonalData(draft.personalData)
      setBusinessData(draft.businessData)
      setLoanData(draft.loanData)
      // The server keeps { at, version }; the local cache a plain flag.
      setContactConsent(Boolean(draft.contactConsent))
      setLocalDraftSummary(null)
    },
    [setSelectedLoanType, setCurrentStep, setPersonalData, setBusinessData, setLoanData, setContactConsent]
  )

  useEffect(() => {
    clearTimeout(localSaveTimer.current)
    localSaveTimer.current = setTimeout(() => {
      saveLocalDraft({ loanType: selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent })
    }, LOCAL_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(localSaveTimer.current)
  }, [selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent])

  const syncEmail = getEmail(selectedLoanType, personalData, businessData)
  const canSyncRemotely = Boolean(syncEmail) && EMAIL_PATTERN.test(syncEmail || '')

  /**
   * Pushes the draft to the server immediately, cancelling any pending debounce.
   *
   * Exposed so explicit checkpoints — leaving via "Save & exit", finishing a step —
   * can guarantee a server-side copy exists. Relying on the debounce alone meant a
   * draft that was only ever edited within the last few seconds was cancelled by the
   * effect cleanup on unmount, so nothing was ever stored and cross-device resume
   * reported no application found.
   */
  const flushRemoteDraft = useCallback(async () => {
    if (!canSyncRemotely) return null
    clearTimeout(remoteSaveTimer.current)

    // File objects have no enumerable properties, so JSON.stringify would silently
    // collapse each attached document to `{}` — sanitize to the same __draftFile__
    // placeholders the local cache uses, so hydrateDraftFiles can re-attach them on resume.
    const payload = {
      loanType: selectedLoanType,
      currentStep,
      personalData: extractFiles(personalData, 'personal').sanitized,
      businessData: extractFiles(businessData, 'business').sanitized,
      loanData,
      contactConsent: Boolean(contactConsent),
      ...(assisted ? { assisted: true } : {}),
      ...(referralCode ? { referralCode } : {}),
    }

    try {
      const token = await withRetry(async () => {
        if (draftToken) {
          try {
            await updateDraft(draftToken, payload)
            return draftToken
          } catch (error) {
            // The server has forgotten this token (expired, or a store that lost it), or
            // the draft behind it is gone. POST /draft merges into the record stored under
            // the email, so creating again keeps what was already saved and hands back a
            // token that works.
            if (!isInvalidTokenError(error) && error?.response?.status !== 404) throw error
          }
        }
        const result = await createDraft({ email: syncEmail, ...payload })
        return result.draftToken
      })
      if (token !== draftToken) {
        // Documents sent under the old token may never have been stored, and the
        // analysis hook re-checks on a token change, so re-send every attachment.
        uploadedSignaturesRef.current.clear()
        setDraftToken(token)
      }
      tokenRecoveryRef.current = false
      setRemoteSyncError(null)
      return token
    } catch (error) {
      // Not best-effort: otp/verify.js resolves a cross-device resume from the server
      // copy alone, so a write that never lands is reported to the applicant as "no
      // in-progress application found" even though their own device still shows it.
      // Swallowing this silently is what made that look like Redis dropping records.
      console.error(`Draft sync failed: ${describeRequestError(error)}`)
      setRemoteSyncError(extractDraftErrorMessage(error))
      return null
    }
  }, [canSyncRemotely, syncEmail, selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent, assisted, referralCode])

  useEffect(() => {
    if (!canSyncRemotely) return undefined
    clearTimeout(remoteSaveTimer.current)
    remoteSaveTimer.current = setTimeout(flushRemoteDraft, REMOTE_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(remoteSaveTimer.current)
  }, [canSyncRemotely, flushRemoteDraft])

  /**
   * Called when any request carrying draftToken gets a 401 — a document upload, an AI
   * check or the prescreen. Without this the browser kept sending a token the server
   * had forgotten, and every upload and check failed until the page was reloaded.
   */
  const invalidateDraftToken = useCallback(() => {
    tokenRecoveryRef.current = true
    setDraftToken(null)
  }, [])

  // Re-save straight away rather than after the debounce, so a stale token never holds
  // up uploads for five seconds. Runs once the null token has reached flushRemoteDraft.
  // flushRemoteDraft changes identity on every keystroke, so without the in-flight guard
  // typing during recovery would mint a fresh token per character.
  const recoveryInFlightRef = useRef(false)
  useEffect(() => {
    if (!tokenRecoveryRef.current || draftToken || !canSyncRemotely || recoveryInFlightRef.current) return
    recoveryInFlightRef.current = true
    flushRemoteDraft().finally(() => {
      recoveryInFlightRef.current = false
    })
  }, [draftToken, canSyncRemotely, flushRemoteDraft])

  useEffect(() => {
    if (!draftToken) return
    const scope = selectedLoanType === 'personal' ? 'personal' : 'business'
    const activeData = selectedLoanType === 'personal' ? personalData : businessData
    const { files } = extractFiles(activeData, scope)

    files.forEach((file, path) => {
      // Existing LMS documents are already stored remotely. They remain available
      // for final submission but must not be re-uploaded as draft attachments.
      if (file.__source === 'lms') return
      const signature = fileSignature(file)
      if (uploadedSignaturesRef.current.get(path) === signature) return
      uploadedSignaturesRef.current.set(path, signature)
      const upload = withRetry(() => uploadDraftDocument(draftToken, path, file))
      inflightUploadsRef.current.set(path, upload)
      upload
        .then(() => setDocumentSyncError(null))
        .finally(() => {
          if (inflightUploadsRef.current.get(path) === upload) inflightUploadsRef.current.delete(path)
        })
        .catch((error) => {
          uploadedSignaturesRef.current.delete(path)
          if (isInvalidTokenError(error)) {
            // Re-sent automatically once the draft has a new token.
            invalidateDraftToken()
            return
          }
          console.error(`Draft document upload failed (${path}): ${describeRequestError(error)}`)
          setDocumentSyncError(extractDraftErrorMessage(error))
        })
    })
  }, [draftToken, selectedLoanType, personalData, businessData, invalidateDraftToken])

  /**
   * Before submitting: makes sure every attached file is in draft storage under `token`,
   * waiting for uploads in flight and sending any that never went (or failed). Throws the
   * first upload error, so the applicant sees why submitting cannot go ahead yet.
   */
  const ensureDocumentsUploaded = useCallback(
    async (token) => {
      const scope = selectedLoanType === 'personal' ? 'personal' : 'business'
      const activeData = selectedLoanType === 'personal' ? personalData : businessData
      const { files } = extractFiles(activeData, scope)
      const pending = []
      files.forEach((file, path) => {
        if (file.__source === 'lms') return
        const signature = fileSignature(file)
        const inflight = inflightUploadsRef.current.get(path)
        if (uploadedSignaturesRef.current.get(path) === signature && token === draftToken) {
          if (inflight) pending.push(inflight)
          return
        }
        uploadedSignaturesRef.current.set(path, signature)
        pending.push(
          withRetry(() => uploadDraftDocument(token, path, file)).catch((error) => {
            uploadedSignaturesRef.current.delete(path)
            throw error
          })
        )
      })
      await Promise.all(pending)
    },
    [selectedLoanType, personalData, businessData, draftToken]
  )

  // Writes the local cache immediately instead of waiting out the debounce.
  // Used by "Save & exit" so the label is literally true — without this, keystrokes
  // from the last 800ms would be lost on the way out.
  const flushLocalDraft = useCallback(
    () =>
      saveLocalDraft({
        loanType: selectedLoanType,
        currentStep,
        personalData,
        businessData,
        loanData,
        draftToken,
        contactConsent,
      }),
    [selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent]
  )

  // `remote: false` after a successful submit: the server has already removed the draft.
  const clearDraft = useCallback(async ({ remote = true } = {}) => {
    const token = remote ? draftToken : null
    setDraftToken(null)
    setRemoteSyncError(null)
    setDocumentSyncError(null)
    uploadedSignaturesRef.current.clear()
    await clearLocalDraft()
    if (token) {
      deleteDraft(token).catch(() => {})
    }
  }, [draftToken])

  return {
    localDraftSummary,
    resumeLocalDraft,
    startFresh,
    hydrateFrom,
    clearDraft,
    invalidateDraftToken,
    ensureDocumentsUploaded,
    flushLocalDraft,
    flushRemoteDraft,
    canSyncRemotely,
    remoteSyncError,
    documentSyncError,
    // Also authorises the AI document checks and prescreen (api/ai/*).
    draftToken,
  }
}
