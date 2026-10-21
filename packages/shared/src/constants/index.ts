/** 1 MVR = 100 laari */
export const MVR_TO_LAARI = 100 as const

/** Maldives country code */
export const MALDIVES_COUNTRY_CODE = '+960' as const

/** Phone regex: +960 followed by exactly 7 digits */
export const PHONE_REGEX = /^\+960\d{7}$/

/** OTP code length */
export const OTP_LENGTH = 6 as const

/** OTP TTL in seconds (5 minutes) */
export const OTP_TTL_SECONDS = 300 as const

/** Max OTP verification attempts before invalidation */
export const OTP_MAX_ATTEMPTS = 5 as const

/** JWT access token TTL string for jsonwebtoken */
export const JWT_ACCESS_TTL = '15m' as const

/** JWT refresh token TTL in days */
export const JWT_REFRESH_TTL_DAYS = 7 as const

/** Default booking request timeout in seconds */
export const REQUEST_TIMEOUT_SECONDS = 60 as const

/** Default global commission in basis points (10%) */
export const DEFAULT_COMMISSION_BPS = 1000 as const

/** Max vehicles for individual operator */
export const INDIVIDUAL_VEHICLE_LIMIT = 3 as const

/** New company starting credit in laari (500 MVR) */
export const NEW_COMPANY_STARTING_CREDIT_LAARI = 50_000 as const

/** Basis points divisor: 1% = 100 bps */
export const BASIS_POINTS = 10_000 as const

/** Timezone for display */
export const MALDIVES_TZ = 'Indian/Maldives' as const

/** Supported locales */
export const SUPPORTED_LOCALES = ['en', 'dv'] as const

/** Default locale */
export const DEFAULT_LOCALE = 'en' as const

/** Platform setting keys */
export const SETTINGS_KEYS = {
  DEFAULT_COMMISSION_BPS: 'default_commission_bps',
  REQUEST_TIMEOUT_SECONDS: 'request_timeout_seconds',
  SEARCH_RADIUS_KM: 'search_radius_km',
  CANCELLATION_WINDOW_SECONDS: 'cancellation_window_seconds',
  INDIVIDUAL_VEHICLE_LIMIT: 'individual_vehicle_limit',
  NEW_COMPANY_STARTING_CREDIT_LAARI: 'new_company_starting_credit_laari',
  MIN_ONLINE_DRIVERS: 'min_online_drivers',
  GST_RATE_BPS: 'gst_rate_bps',
  CANCELLATION_FEE_LAARI: 'cancellation_fee_laari',
  DAILY_SMS_BUDGET: 'daily_sms_budget',
  BOOKING_LOCATIONS_RETENTION_DAYS: 'booking_locations_retention_days',
} as const

/** Max bytes accepted for a company document upload (5 MB). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

/** Accepted document content types. */
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const

/** How long a document signed URL stays valid. */
export const DOCUMENT_URL_TTL_SECONDS = 600
