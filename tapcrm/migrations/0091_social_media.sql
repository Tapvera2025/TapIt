-- Social media workspaces extend the existing client and tenant. Additive and
-- forward-only, following tools/migrate.ts. To withdraw the feature disable its
-- module; retain client history and use a reviewed forward migration/restore.

CREATE TABLE social_workspace_settings (
  organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  timezone text NOT NULL, approval_required boolean NOT NULL DEFAULT false, client_review_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, client_id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id)
);

CREATE TABLE social_connection (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','linkedin','google_business','youtube')),
  credentials_encrypted text, scopes text[] NOT NULL DEFAULT '{}', expires_at timestamptz, refresh_lease_until timestamptz,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','reconnect_required','disconnected')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);

CREATE TABLE social_account (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  connection_id uuid NOT NULL, platform text NOT NULL CHECK (platform IN ('facebook','instagram','linkedin','google_business','youtube')),
  external_id text NOT NULL, name text NOT NULL, profile_image_url text,
  capabilities text[] NOT NULL DEFAULT '{}', metadata jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','reconnect_required','disconnected')),
  connected_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz, last_error text,
  UNIQUE (organization_id, client_id, id), UNIQUE (organization_id, client_id, platform, external_id),
  FOREIGN KEY (organization_id, client_id, connection_id) REFERENCES social_connection(organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id)
);

CREATE TABLE social_media (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE, name text NOT NULL, mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','video/mp4')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600), checksum_sha256 text NOT NULL,
  width integer, height integer, duration_seconds numeric,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);

CREATE TABLE social_post (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  caption text NOT NULL DEFAULT '', title text, link text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','scheduled','publishing','published','partially_published','failed','cancelled')),
  timezone text NOT NULL, scheduled_at timestamptz, published_at timestamptz,
  approval_required boolean NOT NULL DEFAULT false, approved_at timestamptz,
  created_by uuid NOT NULL, publishing_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id),
  FOREIGN KEY (organization_id, publishing_actor_id) REFERENCES app_user(organization_id, id)
);
CREATE INDEX ix_social_post_client_date ON social_post(organization_id, client_id, created_at DESC);
CREATE INDEX ix_social_post_client_status ON social_post(organization_id, client_id, status, scheduled_at);

CREATE TABLE social_post_media (
  organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  post_id uuid NOT NULL, media_id uuid NOT NULL, position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (post_id, media_id),
  FOREIGN KEY (organization_id, client_id, post_id) REFERENCES social_post(organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id, media_id) REFERENCES social_media(organization_id, client_id, id)
);

-- The destination IS the durable scheduled job. A queue tick only discovers
-- these rows; losing Redis or restarting workers cannot lose a schedule.
CREATE TABLE social_post_destination (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  post_id uuid NOT NULL, account_id uuid NOT NULL, caption text NOT NULL, title text, link text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','publishing','published','failed','cancelled','outcome_unknown')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz, lease_id uuid, lease_expires_at timestamptz,
  idempotency_key uuid NOT NULL DEFAULT uuidv7(), platform_post_id text, platform_post_url text,
  last_error text, published_at timestamptz,
  UNIQUE (organization_id, client_id, id), UNIQUE (post_id, account_id), UNIQUE (idempotency_key),
  FOREIGN KEY (organization_id, client_id, post_id) REFERENCES social_post(organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id, account_id) REFERENCES social_account(organization_id, client_id, id),
  CHECK ((status = 'publishing') = (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (status <> 'published' OR platform_post_id IS NOT NULL)
);
CREATE INDEX ix_social_destination_due ON social_post_destination(organization_id, next_attempt_at) WHERE status = 'scheduled';
CREATE INDEX ix_social_destination_post ON social_post_destination(organization_id, client_id, post_id);

CREATE TABLE social_destination_media (
  organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  destination_id uuid NOT NULL, media_id uuid NOT NULL, position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (destination_id, media_id),
  FOREIGN KEY (organization_id, client_id, destination_id) REFERENCES social_post_destination(organization_id, client_id, id),
  FOREIGN KEY (organization_id, client_id, media_id) REFERENCES social_media(organization_id, client_id, id)
);

CREATE TABLE social_publish_attempt (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  destination_id uuid NOT NULL, attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 5),
  lease_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'started' CHECK (outcome IN ('started','published','retry_scheduled','failed','outcome_unknown')),
  error_code text, error_message text, platform_post_id text,
  UNIQUE (destination_id, attempt),
  FOREIGN KEY (organization_id, client_id, destination_id) REFERENCES social_post_destination(organization_id, client_id, id)
);
CREATE INDEX ix_social_attempt_client ON social_publish_attempt(organization_id, client_id, started_at DESC);

CREATE TABLE social_approval (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  post_id uuid NOT NULL, actor_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('submitted','approved','changes_requested')), comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id, post_id) REFERENCES social_post(organization_id, client_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES app_user(organization_id, id)
);
CREATE INDEX ix_social_approval_post ON social_approval(organization_id, client_id, post_id, created_at);

CREATE TABLE social_analytics_snapshot (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  account_id uuid NOT NULL, source text NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  metrics jsonb NOT NULL DEFAULT '[]', synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, source, period_start, period_end),
  FOREIGN KEY (organization_id, client_id, account_id) REFERENCES social_account(organization_id, client_id, id),
  CHECK (period_end >= period_start)
);
CREATE INDEX ix_social_analytics_client ON social_analytics_snapshot(organization_id, client_id, period_start, period_end);

CREATE TABLE social_audit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  actor_id uuid, action text NOT NULL, resource_id uuid, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id),
  FOREIGN KEY (organization_id, actor_id) REFERENCES app_user(organization_id, id)
);
CREATE INDEX ix_social_audit_client ON social_audit_log(organization_id, client_id, created_at DESC);

CREATE TABLE social_oauth_state (
  organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL,
  state_hash text PRIMARY KEY, platform text NOT NULL CHECK (platform IN ('facebook','instagram','linkedin','google_business','youtube')),
  created_by uuid NOT NULL, verifier_encrypted text NOT NULL, expires_at timestamptz NOT NULL,
  consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES client(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user(organization_id, id)
);
CREATE INDEX ix_social_oauth_expiry ON social_oauth_state(organization_id, expires_at);

SELECT apply_tenant_rls('social_workspace_settings');
SELECT apply_tenant_rls('social_connection');
SELECT apply_tenant_rls('social_account');
SELECT apply_tenant_rls('social_media');
SELECT apply_tenant_rls('social_post');
SELECT apply_tenant_rls('social_post_media');
SELECT apply_tenant_rls('social_post_destination');
SELECT apply_tenant_rls('social_destination_media');
SELECT apply_tenant_rls('social_publish_attempt');
SELECT apply_tenant_rls('social_approval');
SELECT apply_tenant_rls('social_analytics_snapshot');
SELECT apply_tenant_rls('social_audit_log');
SELECT apply_tenant_rls('social_oauth_state');
