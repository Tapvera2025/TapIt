import { identityDownload, identityRequest } from '../../../identity/api/authApi.js';
import type { ProjectScreenshot, ReportPeriod, ScreenshotPage } from '../types.js';

function path(projectId: string, suffix = ''): string { return `/api/projects/${encodeURIComponent(projectId)}/reports/screenshots${suffix}`; }
export function getScreenshots(projectId: string, page: number, period: ReportPeriod, pageSize = 12): Promise<ScreenshotPage> { return identityRequest(`${path(projectId)}?page=${page}&pageSize=${pageSize}&period=${period}`); }
export function uploadScreenshots(projectId: string, screenshots: Array<{ fileName: string; mimeType: string; fileBase64: string; title: string; description: string }>): Promise<{ uploaded: ProjectScreenshot[]; uploadedCount: number; failedCount: number }> { return identityRequest(path(projectId), { method: 'POST', body: JSON.stringify({ screenshots }) }); }
export async function getScreenshotContent(projectId: string, screenshotId: string): Promise<{ mimeType: string; dataUrl: string }> { const response = await identityDownload(path(projectId, `/${encodeURIComponent(screenshotId)}/content`)); return { mimeType: response.type, dataUrl: URL.createObjectURL(response) }; }
export function updateScreenshot(projectId: string, screenshotId: string, input: { title: string; description: string }): Promise<ProjectScreenshot> { return identityRequest(path(projectId, `/${encodeURIComponent(screenshotId)}`), { method: 'PATCH', body: JSON.stringify(input) }); }
export function deleteScreenshot(projectId: string, screenshotId: string): Promise<{ deleted: true }> { return identityRequest(path(projectId, `/${encodeURIComponent(screenshotId)}`), { method: 'DELETE' }); }
