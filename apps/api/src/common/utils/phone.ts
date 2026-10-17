import { MALDIVES_COUNTRY_CODE, PHONE_REGEX } from '@ride-master/shared'

/**
 * Normalise a phone number to +960XXXXXXX format.
 * Accepts: 7-digit local, +960XXXXXXX, 960XXXXXXX, with or without spaces/dashes.
 * Throws if the result is not a valid Maldivian number.
 */
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-()]/g, '')

  let phone: string
  if (cleaned.startsWith('+960') && cleaned.length === 11) {
    phone = cleaned
  } else if (cleaned.startsWith('960') && cleaned.length === 10) {
    phone = `+${cleaned}`
  } else if (/^\d{7}$/.test(cleaned)) {
    phone = `${MALDIVES_COUNTRY_CODE}${cleaned}`
  } else {
    phone = cleaned
  }

  if (!validatePhone(phone)) {
    throw new Error(`Invalid Maldivian phone number: ${raw}`)
  }

  return phone
}

/**
 * Validate a phone number is in +960XXXXXXX format.
 */
export function validatePhone(phone: string): boolean {
  return PHONE_REGEX.test(phone)
}
