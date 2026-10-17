import { z } from 'zod'

// ── Search ────────────────────────────────────────────────────────────────────

export const SearchSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupAddress: z.string().max(500).optional(),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  dropoffAddress: z.string().max(500).optional(),
  fromAreaId: z.string().optional(),
  toAreaId: z.string().optional(),
  passengers: z.number().int().min(1).max(20).default(1),
  luggageCount: z.number().int().min(0).max(20).default(0),
  vehicleTypeId: z.string().optional(),
  sortBy: z.enum(['price', 'eta', 'rating']).default('price'),
})

// ── Create Booking ─────────────────────────────────────────────────────────────

export const CreateBookingSchema = z.object({
  idempotencyKey: z.string().uuid('idempotencyKey must be a UUID v4'),
  companyId: z.string().min(1),
  vehicleTypeId: z.string().min(1),
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupAddress: z.string().max(500).optional(),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  dropoffAddress: z.string().max(500).optional(),
  fromAreaId: z.string().min(1),
  toAreaId: z.string().min(1),
  passengers: z.number().int().min(1).max(20).default(1),
  luggageCount: z.number().int().min(0).max(20).default(0),
  paymentMethod: z.enum(['cash', 'card', 'wallet']).default('cash'),
  /** Quoted price shown to rider (in laari) — must match server's computation */
  quotedPriceLaari: z.number().int().positive(),
})

// ── Cancel Booking ─────────────────────────────────────────────────────────────

export const CancelBookingSchema = z.object({
  reason: z.string().min(1).max(500),
})

// ── Driver actions ─────────────────────────────────────────────────────────────

export const DriverActionSchema = z.object({
  action: z.enum(['accept', 'decline', 'arriving', 'arrived', 'start', 'complete']),
})

export type SearchDto = z.infer<typeof SearchSchema>
export type CreateBookingDto = z.infer<typeof CreateBookingSchema>
export type CancelBookingDto = z.infer<typeof CancelBookingSchema>
export type DriverActionDto = z.infer<typeof DriverActionSchema>
