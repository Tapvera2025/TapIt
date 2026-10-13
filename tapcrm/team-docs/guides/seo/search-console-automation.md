# Automatic SEO Keyword Rank Fetching

How the on-page SEO module fills in keyword ranks from Google Search Console,
what it can and cannot cover, and how to set it up.

---

## 1. What this actually reports

**Search Console is not a rank tracker, and the difference matters when you
read the Keyword Tracker table.**

Its Search Analytics API returns, for a verified property, the **average
position** at which the site appeared — averaged over the whole observation
window, across every impression (different users, locations, personalisation).
Three consequences:

- **A keyword the site does not rank for has no row at all.** Google also omits
  queries with very few impressions, for privacy. Both arrive as an
  `unavailable` observation; they are indistinguishable from the outside.
- **The position is fractional** (e.g. `14.3`). `current_rank` holds the
  rounded value; the exact one is kept in `exact_position` and shown in the
  History modal, which is where a 14.4 → 14.6 slide is still visible.
- **The data runs about three days behind.** Observations are taken from a
  window ending `GOOGLE_SEARCH_CONSOLE_LAG_DAYS` back (default 3) and spanning
  `GOOGLE_SEARCH_CONSOLE_WINDOW_DAYS` (default 7). A single day is too sparse —
  a low-impression keyword simply vanishes from it.

### Coverage

| Keyword | Automatic | Why |
| --- | --- | --- |
| Google · SEO · no city | **Yes** | Search Console filters by country, device and page |
| Bing | No | A different product (Bing Webmaster Tools API) |
| GMB | No | Search Console has no local-pack or Business Profile rank |
| Any city set | No | There is no city dimension, only country |
| Country it cannot resolve | No | Reported as `skipped` rather than silently fetched worldwide |

A keyword outside that first row keeps whatever fetch frequency you set, is
never fetched, and shows **Not supported** in the *Auto* column with the reason
on hover. The Add/Edit Keyword form warns about the combination as you pick it.

Covering those rows needs a paid SERP API (DataForSEO, SerpApi). The fetcher
sits behind the `RankProvider` interface in
`packages/server/src/modules/projects/reports/rank-provider.ts` precisely so one
can be added without touching the scheduler, the write path or the UI.

---

## 2. Choosing an auth mode

Set `GOOGLE_SEARCH_CONSOLE_AUTH` to one of:

### `service-account` — recommended for a server

No token expiry, no consent screen, no Google verification review.

**Cost:** the service account is a separate identity, so a property **owner**
must add its email as a user on **every** property it should read. *Restricted*
is enough to read search analytics.

1. In the Google Cloud project that already has the Search Console API enabled,
   create a service account and a **JSON key**.
2. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
   (the `private_key` field from that JSON — the `\n` escapes can stay).
3. In Search Console, for each property: *Settings → Users and permissions →
   Add user*, paste the service-account email, permission *Restricted*.

### `oauth` — immediate access to properties an account already has

Uses a refresh token for an account (e.g. `tapveratechnologies@gmail.com`) that
is already a user on the client properties. **No per-property setup.**

**The trap:** while the OAuth consent screen is in *Testing*, Google expires
refresh tokens after **7 days**, and the nightly job then fails every night
until someone re-consents. Publish the consent screen to **Production** before
relying on this.

1. Create an OAuth client (type *Web application*) in the same project.
2. Consent screen: add the scope
   `https://www.googleapis.com/auth/webmasters.readonly`, then **publish to
   Production**.
3. Complete the consent flow once with `access_type=offline` and keep the
   refresh token.
4. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and
   `GOOGLE_OAUTH_REFRESH_TOKEN`.

Either way the server requests only the **read-only** scope, and
`loadConfig()` refuses to boot if a mode's fields are incomplete — a
half-configured integration fails at deployment, not at 4am inside a job.

---

## 3. Linking a project

