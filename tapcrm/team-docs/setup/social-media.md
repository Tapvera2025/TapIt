# Manage Social Media

The native CRM module is at `/company/social`. It reuses Identity, CRM clients, project assignments, the authorization registry, PostgreSQL tenant context, object storage, notifications and BullMQ. No social API aggregator or separate login is introduced.

## Enable and configure

1. Apply migrations using `npm run migrate`. `0091_social_media.sql` adds 13 tenant-owned social tables, composite client/tenant foreign keys and forced RLS; `0092_social_catalog.sql` registers the module, its client dependency and six permissions; `0093_social_analytics_context.sql` preserves native metric notes/series and post references and makes approval/audit history append-only for the runtime role; `0094_social_story_destination.sql` adds the per-destination `post_type` column that selects Instagram Story vs feed publishing. Migrations are additive and forward-only, following the existing runner. Disable the module to withdraw it; retain history and use a reviewed forward fix or backup restore rather than dropping CRM data.
2. Existing companies with the Clients entitlement receive the Social entitlement with the same enabled/disabled status. New companies can select Manage Social Media in the platform module catalogue.
3. Generate `SOCIAL_TOKEN_ENCRYPTION_KEY` once using `openssl rand -hex 32`. Store and back up the key as a secret. Changing it without a planned re-encryption procedure makes stored credentials unreadable. Do not paste credentials into source code, client settings or screenshots.
4. Set `SOCIAL_PUBLIC_BASE_URL` to the exact public CRM origin, e.g. `https://crm.example.com`, with no path, query or credentials. HTTP localhost is supported only outside production. OAuth callbacks use this configured origin, never a request Host header.
5. Configure one developer app per platform wherever permitted. Register the exact `/api/social/oauth/<platform>/callback` URLs for `facebook`, `instagram`, `linkedin`, `google_business` and `youtube`. The Google app can serve Business Profile and YouTube using separate consent requests.
6. Configure the app ID/secret and approval flags listed in [.env.example](../../.env.example). Keep approval flags false until the app's actual approved products/scopes support the requested use case. See [platform setup and capability matrix](social-platforms.md) for scopes, approval steps, supported accounts, media constraints, refresh behavior and official references.
7. Configure working `S3_ENDPOINT`, credentials and bucket settings using the CRM's existing storage service. `S3_PUBLIC_ENDPOINT` must be an externally reachable HTTPS origin for Meta/Google to fetch media. Signed URLs are generated at publishing time, so a long schedule does not reuse an expired browser preview URL. The local Compose file currently comments out MinIO provisioning; the existing local MinIO container may still run, but new installations need a working object-store deployment.
8. For source changes, run `docker compose up -d --build migrate server client`. Named database volumes and mounted uploads are retained. For environment-only changes, recreate the server with Compose. A restart alone does not load changed source or Compose environment.

No credentials or approval status are inferred. Connected Accounts shows Setup Required or Pending API Approval until configured. A ready configuration is not proof of a successful live authorization or platform approval.

## Permissions and client access

| Permission | Capability |
| --- | --- |
| `social:view` | Client picker, accounts, planner, calendar, history, settings and analytics |
| `social:manage` | Media, drafts, duplication, submission, cancellation and manual analytics sync |
| `social:publish` | Publish and schedule approved/eligible content |
| `social:approve` | Approve another person's post or request changes |
| `social:connect` | Official OAuth, reconnect, disconnect and optional grant revocation |
| `social:settings` | Workspace timezone, approval requirement and client review opt-in |

Super Admin follows the existing authorization bypass, except segregation of duties still blocks self-approval. Other employees require explicit position/override grants through the existing Access controls. No broad social permissions are silently assigned to existing employee roles. For ordinary scopes, access follows the existing Clients policy: the client creator or a user assigned to a project for that client. Every API scopes child records to the selected client and tenant; composite foreign keys reject cross-client media/account relationships.

A workspace can opt the existing CRM client login into `social:view` and `social:approve`. Client ownership is checked by the existing absolute A2 constraint. This login cannot connect accounts, upload content, publish, or alter settings. Review notifications are sent only to currently authorized reviewers with access to the client.

## Workflow

Select an existing client, authorize a platform, then explicitly choose only the discovered accounts belonging to that client. OAuth credentials remain encrypted on the server while the choice is pending; unused state is deleted by the backend cleanup job. Never connect every business returned by an agency user's authorization automatically.

Create shared content and optionally override captions, titles, links, media or post type per destination. Instagram destinations can opt into Story publishing from the per-destination override — Stories require exactly one image or video and are available only when the connected account grants `instagram_content_publish` on a Business or Creator profile. Save drafts without a connection if needed; submitting/publishing requires supported connected destinations. Images are decoded and checked with Sharp; uploads are limited to 8 MiB static images and 50 MiB MP4 videos. Instagram image publishing accepts JPEG. Unsupported combinations return a reason before a schedule is accepted. Video codec, duration and platform moderation remain subject to the platform's validation.

