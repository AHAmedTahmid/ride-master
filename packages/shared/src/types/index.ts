// ─────────────────────────────────────────────────────────────────────────────
// Ride Master — Shared Types
// All domain types used by both the API and the web app.
// ─────────────────────────────────────────────────────────────────────────────

// ── Users & Roles ─────────────────────────────────────────────────────────────

export type Role = 'superadmin' | 'company_owner' | 'driver' | 'rider'

export type AdminLevel = 'super' | 'verifier' | 'support' | 'finance'

export type UserStatus = 'active' | 'suspended' | 'deleted'

export type Language = 'en' | 'dv'

// ── Companies ─────────────────────────────────────────────────────────────────

export type CompanyType = 'company' | 'individual'

export type CompanyStatus = 'pending' | 'approved' | 'rejected' | 'suspended'

export type DocumentType = 'licence' | 'registration' | 'insurance'

export type DocumentStatus = 'pending' | 'verified' | 'rejected' | 'expired'

export type StaffRole = 'manager' | 'dispatcher'

// ── Fleet & Drivers ───────────────────────────────────────────────────────────

export type VehicleStatus = 'active' | 'maintenance' | 'retired'

export type DriverStatus = 'pending' | 'active' | 'suspended'

export type DriverState = 'offline' | 'online' | 'on_trip'

// ── Bookings ──────────────────────────────────────────────────────────────────

export type BookingStatus =
  | 'requested'
  | 'offered'
  | 'accepted'
  | 'driver_arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled_by_rider'
  | 'cancelled_by_driver'
  | 'cancelled_by_company'
  | 'expired'
  | 'no_show'
  | 'disputed'

export type PaymentMethod = 'cash' | 'card' | 'wallet'

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'failed'

export type OfferResponse = 'accepted' | 'declined' | 'timeout'

// ── Money ─────────────────────────────────────────────────────────────────────

export type LedgerType = 'top_up' | 'commission_charge' | 'adjustment' | 'payout'

export type SettlementStatus = 'open' | 'issued' | 'paid'

export type CommissionScope = 'global' | 'company'

export type RefundStatus = 'pending' | 'approved' | 'rejected' | 'processed'

// ── Trust & Support ───────────────────────────────────────────────────────────

export type NotificationChannel = 'push' | 'sms' | 'in_app'

export type ComplaintAgainstType = 'driver' | 'company' | 'rider'

export type ComplaintStatus = 'open' | 'investigating' | 'resolved' | 'closed'

// ── Audit ─────────────────────────────────────────────────────────────────────

export const AuditAction = {
  LOGIN_ADMIN: 'LOGIN_ADMIN',
  LOGIN_OTP: 'LOGIN_OTP',
  LOGOUT: 'LOGOUT',
  ROLE_SWITCH: 'ROLE_SWITCH',
  COMPANY_CREATED: 'COMPANY_CREATED',
  COMPANY_UPDATED: 'COMPANY_UPDATED',
  COMPANY_SUBMITTED: 'COMPANY_SUBMITTED',
  COMPANY_APPROVED: 'COMPANY_APPROVED',
  COMPANY_REJECTED: 'COMPANY_REJECTED',
  COMPANY_SUSPENDED: 'COMPANY_SUSPENDED',
  COMPANY_RESUMED: 'COMPANY_RESUMED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_REMOVED: 'DOCUMENT_REMOVED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  VEHICLE_CREATED: 'VEHICLE_CREATED',
  VEHICLE_UPDATED: 'VEHICLE_UPDATED',
  VEHICLE_DELETED: 'VEHICLE_DELETED',
  DRIVER_CREATED: 'DRIVER_CREATED',
  DRIVER_UPDATED: 'DRIVER_UPDATED',
  DRIVER_DELETED: 'DRIVER_DELETED',
  DRIVER_APPROVED: 'DRIVER_APPROVED',
  DRIVER_SUSPENDED: 'DRIVER_SUSPENDED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  DRIVER_UNASSIGNED: 'DRIVER_UNASSIGNED',
  AREA_CREATED: 'AREA_CREATED',
  AREA_UPDATED: 'AREA_UPDATED',
  AREA_DELETED: 'AREA_DELETED',
  VEHICLE_TYPE_CREATED: 'VEHICLE_TYPE_CREATED',
  VEHICLE_TYPE_UPDATED: 'VEHICLE_TYPE_UPDATED',
  VEHICLE_TYPE_DELETED: 'VEHICLE_TYPE_DELETED',
  SUGGESTED_FARE_CREATED: 'SUGGESTED_FARE_CREATED',
  SUGGESTED_FARE_UPDATED: 'SUGGESTED_FARE_UPDATED',
  SUGGESTED_FARE_DELETED: 'SUGGESTED_FARE_DELETED',
  FARE_CREATED: 'FARE_CREATED',
  FARE_UPDATED: 'FARE_UPDATED',
  FARE_DELETED: 'FARE_DELETED',
  SURCHARGE_CREATED: 'SURCHARGE_CREATED',
  SURCHARGE_UPDATED: 'SURCHARGE_UPDATED',
  SURCHARGE_DELETED: 'SURCHARGE_DELETED',
  COMMISSION_CHANGED: 'COMMISSION_CHANGED',
  REFUND_APPROVED: 'REFUND_APPROVED',
  REFUND_REJECTED: 'REFUND_REJECTED',
  BOOKING_CANCELLED_ADMIN: 'BOOKING_CANCELLED_ADMIN',
  PLATFORM_SETTING_CHANGED: 'PLATFORM_SETTING_CHANGED',
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_SUSPENDED: 'ADMIN_SUSPENDED',
  SETTLEMENT_ISSUED: 'SETTLEMENT_ISSUED',
} as const

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction]

