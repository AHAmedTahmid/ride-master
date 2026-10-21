import { z } from 'zod'

/** YYYY-MM-DD calendar date */
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

const CreateVehicleBase = z.object({
  vehicleTypeId: z.string().min(1),
  plateNumber: z.string().min(2).max(20),
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  year: z
    .number()
    .int()
    .min(1990)
    .max(new Date().getUTCFullYear() + 1, 'Year cannot be in the future'),
  colour: z.string().min(1).max(50),
  insuranceExpiry: DateStringSchema,
})

export const CreateVehicleSchema = CreateVehicleBase

export const UpdateVehicleSchema = CreateVehicleBase.partial()

export const CreateDriverSchema = z.object({
  phone: z.string().min(8).max(20),
  fullName: z.string().min(2).max(200),
  licenceNumber: z.string().min(1).max(100),
  licenceExpiry: DateStringSchema,
  idCardNumber: z.string().min(1).max(100).optional(),
})

export const UpdateDriverSchema = z
  .object({
    fullName: z.string().min(2).max(200).optional(),
    licenceNumber: z.string().min(1).max(100).optional(),
    licenceExpiry: DateStringSchema.optional(),
    idCardNumber: z.string().min(1).max(100).nullable().optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  })

export const CreateAssignmentSchema = z.object({
  vehiclePublicId: z.string().min(1),
})

export type CreateVehicleDto = z.infer<typeof CreateVehicleSchema>
export type UpdateVehicleDto = z.infer<typeof UpdateVehicleSchema>
export type CreateDriverDto = z.infer<typeof CreateDriverSchema>
export type UpdateDriverDto = z.infer<typeof UpdateDriverSchema>
export type CreateAssignmentDto = z.infer<typeof CreateAssignmentSchema>
