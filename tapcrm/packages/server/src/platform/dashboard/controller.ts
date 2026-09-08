import type { Request, Response } from 'express';
import { getStats } from './service.js';
export async function dashboardController(_req: Request, res: Response) {
  res.json({ success: true, data: await getStats() });
}
export async function statsController(_req: Request, res: Response) {
  res.json({ success: true, data: await getStats() });
}
