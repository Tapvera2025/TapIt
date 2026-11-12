import { z } from 'zod';
import {
  DASHBOARD_WIDGET_IDS,
  type DashboardLayoutItem,
  type DashboardPreferences,
  type DashboardPreferencesInput,
  type DashboardWidgetId,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { readPreferences, writePreferences } from './repository.js';

const widgetIdSchema = z.enum(DASHBOARD_WIDGET_IDS as unknown as [DashboardWidgetId, ...DashboardWidgetId[]]);

const layoutItemSchema = z.object({
  i: widgetIdSchema,
  instanceId: z.string().uuid().optional(),
  x: z.number().int().min(0).max(48),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(48),
  h: z.number().int().min(1).max(48),
}).transform((item): DashboardLayoutItem => {
  const { instanceId, ...placement } = item;
  return instanceId ? { ...placement, instanceId } : placement;
});

export const preferencesInputSchema = z.object({
  layout: z.array(layoutItemSchema).max(DASHBOARD_WIDGET_IDS.length * 4),
  hidden: z.array(widgetIdSchema).max(DASHBOARD_WIDGET_IDS.length),
}).superRefine(({ layout }, context) => {
  const keys = new Set<string>();
  layout.forEach((item, index) => {
    const key = `${item.i}:${item.instanceId ?? 'default'}`;
    if (keys.has(key)) {
      context.addIssue({ code: 'custom', path: ['layout', index], message: 'Dashboard widget instances must be unique.' });
    }
    keys.add(key);
  });
});

export async function getPreferences(ctx: RequestContext): Promise<DashboardPreferences> {
  return readPreferences(ctx);
}

export async function savePreferences(
  ctx: RequestContext,
  input: DashboardPreferencesInput,
): Promise<DashboardPreferences> {
  return writePreferences(ctx, input);
}
