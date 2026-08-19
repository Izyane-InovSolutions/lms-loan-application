const FILE_MARKER = '__draftFile__'

const isFileLike = (value) => typeof File !== 'undefined' && value instanceof File

// Walks a (possibly nested) form-data object, pulling out every File/Blob it finds
// and replacing it with a small placeholder that records the dotted path it came
// from (e.g. "personal.documents.passportPhoto" or "business.documents.directorUploads.0.nrc").
// Used so form state can be JSON-serialized for localStorage/server sync while the
// actual binary files are stored separately (IndexedDB locally, Blob storage remotely).
export function extractFiles(root, basePath) {
  const files = new Map()

  const walk = (value, path) => {
    if (Array.isArray(value)) {
      return value.map((item, index) => walk(item, `${path}.${index}`))
    }
    if (isFileLike(value)) {
      files.set(path, value)
      return { [FILE_MARKER]: path }
    }
    if (value && typeof value === 'object') {
      const result = {}
      for (const [key, child] of Object.entries(value)) {
        result[key] = walk(child, `${path}.${key}`)
      }
      return result
    }
    return value
  }

  return { sanitized: walk(root, basePath), files }
}

// Reverses extractFiles: given the sanitized structure and a path -> File map,
// rebuilds the original shape with real File objects back in place.
export function injectFiles(root, filesByPath) {
  const walk = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item))
    }
    if (value && typeof value === 'object') {
      if (FILE_MARKER in value) {
        return filesByPath.get(value[FILE_MARKER]) ?? null
      }
      const result = {}
      for (const [key, child] of Object.entries(value)) {
        result[key] = walk(child)
      }
      return result
    }
    return value
  }

  return walk(root)
}
