/**
 * Where each document slot's file lives in the wizard's form data. A product's built-in
 * documents sit directly under `documents` (documents.payslips), its own ones under
 * documents.custom (slot custom.title-deed → documents.custom['title-deed']), and
 * collateral proofs in documents.collateral, one per pledged item (slot collateral.0).
 * These paths are what api/_lib/drafts and slotFromDraftPath (src/config/applications.js)
 * turn back into slots.
 */

const COLLATERAL_SLOT = /^collateral\.(\d+)$/
const CUSTOM_PREFIX = 'custom.'

/** The file attached for a slot, or null. */
export const readDocument = (documents, slot) => {
  if (slot.startsWith(CUSTOM_PREFIX)) return documents?.custom?.[slot.slice(CUSTOM_PREFIX.length)] ?? null
  const collateral = COLLATERAL_SLOT.exec(slot)
  if (collateral) return documents?.collateral?.[Number(collateral[1])] ?? null
  return documents?.[slot] ?? null
}

/** `documents` with `file` (or null) put at the slot's place; the input is not changed. */
export const writeDocument = (documents, slot, file) => {
  const current = documents || {}
  if (slot.startsWith(CUSTOM_PREFIX)) return { ...current, custom: { ...(current.custom || {}), [slot.slice(CUSTOM_PREFIX.length)]: file } }
  const collateral = COLLATERAL_SLOT.exec(slot)
  if (collateral) {
    const proofs = [...(current.collateral || [])]
    const index = Number(collateral[1])
    while (proofs.length < index) proofs.push(null)
    proofs[index] = file
    return { ...current, collateral: proofs }
  }
  return { ...current, [slot]: file }
}

/** `documents` without the proof of the collateral item at `index`; later proofs move up one, like their items. */
export const removeCollateralProof = (documents, index) => ({
  ...(documents || {}),
  collateral: (documents?.collateral || []).filter((_, proofIndex) => proofIndex !== index),
})

/** Slots that take a photo as well as a PDF: the passport photo, collateral proofs and a product's own documents. */
export const acceptsPhotos = (slot) => slot === 'passportPhoto' || slot.startsWith(CUSTOM_PREFIX) || COLLATERAL_SLOT.test(slot)
