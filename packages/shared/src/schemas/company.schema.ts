import { z } from 'zod'

/** YYYY-MM-DD calendar date */
export const DateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

/** Loose "HH:MM" clock time (surcharge windows; may cross midnight). */
export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM')

export const ConsentSchema = z.object({
  document: z.enum(['terms', 'privacy', 'operator_agreement']),
  version: z.string().min(1).max(20),
})

const CreateCompanyBase = z.object({
  type: z.enum(['company', 'individual']),
  name: z.string().min(2).max(200),
  tradeName: z.string().min(1).max(200).optional(),
  registrationNumber: z.string().min(1).max(100).optional(),
  licenceNumber: z.string().min(1).max(100),
  phone: z.string().min(8).max(20),
  email: z.string().email().max(320).optional(),
  serviceAreaIds: z.array(z.string().min(1)).min(1, 'At least one service area required'),
  consents: z
    .array(ConsentSchema)
    .min(2, 'Terms and privacy consent are required')
    .superRefine((consents, ctx) => {
      const docs = consents.map((c) => c.document)
      if (!docs.includes('terms')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Terms consent is required' })
      }
      if (!docs.includes('privacy')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Privacy consent is required' })
      }
    }),
  /** Required for individuals: becomes the owner-driver's licence expiry. */
  licenceExpiry: DateStringSchema.optional(),
})

/**
 * Company signup payload.
 * - type 'company' requires a registration number (licence expiry lives on
 *   the uploaded licence document).
 * - type 'individual' requires licenceExpiry (the driver row it creates).
 */
export const CreateCompanySchema = CreateCompanyBase.superRefine((v, ctx) => {
  if (v.type === 'company' && !v.registrationNumber) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['registrationNumber'],
      message: 'Registration number is required for a company',
    })
  }
  if (v.type === 'individual' && !v.licenceExpiry) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['licenceExpiry'],
      message: 'Licence expiry is required for an individual operator',
    })
  }
})

/**
 * Profile edits. Editing identity fields (name, trade name, registration or
 * licence number) on an approved company sends it back to review.
 */
export const UpdateCompanySchema = z.object({
  name: z.string().min(2).max(200).optional(),
  tradeName: z.string().min(1).max(200).nullable().optional(),
  registrationNumber: z.string().min(1).max(100).nullable().optional(),
  licenceNumber: z.string().min(1).max(100).optional(),
  phone: z.string().min(8).max(20).optional(),
  email: z.string().email().max(320).nullable().optional(),
})

/** Which documents each operator type must upload before submission. */
export const COMPANY_REQUIRED_DOCUMENTS = {
  company: ['licence', 'registration', 'insurance'],
  individual: ['licence', 'insurance'],
} as const

export const UploadDocumentSchema = z
  .object({
    type: z.enum(['licence', 'registration', 'insurance']),
    expiryDate: DateStringSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const required = v.type !== 'registration'
    if (required && !v.expiryDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiryDate'],
        message: `Expiry date is required for '${v.type}' documents`,
      })
    }
  })

export const RejectCompanySchema = z.object({
  reason: z.string().min(3).max(500),
})

export const SuspendCompanySchema = z.object({
  reason: z.string().min(3).max(500),
})

export const SetServiceAreasSchema = z.object({
  areaIds: z.array(z.string().min(1)).min(1, 'At least one service area required'),
})

export const CreateFareSchema = z.object({
  vehicleTypeId: z.string().min(1),
  fromAreaId: z.string().min(1),
  toAreaId: z.string().min(1),
  priceLaari: z.number().int().positive('Price must be a positive integer in laari'),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
})

export const UpdateFareSchema = z
  .object({
    priceLaari: z.number().int().positive().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.priceLaari !== undefined || v.active !== undefined, {
    message: 'Provide priceLaari and/or active',
  })

export const CreateSurchargeSchema = z
  .object({
    name: z.string().min(1).max(100),
    amountLaari: z.number().int().positive().optional(),
    percentBps: z.number().int().min(1).max(10_000).optional(),
    timeFrom: ClockTimeSchema.optional(),
    timeTo: ClockTimeSchema.optional(),
    active: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.amountLaari === undefined) === (v.percentBps === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentBps'],
        message: 'Provide exactly one of amountLaari or percentBps',
      })
    }
    if ((v.timeFrom === undefined) !== (v.timeTo === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeTo'],
        message: 'timeFrom and timeTo must be provided together (may cross midnight)',
      })
    }
  })

export const UpdateSurchargeSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    amountLaari: z.number().int().positive().optional(),
    percentBps: z.number().int().min(1).max(10_000).optional(),
    timeFrom: ClockTimeSchema.optional().nullable(),
    timeTo: ClockTimeSchema.optional().nullable(),
    active: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.amountLaari !== undefined && v.percentBps !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['percentBps'],
        message: 'Provide amountLaari or percentBps, not both',
      })
    }
    if (
      v.timeFrom !== undefined &&
      v.timeTo !== undefined &&
      v.timeFrom !== null &&
      v.timeTo === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeTo'],
        message: 'timeFrom and timeTo must be cleared together',
      })
    }
  })

export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>
export type UploadDocumentDto = z.infer<typeof UploadDocumentSchema>
export type CreateFareDto = z.infer<typeof CreateFareSchema>
export type UpdateFareDto = z.infer<typeof UpdateFareSchema>
export type CreateSurchargeDto = z.infer<typeof CreateSurchargeSchema>
export type UpdateSurchargeDto = z.infer<typeof UpdateSurchargeSchema>
