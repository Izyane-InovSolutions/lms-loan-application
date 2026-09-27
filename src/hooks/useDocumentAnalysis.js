import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeDocument, isAiUnavailable, aiFailureReason, pausesAiChecks } from '../services/aiApi'
import { describeRequestError } from '../lib/requestError'

const fileSignature = (file) => `${file.name}:${file.size}:${file.lastModified}`

// Existing LMS documents (prefilled applications) are references, not local files, and
// there is nothing to send.
const isAnalyzableFile = (file) => typeof File !== 'undefined' && file instanceof File

/**
 * Keeps an AI analysis for every attached document, keyed by fieldKey.
 *
 * Declarative on purpose: it is handed the current list of slots and reconciles —
 * attaching, replacing, removing, and restoring a resumed draft all go through the same
 * path, so none of the wizard's upload handlers need to know about it.
 *
 * Returns { analyses, paused, retry }:
 *   analyses  { [fieldKey]: { status: 'analyzing' | 'done' | 'skipped' | 'error', analysis?, reason? } }
 *   paused    { reason } once the provider is out of credit, overloaded or the daily limit is
 *             hit — every further call would fail the same way, so none are made until retry()
 *   retry     re-sends every slot whose check failed, and lifts the pause
 *
 * A 401 means the draft token was lost server-side; `onInvalidToken` asks the draft hook
 * for a new one, and the change of `token` re-sends the affected slots.
 *
 * Advisory only: nothing here blocks the applicant.
 */
export function useDocumentAnalysis({ token, slots, onInvalidToken }) {
  const [analyses, setAnalyses] = useState({})
  const [paused, setPaused] = useState(null)
  const [retryNonce, setRetryNonce] = useState(0)
  // Which file signature each slot was last sent with, so re-renders don't resend and a
  // late response for a replaced file is discarded.
  const requestedRef = useRef(new Map())
  const unavailableRef = useRef(false)
  const pausedRef = useRef(null)
  const onInvalidTokenRef = useRef(onInvalidToken)
  onInvalidTokenRef.current = onInvalidToken

  const slotsKey = slots
    .map(({ fieldKey, file }) => `${fieldKey}=${isAnalyzableFile(file) ? fileSignature(file) : ''}`)
    .join('|')

  useEffect(() => {
    if (!token || unavailableRef.current) return

    const current = new Map(
      slots.filter(({ file }) => isAnalyzableFile(file)).map((slot) => [slot.fieldKey, slot])
    )

    // Forget slots whose file was removed, so re-attaching the same file checks it again.
    const removed = [...requestedRef.current.keys()].filter((fieldKey) => !current.has(fieldKey))
    if (removed.length) {
      removed.forEach((fieldKey) => requestedRef.current.delete(fieldKey))
      setAnalyses((prev) => {
        const next = { ...prev }
        removed.forEach((fieldKey) => delete next[fieldKey])
        return next
      })
    }

    current.forEach(({ fieldKey, docType, file }) => {
      const signature = fileSignature(file)
      if (requestedRef.current.get(fieldKey) === signature) return

      // Paused: say why on the new upload instead of sending a request known to fail.
      if (pausedRef.current) {
        setAnalyses((prev) => ({ ...prev, [fieldKey]: { status: 'error', reason: pausedRef.current.reason } }))
        return
      }

      requestedRef.current.set(fieldKey, signature)

      const settle = (entry) => {
        if (requestedRef.current.get(fieldKey) !== signature) return
        setAnalyses((prev) => ({ ...prev, [fieldKey]: entry }))
      }

      settle({ status: 'analyzing' })
      analyzeDocument(token, docType, file, { fieldKey })
        .then((response) =>
          settle(response.status === 'analyzed' ? { status: 'done', analysis: response.analysis } : { status: 'skipped' })
        )
        .catch((error) => {
          if (isAiUnavailable(error)) {
            unavailableRef.current = true
            setAnalyses({})
            return
          }
          const reason = aiFailureReason(error)
          console.warn(`[ai] document check failed (${fieldKey}): ${describeRequestError(error)}`)
          settle({ status: 'error', reason })
          // Cleared after settling (settle ignores stale signatures) so a retry, a new
          // token, or the next change to the slot sends it again.
          if (requestedRef.current.get(fieldKey) === signature) requestedRef.current.delete(fieldKey)

          if (reason === 'invalid_token') onInvalidTokenRef.current?.()
          if (pausesAiChecks(reason) && !pausedRef.current) {
            pausedRef.current = { reason }
            setPaused(pausedRef.current)
          }
        })
    })
    // slotsKey captures every input that matters; `slots` itself is rebuilt each render.
  }, [token, slotsKey, retryNonce])

  const retry = useCallback(() => {
    pausedRef.current = null
    setPaused(null)
    // Failed slots are already out of requestedRef; bumping the nonce re-runs the
    // reconcile, which sends them again.
    setRetryNonce((value) => value + 1)
  }, [])

  return { analyses, paused, retry }
}
