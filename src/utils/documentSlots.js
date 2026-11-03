/**
 * Where each document slot's file lives in the wizard's form data. A product's built-in
 * documents sit directly under `documents` (documents.payslips), its own ones under
 * documents.custom (slot custom.title-deed → documents.custom['title-deed']), and
 * collateral proofs in documents.collateral: a list of files per pledged item (slot
 * collateral.0.1 is item 1's second file → documents.collateral[0][1]). A removed file leaves
 * a gap, so the others keep their slots (and their checks). Drafts from before held one file
 * per item (documents.collateral[0], slot collateral.0): it reads as that item's first file.
 * These paths are what api/_lib/drafts and slotFromDraftPath (src/config/applications.js)
 * turn back into slots.
 */

const COLLATERAL_SLOT = /^collateral\.(\d+)(?:\.(\d+))?$/
const CUSTOM_PREFIX = 'custom.'

// An item's proof files (with gaps), whether stored as a list or, from before, one file.
const proofsOf = (documents, index) => {
  const stored = documents?.collateral?.[index]
  return Array.isArray(stored) ? stored : stored ? [stored] : []
}

/** The proof files attached to collateral item `index`: [{ slot, file }], gaps left out. */
export const collateralProofs = (documents, index) =>
  proofsOf(documents, index)
    .map((file, position) => ({ slot: `collateral.${index}.${position}`, file }))
    .filter((entry) => entry.file)

/** The slot the next proof file of collateral item `index` goes in. */
export const nextCollateralSlot = (documents, index) => `collateral.${index}.${proofsOf(documents, index).length}`

/** The file attached for a slot, or null. */
export const readDocument = (documents, slot) => {
  if (slot.startsWith(CUSTOM_PREFIX)) return documents?.custom?.[slot.slice(CUSTOM_PREFIX.length)] ?? null
  const collateral = COLLATERAL_SLOT.exec(slot)
  if (collateral) return proofsOf(documents, Number(collateral[1]))[Number(collateral[2] ?? 0)] ?? null
  return documents?.[slot] ?? null
}

/** `documents` with `file` (or null) put at the slot's place; the input is not changed. */
export const writeDocument = (documents, slot, file) => {
  const current = documents || {}
  if (slot.startsWith(CUSTOM_PREFIX)) return { ...current, custom: { ...(current.custom || {}), [slot.slice(CUSTOM_PREFIX.length)]: file } }
  const collateral = COLLATERAL_SLOT.exec(slot)
  if (collateral) {
    const items = [...(current.collateral || [])]
    const index = Number(collateral[1])
    const position = Number(collateral[2] ?? 0)
    while (items.length < index) items.push([])
    const files = [...proofsOf(current, index)]
    while (files.length < position) files.push(null)
    files[position] = file
    items[index] = files
    return { ...current, collateral: items }
  }
  return { ...current, [slot]: file }
}

/** `documents` without the proofs of the collateral item at `index`; later items' proofs move up one, like their items. */
export const removeCollateralProof = (documents, index) => ({
  ...(documents || {}),
  collateral: (documents?.collateral || []).filter((_, proofIndex) => proofIndex !== index),
})

/** Slots that take a photo as well as a PDF: the passport photo, collateral proofs and a product's own documents. */
export const acceptsPhotos = (slot) => slot === 'passportPhoto' || slot.startsWith(CUSTOM_PREFIX) || COLLATERAL_SLOT.test(slot)
