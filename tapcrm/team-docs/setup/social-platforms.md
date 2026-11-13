# Social media developer applications

Tapvera connects directly to official APIs. Configure one CRM developer application per platform (a Google Cloud project can serve both Google providers), then each client's authorized administrator grants OAuth access. A separate application per client is unnecessary. CRM users choose which discovered Pages, organizations, locations, or channels belong to the selected existing client.

Platform credentials, app review, enabled products, granted scopes, account roles, quotas, and public media delivery must all be in place before a connection can publish. The module does not contain live demo connections or fabricated analytics. Approval flags are an operator assertion, not proof that a platform has approved the application.

## Server configuration

Use the existing secret-management/deployment mechanism. Do not commit values or put server secrets in frontend/Vite variables.

```dotenv
# Public CRM origin, never a value inferred from the incoming Host header.
SOCIAL_PUBLIC_BASE_URL=https://crm.example.com
# Generate once using: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Keep stable across restarts and back it up securely. Changing it requires credential migration/reconnection.
SOCIAL_TOKEN_ENCRYPTION_KEY=

SOCIAL_META_CLIENT_ID=
SOCIAL_META_CLIENT_SECRET=
# Explicit supported version; recheck Meta version lifetimes before upgrades.
SOCIAL_META_API_VERSION=v24.0
SOCIAL_META_APPROVED=false

SOCIAL_LINKEDIN_CLIENT_ID=
SOCIAL_LINKEDIN_CLIENT_SECRET=
SOCIAL_LINKEDIN_API_VERSION=202609
SOCIAL_LINKEDIN_APPROVED=false
# Enable only after the respective product/scopes are approved for this application.
SOCIAL_LINKEDIN_ORGANIZATIONS_ENABLED=false
SOCIAL_LINKEDIN_INSIGHTS_ENABLED=false

SOCIAL_GOOGLE_CLIENT_ID=
SOCIAL_GOOGLE_CLIENT_SECRET=
SOCIAL_GOOGLE_BUSINESS_APPROVED=false
SOCIAL_YOUTUBE_APPROVED=false
```

Register exact callback URIs with each application, substituting the public CRM origin:

```text
https://crm.example.com/api/social/oauth/facebook/callback
https://crm.example.com/api/social/oauth/instagram/callback
https://crm.example.com/api/social/oauth/linkedin/callback
https://crm.example.com/api/social/oauth/google_business/callback
https://crm.example.com/api/social/oauth/youtube/callback
```

Local development can use an explicitly configured `http://localhost:<port>` origin if the platform permits it. Meta's media-fetching APIs still need publicly reachable HTTPS media, including for scheduled content. A local filesystem path or localhost URL cannot be fetched by a platform. The composer uses CRM-controlled media storage rather than arbitrary server-side URL downloads.

## Supported operations and approval gates

| Platform | Supported accounts and required scopes | Implemented publishing | Implemented reporting | External setup |
| --- | --- | --- | --- | --- |
| Facebook Pages | A Page with a granted publishing task; `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | Text, attached link, up to 10 JPEG/PNG images, one MP4 feed video (uploaded from CRM storage to `graph-video.facebook.com`), or one MP4 Reel (Reels API: start, upload to `rupload.facebook.com`, finish) | Current follower counter and cumulative post reaction/comment/share counters when returned | Meta business verification/App Review/Advanced Access as required for client accounts; live app and approved scopes |
| Instagram via Facebook Login | Professional Business/Creator account linked to an authorized Facebook Page; `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish` | One JPEG, JPEG carousel (up to 10), one MP4/MOV Reel (a single feed video or an explicit Reel placement), or a Story | Current follower/media counters and cumulative post like/comment counters when returned | Meta App Review/Advanced Access; linked Page; public media; consumer accounts unsupported |
| LinkedIn | Authenticated member: `openid`, `profile`, `w_member_social`; optional organization: `w_organization_social`, `r_organization_admin`; optional organization reads: `r_organization_social` | Text, article link, one uploaded JPEG/PNG image, or one MP4 video (Videos API: initialize, upload each part, finalize, wait for AVAILABLE, then post) | Approved organization organic share statistics only; member analytics unavailable | Enable Sign In with LinkedIn using OIDC and Share on LinkedIn. Community Management approval plus eligible Page role for organizations. Reporting requires approved organization permissions |
| Google Business Profile | Locations administered by the authorizing Google user; `https://www.googleapis.com/auth/business.manage`, plus `openid` and `https://www.googleapis.com/auth/userinfo.email` to identify the signed-in account | Standard text post, optional one JPEG/PNG image and Learn More link | Location daily impressions, website/call clicks and direction requests | Project-level Business Profile API approval, required APIs enabled, OAuth consent verification as applicable, eligible verified location |
| YouTube | Authorizing user's channel; `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly` (full Google scope URLs) | One video via resumable upload, explicit title, description and the visibility chosen in the composer (public, unlisted or private) | Native daily channel/video views, watched minutes, likes, comments, shares and subscriber gains/losses when returned | YouTube Data API and Analytics API enabled, OAuth verification/API compliance requirements and sufficient quotas |

