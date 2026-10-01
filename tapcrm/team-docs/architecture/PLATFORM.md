# TapCRM Platform Control Plane

The Platform module is the Tapvera product-operator control plane. Its Master Admin is a separate principal and is never represented by tenant `app_user` / `super-admin`.

## Routes

### Platform authentication
- POST `/api/platform/auth/login`
- POST `/api/platform/auth/refresh`
- POST `/api/platform/auth/logout`

### Dashboard
- GET `/api/platform/dashboard`
- GET `/api/platform/dashboard/stats`

### Module catalog
- GET `/api/platform/modules`

### Organizations
- GET `/api/platform/organizations`
- POST `/api/platform/organizations`
- GET `/api/platform/organizations/:id`
- POST `/api/platform/organizations/:id/activate`
- POST `/api/platform/organizations/:id/suspend`
- GET `/api/platform/organizations/:id/modules`
- POST `/api/platform/organizations/:id/modules/:moduleKey/enable`
- POST `/api/platform/organizations/:id/modules/:moduleKey/disable`
- GET `/api/platform/organizations/:id/admin`
- POST `/api/platform/organizations/:id/admin/invite`
- POST `/api/platform/organizations/:id/admin/resend`

## Provisioning flow

1. Master Admin authenticates against `platform_user`.
2. Company creation creates `organization` and generates its UUID in PostgreSQL.
3. Selected module keys are resolved against the global `module` catalog.
4. Core modules are always enabled; selected modules become `organization_module` rows.
5. A one-time `admin_invitation` stores only a SHA-256 token hash and expires after 30 minutes.
6. Development logs the invitation URL. Production requires an email delivery adapter.
7. `/api/identity/invitations/accept` consumes the invitation and creates the tenant `app_user` as `super-admin`.
8. The resulting tenant user carries `organization_id`, which becomes the tenant RLS context.

## Security boundary

`organization_module` is the platform entitlement source of truth. The client uses it to render available modules, but server-side tenant routes must enforce the same entitlement. The generic route binding supports `module` metadata and `requireModuleEnabled()` for that enforcement.
