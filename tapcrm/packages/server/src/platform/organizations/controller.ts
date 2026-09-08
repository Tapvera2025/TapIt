import type { Request, Response } from 'express';
import { createOrganization, getOrganization, deleteOrganization, changeStatus, updateOrganization } from './service.js';
import { createOrganizationSchema, updateOrganizationSchema } from './validators.js';
import { listOrganizations } from './repository.js';
import { adminStatus } from './admin.js';

export async function listController(_req: Request, res: Response) {
  res.json({ success: true, data: await listOrganizations() });
}

export async function getController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await getOrganization(String(req.params['id'] ?? '')),
  });
}

export async function deleteController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await deleteOrganization(String(req.params['id'] ?? '')),
  });
}

export async function createController(req: Request, res: Response) {
  const body = createOrganizationSchema.parse(req.body);
  const result = await createOrganization(
    body,
    req.platformCtx!.principal.platformUserId,
  );
  res.status(201).json({ success: true, data: result });
}

export async function updateController(req: Request, res: Response) {
  const body = updateOrganizationSchema.parse(req.body);
  res.json({
    success: true,
    data: await updateOrganization(
      String(req.params['id'] ?? ''),
      body,
      req.platformCtx!.principal.platformUserId,
    ),
  });
}

export async function activateController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await changeStatus(String(req.params['id'] ?? ''), 'active'),
  });
}

export async function adminController(req: Request, res: Response) {
  res.json({ success: true, data: await adminStatus(String(req.params['id'] ?? '')) });
}

export async function suspendController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await changeStatus(String(req.params['id'] ?? ''), 'suspended'),
  });
}
