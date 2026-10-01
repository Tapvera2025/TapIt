import { z } from 'zod';
import {
  DASHBOARD_WIDGET_IDS,
  type DashboardPreferences,
  type DashboardPreferencesInput,
  type DashboardWidgetId,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { readPreferences, writePreferences } from './repository.js';

const widgetIdSchema = z.enum(DASHBOARD_WIDGET_IDS as unknown as [DashboardWidgetId, ...DashboardWidgetId[]]);

const layoutItemSchema = z.object({
  i: widgetIdSchema,
  x: z.number().int().min(0).max(48),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(48),
  h: z.number().int().min(1).max(48),
});

export const preferencesInputSchema = z.object({
  layout: z.array(layoutItemSchema).max(DASHBOARD_WIDGET_IDS.length),
  hidden: z.array(widgetIdSchema).max(DASHBOARD_WIDGET_IDS.length),
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
