import { useCallback, useEffect, useRef, useState } from 'react'
import { extractFiles } from '../utils/fileTree'
import { saveLocalDraft, loadLocalDraft, clearLocalDraft } from '../utils/localDraftStore'
import {
  createDraft,
  updateDraft,
  deleteDraft,
  uploadDraftDocument,
  extractDraftErrorMessage,
  draftConflictCode,
} from '../services/draftApi'
import { describeRequestError, isInvalidTokenError } from '../lib/requestError'

const LOCAL_SAVE_DEBOUNCE_MS = 800
const REMOTE_SAVE_DEBOUNCE_MS = 5000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RETRY_DELAYS_MS = [1000, 3000]
const UPLOAD_BACKOFF_BASE_MS = 30 * 1000
const UPLOAD_BACKOFF_MAX_MS = 5 * 60 * 1000

export const DRAFT_EXISTS_MESSAGE =
  'An application is already in progress for this email address. Resume it with the code we email you, or use a different email address.'
const EMAIL_IN_USE_FALLBACK = 'This email address is already used by another application in progress.'

// No status at all means the request never got an answer (offline, DNS, timeout) —
// the transient case worth repeating. A 4xx is a verdict on this specific request
// (file too large, bad token, no draft) and will fail identically however often it
// is sent, so repeating it just triples the noise and delays the error the applicant
// needs to see.
const isRetryable = (error) => {
  const status = error?.response?.status
  return status === undefined || status >= 500
}

// Same verdict for a document, minus the statuses that mean "not now" rather than "no".
// 401 is handled before this is asked (the token is recovered and the file re-sent).
const isPermanentUploadFailure = (error) => {
  const status = error?.response?.status
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
}

/** How long to wait before re-sending a document after its `attempts`-th transient failure. */
export const uploadRetryDelay = (attempts) =>
  Math.min(UPLOAD_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), UPLOAD_BACKOFF_MAX_MS)

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

/**
 * Runs `run` one call at a time. A call made while one is in flight gets a single
 * trailing run, shared by every caller that asked in the meantime and started only once
 * the current one settles — so it reads the newest state, and a caller awaiting it gets
 * a result that includes what they had when they asked.
 *
 * Draft saves need this: the step checkpoint, the debounce and Submit could all overlap,
 * a retried older payload could land after a newer one, and two saves without a token
 * would each POST and mint a token of their own.
 */
export function createSerialRunner(run) {
  let inflight = null
  let queued = null
  const start = () => {
    const current = new Promise((resolve) => resolve(run())).finally(() => {
      if (inflight === current) inflight = null
    })
    inflight = current
    return current
  }
  return () => {
    // Checked first: between the running call settling and the queued one starting,
    // `inflight` is already clear, and starting a third here would run two at once.
    if (queued) return queued
    if (!inflight) return start()
    queued = inflight
      .catch(() => {})
      .then(() => {
        queued = null
        return start()
      })
    return queued
  }
}

const getEmail = (loanType, personalData, businessData) =>
  loanType === 'personal'
    ? personalData?.personalInfo?.email?.trim()
    : businessData?.directorInfo?.applicantEmail?.trim()

