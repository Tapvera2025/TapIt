# Platform setup

## 1. Run migrations

```bash
npm run migrate
```

This adds the platform authentication tables, module catalog, organization module entitlements and admin invitations.

## 2. Bootstrap the Tapvera Master Admin

Set these environment variables (or export them for the command):

```bash
export PLATFORM_ADMIN_EMAIL=master@tapvera.io
export PLATFORM_ADMIN_NAME="Tapvera Master Admin"
export PLATFORM_ADMIN_PASSWORD="replace-with-a-strong-12-plus-character-password"
npm run platform:admin
```

The command hashes the password with Argon2id and creates/updates the `MASTER_ADMIN` platform account.

## 3. Start API and web client

```bash
npm run dev:api
npm run dev:web
```

Open:

```text
http://localhost:5173/platform/login
```

## 4. Create a company

The Master Admin submits:

```json
{
  "name": "ABC Technologies",
  "code": "ABC001",
  "adminEmail": "admin@abc.com",
  "timezone": "Asia/Kolkata",
  "currency": "INR",
  "modules": ["employee-directory", "attendance", "leads"]
}
```

The server creates the PostgreSQL organization UUID, enables core modules automatically, resolves the selected company bundles into `organization_module`, and creates a one-time 30-minute admin invitation.

The Master Admin can select only the company bundles exposed in the platform UI: HR, Sales, Development, Client and Finance. In development the invitation URL is returned by the API and logged. If SMTP variables are present, the same invitation is also sent through Nodemailer; in production SMTP becomes the delivery path.

## 5. Accept the company-admin invitation

Open the generated URL. The frontend sends the token and a new password to:

`POST /api/identity/invitations/accept`

The token is stored only as a SHA-256 hash. Acceptance creates a tenant `app_user` with account type `super-admin` and the organization's ID.

## 6. Module access model

`organization_module` is the source of truth for company-level entitlements. The frontend uses it to render available modules, while server-side tenant routes can declare `module: '<module-key>'` and the framework calls `requireModuleEnabled()` before authorization.
