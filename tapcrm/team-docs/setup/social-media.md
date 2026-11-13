# Manage Social Media

The native CRM module is at `/company/social`. It reuses Identity, CRM clients, project assignments, the authorization registry, PostgreSQL tenant context, object storage, notifications and BullMQ. No social API aggregator or separate login is introduced.

## Enable and configure

1. Apply migrations using `npm run migrate`. `0091_social_media.sql` adds 13 tenant-owned social tables, composite client/tenant foreign keys and forced RLS; `0092_social_catalog.sql` registers the module, its client dependency and six permissions; `0093_social_analytics_context.sql` preserves native metric notes/series and post references and makes approval/audit history append-only for the runtime role; `0094_social_story_destination.sql` adds the per-destination `post_type` column that selects Instagram Story vs feed publishing; `0126_social_company_connections.sql` adds company-wide connections `0146_social_company_logins.sql` widens them to every platform and to Search Console properties (below), and `0148_social_location_page_tokens.sql` keeps each company Facebook Page's own token on its location. Migrations are additive and forward-only, following the existing runner. Disable the module to withdraw it; retain history and use a reviewed forward fix or backup restore rather than dropping CRM data.
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
| `system:manage-integrations` | Company connections: connect the company's logins, refresh what they manage, assign it to clients, disconnect |

Super Admin follows the existing authorization bypass, except segregation of duties still blocks self-approval. Other employees require explicit position/override grants through the existing Access controls. No broad social permissions are silently assigned to existing employee roles. For ordinary scopes, access follows the existing Clients policy: the client creator or a user assigned to a project for that client. Every API scopes child records to the selected client and tenant; composite foreign keys reject cross-client media/account relationships.

A workspace can opt the existing CRM client login into `social:view` and `social:approve`. Client ownership is checked by the existing absolute A2 constraint. This login cannot connect accounts, upload content, publish, or alter settings. Review notifications are sent only to currently authorized reviewers with access to the client.

## Company logins

Agencies manage their clients' pages and profiles from a few staff logins: a Google account each client added as a Manager of their Business Profile and a user of their Search Console property, a Facebook login with a role on their Page, a LinkedIn member who administers their company page. Instead of signing in again for every client, a company admin connects each login once under **Manage Social Media → Company connections**:

| Connect | One sign-in lists | Notes |
|---|---|---|
| Google | Every Business Profile location the account manages, and every verified Search Console property it can read | Search Console access (`webmasters.readonly`) is asked for but optional: declining it still connects the profiles. Enable the Search Console API in the Google Cloud project behind `SOCIAL_GOOGLE_CLIENT_ID` and add the scope to its OAuth consent screen; if listing fails, the profiles still connect and the reason shows on the login. |
| Facebook + Instagram | Every Page the login can create content on, and the Instagram professional account linked to each Page | Instagram permissions are optional. The login's user token is stored once and lists the Pages; each Page and Instagram location also keeps that Page's own token, encrypted for the location (`0148_social_location_page_tokens.sql`). Meta user tokens last about 60 days and cannot be renewed without a sign-in, but a Page token read with one does not expire, so assigned Pages keep publishing after the login expires; reconnecting the login picks up new Pages and heals anything Meta refused. Locations saved before 0148 get their Page token at the next refresh (daily, or **Refresh**). |
| LinkedIn | The member's own profile, and the company pages it administers | Company pages need `SOCIAL_LINKEDIN_ORGANIZATIONS_ENABLED=true` and LinkedIn's Community Management approval. |
| YouTube channel | The one channel chosen on Google's screen | Google grants one channel per sign-in (a Brand Account channel is its own Google identity), so each channel is its own company login. |

