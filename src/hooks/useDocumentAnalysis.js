import { useEffect, useRef, useState } from 'react'
import { analyzeDocument, isAiUnavailable } from '../services/aiApi'

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
 * Returns { [fieldKey]: { status: 'analyzing' | 'done' | 'skipped' | 'error', analysis? } }.
 * Advisory only: nothing here blocks the applicant.
 */
export function useDocumentAnalysis({ token, slots }) {
  const [analyses, setAnalyses] = useState({})
  // Which file signature each slot was last sent with, so re-renders don't resend and a
  // late response for a replaced file is discarded.
  const requestedRef = useRef(new Map())
  const unavailableRef = useRef(false)

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
      requestedRef.current.set(fieldKey, signature)

      const settle = (entry) => {
        if (requestedRef.current.get(fieldKey) !== signature) return
        setAnalyses((prev) => ({ ...prev, [fieldKey]: entry }))
      }

      settle({ status: 'analyzing' })
      analyzeDocument(token, docType, file)
        .then((response) =>
          settle(response.status === 'analyzed' ? { status: 'done', analysis: response.analysis } : { status: 'skipped' })
        )
        .catch((error) => {
          if (isAiUnavailable(error)) {
            unavailableRef.current = true
            setAnalyses({})
            return
          }
          console.warn(`Document check failed for ${fieldKey}`, error)
          settle({ status: 'error' })
          // Cleared after settling (settle ignores stale signatures) so the next change
          // to the slot, or a resume, tries again.
          if (requestedRef.current.get(fieldKey) === signature) requestedRef.current.delete(fieldKey)
        })
    })
    // slotsKey captures every input that matters; `slots` itself is rebuilt each render.
  }, [token, slotsKey])

  return analyses
}
