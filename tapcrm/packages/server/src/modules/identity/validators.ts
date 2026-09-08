import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
  deviceLabel: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMetres: z.number().int().nonnegative().max(100000).nullable().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
