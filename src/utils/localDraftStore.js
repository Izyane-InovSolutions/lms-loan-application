import { extractFiles, injectFiles } from './fileTree'

const DB_NAME = 'lms-application-draft'
const DB_VERSION = 1
const STORE_NAME = 'files'
const STORAGE_KEY = 'lms_application_draft_v1'

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

const saveFilesToIdb = async (filesByPath) => {
  const db = await openDb()
  if (!db || filesByPath.size === 0) return
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
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

export async function saveLocalDraft({
  loanType,
  currentStep,
  personalData,
  businessData,
  loanData,
  draftToken,
}) {
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
    savedAt: Date.now(),
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
  } catch {
    // localStorage may be disabled/full; the draft simply won't persist locally
  }
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

  const filesByPath = await loadAllFilesFromIdb()
  return {
    ...meta,
    personalData: injectFiles(meta.personalData, filesByPath),
    businessData: injectFiles(meta.businessData, filesByPath),
  }
}

export async function clearLocalDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  await clearAllFilesFromIdb()
}
