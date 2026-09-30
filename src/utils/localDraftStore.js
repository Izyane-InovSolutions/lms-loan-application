import { extractFiles, injectFiles } from './fileTree'

const DB_NAME = 'lms-application-draft'
const DB_VERSION = 1
const STORE_NAME = 'files'
const STORAGE_KEY = 'lms_application_draft_v1'

// Matches the server's draft TTL (DRAFT_TTL_SECONDS). The local copy holds the
// applicant's NRC, payslips and bank statements, so on a shared or borrowed device it
// must not outlive the application it belongs to.
export const LOCAL_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** A saved copy with no timestamp predates expiry and is treated as expired too. */
export const isLocalDraftExpired = (meta, now = Date.now()) =>
  !Number.isFinite(meta?.savedAt) || now - meta.savedAt > LOCAL_DRAFT_MAX_AGE_MS

/** Stored file paths the current form no longer references (removed or replaced slots). */
export const staleFilePaths = (storedPaths, currentPaths) => {
  const keep = new Set(currentPaths)
  return [...storedPaths].filter((path) => !keep.has(path))
}

// Saves and clears run one at a time, in call order. A save is two async writes
// (IndexedDB, then localStorage), so without this a clear issued while a save was
// between them — right after submitting, say — was followed by that save's
// localStorage write, and the submitted application came back as a draft.
let queue = Promise.resolve()
const enqueue = (operation) => {
  const run = queue.then(operation)
  queue = run.catch(() => {})
  return run
}

let dbPromise = null

const openDb = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'path' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

// Replaces the stored set rather than adding to it: a document removed from the form
// is deleted here too, instead of lingering in the browser indefinitely.
const saveFilesToIdb = async (filesByPath) => {
  const db = await openDb()
  if (!db) return
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const keysRequest = store.getAllKeys()
    keysRequest.onsuccess = () => {
      staleFilePaths(keysRequest.result, filesByPath.keys()).forEach((path) => store.delete(path))
    }
    for (const [path, file] of filesByPath.entries()) {
      store.put({ path, file })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const loadAllFilesFromIdb = async () => {
  const filesByPath = new Map()
  const db = await openDb()
  if (!db) return filesByPath
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        filesByPath.set(cursor.value.path, cursor.value.file)
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return filesByPath
}

const clearAllFilesFromIdb = async () => {
  const db = await openDb()
  if (!db) return
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const removeStoredDraft = async () => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  await clearAllFilesFromIdb()
}

export function saveLocalDraft({
  loanType,
  currentStep,
  personalData,
  businessData,
  loanData,
  draftToken,
  contactConsent = false,
}) {
  return enqueue(async () => {
    const personal = extractFiles(personalData, 'personal')
    const business = extractFiles(businessData, 'business')
    await saveFilesToIdb(new Map([...personal.files, ...business.files]))

    const meta = {
      loanType,
      currentStep,
      personalData: personal.sanitized,
      businessData: business.sanitized,
      loanData,
      draftToken: draftToken || null,
      contactConsent: Boolean(contactConsent),
      savedAt: Date.now(),
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
    } catch {
      // localStorage may be disabled/full; the draft simply won't persist locally
    }
  })
}

export async function loadLocalDraft() {
  let raw
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  let meta
  try {
    meta = JSON.parse(raw)
  } catch {
    return null
  }

  if (isLocalDraftExpired(meta)) {
    await clearLocalDraft()
    return null
  }

  const filesByPath = await loadAllFilesFromIdb()
  return {
    ...meta,
    personalData: injectFiles(meta.personalData, filesByPath),
    businessData: injectFiles(meta.businessData, filesByPath),
  }
}

export function clearLocalDraft() {
  return enqueue(removeStoredDraft)
}
