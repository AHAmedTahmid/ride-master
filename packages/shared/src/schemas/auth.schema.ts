import { z } from 'zod'
import { PHONE_REGEX } from '../constants'

// ── Phone normalisation helper ─────────────────────────────────────────────────
const phoneSchema = z
  .string()
  .trim()
  .transform((val) => {
    // Strip spaces and dashes
    const cleaned = val.replace(/[\s\-]/g, '')
    // Already full format
    if (/^\+960\d{7}$/.test(cleaned)) return cleaned
    // Local 7-digit number
    if (/^\d{7}$/.test(cleaned)) return `+960${cleaned}`
    return cleaned
  })
  .refine((val) => PHONE_REGEX.test(val), {
    message: 'Phone must be a valid Maldivian number in +960XXXXXXX format',
  })

// ── Auth schemas ──────────────────────────────────────────────────────────────

export const RequestOtpSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(['login', 'register', 'verify']).default('login'),
})

export const VerifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d{6}$/, 'OTP must be digits'),
  purpose: z.enum(['login', 'register', 'verify']).default('login'),
})

export const AdminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const VerifyTotpSchema = z.object({
  email: z.string().email(),
  totpToken: z.string().length(6, 'TOTP must be 6 digits').regex(/^\d{6}$/),
  /** Temporary token issued after password verification, before TOTP */
  preAuthToken: z.string().min(1),
})

export const SwitchRoleSchema = z.object({
  role: z.enum(['superadmin', 'company_owner', 'driver', 'rider']),
  companyId: z.string().optional(), // required when switching to company_owner or driver
})

export type RequestOtpDto = z.infer<typeof RequestOtpSchema>
export type VerifyOtpDto = z.infer<typeof VerifyOtpSchema>
export type AdminLoginDto = z.infer<typeof AdminLoginSchema>
export type VerifyTotpDto = z.infer<typeof VerifyTotpSchema>
export type SwitchRoleDto = z.infer<typeof SwitchRoleSchema>
