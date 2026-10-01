import { z } from 'zod';
import { CLIENT_REGIONS } from './types.js';

const emailField = z.string().trim().toLowerCase().email('Enter a valid email address').max(320);
const passwordField = z.string().min(12, 'Password must be at least 12 characters').max(200);

export const createClientSchema = z.object({
  clientName: z.string().trim().min(1, 'Client name is required').max(200),
  businessName: z.string().trim().min(1, 'Business name is required').max(200),
  email: emailField,
  password: passwordField,
  region: z.enum(CLIENT_REGIONS),
});

export const updateClientSchema = z.object({
  clientName: z.string().trim().min(1).max(200).optional(),
  businessName: z.string().trim().min(1).max(200).optional(),
  region: z.enum(CLIENT_REGIONS).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const resetClientCredentialsSchema = z.object({
  password: passwordField,
});

export const clientListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ResetClientCredentialsInput = z.infer<typeof resetClientCredentialsSchema>;
export type ClientListQueryInput = z.infer<typeof clientListQuerySchema>;
