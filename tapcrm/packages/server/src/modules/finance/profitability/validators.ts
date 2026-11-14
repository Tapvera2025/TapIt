import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().date();
const money = z.string().regex(/^\d+(\.\d{1,2})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero');
const hours = z.string().regex(/^\d+(\.\d{1,4})?$/).refine((value) => Number(value) > 0, 'Hours must be greater than zero');
const reason = z.string().trim().min(3).max(1000);
const periodFields = { periodStart: date, periodEnd: date };
const withPeriod = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.extend(periodFields).refine((v) => {
  const value = v as { periodStart: string; periodEnd: string };
  return value.periodEnd >= value.periodStart;
}, 'Period end must not precede period start');

export const budgetSchema = withPeriod(z.object({ projectId: uuid, name: z.string().trim().min(2).max(200), currency: z.string().regex(/^[A-Z]{3}$/), version: z.number().int().min(1).default(1), reason, lines: z.array(z.object({ category: z.enum(['staff_time','vendor','advertising','other']), amount: money, reason })).min(1) }));
export const rateSchema = z.object({ userId: uuid.optional(), roleCode: z.string().trim().min(1).max(80).optional(), currency: z.string().regex(/^[A-Z]{3}$/), hourlyRate: money, effectiveFrom: date, effectiveTo: date.nullable().optional(), reason }).refine((v) => Boolean(v.userId) !== Boolean(v.roleCode), 'Provide exactly one of userId or roleCode');
export const timeCostSchema = z.object({ projectId: uuid, userId: uuid, sourceType: z.string().trim().min(1).max(80), sourceId: uuid, workDate: date, hours, billableHours: hours.optional(), currency: z.string().regex(/^[A-Z]{3}$/), reason }).refine((v) => !v.billableHours || Number(v.billableHours) <= Number(v.hours), 'Billable hours cannot exceed total hours');
export const directCostSchema = z.object({ projectId: uuid.optional(), category: z.enum(['vendor','other']), allocationMode: z.enum(['direct','shared']), sourceType: z.string().trim().min(1).max(80), sourceId: uuid, workDate: date, amount: money, currency: z.string().regex(/^[A-Z]{3}$/), description: z.string().trim().min(3).max(300), reason }).refine((v) => v.allocationMode === 'shared' || Boolean(v.projectId), 'A direct cost must identify a project');
export const revenueSchema = z.object({ projectId: uuid, sourceType: z.string().trim().min(1).max(80), sourceId: uuid, periodStart: date, amount: money, currency: z.string().regex(/^[A-Z]{3}$/), reason });
export const allocationSchema = withPeriod(z.object({ driver: z.enum(['equal','budget','approved_hours']), reason }));
export const decisionSchema = z.object({ reason });
export const marginSchema = withPeriod(z.object({ projectId: uuid, currency: z.string().regex(/^[A-Z]{3}$/), reason }));
export const payrollImportSchema = z.object({ runId: uuid, reason });
export const metricSchema = withPeriod(z.object({ projectId: uuid, currency: z.string().regex(/^[A-Z]{3}$/), availableHours: hours, theoreticalValue: money, reason }));
export const leakageSchema = z.object({ periodStart: date, periodEnd: date }).refine((v) => v.periodEnd >= v.periodStart, 'Period end must not precede period start');
export const leakageDecisionSchema = z.object({ status: z.enum(['acknowledged','resolved']), resolution: reason });
export const advertisingAccountSchema = z.object({ provider: z.enum(['google_ads','meta_ads','manual']), externalAccountId: z.string().trim().min(1).max(160), name: z.string().trim().min(2).max(200), projectId: uuid.optional(), clientId: uuid.optional(), fundingModel: z.enum(['client_funded','company_funded','shared']), currency: z.string().regex(/^[A-Z]{3}$/), credentials: z.record(z.string()).optional(), freshnessHours: z.number().int().min(1).max(8760).default(48), reason });
export const advertisingCredentialsSchema = z.object({ credentials: z.record(z.string()).refine((v) => Object.values(v).every((value) => value.trim().length > 0), 'Credentials cannot contain empty values'), reason });
export const advertisingSyncSchema = z.object({ periodStart: date, periodEnd: date }).refine((v) => v.periodEnd >= v.periodStart, 'Period end must not precede period start');
export const manualSpendSchema = z.object({ spendDate: date, campaignName: z.string().trim().max(200).nullable().optional(), externalSpendId: z.string().trim().min(1).max(160), amount: money, currency: z.string().regex(/^[A-Z]{3}$/), reason });

export type BudgetInput = z.infer<typeof budgetSchema>;
export type RateInput = z.infer<typeof rateSchema>;
export type TimeCostInput = z.infer<typeof timeCostSchema>;
export type DirectCostInput = z.infer<typeof directCostSchema>;
export type RevenueInput = z.infer<typeof revenueSchema>;
export type AllocationInput = z.infer<typeof allocationSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type MarginInput = z.infer<typeof marginSchema>;
export type PayrollImportInput = z.infer<typeof payrollImportSchema>;
export type MetricInput = z.infer<typeof metricSchema>;
export type LeakageInput = z.infer<typeof leakageSchema>;
export type LeakageDecisionInput = z.infer<typeof leakageDecisionSchema>;
export type AdvertisingAccountInput = z.infer<typeof advertisingAccountSchema>;
export type AdvertisingSyncInput = z.infer<typeof advertisingSyncSchema>;
export type AdvertisingCredentialsInput = z.infer<typeof advertisingCredentialsSchema>;
export type ManualSpendInput = z.infer<typeof manualSpendSchema>;
