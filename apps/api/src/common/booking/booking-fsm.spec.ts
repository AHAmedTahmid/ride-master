import { describe, expect, it } from 'vitest'
import {
  ACTIVE_BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  BookingStatus,
  TERMINAL_BOOKING_STATUSES,
} from '@ride-master/shared'

const ALL_STATUSES: BookingStatus[] = [
  'requested',
  'offered',
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'cancelled_by_company',
  'expired',
  'no_show',
  'disputed',
]

/**
 * The transition table is the core business rule of the booking lifecycle
 * (Phase 3/4 services enforce it). Locking its shape now prevents accidental
 * rewrites while the API catches up.
 */
describe('BOOKING_TRANSITIONS', () => {
  it('only references known statuses', () => {
    for (const t of BOOKING_TRANSITIONS) {
      expect(ALL_STATUSES).toContain(t.from)
      expect(ALL_STATUSES).toContain(t.to)
    }
  })

  it('never allows a self-transition', () => {
    for (const t of BOOKING_TRANSITIONS) {
      expect(t.from).not.toBe(t.to)
    }
  })

  it('system-only transitions declare no actor roles', () => {
    for (const t of BOOKING_TRANSITIONS.filter((t) => t.systemOnly)) {
      expect(t.allowedRoles).toEqual([])
    }
  })

  it('non-system transitions always declare at least one role', () => {
    for (const t of BOOKING_TRANSITIONS.filter((t) => !t.systemOnly)) {
      expect(t.allowedRoles.length).toBeGreaterThan(0)
    }
  })

  it('only drivers move a trip through the pickup→trip sequence', () => {
    const driverPath: Array<[BookingStatus, BookingStatus]> = [
      ['offered', 'accepted'],
      ['accepted', 'driver_arriving'],
      ['driver_arriving', 'arrived'],
      ['arrived', 'in_progress'],
      ['in_progress', 'completed'],
    ]
    for (const [from, to] of driverPath) {
      const t = BOOKING_TRANSITIONS.find((t) => t.from === from && t.to === to)
      expect(t, `${from}→${to} must exist`).toBeDefined()
      expect(t!.systemOnly).toBeFalsy()
      expect(t!.allowedRoles).toContain('driver')
    }
  })

  it('riders can cancel from any pre-completion state but never after', () => {
    for (const from of ['requested', 'offered', 'accepted', 'driver_arriving'] as const) {
      const t = BOOKING_TRANSITIONS.find(
        (t) => t.from === from && t.to === 'cancelled_by_rider',
      )
      expect(t, `rider cancel from ${from}`).toBeDefined()
      expect(t!.allowedRoles).toContain('rider')
    }
    for (const from of ['arrived', 'in_progress', 'completed'] as const) {
      expect(
        BOOKING_TRANSITIONS.some((t) => t.from === from && t.to === 'cancelled_by_rider'),
        `no rider cancel from ${from}`,
      ).toBe(false)
    }
  })

  it('only superadmins can raise disputes, and only on completed/in_progress trips', () => {
    const disputes = BOOKING_TRANSITIONS.filter((t) => t.to === 'disputed')
    expect(disputes.map((t) => t.from).sort()).toEqual(['completed', 'in_progress'])
    for (const t of disputes) {
      expect(t.allowedRoles).toEqual(['superadmin'])
    }
  })

  it('terminal statuses never re-enter the flow — except completed → disputed', () => {
    for (const t of BOOKING_TRANSITIONS) {
      if (TERMINAL_BOOKING_STATUSES.includes(t.from)) {
        expect(t.from).toBe('completed')
        expect(t.to).toBe('disputed')
      }
    }
  })

  it('every requested booking can reach offered or a cancellation', () => {
    const fromRequested = BOOKING_TRANSITIONS.filter((t) => t.from === 'requested')
    const targets = fromRequested.map((t) => t.to).sort()
    expect(targets).toEqual(['cancelled_by_rider', 'offered'])
  })

  it('ACTIVE and TERMINAL status lists partition every status exactly once', () => {
    const all = [...ACTIVE_BOOKING_STATUSES, ...TERMINAL_BOOKING_STATUSES].sort()
    expect(all).toEqual([...ALL_STATUSES].sort())
  })
})
