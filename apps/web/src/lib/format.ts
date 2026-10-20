import { MVR_TO_LAARI } from '@ride-master/shared'

/**
 * Exact integer formatting of laari into MVR strings.
 * 1250 laari → "12.50" (never floating point).
 */
export function formatLaari(laari: number): string {
  if (!Number.isInteger(laari)) {
    throw new TypeError('Money must be integer laari')
  }
  const sign = laari < 0 ? '-' : ''
  const abs = Math.abs(laari)
  const mvr = Math.floor(abs / MVR_TO_LAARI)
  const cents = abs % MVR_TO_LAARI
  return `${sign}${mvr}.${String(cents).padStart(2, '0')}`
}

/** "+9607712345" → "7712345" for compact display. */
export function compactPhone(phone: string): string {
  return phone.startsWith('+960') ? phone.slice(4) : phone
}

/** Maldives-local timestamp formatting (UTC+5, no external deps). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Indian/Maldives is UTC+5 year-round (no DST).
  const shifted = new Date(d.getTime() + 5 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  return `${date} ${time}`
}
