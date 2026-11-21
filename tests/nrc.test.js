import { describe, expect, it } from 'vitest'

import { formatNrc } from '../src/utils/nrc.js'

describe('NRC formatting', () => {
  it('shapes the digits as they are typed: 123456/78/9', () => {
    expect(formatNrc('1234')).toBe('1234')
    expect(formatNrc('123456')).toBe('123456')
    expect(formatNrc('1234567')).toBe('123456/7')
    expect(formatNrc('12345678')).toBe('123456/78')
    expect(formatNrc('123456789')).toBe('123456/78/9')
  })

  it('ignores what is typed between the digits, and anything past the last one', () => {
    expect(formatNrc('123456/78/9')).toBe('123456/78/9')
    expect(formatNrc(' 123 456-78 9 ')).toBe('123456/78/9')
    expect(formatNrc('1234567890')).toBe('123456/78/9')
    expect(formatNrc('ab')).toBe('')
  })

  it('lets a slash be deleted: the digits before it stand alone', () => {
    expect(formatNrc('123456/')).toBe('123456')
    expect(formatNrc('123456/78/')).toBe('123456/78')
  })
})
