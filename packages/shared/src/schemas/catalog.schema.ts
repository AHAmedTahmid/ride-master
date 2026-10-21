import { z } from 'zod'

const WktPolygonSchema = z
  .string()
  .min(11)
  .max(10_000)
  .regex(/^\s*POLYGON\s*\(/i, 'geometryWkt must be a POLYGON(...) string')

export const CreateAreaSchema = z.object({
  nameEn: z.string().min(1).max(200),
  nameDv: z.string().min(1).max(200),
  type: z.string().min(1).max(50).default('zone'),
  geometryWkt: WktPolygonSchema,
  active: z.boolean().optional(),
})

export const UpdateAreaSchema = z
  .object({
    nameEn: z.string().min(1).max(200).optional(),
    nameDv: z.string().min(1).max(200).optional(),
    type: z.string().min(1).max(50).optional(),
    geometryWkt: WktPolygonSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  })

export const CreateVehicleTypeSchema = z.object({
  name: z.string().min(1).max(100),
  seats: z.number().int().min(1).max(60),
  luggageCapacity: z.number().int().min(0).max(30).default(2),
  sortOrder: z.number().int().min(0).max(9_999).default(0),
})

export const UpdateVehicleTypeSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    seats: z.number().int().min(1).max(60).optional(),
    luggageCapacity: z.number().int().min(0).max(30).optional(),
    sortOrder: z.number().int().min(0).max(9_999).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  })

export const CreateSuggestedFareSchema = z
  .object({
    fromAreaId: z.string().min(1),
    toAreaId: z.string().min(1),
    vehicleTypeId: z.string().min(1),
    priceLaari: z.number().int().positive('Price must be a positive integer in laari'),
  })
  .refine((v) => v.fromAreaId !== v.toAreaId, {
    message: 'fromAreaId and toAreaId must differ',
    path: ['toAreaId'],
  })

export const UpdateSuggestedFareSchema = z.object({
  priceLaari: z.number().int().positive(),
})

export type CreateAreaDto = z.infer<typeof CreateAreaSchema>
export type UpdateAreaDto = z.infer<typeof UpdateAreaSchema>
export type CreateVehicleTypeDto = z.infer<typeof CreateVehicleTypeSchema>
export type UpdateVehicleTypeDto = z.infer<typeof UpdateVehicleTypeSchema>
export type CreateSuggestedFareDto = z.infer<typeof CreateSuggestedFareSchema>
export type UpdateSuggestedFareDto = z.infer<typeof UpdateSuggestedFareSchema>
