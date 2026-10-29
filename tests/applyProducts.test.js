import { describe, expect, it } from 'vitest'
import { applyPath, isProductSlug } from '../src/config/applicationSteps.js'
import { acceptsPhotos, readDocument, removeCollateralProof, writeDocument } from '../src/utils/documentSlots.js'
import { slotFromDraftPath } from '../src/config/applications.js'
import { extractFiles } from '../src/utils/fileTree.js'

describe('wizard URLs for products', () => {
  it('keeps the built-in products’ paths and gives added ones their form’s steps', () => {
    expect(applyPath('personal', 2)).toBe('/apply/personal/documents')
    expect(applyPath('business', 1)).toBe('/apply/business/directors-applicant')
    expect(applyPath('asset-finance', 0, 'business')).toBe('/apply/asset-finance/business-information')
    expect(applyPath('civil-servant', 3, 'personal')).toBe('/apply/civil-servant/loan-terms')
  })

  it('falls back to the personal form for an unknown form or a bad product id', () => {
    expect(applyPath('asset-finance', 0)).toBe('/apply/asset-finance/personal-information')
    expect(applyPath('Not a slug!', 0, 'business')).toBe('/apply/business/business-information')
    expect(isProductSlug('asset-finance')).toBe(true)
    expect(isProductSlug('../admin')).toBe(false)
  })
})

describe('document slots in the form', () => {
  const file = { name: 'deed.pdf' }

  it('reads and writes built-in, custom and collateral slots where the server expects them', () => {
    let documents = { payslips: null }
    documents = writeDocument(documents, 'payslips', file)
    documents = writeDocument(documents, 'custom.title-deed', file)
    documents = writeDocument(documents, 'collateral.1', file)
    expect(readDocument(documents, 'payslips')).toBe(file)
    expect(readDocument(documents, 'custom.title-deed')).toBe(file)
    expect(documents.collateral).toEqual([null, file])
    expect(readDocument(documents, 'collateral.0')).toBeNull()
    expect(readDocument(undefined, 'custom.missing')).toBeNull()
  })

  it('stores files at draft paths that map back to their slots', () => {
    if (typeof File === 'undefined') return
    const upload = new File(['x'], 'deed.pdf', { type: 'application/pdf' })
    const documents = writeDocument(writeDocument({}, 'custom.title-deed', upload), 'collateral.0', upload)
    const { files } = extractFiles({ documents }, 'personal')
    expect([...files.keys()].map(slotFromDraftPath).sort()).toEqual(['collateral.0', 'custom.title-deed'])
  })

  it('moves later collateral proofs up when an item is removed', () => {
    const documents = { collateral: ['a', 'b', 'c'] }
    expect(removeCollateralProof(documents, 1).collateral).toEqual(['a', 'c'])
    expect(documents.collateral).toEqual(['a', 'b', 'c'])
  })

  it('takes photos for the passport photo, collateral proofs and a product’s own documents only', () => {
    expect(acceptsPhotos('passportPhoto')).toBe(true)
    expect(acceptsPhotos('collateral.0')).toBe(true)
    expect(acceptsPhotos('custom.title-deed')).toBe(true)
    expect(acceptsPhotos('payslips')).toBe(false)
  })
})
