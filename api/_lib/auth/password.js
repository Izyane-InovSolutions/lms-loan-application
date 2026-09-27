import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { fail } from '../http.js'

const scrypt = promisify(crypto.scrypt)
const KEY_LENGTH = 64

// Length over composition rules: a long passphrase beats "P@ssw0rd1", and the cap stops
// a multi-megabyte "password" being used to burn CPU in scrypt.
export const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128

export const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    fail(400, `Use a password between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`, 'weak_password')
  }
}

/** `salt:hash`, both hex. scrypt from node:crypto — no native dependency to build. */
export const hashPassword = async (password) => {
  validatePassword(password)
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `${salt}:${derived.toString('hex')}`
}

export const verifyPassword = async (password, stored) => {
  if (!stored || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false
  const [salt, encoded] = stored.split(':')
  if (!salt || !encoded) return false
  const expected = Buffer.from(encoded, 'hex')
  const actual = await scrypt(password, salt, expected.length)
  return crypto.timingSafeEqual(actual, expected)
}

// Checked against a throwaway hash when the email is unknown, so a failed login takes
// the same time whether or not the account exists.
let dummyHash = null
export const verifyAgainstDummy = async (password) => {
  dummyHash ||= await hashPassword('not-a-real-password-for-timing')
  await verifyPassword(typeof password === 'string' ? password : '', dummyHash)
  return false
}