Open a project → **Reports** → **Google Search Console**:

1. Pick the property from the dropdown. It lists everything the configured
   Google account can read, in Search Console's own forms —
   `sc-domain:example.com` (domain property) or `https://example.com/`
   (URL-prefix property). If the list is empty, the card says why.
2. **Link property.**
3. Give the keywords you want fetched a frequency other than *Manual*.
4. **Sync now** to confirm it works, rather than waiting for the schedule.

Re-pointing a project at a different property clears its sync history, because
that history described another site. Re-saving the same property keeps it.

---

## 4. How the schedule runs

Two jobs, in `packages/server/src/modules/projects/reports/jobs.ts`:

| Job | Cadence | Does |
| --- | --- | --- |
| `projects.seo-rank-sweep` | daily, 04:20, per organization | Finds projects with keywords due, offers one fetch job each |
| `projects.seo-rank-fetch` | on demand | One project's fetch, keyed `project:windowEnd` |

A keyword is due when `last_auto_fetch_at` is older than its frequency allows —
20 hours for *daily*, 6 days for *weekly*, 27 days for *monthly*. Each is
slightly under its nominal period so a job at 04:20 is not pushed later each
cycle until it misses a day.

Keywords sharing a country, device and target URL are fetched in **one** API
call, so a project with 200 keywords on one site and one device costs a single
request — comfortably inside Search Console's quota.

**Sync now** runs the same code as the job, so the button and the schedule
cannot drift apart. It differs in one way: it refetches **every** automatic
keyword, not only those currently due.

### Idempotency and retries

- One automatic observation per keyword per window, enforced by a unique index.
  A redelivered or retried job **refreshes** that row instead of appending a
  second one, and only a genuinely new row shifts `previous_rank` — so a retry
  cannot invent a trend (JB-1).
- A transient failure (rate limit, Google 5xx) is retried with backoff and
  eventually dead-letters with a `job-dead-lettered` alert (JB-4).
- A credential or permission failure is **not** retried — it would fail
  identically every time. It is recorded on the project for someone to fix, and
  the card shows it.

### An `unavailable` result does not erase a known rank

The manual *Rank* dialog sets `current_rank` to null when you choose
*Unavailable*, which is right: a person is stating they checked. The automated
path deliberately does **not**. Search Console omits low-impression queries
routinely, so applying that would flip a real rank to `N/A` and back as
impressions wobble. Instead the history row records the truth, the keyword's
last known rank stands, and the *Auto* column shows **No data**.

---

## 5. Reading the outcomes

`last_auto_fetch_outcome`, shown as a badge in the *Auto* column with the
detail on hover:

| Badge | Means |
| --- | --- |
| **Fetched** | A position came back and `current_rank` was updated |
| **No data** | Google answered, but not for this keyword — not ranking, or too few impressions |
| **Not supported** | Bing, GMB, a city, or an unrecognised country. Update it manually |
| **Failed** | The fetch itself failed. The card carries the reason |

The card's own line shows the last sync's status (`ok` / `partial` / `failed`),
when it ran, and how many keywords it updated. `partial` means some keywords
were updated and some could not be fetched automatically.

---

## 6. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Property dropdown is empty | The Google account is not a user on any property; or, in `service-account` mode, the service-account email was never added |
| "Search Console denied access" | The account lost access to that property, or the key was revoked |
| Worked for a week, then failed nightly | `oauth` mode with the consent screen still in *Testing* — Google expired the refresh token. Publish to Production |
| Every keyword says **No data** | Usually the wrong property (a URL-prefix property that does not cover the pages), or a `page` filter pointing at a URL that gets no impressions |
| Nothing runs at all | `GOOGLE_SEARCH_CONSOLE_AUTH=off`, no property linked, or every keyword left on *Manual* |
| Ranks look worse than a rank tracker says | Expected. This is an impression-weighted average across locations and devices, not a single SERP reading — see §1 |
