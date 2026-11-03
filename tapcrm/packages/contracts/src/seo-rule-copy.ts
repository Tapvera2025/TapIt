/** Shared wording for audit findings, fix proposals and rule settings. */
export interface SeoRuleCopy { title: string; description: string; recommendation?: string }

const RULE_COPY: Record<string, readonly [string, string]> = {
  M001: ['Page title missing', 'The fetched page has no usable title. Check whether a descriptive title is present in the HTML.'],
  M002: ['Page title is empty', 'A title element exists but contains no text.'],
  M005: ['Meta description missing', 'No meta description was found. Review whether this page would benefit from a clear search-result summary.'],
  M006: ['Meta description is empty', 'The meta description element exists but its content is blank.'],
  M009: ['Page language not declared', 'The HTML element has no language attribute, such as lang="en".'],
  H001: ['URL returned 404 — not found', 'The URL returned HTTP 404 during the crawl. Check its purpose and any links pointing to it before changing it.'],
  H002: ['URL returned 410 — removed', 'The URL is marked as permanently removed. Confirm the removal is intentional and review links to it.'],
  H003: ['Server error while loading URL', 'The server returned a 5xx response. Investigate availability and server logs for the crawl time.'],
  H009: ['Possible redirect loop', 'The recorded redirect chain repeats a URL. Review the redirects and their final destination.'],
  H010: ['Long redirect chain', 'The request followed more than three redirects. Review whether it can reach the final URL more directly.'],
  I001: ['Priority page marked noindex', 'A priority page has a noindex directive in its HTML. Confirm whether it is intended to appear in search.'],
  I006: ['Priority page blocked from indexing by header', 'A priority page has a noindex value in its X-Robots-Tag response header.'],
  I009: ['Review noindex and canonical together', 'The page declares both noindex and a canonical URL. Confirm the intended indexing behavior.'],
  C001: ['Invalid canonical URL', 'The preferred-page URL in the canonical tag or header is not a valid absolute URL.'],
  C002: ['Conflicting canonical URLs', 'The HTML canonical tag and HTTP canonical header point to different URLs.'],
  C008: ['Page changes after JavaScript rendering', 'The raw and rendered content differ. Review whether JavaScript changes important search directives.'],
  T001: ['Very little visible text', 'Fewer than 50 words were detected in the fetched HTML. Short pages can be intentional; review their purpose and rendering.'],
  T002: ['Main page heading missing', 'No H1 heading was detected in the fetched page. Review how its main topic is presented.'],
  T003: ['Multiple main headings', 'More than one H1 heading was detected. Review the heading structure and the page’s main topic.'],
  T004: ['Page title and main heading match', 'The title and H1 use the same text. This is a review suggestion and can be intentional.'],
  T005: ['Long page title', 'The title exceeds this check’s 70-character threshold. Review its wording and possible truncation.'],
  T006: ['Long meta description', 'The description exceeds this check’s 165-character threshold. Review whether a shorter summary is clearer.'],
  T009: ['Matching content on multiple URLs', 'Another crawled URL has the same content hash. Review whether the duplicate URLs are intentional.'],
  L001: ['Page contains links to 404 URLs', 'Links on this page point to destinations observed returning HTTP 404 during this crawl. The listed broken URLs are the destinations, not this page itself.'],
  L002: ['Priority page has no discovered incoming links', 'No internal links to this priority page were found within the crawl’s coverage. An incomplete crawl can miss links.'],
  L003: ['Link text could be more descriptive', 'Some links use generic labels such as “click here” or “read more.” Review whether their destinations are clear.'],
  L005: ['Page has nofollow links to this site', 'Some internal links on this page carry rel="nofollow". That tells search engines not to pass link signal to the destination — confirm whether that is intended.'],
  L008: ['Page has many internal links', 'More than 150 internal links were detected on this page. Review navigation usability and whether links are repeating unnecessarily.'],
  A001: ['Page has images without alt attributes', 'Some images on this page have no alt attribute. Informational images need useful text alternatives; decorative images can use empty alt text.'],
  A002: ['Page has images with empty alt text to review', 'Some images on this page appear informational but have empty alt text. Confirm whether they are decorative.'],
  A003: ['Page has oversized image files', 'Images on this page exceed 500 KB. Review compression, formats and the dimensions needed on the page.'],
  A005: ['Page lazy-loads its main image', 'An image identified as the likely main content image uses lazy loading. Review whether this delays its appearance.'],
  S001: ['Priority page missing from sitemap', 'This priority URL was not found in the sitemap entries collected by the audit.'],
  S002: ['Page listed in sitemap but marked noindex', 'This URL appears in the XML sitemap yet declares a noindex directive. The two signals contradict each other — review which is intended.'],
  S003: ['Sitemap-listed URL returned a non-200 status', 'This URL is listed in the XML sitemap but returned a redirect or error during the crawl. Sitemaps should only list canonical, 200-OK URLs.'],
  S005: ['Review older sitemap modification date', 'The sitemap’s last-modified value is more than a year old. Change it only if it does not reflect the actual page update date.'],
  D001: ['Page has unparseable structured data', 'The audit found errors while reading this page’s JSON-LD structured data. Validate the markup in a schema tester.'],
  D002: ['Page has Product markup missing offer details', 'This page declares Product structured data without the offer information checked by this rule. Review the product markup.'],
  D003: ['Page has Article markup missing publication dates', 'This page declares Article structured data without the publication or modification dates checked by this rule.'],
  D006: ['Page has no structured data', 'No JSON-LD types were detected on this page. Review whether structured data is relevant here — it is not required for every URL.'],
  D009: ['Page structured data may not match its content', 'The audit identified a possible mismatch between this page’s structured data and its visible content. Verify manually.'],
  G001: ['Page has hreflang using relative URLs', 'A hreflang link on this page does not use a complete absolute URL. hreflang requires fully-qualified URLs.'],
  G002: ['Page hreflang set lacks x-default', 'This page declares language alternates without an x-default fallback. Review whether a fallback is needed.'],
  G003: ['Page has invalid hreflang codes', 'A language or region code in this page’s hreflang annotations could not be recognized.'],
  G005: ['Page hreflang alternates lack return links', 'Crawled sibling pages do not all link back to this page as expected. Review the reciprocal hreflang annotations.'],
  G007: ['Page hreflang and canonical disagree', 'A hreflang alternate references this URL while its canonical points elsewhere. Review the intended preferred URL.'],
  P001: ['Main content loads slowly for real users', 'Available CrUX data places the 75th-percentile Largest Contentful Paint above the good range.'],
  P002: ['Slow responses to user interactions', 'Available CrUX data places the 75th-percentile Interaction to Next Paint above the good range.'],
  P003: ['Content shifts while the page loads', 'Available CrUX data places the 75th-percentile Cumulative Layout Shift above the good range.'],
  P007: ['Low Lighthouse performance score', 'An available Lighthouse lab report has a performance score below 50 out of 100.'],
  P010: ['Real-user performance data unavailable', 'The audit had no CrUX measurements to assess. This is a data-availability notice, not a confirmed page defect; missing samples or provider access can cause it.'],
};

export const SEO_RULE_GROUP_LABELS: Readonly<Record<string, string>> = {
  meta: 'Page titles & descriptions', http: 'HTTP errors & redirects', robots: 'Crawling & indexing',
  canonicalization: 'Canonical URLs', content: 'Content & headings', links: 'Links & navigation',
  images: 'Images & accessibility', sitemaps: 'XML sitemaps', schema: 'Structured data',
  international: 'Languages & regional pages', performance: 'Speed & Core Web Vitals',
};

export function getSeoRuleCopy(ruleId: string): SeoRuleCopy {
  const copy = RULE_COPY[ruleId];
  if (!copy) return { title: 'Additional SEO check', description: 'A description is not available for this check. Use its technical reference when requesting more information.' };
  return { title: copy[0], description: copy[1], ...(ruleId === 'P010' ? {
    recommendation: 'Check the connection status in Core Web Vitals. Resolve any API-access error first. If Google reports no eligible samples, keep the field measurements unavailable and use Lighthouse for separate lab diagnostics. Recheck when field data becomes available.',
  } : {}) };
}

export function getSeoRuleGroupLabel(group: string): string {
  return SEO_RULE_GROUP_LABELS[group] ?? 'Other SEO checks';
}
