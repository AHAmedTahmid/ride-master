import { monotonicFactory } from 'ulid'

const monotonicUlid = monotonicFactory()

/**
 * Generate a new ULID (26-char, lexicographically sortable).
 * Monotonic: consecutive calls in the same millisecond still sort in
 * creation order — important for using the id as a stable cursor.
 */
export function generateUlid(): string {
  return monotonicUlid()
}
