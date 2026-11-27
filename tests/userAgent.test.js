import { describe, expect, it } from 'vitest'
import { describeUserAgent } from '../src/utils/userAgent.js'

describe('reading a User-Agent', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36', { browser: 'Chrome 157', os: 'macOS', device: 'Computer' }],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0', { browser: 'Edge 150', os: 'Windows', device: 'Computer' }],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', { browser: 'Safari 18', os: 'iOS', device: 'Phone' }],
    ['Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36', { browser: 'Chrome 156', os: 'Android', device: 'Phone' }],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', { browser: 'Firefox 140', os: 'Linux', device: 'Computer' }],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', { browser: 'Safari 17', os: 'iPadOS', device: 'Tablet' }],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 OPR/120.0.0.0', { browser: 'Opera 120', os: 'Windows', device: 'Computer' }],
    ['curl/8.4.0', { browser: 'curl 8', os: null, device: 'Script or tool' }],
  ])('%s', (ua, expected) => {
    expect(describeUserAgent(ua)).toMatchObject(expected)
  })

  it('says nothing for none', () => {
    expect(describeUserAgent('')).toBeNull()
    expect(describeUserAgent(null)).toBeNull()
  })

  it('reads as one line', () => {
    expect(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36').label).toBe('Chrome 157 on macOS, computer')
  })
})
