#!/usr/bin/env tsx
/**
 * TapCRM Comprehensive End-to-End API Test Suite
 *
 * Exercises all implemented API domains against the running server:
 * 1. Public Health & Discovery APIs
 * 2. Platform Control Plane (Master Admin) APIs
 * 3. Tenant Identity & Session Management APIs
 * 4. Organization Structure & Chart APIs
 * 5. Employee Directory & Provisioning APIs
 * 6. Task Management & Workflow APIs
 * 7. Security & Error Handling (Authentication / Authorization / Validation)
 *
 * Usage:
 *   npx tsx tools/api-test-suite.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(ROOT, '.env');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:4000';
const PLATFORM_ADMIN_EMAIL = process.env['PLATFORM_ADMIN_EMAIL'] ?? 'master@tapvera.io';
const TENANT_ADMIN_EMAIL = process.env['TEST_TENANT_ADMIN_EMAIL'] ?? 'admin@tapvera.io';

// Credentials come from the environment (or .env) only — never from source.
function requiredEnv(name: string, purpose: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Set ${name} (${purpose}) in the environment or .env to run the API test suite.`);
    process.exit(2);
  }
  return value;
}
const PLATFORM_ADMIN_PASSWORD = requiredEnv('PLATFORM_ADMIN_PASSWORD', 'the Master Admin password');
const TENANT_ADMIN_PASSWORD = requiredEnv('TEST_TENANT_ADMIN_PASSWORD', `the password of ${TENANT_ADMIN_EMAIL} in the test tenant`);

interface TestResult {
  readonly category: string;
  readonly name: string;
  readonly method: string;
  readonly endpoint: string;
  readonly status: 'PASS' | 'FAIL';
  readonly statusCode: number;
  readonly expectedStatus: number;
  readonly durationMs: number;
  detail?: string | undefined;
}

interface ApiResponse {
  readonly status: number;
  readonly data: unknown;
  readonly durationMs: number;
}

const testResults: TestResult[] = [];

function asRecord(val: unknown): Record<string, unknown> | null {
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : [];
}

function getStr(obj: unknown, key: string): string | undefined {
  const rec = asRecord(obj);
  if (!rec) return undefined;
  const val = rec[key];
  return typeof val === 'string' ? val : undefined;
}

function getBool(obj: unknown, key: string): boolean | undefined {
  const rec = asRecord(obj);
  if (!rec) return undefined;
  const val = rec[key];
  return typeof val === 'boolean' ? val : undefined;
}

function getObj(obj: unknown, key: string): Record<string, unknown> | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  return asRecord(rec[key]);
}

function getArr(obj: unknown, key: string): unknown[] {
  const rec = asRecord(obj);
  if (!rec) return [];
  return asArray(rec[key]);
}

async function request(
  method: string,
  path: string,
  options: {
    readonly token?: string | undefined;
    readonly body?: unknown;
    readonly headers?: Record<string, string> | undefined;
  } = {},
): Promise<ApiResponse> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  };

  const start = Date.now();
  const res = await fetch(url, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const durationMs = Date.now() - start;

  let data: unknown = null;
  const text = await res.text();
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    data = text;
  }

  return { status: res.status, data, durationMs };
}

function record(
  category: string,
  name: string,
  method: string,
  endpoint: string,
  res: ApiResponse,
  expectedStatus: number,
  validator?: (data: unknown) => boolean,
): boolean {
  const statusMatch = res.status === expectedStatus;
  const dataMatch = validator ? validator(res.data) : true;
  const passed = statusMatch && dataMatch;

  const result: TestResult = {
    category,
    name,
    method,
    endpoint,
    status: passed ? 'PASS' : 'FAIL',
    statusCode: res.status,
    expectedStatus,
    durationMs: res.durationMs,
  };

  if (!passed) {
    result.detail = `Expected ${expectedStatus}, got ${res.status}. Response: ${JSON.stringify(res.data).slice(0, 200)}`;
  }

  testResults.push(result);
  return passed;
}

async function runTestSuite() {
  console.log(`\n============================================================`);
  console.log(`  TapCRM API Test Suite Execution`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`============================================================\n`);

  // -------------------------------------------------------------------
  // 1. Health & Discovery APIs
  // -------------------------------------------------------------------
  console.log(`[1/7] Testing Health & Discovery APIs...`);

  const healthRes = await request('GET', '/health');
  record('Health', 'System Liveness Health Check', 'GET', '/health', healthRes, 200, (d) => getStr(getObj(d, 'data'), 'status') === 'ok');

  const manifestRes = await request('GET', '/health/manifest');
  record('Health', 'Route Manifest Status', 'GET', '/health/manifest', manifestRes, 200, (d) => getBool(d, 'success') === true);

  // -------------------------------------------------------------------
  // 2. Platform Control Plane APIs
  // -------------------------------------------------------------------
  console.log(`[2/7] Testing Platform Control Plane APIs...`);

  let platformAccessToken = '';
  let platformRefreshToken = '';

  const platLoginRes = await request('POST', '/api/platform/auth/login', {
    body: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
  });
  const platLoginOk = record('Platform', 'Master Admin Login', 'POST', '/api/platform/auth/login', platLoginRes, 200, (d) => {
    const data = getObj(d, 'data');
    platformAccessToken = getStr(data, 'accessToken') ?? '';
    platformRefreshToken = getStr(data, 'refreshToken') ?? '';
    return platformAccessToken.length > 0;
  });

  if (platLoginOk && platformAccessToken) {
    const platDashRes = await request('GET', '/api/platform/dashboard', { token: platformAccessToken });
    record('Platform', 'Platform Dashboard Overview', 'GET', '/api/platform/dashboard', platDashRes, 200, (d) => getBool(d, 'success') === true);

    const platStatsRes = await request('GET', '/api/platform/dashboard/stats', { token: platformAccessToken });
    record('Platform', 'Platform Dashboard Statistics', 'GET', '/api/platform/dashboard/stats', platStatsRes, 200, (d) => getBool(d, 'success') === true);

    const platOrgsRes = await request('GET', '/api/platform/organizations', { token: platformAccessToken });
    record('Platform', 'List Tenant Organizations', 'GET', '/api/platform/organizations', platOrgsRes, 200, (d) => getArr(d, 'data').length > 0);

    const platModsRes = await request('GET', '/api/platform/modules', { token: platformAccessToken });
    record('Platform', 'List Platform Module Catalog', 'GET', '/api/platform/modules', platModsRes, 200, (d) => getArr(d, 'data').length > 0);

    const platInvsRes = await request('GET', '/api/platform/invitations', { token: platformAccessToken });
    record('Platform', 'List Admin Invitations', 'GET', '/api/platform/invitations', platInvsRes, 200, (d) => {
      const data = getObj(d, 'data');
      return getArr(data, 'items').length >= 0;
    });

    // Get Tapvera Org Details
    const orgsList = getArr(platOrgsRes.data, 'data');
    const tapveraOrg = orgsList.find((o) => getStr(o, 'code') === 'tapvera');
    const tapveraOrgId = tapveraOrg ? getStr(tapveraOrg, 'id') : undefined;
    if (tapveraOrgId) {
      const platOrgDetailRes = await request('GET', `/api/platform/organizations/${tapveraOrgId}`, { token: platformAccessToken });
      record('Platform', 'Get Single Organization Details', 'GET', `/api/platform/organizations/:id`, platOrgDetailRes, 200, (d) => getStr(getObj(d, 'data'), 'code') === 'tapvera');

      const platOrgModsRes = await request('GET', `/api/platform/organizations/${tapveraOrgId}/modules`, { token: platformAccessToken });
      record('Platform', 'Get Organization Module Entitlements', 'GET', `/api/platform/organizations/:id/modules`, platOrgModsRes, 200, (d) => getArr(d, 'data').length > 0);
    }

    // Wait 1.1s so JWT issued-at timestamp advances by at least 1s for refresh rotation
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const platRefreshRes = await request('POST', '/api/platform/auth/refresh', {
      body: { refreshToken: platformRefreshToken },
    });
    record('Platform', 'Master Admin Token Refresh', 'POST', '/api/platform/auth/refresh', platRefreshRes, 200, (d) => {
      const newTok = getStr(getObj(d, 'data'), 'accessToken');
      if (newTok) platformAccessToken = newTok;
      return !!newTok;
    });
  }

  // -------------------------------------------------------------------
  // 3. Tenant Identity & Session APIs
  // -------------------------------------------------------------------
  console.log(`[3/7] Testing Tenant Identity & Session APIs...`);

  let tenantAccessToken = '';
  let tenantRefreshToken = '';

  const tenantLoginRes = await request('POST', '/api/identity/login', {
    body: { email: TENANT_ADMIN_EMAIL, password: TENANT_ADMIN_PASSWORD },
  });
  const tenantLoginOk = record('Identity', 'Tenant User Login', 'POST', '/api/identity/login', tenantLoginRes, 200, (d) => {
    const data = getObj(d, 'data');
    tenantAccessToken = getStr(data, 'accessToken') ?? '';
    tenantRefreshToken = getStr(data, 'refreshToken') ?? '';
    return tenantAccessToken.length > 0;
  });

  if (tenantLoginOk && tenantAccessToken) {
    const meRes = await request('GET', '/api/identity/me', { token: tenantAccessToken });
    record('Identity', 'Get Current Profile (/api/identity/me)', 'GET', '/api/identity/me', meRes, 200, (d) => getStr(getObj(getObj(d, 'data'), 'user'), 'email') === TENANT_ADMIN_EMAIL);

    const sessionsRes = await request('GET', '/api/identity/sessions', { token: tenantAccessToken });
    record('Identity', 'List Active User Sessions', 'GET', '/api/identity/sessions', sessionsRes, 200, (d) => getArr(d, 'data').length >= 0);

    const geofenceNoticeRes = await request('GET', '/api/identity/geofence/notice', { token: tenantAccessToken });
    record('Identity', 'Get Geofence Notice', 'GET', '/api/identity/geofence/notice', geofenceNoticeRes, 200, (d) => getBool(d, 'success') === true);

    // Wait 1.1s so JWT issued-at timestamp advances by at least 1s for refresh rotation
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const tenantRefreshRes = await request('POST', '/api/identity/refresh', {
      body: { refreshToken: tenantRefreshToken },
    });
    record('Identity', 'Tenant Session Token Refresh', 'POST', '/api/identity/refresh', tenantRefreshRes, 200, (d) => {
      const newTok = getStr(getObj(d, 'data'), 'accessToken');
      if (newTok) tenantAccessToken = newTok;
      return !!newTok;
    });
  }

  // -------------------------------------------------------------------
  // 4. Organization Structure APIs
  // -------------------------------------------------------------------
  console.log(`[4/7] Testing Organization Structure APIs...`);

  if (tenantAccessToken) {
    const deptsRes = await request('GET', '/api/org/departments', { token: tenantAccessToken });
    record('Organization', 'List Departments', 'GET', '/api/org/departments', deptsRes, 200, (d) => getArr(d, 'data').length > 0);

    const teamsRes = await request('GET', '/api/org/teams', { token: tenantAccessToken });
    record('Organization', 'List Teams', 'GET', '/api/org/teams', teamsRes, 200, (d) => getArr(d, 'data').length >= 0);

    const chartRes = await request('GET', '/api/org/chart', { token: tenantAccessToken });
    record('Organization', 'Get Organization Hierarchy Chart', 'GET', '/api/org/chart', chartRes, 200, (d) => Array.isArray(getArr(getObj(d, 'data'), 'departments')));

    const desigsRes = await request('GET', '/api/org/designations', { token: tenantAccessToken });
    record('Organization', 'List Designations', 'GET', '/api/org/designations', desigsRes, 200, (d) => getArr(d, 'data').length >= 0);

    const ladderRes = await request('GET', '/api/org/ladder/development', { token: tenantAccessToken });
    record('Organization', 'Get Position Ladder for Department', 'GET', '/api/org/ladder/:deptCode', ladderRes, 200, (d) => getObj(getObj(d, 'data'), 'department') !== null);

    // Create a new Designation
    const desigCode = `QA Lead ${Date.now()}`;
    const createDesigRes = await request('POST', '/api/org/designations', {
      token: tenantAccessToken,
      body: { name: desigCode, specializations: ['Automation', 'Security', 'Performance'] },
    });
    record('Organization', 'Create New Designation', 'POST', '/api/org/designations', createDesigRes, 201, (d) => getStr(getObj(d, 'data'), 'name') === desigCode);
    const newDesigId = getStr(getObj(createDesigRes.data, 'data'), 'id');

    if (newDesigId) {
      const updateDesigRes = await request('PATCH', `/api/org/designations/${newDesigId}`, {
        token: tenantAccessToken,
        body: { status: 'active', specializations: ['Automation', 'CI/CD'] },
      });
      record('Organization', 'Update Designation', 'PATCH', `/api/org/designations/:id`, updateDesigRes, 200, (d) => getStr(getObj(d, 'data'), 'id') === newDesigId);
    }
  }

  // -------------------------------------------------------------------
  // 5. Employee Directory APIs
  // -------------------------------------------------------------------
  console.log(`[5/7] Testing Employee Directory APIs...`);

  if (tenantAccessToken) {
    const listUsersRes = await request('GET', '/api/users', { token: tenantAccessToken });
    record('Employee', 'List Organization Employees', 'GET', '/api/users', listUsersRes, 200, (d) => getArr(d, 'data').length >= 0);

    // Provision an employee
    const uniqueEmail = `eng.${Date.now()}@tapvera.io`;
    const deptsResponse = await request('GET', '/api/org/departments', { token: tenantAccessToken });
    const depts = getArr(deptsResponse.data, 'data');
    const devDept = depts.find((d) => getStr(d, 'code') === 'development');
    const ladderResponse = await request('GET', '/api/org/ladder/development', { token: tenantAccessToken });
    const ladderPositions = getArr(getObj(ladderResponse.data, 'data'), 'positions');
    const devPos = ladderPositions[0];
    const devDeptId = devDept ? getStr(devDept, 'id') : undefined;
    const devPosId = devPos ? getStr(devPos, 'id') : undefined;

    if (devDeptId && devPosId) {
      const provisionRes = await request('POST', '/api/users', {
        token: tenantAccessToken,
        body: {
          email: uniqueEmail,
          fullName: 'Test Automation Engineer',
          password: 'Password12345!Secure',
          confirmPassword: 'Password12345!Secure',
          departmentId: devDeptId,
          positionId: devPosId,
        },
      });
      record('Employee', 'Provision New Employee', 'POST', '/api/users', provisionRes, 201, (d) => getStr(getObj(getObj(d, 'data'), 'employee'), 'email') === uniqueEmail);
    }
  }

  // -------------------------------------------------------------------
  // 6. Task Management APIs
  // -------------------------------------------------------------------
  console.log(`[6/7] Testing Task Management APIs...`);

  if (tenantAccessToken) {
    const listTasksRes = await request('GET', '/api/tasks', { token: tenantAccessToken });
    record('Tasks', 'List Tasks (Paginated)', 'GET', '/api/tasks', listTasksRes, 200, (d) => Array.isArray(getArr(getObj(d, 'data'), 'items')));

    const assigneesRes = await request('GET', '/api/tasks/assignees', { token: tenantAccessToken });
    record('Tasks', 'List Task Assignable Users', 'GET', '/api/tasks/assignees', assigneesRes, 200, (d) => getArr(d, 'data').length >= 0);

    // Create Task
    const createTaskRes = await request('POST', '/api/tasks', {
      token: tenantAccessToken,
      body: {
        title: `Test Task Run ${Date.now()}`,
        description: 'End to end API test verification task',
        priority: 'high',
      },
    });
    record('Tasks', 'Create New Task', 'POST', '/api/tasks', createTaskRes, 201, (d) => typeof getStr(getObj(d, 'data'), 'id') === 'string');
    const createdTaskId = getStr(getObj(createTaskRes.data, 'data'), 'id');

    if (createdTaskId) {
      const getTaskRes = await request('GET', `/api/tasks/${createdTaskId}`, { token: tenantAccessToken });
      record('Tasks', 'Get Single Task by ID', 'GET', `/api/tasks/:id`, getTaskRes, 200, (d) => getStr(getObj(d, 'data'), 'id') === createdTaskId);

      const updateTaskRes = await request('PATCH', `/api/tasks/${createdTaskId}`, {
        token: tenantAccessToken,
        body: { title: `Updated Task Title ${Date.now()}`, priority: 'urgent' },
      });
      record('Tasks', 'Update Task Properties', 'PATCH', `/api/tasks/:id`, updateTaskRes, 200, (d) => getStr(getObj(d, 'data'), 'priority') === 'urgent');

      const transitionTaskRes = await request('POST', `/api/tasks/${createdTaskId}/transition`, {
        token: tenantAccessToken,
        body: { status: 'in_progress' },
      });
      record('Tasks', 'Transition Task Status', 'POST', `/api/tasks/:id/transition`, transitionTaskRes, 201, (d) => getStr(getObj(d, 'data'), 'status') === 'in_progress');
    }
  }

  // -------------------------------------------------------------------
  // 7. Security, Fail-Closed & Error Handling Validation
  // -------------------------------------------------------------------
  console.log(`[7/7] Testing Security & Fail-Closed Error Handling APIs...`);

  // Protected route with NO auth token
  const unauthRes = await request('GET', '/api/tasks');
  record('Security', 'Unauthenticated Access Refusal (401)', 'GET', '/api/tasks', unauthRes, 401, (d) => getStr(d, 'code') === 'UNAUTHENTICATED');

  // Bad credentials login
  const badLoginRes = await request('POST', '/api/identity/login', {
    body: { email: TENANT_ADMIN_EMAIL, password: 'WrongPassword123!' },
  });
  record('Security', 'Invalid Credentials Refusal (401)', 'POST', '/api/identity/login', badLoginRes, 401, (d) => getBool(d, 'success') === false);

  // Missing route 404 (with valid auth to test router 404 instead of unauth 401)
  const notFoundRes = await request('GET', '/api/completely-nonexistent-route-xyz', {
    token: tenantAccessToken,
  });
  record('Security', 'Non-Existent Route 404 Handler', 'GET', '/api/nonexistent', notFoundRes, 404);

  // Validation error handling (422)
  if (tenantAccessToken) {
    const invalidTaskRes = await request('POST', '/api/tasks', {
      token: tenantAccessToken,
      body: { title: '' }, // empty title violates min length
    });
    record('Security', 'Input Validation Rejection (422)', 'POST', '/api/tasks', invalidTaskRes, 422, (d) => getBool(d, 'success') === false);
  }

  // -------------------------------------------------------------------
  // Results Summary
  // -------------------------------------------------------------------
  console.log(`\n============================================================`);
  console.log(`  API Test Suite Summary`);
  console.log(`============================================================\n`);

  const passed = testResults.filter((r) => r.status === 'PASS');
  const failed = testResults.filter((r) => r.status === 'FAIL');

  console.log(`Total APIs Tested : ${testResults.length}`);
  console.log(`Passed            : ${passed.length}`);
  console.log(`Failed            : ${failed.length}\n`);

  // Group by category
  const categories = [...new Set(testResults.map((r) => r.category))];
  for (const cat of categories) {
    const catTests = testResults.filter((r) => r.category === cat);
    console.log(`--- [ ${cat} (${catTests.filter((t) => t.status === 'PASS').length}/${catTests.length}) ] ---`);
    for (const t of catTests) {
      const symbol = t.status === 'PASS' ? '✓' : '✗';
      console.log(`  ${symbol} [${t.method.padEnd(5)}] ${t.endpoint.padEnd(38)} -> HTTP ${t.statusCode} (${t.durationMs}ms) - ${t.name}`);
      if (t.detail) {
        console.log(`      Detail: ${t.detail}`);
      }
    }
    console.log();
  }

  if (failed.length > 0) {
    console.error(`✗ Test Run Completed with ${failed.length} failure(s).`);
    process.exit(1);
  } else {
    console.log(`✓ All ${passed.length} API endpoints responded successfully and passed assertions!`);
  }
}

void runTestSuite().catch((err) => {
  console.error('Fatal error during API test run:', err);
  process.exit(1);
});