Platform limits are checked before publishing: Instagram captions 2,200 characters; Facebook captions 63,206; LinkedIn captions 3,000; Business Profile summaries 1,500; YouTube descriptions 5,000 and titles 100. Instagram JPEGs are limited to 8 MB and Reels to 1 GB by the adapter; CRM storage may impose a smaller limit. A Reel must also meet Meta's codec, duration (Facebook: 3–90 seconds), aspect-ratio and resolution requirements; this adapter does not transcode videos. A Facebook Reel is confirmed by Meta's finish step and its status is read for a few seconds afterwards: a processing failure seen then fails the destination, a slower one stays "processing" on the platform. LinkedIn videos must be 75 KB to 500 MB and 3 seconds to 30 minutes; the adapter waits for LinkedIn to finish processing before it creates the post, and retries later if processing is slow. LinkedIn documents and multi-image posts, Facebook Stories, Business Profile videos and YouTube Community posts are unavailable in this implementation.

Each provider's capability flags describe implemented operations. A configured app can still be denied by the platform if consent, approval, account eligibility, or role requirements are missing. Do not turn a permission error into an apparently successful connection or publishing result.

## Platform setup details

### Meta

Create a Meta application for the CRM, configure Facebook Login for Business as required for its use case, register both callback URLs, and request only the permissions in the matrix. Test with app-role accounts before seeking Advanced Access for real client administrators. Clients must have a task that allows creating content on their Page. Instagram accounts must be professional accounts linked to that Page.