const normalizeEmail = (email) => (email || '').trim().toLowerCase()

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
  // False on a staff machine (assisted mode): the customer's answers and documents are
  // kept on the server only, never in this browser.
  keepLocalCopy = true,
  skipLocalCheck = false,
}) {
  const [localDraftSummary, setLocalDraftSummary] = useState(null)
  const [draftToken, setDraftTokenState] = useState(null)
  // Mirrors draftToken for the save queue: a save queued behind the one that minted a
  // token runs before React re-renders, and must PUT with that token, not POST again.
  const draftTokenRef = useRef(null)
  const setDraftToken = useCallback((token) => {
    draftTokenRef.current = token
    setDraftTokenState(token)
  }, [])
  // Kept apart from remoteSyncError on purpose: a failed attachment upload leaves the
  // draft itself perfectly resumable, so warning that the whole application is
  // unreachable would be false. Only the documents are missing.
  const [remoteSyncError, setRemoteSyncError] = useState(null)
  const [documentSyncError, setDocumentSyncError] = useState(null)
  // A 409 from /api/draft ({ code, email, message }). It holds for that email only: the
  // server will answer the same until the applicant changes the address, so saving
  // stops until then instead of asking again every few seconds.
  const [syncConflict, setSyncConflictState] = useState(null)
  const syncConflictRef = useRef(null)
  const setSyncConflict = useCallback((conflict) => {
    syncConflictRef.current = conflict
    setSyncConflictState(conflict)
  }, [])
  const uploadedSignaturesRef = useRef(new Map())
  // Documents the server refused, by draft path: { signature, permanent, attempts,
  // retryAt, error }. Without it the upload effect, which re-runs on every keystroke,
  // re-sent a file that could only ever fail again.
  const failedUploadsRef = useRef(new Map())
  // Bumped when a transient upload failure's backoff runs out, to re-run the upload effect.
  const [uploadRetryTick, setUploadRetryTick] = useState(0)
  // Uploads still in flight, by draft path, so submit can wait for them.
  const inflightUploadsRef = useRef(new Map())
  // Set when the server no longer recognises draftToken; the next render re-saves the
  // draft to obtain a new one (see the recovery effect below).
  const tokenRecoveryRef = useRef(false)
  // Set by clearDraft once the application is submitted. The answers stay in state
  // behind the success dialog, and without this every autosave wrote them straight back:
  // to this browser after 800ms, and to the server as a brand-new draft after 5s.
  const autosavePausedRef = useRef(false)
  const localSaveTimer = useRef(null)
  const remoteSaveTimer = useRef(null)
  const checkedLocalRef = useRef(false)
  // While the "resume or start fresh?" prompt is open nothing is saved: the form is still
  // blank, and saving it would overwrite the draft being offered — here, and on the
  // server too if its token were in use. The token is only taken up on resume.
  const choicePending = Boolean(localDraftSummary)
  const choicePendingRef = useRef(false)
  choicePendingRef.current = choicePending

  useEffect(() => {
    if (checkedLocalRef.current || skipLocalCheck) {
      checkedLocalRef.current = true
      return
    }
    checkedLocalRef.current = true
    loadLocalDraft()
      .then((draft) => {
        if (draft && draft.currentStep > 0) setLocalDraftSummary(draft)
      })
      .catch(() => {})
  }, [skipLocalCheck])

  const resumeLocalDraft = useCallback(() => {
    if (!localDraftSummary) return
    if (localDraftSummary.draftToken) setDraftToken(localDraftSummary.draftToken)
    setSelectedLoanType(localDraftSummary.loanType)
    setCurrentStep(localDraftSummary.currentStep)
    setPersonalData(localDraftSummary.personalData)
    setBusinessData(localDraftSummary.businessData)
    setLoanData(localDraftSummary.loanData)
    setContactConsent(Boolean(localDraftSummary.contactConsent))
    setLocalDraftSummary(null)
  }, [localDraftSummary, setDraftToken, setSelectedLoanType, setCurrentStep, setPersonalData, setBusinessData, setLoanData, setContactConsent])

  // Discards the offered draft, on the server too: left there, it would hold the email
  // and the new application's first save would be refused as already in progress.
  const startFresh = useCallback(() => {
    const abandoned = localDraftSummary?.draftToken
    autosavePausedRef.current = false
    setLocalDraftSummary(null)
    setDraftToken(null)
    setRemoteSyncError(null)
    setDocumentSyncError(null)
    setSyncConflict(null)
    clearLocalDraft().catch(() => {})
    if (abandoned) deleteDraft(abandoned).catch(() => {})
  }, [localDraftSummary, setDraftToken, setSyncConflict])

  // Used by the OTP-verified cross-device resume path — intent is already explicit,
  // so this hydrates immediately with no "resume vs start fresh" prompt.
  const hydrateFrom = useCallback(
    (draft) => {
      autosavePausedRef.current = false
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
    [setDraftToken, setSelectedLoanType, setCurrentStep, setPersonalData, setBusinessData, setLoanData, setContactConsent]
  )

  useEffect(() => {
    clearTimeout(localSaveTimer.current)
    if (autosavePausedRef.current || !keepLocalCopy || choicePending) return undefined
    localSaveTimer.current = setTimeout(() => {
      if (autosavePausedRef.current) return
      saveLocalDraft({ loanType: selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent }).catch(
        () => {}
      )
    }, LOCAL_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(localSaveTimer.current)
  }, [selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent, keepLocalCopy, choicePending])

  // Assisted mode is only confirmed once the staff session loads, so a save may already
  // have happened — and an earlier customer's copy may still be on this machine.
  useEffect(() => {
    if (keepLocalCopy) return
    clearTimeout(localSaveTimer.current)
    clearLocalDraft().catch(() => {})
  }, [keepLocalCopy])

  const syncEmail = getEmail(selectedLoanType, personalData, businessData)
  const canSyncRemotely = Boolean(syncEmail) && EMAIL_PATTERN.test(syncEmail || '')
  const normalizedSyncEmail = normalizeEmail(syncEmail)
  const syncEmailRef = useRef('')
  syncEmailRef.current = normalizedSyncEmail

  // Reassigned every render, so the save queue always runs the newest closure: a save
  // that waited behind another sends what the form holds when it starts, not when it
  // was requested. The token and the conflict come from refs for the same reason.
  const saveRemoteDraftRef = useRef(null)
  saveRemoteDraftRef.current = async () => {
    if (autosavePausedRef.current || choicePendingRef.current || !canSyncRemotely) return null
    // Already refused for this address; asking again gets the same 409.
    if (syncConflictRef.current?.email === normalizedSyncEmail) return null

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
        const current = draftTokenRef.current
        if (current) {
          try {
            await updateDraft(current, payload)
            return current
          } catch (error) {
            // The server has forgotten this token (expired, or a store that lost it), or
            // the draft behind it is gone. POST starts a draft under the email when none
            // is in progress; when one is, it refuses with draft_exists (handled below),
            // since without a token nothing shows this browser owns it.
            if (!isInvalidTokenError(error) && error?.response?.status !== 404) throw error
          }
        }
        // Submitted or discarded meanwhile: a POST now would bring the draft back.
        if (autosavePausedRef.current) return null
        const result = await createDraft({ email: syncEmail, ...payload })
        return result.draftToken
      })
      if (autosavePausedRef.current) return token
      if (token !== draftTokenRef.current) {
        // Documents sent under the old token may never have been stored, and the
        // analysis hook re-checks on a token change, so re-send every attachment.
        uploadedSignaturesRef.current.clear()
        failedUploadsRef.current.clear()
        setDraftToken(token)
      }
      tokenRecoveryRef.current = false
      setRemoteSyncError(null)
      if (syncConflictRef.current) setSyncConflict(null)
      return token
    } catch (error) {
      const conflict = draftConflictCode(error)
      if (conflict) {
        console.warn(`Draft sync refused: ${describeRequestError(error)}`)
        // draft_exists only comes back from the POST, which runs when there is no token
        // or the server rejected it; either way there is nothing worth keeping.
        if (conflict === 'draft_exists' && draftTokenRef.current) setDraftToken(null)
        setSyncConflict({
          code: conflict,
          email: normalizedSyncEmail,
          message: conflict === 'draft_exists' ? DRAFT_EXISTS_MESSAGE : error.response.data?.message || EMAIL_IN_USE_FALLBACK,
        })
        setRemoteSyncError(null)
        return null
      }
      // Not best-effort: otp/verify.js resolves a cross-device resume from the server
      // copy alone, so a write that never lands is reported to the applicant as "no
      // in-progress application found" even though their own device still shows it.
      // Swallowing this silently is what made that look like Redis dropping records.
      console.error(`Draft sync failed: ${describeRequestError(error)}`)
      setRemoteSyncError(extractDraftErrorMessage(error))
      return null
    }
  }

  // Stable for the hook's lifetime; see createSerialRunner.
  const [queueRemoteSave] = useState(() => createSerialRunner(() => saveRemoteDraftRef.current()))

  /**
   * Pushes the draft to the server immediately, cancelling any pending debounce.
   * Resolves to the draft token, or null when nothing could be saved.
   *
   * Exposed so explicit checkpoints — leaving via "Save & exit", finishing a step —
   * can guarantee a server-side copy exists. Relying on the debounce alone meant a
   * draft that was only ever edited within the last few seconds was cancelled by the
   * effect cleanup on unmount, so nothing was ever stored and cross-device resume
   * reported no application found.
   */
  const flushRemoteDraft = useCallback(() => {
    clearTimeout(remoteSaveTimer.current)
    return queueRemoteSave()
  }, [queueRemoteSave])

  useEffect(() => {
    if (!canSyncRemotely || autosavePausedRef.current || choicePending) return undefined
    if (syncConflictRef.current?.email === normalizedSyncEmail) return undefined
    clearTimeout(remoteSaveTimer.current)
    remoteSaveTimer.current = setTimeout(flushRemoteDraft, REMOTE_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(remoteSaveTimer.current)
  }, [
    canSyncRemotely,
    normalizedSyncEmail,
    selectedLoanType,
    currentStep,
    personalData,
    businessData,
    loanData,
    contactConsent,
    assisted,
    referralCode,
    choicePending,
    flushRemoteDraft,
  ])

  /**
   * Called when any request carrying draftToken gets a 401 — a document upload, an AI
   * check or the prescreen. Without this the browser kept sending a token the server
   * had forgotten, and every upload and check failed until the page was reloaded.
   */
  const invalidateDraftToken = useCallback(() => {
    tokenRecoveryRef.current = true
    setDraftToken(null)
  }, [setDraftToken])

  // Re-save straight away rather than after the debounce, so a stale token never holds
  // up uploads for five seconds. Runs once the null token has reached this render; the
  // save queue folds it into any save already under way.
  useEffect(() => {
    if (!tokenRecoveryRef.current || draftToken || !canSyncRemotely) return
    flushRemoteDraft()
  }, [draftToken, canSyncRemotely, flushRemoteDraft])

  /**
   * Sends one document under `token`, recording a refusal so it is not re-sent blindly.
   * Rejects with the upload's error; a 401 is left for the caller to recover from.
   */
  const uploadDocument = useCallback((token, path, file) => {
    const signature = fileSignature(file)
    uploadedSignaturesRef.current.set(path, signature)
    const upload = withRetry(() => uploadDraftDocument(token, path, file)).then(
      (result) => {
        if (failedUploadsRef.current.get(path)?.signature === signature) failedUploadsRef.current.delete(path)
        return result
      },
      (error) => {
        // Only if the slot still holds this file: a replacement may already be on its way.
        if (uploadedSignaturesRef.current.get(path) === signature) uploadedSignaturesRef.current.delete(path)
        if (!isInvalidTokenError(error)) {
          if (isPermanentUploadFailure(error)) {
            failedUploadsRef.current.set(path, { signature, permanent: true, error })
          } else {
            const previous = failedUploadsRef.current.get(path)
            const attempts = (previous?.signature === signature ? previous.attempts || 0 : 0) + 1
            failedUploadsRef.current.set(path, {
              signature,
              permanent: false,
              attempts,
              retryAt: Date.now() + uploadRetryDelay(attempts),
              error,
            })
            // Re-runs the upload effect, which schedules the retry for when it is due.
            setUploadRetryTick((tick) => tick + 1)
          }
        }
        throw error
      }
    )
    inflightUploadsRef.current.set(path, upload)
    upload
      .finally(() => {
        if (inflightUploadsRef.current.get(path) === upload) inflightUploadsRef.current.delete(path)
      })
      .catch(() => {})
    return upload
  }, [])

  useEffect(() => {
    if (!draftToken || autosavePausedRef.current) return undefined
    const scope = selectedLoanType === 'personal' ? 'personal' : 'business'
    const activeData = selectedLoanType === 'personal' ? personalData : businessData
    const { files } = extractFiles(activeData, scope)

    // A refusal is about one file: once it is replaced or removed, so is the warning.
    let pruned = false
    failedUploadsRef.current.forEach((failure, path) => {
      const file = files.get(path)
      if (!file || fileSignature(file) !== failure.signature) {
        failedUploadsRef.current.delete(path)
        pruned = true
      }
    })
    if (pruned && failedUploadsRef.current.size === 0) setDocumentSyncError(null)

    const now = Date.now()
    let nextRetryAt = Infinity
    files.forEach((file, path) => {
      // Existing LMS documents are already stored remotely. They remain available
      // for final submission but must not be re-uploaded as draft attachments.
      if (file.__source === 'lms') return
      const signature = fileSignature(file)
      if (uploadedSignaturesRef.current.get(path) === signature) return
      const failure = failedUploadsRef.current.get(path)
      if (failure?.signature === signature) {
        // Refused outright (too large, wrong type): the same file gets the same answer.
        if (failure.permanent) return
        // Server or network trouble: try again on a backoff, not on the next keystroke.
        if (failure.retryAt > now) {
          nextRetryAt = Math.min(nextRetryAt, failure.retryAt)
          return
        }
      }
      uploadDocument(draftToken, path, file)
        .then(() => {
          if (failedUploadsRef.current.size === 0) setDocumentSyncError(null)
        })
        .catch((error) => {
          if (isInvalidTokenError(error)) {
            // Re-sent automatically once the draft has a new token.
            invalidateDraftToken()
            return
          }
          console.error(`Draft document upload failed (${path}): ${describeRequestError(error)}`)
          setDocumentSyncError(extractDraftErrorMessage(error))
        })
    })

    if (nextRetryAt === Infinity) return undefined
    const timer = setTimeout(() => setUploadRetryTick((tick) => tick + 1), nextRetryAt - now)
    return () => clearTimeout(timer)
  }, [draftToken, selectedLoanType, personalData, businessData, uploadRetryTick, uploadDocument, invalidateDraftToken])

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
      const sameToken = token === draftTokenRef.current
      const pending = []
      files.forEach((file, path) => {
        if (file.__source === 'lms') return
        const signature = fileSignature(file)
        const inflight = inflightUploadsRef.current.get(path)
        if (uploadedSignaturesRef.current.get(path) === signature && sameToken) {
          if (inflight) pending.push(inflight)
          return
        }
        // A file the server has already refused would only be refused again. Transient
        // failures are retried now, though: the applicant is waiting on this one.
        const failure = failedUploadsRef.current.get(path)
        if (failure?.permanent && failure.signature === signature && sameToken) {
          pending.push(Promise.reject(failure.error))
          return
        }
        pending.push(uploadDocument(token, path, file))
      })
      await Promise.all(pending)
    },
    [selectedLoanType, personalData, businessData, uploadDocument]
  )

  // Writes the local cache immediately instead of waiting out the debounce.
  // Used by "Save & exit" so the label is literally true — without this, keystrokes
  // from the last 800ms would be lost on the way out.
  const flushLocalDraft = useCallback(() => {
    clearTimeout(localSaveTimer.current)
    if (autosavePausedRef.current || !keepLocalCopy || choicePending) return Promise.resolve()
    return saveLocalDraft({
      loanType: selectedLoanType,
      currentStep,
      personalData,
      businessData,
      loanData,
      draftToken,
      contactConsent,
    }).catch(() => {})
  }, [selectedLoanType, currentStep, personalData, businessData, loanData, draftToken, contactConsent, keepLocalCopy, choicePending])

  // `remote: false` after a successful submit: the server has already removed the draft.
  // Either way autosave stops here, until resumeAutosave: the answers are still in state.
  const clearDraft = useCallback(
    async ({ remote = true } = {}) => {
      autosavePausedRef.current = true
      clearTimeout(localSaveTimer.current)
      clearTimeout(remoteSaveTimer.current)
      const token = remote ? draftTokenRef.current : null
      tokenRecoveryRef.current = false
      setDraftToken(null)
      setRemoteSyncError(null)
      setDocumentSyncError(null)
      setSyncConflict(null)
      uploadedSignaturesRef.current.clear()
      failedUploadsRef.current.clear()
      // Queued behind any local save already under way, so that save cannot land after it.
      await clearLocalDraft().catch(() => {})
      if (token) {
        deleteDraft(token).catch(() => {})
      }
    },
    [setDraftToken, setSyncConflict]
  )

  // For a new application started without leaving the page (the form has been reset).
  const resumeAutosave = useCallback(() => {
    autosavePausedRef.current = false
  }, [])

  // For Submit, which learns only that the save returned null: why, if the server said.
  const syncConflictMessage = useCallback(() => {
    const conflict = syncConflictRef.current
    return conflict?.email === syncEmailRef.current ? conflict.message : null
  }, [])

  const activeConflict = syncConflict?.email === normalizedSyncEmail ? syncConflict : null

  return {
    localDraftSummary,
    resumeLocalDraft,
    startFresh,
    hydrateFrom,
    clearDraft,
    resumeAutosave,
    invalidateDraftToken,
    ensureDocumentsUploaded,
    flushLocalDraft,
    flushRemoteDraft,
    canSyncRemotely,
    // email_in_use reads like any other failed sync; draft_exists has its own notice.
    remoteSyncError: activeConflict ? (activeConflict.code === 'email_in_use' ? activeConflict.message : null) : remoteSyncError,
    draftExists: activeConflict?.code === 'draft_exists',
    syncConflictMessage,
    documentSyncError,
    // Also authorises the AI document checks and prescreen (api/ai/*).
    draftToken,
  }
}
