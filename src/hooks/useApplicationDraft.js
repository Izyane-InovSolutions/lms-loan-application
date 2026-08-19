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

const LOCAL_SAVE_DEBOUNCE_MS = 800
const REMOTE_SAVE_DEBOUNCE_MS = 5000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RETRY_DELAYS_MS = [1000, 3000]

// Upstash is reached over HTTP, so a cold start, rate limit or dropped connection
// fails the whole write rather than queueing it. Retrying twice turns the common
// transient case back into a successful sync instead of a missing server copy.
const withRetry = async (operation) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error
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
  skipLocalCheck = false,
}) {
  const [localDraftSummary, setLocalDraftSummary] = useState(null)
  const [draftToken, setDraftToken] = useState(null)
  const [remoteSyncError, setRemoteSyncError] = useState(null)
  const uploadedSignaturesRef = useRef(new Map())
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
    setLocalDraftSummary(null)
  }, [localDraftSummary, setSelectedLoanType, setCurrentStep, setPersonalData, setBusinessData, setLoanData])

  const startFresh = useCallback(() => {
    setLocalDraftSummary(null)
    setDraftToken(null)
    setRemoteSyncError(null)
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
      setLocalDraftSummary(null)
    },
    [setSelectedLoanType, setCurrentStep, setPersonalData, setBusinessData, setLoanData]
  )

  useEffect(() => {
    clearTimeout(localSaveTimer.current)
    localSaveTimer.current = setTimeout(() => {
      saveLocalDraft({ loanType: selectedLoanType, currentStep, personalData, businessData, loanData, draftToken })
    }, LOCAL_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(localSaveTimer.current)
  }, [selectedLoanType, currentStep, personalData, businessData, loanData, draftToken])

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
    }

    try {
      const token = await withRetry(async () => {
        if (!draftToken) {
          const result = await createDraft({ email: syncEmail, ...payload })
          return result.draftToken
        }
        await updateDraft(draftToken, payload)
        return draftToken
      })
      if (token !== draftToken) setDraftToken(token)
      setRemoteSyncError(null)
      return token
    } catch (error) {
      // Not best-effort: otp/verify.js resolves a cross-device resume from the server
      // copy alone, so a write that never lands is reported to the applicant as "no
      // in-progress application found" even though their own device still shows it.
      // Swallowing this silently is what made that look like Redis dropping records.
      console.error('Draft sync failed', error)
      setRemoteSyncError(extractDraftErrorMessage(error))
      return null
    }
  }, [canSyncRemotely, syncEmail, selectedLoanType, currentStep, personalData, businessData, loanData, draftToken])

  useEffect(() => {
    if (!canSyncRemotely) return undefined
    clearTimeout(remoteSaveTimer.current)
    remoteSaveTimer.current = setTimeout(flushRemoteDraft, REMOTE_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(remoteSaveTimer.current)
  }, [canSyncRemotely, flushRemoteDraft])

  useEffect(() => {
    if (!draftToken) return
    const scope = selectedLoanType === 'personal' ? 'personal' : 'business'
    const activeData = selectedLoanType === 'personal' ? personalData : businessData
    const { files } = extractFiles(activeData, scope)

    files.forEach((file, path) => {
      const signature = fileSignature(file)
      if (uploadedSignaturesRef.current.get(path) === signature) return
      uploadedSignaturesRef.current.set(path, signature)
      withRetry(() => uploadDraftDocument(draftToken, path, file)).catch((error) => {
        console.error(`Draft document upload failed for ${path}`, error)
        uploadedSignaturesRef.current.delete(path)
        setRemoteSyncError('Some attached documents could not be saved to your online draft.')
      })
    })
  }, [draftToken, selectedLoanType, personalData, businessData])

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
      }),
    [selectedLoanType, currentStep, personalData, businessData, loanData, draftToken]
  )

  const clearDraft = useCallback(async () => {
    const token = draftToken
    setDraftToken(null)
    setRemoteSyncError(null)
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
    flushLocalDraft,
    flushRemoteDraft,
    canSyncRemotely,
    remoteSyncError,
  }
}
