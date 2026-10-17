import { ulid } from 'ulid'

/** Generate a new ULID (26-char sortable unique ID). */
export function generateUlid(): string {
  return ulid()
}
