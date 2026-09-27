import { getSetting } from './settings.js'

/*
 * Text messages to customers, through the provider chosen in Settings → Notifications.
 *
 *   none             no texts (the default)
 *   africastalking   Africa's Talking bulk SMS. Username "sandbox" uses their test
 *                    environment, which delivers to the simulator rather than phones.
 *
 * Another provider plugs in by adding a sender below with the same send() shape.
 */

/** +260 97… from the wizard's 9-digit national number (or a number already in +260 form). */
export const toZambianE164 = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 9) return `+260${digits}`
  if (digits.length === 12 && digits.startsWith('260')) return `+${digits}`
  if (digits.length === 10 && digits.startsWith('0')) return `+260${digits.slice(1)}`
  return null
}

const africasTalking = ({ username, apiKey, senderId }) => ({
  name: 'africastalking',
  async send(to, message) {
    const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com'
    const body = new URLSearchParams({ username, to, message })
    if (senderId) body.set('from', senderId)
    const response = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    })
    const payload = await response.json().catch(() => ({}))
    const recipient = payload?.SMSMessageData?.Recipients?.[0]
    if (!response.ok || !recipient || recipient.statusCode >= 400) {
      throw new Error(recipient?.status || payload?.SMSMessageData?.Message || `SMS provider answered ${response.status}`)
    }
    return { id: recipient.messageId }
  },
})

/** The configured sender, or null when texts are off or not set up. */
export const getSms = async () => {
  const config = await getSetting('sms')
  if (config.provider === 'africastalking' && config.username && config.apiKey) return africasTalking(config)
  return null
}

/** Sends if a provider is set up and customer texts are on. Never throws: a failed text is logged. */
export const textCustomer = async (phone, message) => {
  const { customerSms } = await getSetting('notifications')
  if (!customerSms) return false
  const sms = await getSms()
  const to = toZambianE164(phone)
  if (!sms || !to) return false
  try {
    await sms.send(to, message.slice(0, 300))
    return true
  } catch (error) {
    console.warn(`[sms] could not text ${to.slice(0, 7)}…: ${error.message}`)
    return false
  }
}
