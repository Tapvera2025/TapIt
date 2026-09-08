import type { Request, Response } from 'express';
import { listOrganizationModules, changeOrganizationModule, catalog } from './service.js';

export async function catalogController(_req: Request, res: Response) {
  res.json({ success: true, data: await catalog() });
}
export async function organizationModulesController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await listOrganizationModules(String(req.params['id'] ?? '')),
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
