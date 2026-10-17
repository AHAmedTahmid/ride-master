import { z } from 'zod'

export const CreateCompanySchema = z.object({
  type: z.enum(['company', 'individual']),
  name: z.string().min(2).max(200),
  tradeName: z.string().max(200).optional(),
  registrationNumber: z.string().max(100).optional(),
  licenceNumber: z.string().min(1).max(100),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional(),
  serviceAreaIds: z.array(z.string()).min(1, 'At least one service area required'),
})

export const UpdateCompanySchema = CreateCompanySchema.partial().omit({ type: true })

export const CreateFareSchema = z.object({
  vehicleTypeId: z.string().min(1),
  fromAreaId: z.string().min(1),
  toAreaId: z.string().min(1),
  priceLaari: z.number().int().positive('Price must be a positive integer in laari'),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
})

export const UpdateFareSchema = z.object({
  priceLaari: z.number().int().positive(),
})

export type CreateCompanyDto = z.infer<typeof CreateCompanySchema>
export type UpdateCompanyDto = z.infer<typeof UpdateCompanySchema>
export type CreateFareDto = z.infer<typeof CreateFareSchema>
export type UpdateFareDto = z.infer<typeof UpdateFareSchema>