// ── Booking State Machine ─────────────────────────────────────────────────────

export interface BookingTransition {
  from: BookingStatus
  to: BookingStatus
  allowedRoles: Role[]
  /** If true, only the system (scheduler / expiry job) can trigger this */
  systemOnly?: boolean
}

/**
 * Complete allowed transition table.
 * Any transition NOT listed here must be rejected with 422.
 */
export const BOOKING_TRANSITIONS: BookingTransition[] = [
  // System creates the booking
  { from: 'requested', to: 'offered', allowedRoles: [], systemOnly: true },
  // Driver accepts
  { from: 'offered', to: 'accepted', allowedRoles: ['driver'] },
  // Driver declined by all / timeout
  { from: 'offered', to: 'expired', allowedRoles: [], systemOnly: true },
  // Driver marks they are heading to pickup
  { from: 'accepted', to: 'driver_arriving', allowedRoles: ['driver'] },
  // Driver has arrived at pickup
  { from: 'driver_arriving', to: 'arrived', allowedRoles: ['driver'] },
  // Trip started
  { from: 'arrived', to: 'in_progress', allowedRoles: ['driver'] },
  // Trip completed
  { from: 'in_progress', to: 'completed', allowedRoles: ['driver'] },
  // Rider cancels before driver arrives
  { from: 'requested', to: 'cancelled_by_rider', allowedRoles: ['rider', 'superadmin'] },
  { from: 'offered', to: 'cancelled_by_rider', allowedRoles: ['rider', 'superadmin'] },
  { from: 'accepted', to: 'cancelled_by_rider', allowedRoles: ['rider', 'superadmin'] },
  { from: 'driver_arriving', to: 'cancelled_by_rider', allowedRoles: ['rider', 'superadmin'] },
  // Driver cancels
  { from: 'accepted', to: 'cancelled_by_driver', allowedRoles: ['driver', 'superadmin'] },
  { from: 'driver_arriving', to: 'cancelled_by_driver', allowedRoles: ['driver', 'superadmin'] },
  // Company cancels
  { from: 'accepted', to: 'cancelled_by_company', allowedRoles: ['company_owner', 'superadmin'] },
  {
    from: 'driver_arriving',
    to: 'cancelled_by_company',
    allowedRoles: ['company_owner', 'superadmin'],
  },
  // No-show (driver marks rider absent)
  { from: 'arrived', to: 'no_show', allowedRoles: ['driver'] },
  // Admin disputes
  { from: 'completed', to: 'disputed', allowedRoles: ['superadmin'] },
  { from: 'in_progress', to: 'disputed', allowedRoles: ['superadmin'] },
]

// ── Active booking statuses ───────────────────────────────────────────────────

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  'requested',
  'offered',
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
]

export const TERMINAL_BOOKING_STATUSES: BookingStatus[] = [
  'completed',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'cancelled_by_company',
  'expired',
  'no_show',
  'disputed',
]

// ── JWT Payload ───────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string // user public_id
  phone?: string
  email?: string
  roles: Role[]
  activeRole: Role
  companyId?: string // public_id of active company (for company_owner / driver)
  adminLevel?: AdminLevel
  sessionId: string // session public_id
  iat?: number
  exp?: number
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

// ── API Error ─────────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number
  error: string
  message: string
  requestId?: string
  fields?: { field: string; message: string }[]
}