The OAuth code is exchanged for a user token and then a long-lived user token. Account discovery obtains a distinct Page token. Tokens and the original user grant are server-only values encrypted together by the social service. A Page token read with a long-lived user token does not expire, so a Page is never sent to reconnect for age alone (Page tokens saved earlier with the user token's ~60-day expiry drop it on first use); reconnect when Meta revokes access. The long-lived user token itself expires after about 60 days with no refresh grant: a company login then needs a sign-in to list new Pages, while its assigned Pages keep publishing with their own tokens. Instagram publishing creates unpublished containers, checks processing status, then publishes exactly once. A missing permalink after publication does not erase the successful media ID.

These adapters currently retrieve stable account/post counters, not reach/impression history. No extra `read_insights` or `instagram_manage_insights` scope is requested for unavailable historical charts. Public media URLs must remain accessible through the scheduled publishing time. Rate limits vary by application/account/use case; monitor Meta usage headers and the app dashboard rather than assuming a fixed universal quota.

Official references: [Pages publishing](https://developers.facebook.com/docs/pages-api/posts/), [Meta's official Facebook API collection](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api), [Meta's official Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Instagram publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/), [long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/). The Meta documentation website rate-limited automated access during implementation; the official Meta-owned Postman collections were also consulted.

### LinkedIn

Create the CRM application and enable the OIDC and Share on LinkedIn products for member discovery/publishing. Set `SOCIAL_LINKEDIN_APPROVED=true` only after the required products are enabled. Member publishing does not imply organization access. Request Community Management access before enabling `SOCIAL_LINKEDIN_ORGANIZATIONS_ENABLED`; enable reporting separately only when its scopes are approved. The connected member must have an eligible organization publishing role. LinkedIn's documentation has both legacy `rw_organization_admin` and newer `r_organization_admin` reporting references; this integration requests the read-only `r_organization_admin` and reports platform permission denials explicitly. Verify granted scopes against the approved product/version before rollout.

Posts use the versioned REST Posts API with `Linkedin-Version` and Rest.li headers; store the returned `x-restli-id`. Images are uploaded from trusted CRM storage, never fetched by the adapter from user-supplied URLs. Refresh tokens are supported only when LinkedIn actually grants them to an approved partner; otherwise the account requires reconnection. Member post reads/analytics are restricted and are not claimed here. Organization post reports are cumulative and ignore a selected date range; organization account reports use the requested daily range. Do not add daily unique counts or engagement ratios into misleading overall totals.

Official references: [API access and permissions](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access), [authorization-code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow), [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09), [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09), [organization roles](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09), [organization share statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics?view=li-lms-2026-09), [partner refresh-token restrictions](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens).

### Google Business Profile

Request Business Profile API access for the Google Cloud project before enabling the approval flag. Enable Business Profile Account Management, Business Information, Performance, and Google My Business APIs needed by the listed endpoints. Configure an OAuth Web application, consent screen, and exact callbacks. The client must authorize an account that administers an eligible location. Discovery uses Account Management v1 and Business Information v1; standard posts use the supported My Business v4 localPosts endpoint. Google can reject posts based on location/category eligibility or content policies.

A company can connect one Google account for all its clients (see [company-wide connections](social-media.md#company-wide-google-business-profile-connections)). Business Profile API approval and the OAuth consent screen belong to the CRM's single Google Cloud project, so customer companies never set up Google Cloud themselves. Before external companies sign in, the consent screen must be **In production** (in Testing, Google expires refresh tokens after 7 days) and pass any verification Google requires for the requested scopes. All companies share the project's quota (300 requests per minute by default, and 10 edits per minute per profile); rate-limited publishes retry with backoff.

Analytics uses Business Profile Performance v1. The old local-post `reportInsights` endpoint was removed; this module exposes location reports and an explicit unavailable state for individual-post analytics. Do not substitute legacy endpoint results or estimated values. Quotas and access are controlled per project/API and are visible in Google Cloud; approval is independent of OAuth consent.

Official references: [prerequisites and access approval](https://developers.google.com/my-business/content/prereqs), [localPosts resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts), [daily performance endpoint](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries), [removed post-insights endpoint](https://developers.google.com/my-business/content/performance/change-log), [OAuth server flow and token revocation](https://developers.google.com/identity/protocols/oauth2/web-server).

### YouTube

Enable YouTube Data API v3 and YouTube Analytics API in the Google project. Configure consent for upload, channel-read and analytics-read scopes. The provider uses OAuth with PKCE and offline consent; the publishing worker refreshes credentials when a refresh token is available. Uploads use the resumable endpoint and a trusted CRM-stored video. The composer records each YouTube destination's visibility (public by default, or unlisted or private) and the upload sends it; a destination saved before that choice existed uploads as **private**. A successful upload ID is a completed upload request, not proof that YouTube has finished processing or accepted the video for public display; retain the returned platform state and check status when needed.

As checked on October 14, 2026, the current official `videos.insert` documentation lists a separate Video Uploads quota bucket with 100 calls/day at 1 unit/call and says unverified-project uploads are not restricted to private mode. This differs from older documentation. Consult the live quota console and current compliance requirements before launch; do not hardcode old quota pricing or promise public availability. Reporting may lag, and absent rows/metrics remain unavailable rather than becoming invented zero totals.

Official references: [video insertion, restrictions and quotas](https://developers.google.com/youtube/v3/docs/videos/insert), [resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [Analytics queries](https://developers.google.com/youtube/analytics/reference/reports/query), [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Security and operations

OAuth redirects are fixed configuration. Short-lived sealed state, a browser-bound HttpOnly cookie, existing authenticated CRM sessions, and single-use database state protect the authorization flow. Google additionally uses PKCE. Tokens are encrypted with organization/client/platform associated data and are never returned in account DTOs, audit details or provider error messages.

Disconnecting one CRM account should delete its local credentials and prevent future scheduled use. Remote Meta/Google revocation removes the entire user-to-application grant and may invalidate sibling accounts or other client workspaces. Use a separate, explicit grant-revocation action with that explanation; do not silently revoke the whole grant when disconnecting one account. LinkedIn does not document a generally available revocation endpoint; after local disconnection, remove the CRM through LinkedIn's Permitted services settings when full grant removal is desired.

The publishing service must persist a claim for each destination before sending any create-post request. Official APIs do not universally support idempotency keys. A timeout/network interruption or server error after a create request can mean the post already exists; these outcomes are marked ambiguous and require a platform check before retry. An explicit rate-limit rejection is safe to retry with a bounded delay. Never automatically retry successful destinations or outcome-unknown destinations. Credential refresh errors require reconnect when the platform returns expired/revoked authorization.

No provider webhooks are registered by these adapters. If webhooks are added later, verify signatures before processing them. Keep runtime logs from serializing OAuth query strings, token request bodies, provider credentials, or encrypted payloads.

## Validation

Run the mocked provider tests without any real platform credentials or accounts:

```sh
npx vitest run packages/server/src/modules/social/providers/providers.test.ts
```

They cover provider payloads, scope/PKCE handling, token refresh, read-only account exclusion, unsupported-media validation, untrusted upload hosts, successful-ID retention, rate limits, ambiguous outcomes, genuine metric parsing, and explicit unavailable operations. These tests never publish real content. They do not prove platform approval, account eligibility, video compatibility, quota availability, or a live OAuth journey. Validate those separately with authorized test accounts after configuration and approval.

## Client portal connections: provider prerequisites

These checks apply before client portal connections are enabled. They do not change the company connections or the agency sign-in flows.

### Meta (Facebook Pages and Instagram)

- Uses the existing Facebook Login app with the same scopes as today:
  - Pages: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
  - Instagram: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`.
- Clients outside the app's own business need Advanced Access through App Review. The app's business needs Business Verification.
- Meta's developers blog (2026-10-09, "Retiring access verification for Tech Provider apps") announced that the separate Tech Provider access verification step is retired in favour of Business Verification and App Review. Confirm the current state in the Meta App Dashboard before enabling client connections.
- Only professional Instagram accounts are supported. Meta's wording: "The Instagram API with Facebook Login cannot access Instagram consumer accounts." The Instagram account must be linked to a Facebook Page that the signing-in user manages.
- Personal Facebook profiles cannot be connected.
- The registered redirect URI is unchanged: `<SOCIAL_PUBLIC_BASE_URL>/api/social/oauth/<platform>/callback`.

### YouTube

- This is a separate grant from Business Profile and Search Console.
- Scopes: `youtube.upload`, `youtube.readonly`, `yt-analytics.readonly`.
- The client picks the Google account or Brand Account that owns the channel.
- Publishing is video upload only.
- Google OAuth verification of the consent screen is required for external users with these scopes.

### Google Business Profile: not enabled in the client portal

This is a blocker. Google's [Business Profile API policies](https://developers.google.com/my-business/content/policies) say:

> "You cannot allow agencies, end-clients, or other third parties to use your Business Profile project"

> "Any automatic or programmatic use of Business Profile by agencies or end-clients requires them to use their own Business Profile project."

It is unclear whether one CRM-owned project may serve scheduled posting for many unrelated businesses. Until Google confirms this in writing:

- The portal shows Business Profile as unavailable.
- The portal does not request Business Profile or Search Console scopes.
- Agency company connections are unchanged.

Other Google rules to review before ever enabling it:

- API access approval is per project. Apply through the Basic API Access application form. 0 QPM means not approved.
- Notify the end-client within 48 hours of changes made on their behalf.
- Provide a way to disassociate within seven business days after they stop using the service.
- Do not store Business Profile API content beyond 30 days.

These quotes were read on 2026-11-12. Re-check them against the live pages before any decision.
