/**
 * Turns a validation key ("directorInfo.directors[0].nrc") into a DOM-safe id.
 * Shared by the field components and the error summary so a summary entry can
 * focus the exact control it refers to.
 */
export const fieldId = (key) => `field-${String(key).replace(/[^a-zA-Z0-9_-]+/g, '-')}`

export const focusField = (key) => {
  if (typeof document === 'undefined') return
  const element = document.getElementById(fieldId(key))
  if (!element) return
  element.focus({ preventScroll: true })
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
