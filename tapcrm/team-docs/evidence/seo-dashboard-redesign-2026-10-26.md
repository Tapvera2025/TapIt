# Website SEO dashboard redesign — 26 October 2026

Replaced the SEO module's second sidebar with five keyboard-accessible tabs inside the existing CRM shell. All 13 existing sections remain available:

| Main tab | Tools |
| --- | --- |
| Overview | Website summary, priority list, finding history, severity breakdown, checkup coverage, PDF report |
| Website health | Issues to review, recommended fixes, speed and experience |
| Search visibility | Google traffic, search terms, Google positions, AI mentions, incoming links |
| Activity | Checkup history, notifications |
| Settings | Websites, checkup settings |

The punch-in/out page informed the soft cards, status badges, clear primary actions, and circular progress representation. The website illustration is an original SVG tied to CRM theme variables. The coverage ring measures pages loaded against discovered URLs; it is not an invented SEO score.

Issues default to grouped causes. Expandable cards explain what was found, why it matters, what to do, and sample affected pages. The individual view retains evidence, status filters, a scoped search, and server pagination. Marking a finding not applicable is an explicit review action. Fix recommendations explain that marking work done does not edit the website or verify the fix.

Other panels explain impressions, clicks, average positions, snapshot limits, search intent, unknown AI measurements, link authority, and provider availability. Real-user performance and lab tests remain separate. Plain-language metric labels include the technical abbreviation and a target. The targets follow [Google's Core Web Vitals guidance](https://web.dev/articles/vitals).

## Verification

- Full Vitest suite: **2,273 passed, 436 skipped, zero failures**, across 222 passing test files.
- Seven focused model tests passed, including weighted search positions, daily aggregation, current rank deduplication, safe imported link schemes, and navigation completeness/keyboard movement.
- Client TypeScript and production build passed. The existing large-bundle warning remains.
- ESLint passed for the entire SEO client directory with zero errors and warnings.
- Browser fixtures mounted the actual `CompanyLayout`, CRM sidebar, header, theme provider, and SEO workspace with mocked API responses. No authenticated production/provider journey is implied by these fixtures.
- All 13 screens were reachable; populated and empty states were exercised. Verified grouped explanations, evidence, pagination, dismiss review, fix completion records, Google imports, live-rank queueing, performance queueing, notification acknowledgement, rule persistence callbacks, website creation/selection, keyboard tabs, failure/retry states, and read-only controls.
- Browser checks passed at 1440px desktop, 768px tablet, and 390px phone widths. Light/dark screenshots were inspected. The phone checks found no page overflow. No browser page errors occurred.
- A pagination view reset discovered in browser testing was fixed by keeping the audit view mounted while independently loading its result pages. Site/request keys prevent data from the previous website appearing during selection changes.
- Temporary browser fixture entry points were removed before the runtime rebuild.
- Final server/client rebuild and recreation succeeded. API health and the SEO page returned HTTP 200. The running client source hashes matched the final workspace and CSS files, and the QA entry point was absent from the image.
- The final tablet/phone metric grid was checked at both widths after refinement; four metrics form two balanced columns. Unassessed websites show guidance instead of a zero-valued health chart.

Historical findings remain reconstructed estimates using first sightings and the latest resolution. Missing provider data is displayed as unknown/unavailable rather than a fabricated healthy result. There are no new backend endpoints, database migrations, or external-provider requirements for this UI change.
