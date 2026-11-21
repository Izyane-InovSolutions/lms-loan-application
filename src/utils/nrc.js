/**
 * An NRC as it is typed, shaped like the card: 123456/78/9. Only the digits count (spaces,
 * dashes or slashes typed by hand are dropped) and the slashes appear once the digits
 * reach them, so deleting back over a slash works.
 */
export const formatNrc = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 9)
  if (digits.length <= 6) return digits
  if (digits.length <= 8) return `${digits.slice(0, 6)}/${digits.slice(6)}`
  return `${digits.slice(0, 6)}/${digits.slice(6, 8)}/${digits.slice(8)}`
}

/** What an NRC input takes: digits on a phone's keypad, and no more than 123456/78/9. */
export const NRC_INPUT_PROPS = { inputMode: 'numeric', maxLength: 11, autoComplete: 'off' }