1. **Connect** signs in once. TapIt stores one encrypted token per platform account (identified by its stable platform id, shown by its email or name) and lists everything it manages.
2. **Suggested assignments**: for each unassigned item TapIt suggests a client when exactly one client matches — by website first (the client's SEO sites, its business email domain, websites of pages already assigned to it, its Search Console properties), then by name. **Accept all** assigns every suggestion; each can also be accepted, changed or assigned by hand.
3. **Assign to client** links an item to one CRM client. A publishing item (Page, Instagram account, Business Profile, LinkedIn page, channel) becomes that client's account; moving it cancels the old client's scheduled posts to it. A Search Console property is read, never published to: it is assigned on its own row (`social_connection_location.client_id`), serves one client at a time, and moves between two of the company's Google logins without a second client.
4. **Refresh** (and a daily job) picks up what a new client just shared, and flags what the login no longer manages as *missing*.
5. **Disconnect** unassigns everything the login served, cancels their scheduled posts and releases its Search Console properties. Revoking at the platform is a separate opt-in, because the platform removes the user's whole grant.

Why one sign-in: each Google sign-in mints a new refresh token, and Google keeps at most 100 per Google account per OAuth client, silently cancelling the oldest. Per-client sign-ins with one agency account therefore break at scale; a company login is one token, refreshed once and shared by everything it serves. Signing in again with the same account updates that login and heals everything that needed a reconnect. When a platform stops accepting the token, everything on it is marked *reconnect required* and admins holding `system:manage-integrations` get one notification.

A client's own sign-in (Connected Accounts → Connect account) still works for clients who prefer it. Assigning that same item from a company login moves it onto the company token and keeps the account's post history. A client page can unassign a company item but never revoke the company's grant. Database triggers keep a client connection serving only its own client, and a company connection serving clients only through what it lists; a check keeps row-level client assignment to Search Console properties.

Search Console properties connected here are what the rest of the CRM reads: the SEO module's Search Performance import, its **Search Console report** (SEO dashboard → Search visibility; it moved there from Social → Analytics, which now shows only social channels) and the project **Google Search Console** card list, link and read only properties the organization's own Google logins can read, through `modules/social/facade.ts` (`listSearchConsoleProperties`, `searchConsoleToken`, `searchConsolePerformance`, `inspectSearchConsoleUrl`). The server's shared Search Console login (`GOOGLE_SEARCH_CONSOLE_AUTH`) serves only the organization named in `GOOGLE_SEARCH_CONSOLE_ORGANIZATION`, so no organization reads another's property.

The OAuth apps, callback URLs (`/api/social/oauth/<platform>/callback`) and `.env` settings are the same as for client sign-ins; the sealed state decides where the browser returns. A Google login additionally requests `openid` and `userinfo.email` to recognise the signed-in account.

## Workflow

Select an existing client, authorize a platform, then explicitly choose only the discovered accounts belonging to that client. OAuth credentials remain encrypted on the server while the choice is pending; unused state is deleted by the backend cleanup job. Never connect every business returned by an agency user's authorization automatically.

Create shared content and optionally override captions, titles, links, media or post type per destination. Each Facebook and Instagram destination has a **placement**: Feed post, Reel (exactly one video) or, for Instagram only, Story — Stories require exactly one image or video and are available only when the connected account grants `instagram_content_publish` on a Business or Creator profile. Facebook and LinkedIn destinations accept one MP4 video. Each YouTube destination records its **visibility** (public by default, unlisted or private). `0147_social_video_destinations.sql` adds the `reel` post type and the per-destination `privacy_status`. Save drafts without a connection if needed; submitting/publishing requires supported connected destinations. Images are decoded and checked with Sharp; uploads are limited to 8 MiB static images and 50 MiB MP4 videos. Instagram image publishing accepts JPEG. Unsupported combinations return a reason before a schedule is accepted. Video codec, duration and platform moderation remain subject to the platform's validation.

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

- LinkedIn documents and multiple images, Facebook Stories and Business Profile videos are not implemented in this release. Facebook feed videos and Reels, Instagram Reels and Stories, and LinkedIn videos are supported; see the workflow section.
- YouTube videos upload with the visibility chosen in the composer. A completed upload is not proof of completed processing or moderation.
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

## Clients connecting their own accounts (client portal)

Clients can connect their own social accounts from the client portal at **Social accounts** (`/client/social`). Any active client login can use this page when the organization has the Social and Client portal modules enabled.

### How a client connects an account

1. The client picks a platform.
2. The client signs in on the platform's own consent screen.
3. The platform returns the client to the same portal page.
4. The page shows only the accounts the platform authorized.
5. The client ticks exactly the accounts to attach. Nothing is attached automatically.
6. The client confirms.

The choice stays open for 30 minutes. The platform sign-in must come back within 10 minutes.

Platforms in the portal:

- Facebook Pages.
- Instagram professional (Business or Creator) accounts linked to a Facebook Page. The client signs in with Facebook.
- YouTube channels (video uploads).

LinkedIn stays agency-only. Google Business Profile is shown as not available. See [provider prerequisites](social-platforms.md#client-portal-connections-provider-prerequisites).

### What a client can and cannot do

A client can connect, reconnect and disconnect accounts they connected themselves.

A client cannot:

- Publish or edit posts.
- Change workspace settings.
- See or change company connections.
- See other clients.

Accounts the agency manages appear as "Managed by your agency" with no actions.

### Disconnecting (client)

Disconnecting an account:

- Removes the stored token for that account.
- Stops publishing to it.
- Cancels its scheduled posts. Posts already being published finish and keep their outcome.

An optional separate checkbox, "remove TapIt's access", revokes the grant at the platform:

- Facebook and Instagram: removes TapIt from the whole Facebook login. Every Page and Instagram account connected with that login, in any client, must be reconnected.
- YouTube: revokes that Google account's grant.
- Refused if the agency's own company Facebook login is the same Facebook user.

If the platform call fails, the client is told to remove access in their platform settings.

Agency staff can disconnect a client-connected account locally. They cannot revoke the client's own platform grant. That attempt returns error `SOCIAL_CLIENT_OWNED_GRANT`.

### Team side

Accounts connected by a client appear in Manage Social Media for that client with a "Connected by client" badge. They use the normal flow: create, approve (if required), then schedule or publish. Scheduling uses the client's timezone. Only staff who already have access to that client can use them.

### Permission

The new action `social:connect-own-accounts` is held only by client logins, through their fixed policy set. It cannot be given to any position.

Agency staff keep `social:connect`, `social:manage`, `social:publish` and `social:settings` as before.

### Ownership rules

- An account serves one CRM client.
- If it is already connected for a different client, the client sees "connected elsewhere — ask your agency to move it". No other client's name is shown.
- If the agency already manages it for this client, the client cannot take it over.
- The agency cannot take over an account the client connected, either by client sign-in or by company-login assignment. The client must disconnect it first.

### Security

- Sign-in state is sealed, single-use and expires.
- It is bound to the browser cookie, the client login and its session version, the platform, and the surface (portal or workspace).
- Callback and redirect URLs are fixed.
- Tokens are encrypted per organization, client and platform. They are never returned to the browser.

### Database

Migration `0151_social_client_portal_connections.sql` adds `social_connection.connected_via` and `social_oauth_state.surface`, with guard triggers. It is forward-only. To withdraw the feature, stop granting the action.
