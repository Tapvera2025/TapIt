import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  listOrganizationModules,
  changeOrganizationModule,
  applyOrganizationModuleChanges,
  catalog,
} from './service.js';

const moduleChangeSchema = z
  .object({
    enable: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
    disable: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  })
  .strict();

export async function catalogController(_req: Request, res: Response) {
  res.json({ success: true, data: await catalog() });
}
export async function organizationModulesController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await listOrganizationModules(String(req.params['id'] ?? '')),
  });
}
export async function changeModulesController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await applyOrganizationModuleChanges(
      String(req.params['id'] ?? ''),
      moduleChangeSchema.parse(req.body ?? {}),
      req.platformCtx!.principal.platformUserId,
    ),
  });
}
export async function enableController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await changeOrganizationModule(
      String(req.params['id'] ?? ''),
      String(req.params['moduleKey'] ?? ''),
      true,
      req.platformCtx!.principal.platformUserId,
    ),
  });
}
export async function disableController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await changeOrganizationModule(
      String(req.params['id'] ?? ''),
      String(req.params['moduleKey'] ?? ''),
      false,
      req.platformCtx!.principal.platformUserId,
    ),
  });
}