Required approvals block publishing. Revising approved content clears approval. Choose a schedule in the workspace timezone; the server stores UTC. The composer rejects nonexistent/ambiguous daylight-saving times. The monthly/weekly calendar opens post details, where eligible schedules can be changed or cancelled. On the calendar, authorized publishers can drag a scheduled post onto another date to reschedule — only scheduled posts with no publishing attempts are draggable, and the drop preserves the original time-of-day in the workspace timezone.

The durable job is the PostgreSQL destination row. BullMQ sweeps every 15 seconds and rechecks the publishing employee's current account state, permission, client access and module entitlement. Each destination has its own atomic claim, lease, attempt history, remote ID and result. Explicit transient rejections retry up to five attempts with bounded exponential backoff and Retry-After handling. Successful destinations are never resent. Interrupted or ambiguous creates become `outcome_unknown`; inspect the platform before duplicating such content. A failed sibling does not erase a successful destination.

Disconnect removes local encrypted credentials and cancels unclaimed schedules for that account. A separate opt-in checkbox can revoke the entire platform-to-CRM grant where supported; it clearly warns that this can disconnect sibling accounts/workspaces. If revocation is unavailable or fails, local credentials are still removed and the UI directs the user to platform application settings.

Analytics synchronizes every six hours and can be refreshed for a selected period. It retains native metric names, reporting periods, source notes, daily series and supported post results. Missing metrics remain unavailable. Current/cumulative Meta counters are labelled as such; they are not historical reach totals. Do not add metrics across different platform definitions. The analytics panel renders per-platform aggregates (latest account counters summed across accounts of that platform, plus the sum of post-level counters within the selected range for the same platform) with an explicit note that cross-platform sums are not derived. An **Export CSV** button downloads one row per metric observation with native metric names and reporting periods; formula-prefix characters are escaped so spreadsheet software cannot execute cell content.

## Test and validation

Unit/provider tests use mocked fetch and never publish to real accounts:

```sh
npx vitest run packages/server/src/modules/social packages/client/src/social
npm run typecheck
npm run lint
node --experimental-strip-types tools/extract-registry.ts --check
npm run ci
npm test
npm run build --workspace @tapcrm/client
```

`social.integration.test.ts` additionally requires `TAPCRM_INTEGRATION_DB=1`, a migrated disposable PostgreSQL database whose name contains `test`, a `MIGRATION_DATABASE_URL` for the test owner and a `DATABASE_URL` for its restricted `tapcrm_app` role. Supply test JWT secrets and Redis configuration through the environment. The suite tests the actual HTTP authorization pipeline, RLS, client relationships, encrypted account DTOs, OAuth cookies/PKCE/replay/expiry, explicit account selection, refresh/revocation, uploads, approvals, schedules, competing claims, restart uncertainty, partial outcomes and permission removal. Provider calls and object storage are mocked in that suite.

Desktop/mobile browser QA uses clearly labelled fixtures, never live connections. These checks do not prove OAuth approval, app product access, live media compatibility or provider delivery. After approval, authorize dedicated platform test accounts and verify each allowed content type and native metrics before enabling client publishing.

## Present limits and next work

- Facebook video, LinkedIn video/documents/multiple images and Facebook Stories are not implemented in this release. Instagram Stories is supported through the per-destination override; see the workflow section.
- YouTube videos upload as **private**; change visibility in YouTube after reviewing processing. A completed upload is not proof of public visibility or completed moderation.
- Outcome-unknown destinations require a platform check; there is no automatic recovery that guesses a remote post ID.
- Analytics shows native reports, daily series, per-platform aggregates and a CSV export. Advanced exports and custom report builders beyond CSV + aggregates are follow-up work.
- Live OAuth/publishing/analytics need real app credentials, review/verification where required, an eligible authorized account and externally reachable storage. These are separate from passing mocked tests.
- The existing repository still reports phased authorization/route gaps outside this module. Passing the normal CI gates does not mean the whole CRM passes strict production release verification.

Prioritize dedicated-account live validation, then video metadata inspection and resumable upload recovery, explicit YouTube visibility/audience controls, API usage monitoring and advanced reporting. Add new platforms as adapters after reviewing their current official documentation.

## Not supported by platform APIs

These items were requested but cannot be built against a stable public API as of this release. They stay out of scope until the underlying platforms expose a path for third-party apps.

- **YouTube Community posts** — YouTube Data API v3 does not expose community posts to third-party applications. Posting requires manual channel access through the YouTube Partner Program and is not available through any supported endpoint.
- **Facebook Stories** — Meta deprecated the Graph API `page_published_story` write path for third-party publishing; no stable public endpoint exists. Instagram Stories remain supported through the Instagram Content Publishing API.
- **Google Business Profile post insights** — The former `localPosts` insight endpoint was retired in October 2022. The Business Profile Performance API returns location-level aggregates only, not per-post counters, so a comparable per-post metric cannot be synchronized.
