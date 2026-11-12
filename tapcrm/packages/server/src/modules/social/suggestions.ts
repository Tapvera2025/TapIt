import type {
  SocialCompanyAssetPlatform,
  SocialCompanyLocationSuggestion,
} from '@tapcrm/contracts';

/**
 * Which client an unassigned page, profile, channel or property most likely
 * belongs to.
 *
 * A suggestion is made only when exactly ONE client matches, so a company can
 * accept every suggestion in one go. A website match — the asset's website is
 * one of the client's domains — wins over a name match, and an ambiguous
 * website match is never rescued by a name.
 */

export interface ClientCandidate {
  id: string;
  /** How the client is shown: business name, else contact name. */
  name: string;
  /** Business and contact names as typed in the CRM. */
  names: readonly string[];
  /** Hostnames known to be the client's: its SEO sites, its email domain, its
   * assigned pages' websites and its Search Console properties. */
  hosts: readonly string[];
}

export interface AssetForMatching {
  platform: SocialCompanyAssetPlatform;
  externalId: string;
  name: string;
  websiteUrl: string | null;
}

/** Mailbox providers: an address there says nothing about the client's own domain. */
const SHARED_MAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'yahoo.co.in',
  'yahoo.com',
  'ymail.com',
  'zoho.com',
  'zohomail.in',
]);

/** Words that do not tell two businesses apart. */
const NAME_NOISE = new Set([
  'and',
  'co',
  'company',
  'corp',
  'inc',
  'india',
  'limited',
  'llc',
  'llp',
  'ltd',
  'official',
  'private',
  'pvt',
  'the',
]);

/** `www.Example.com`, `https://example.com/x` or `sc-domain:example.com` → `example.com`. */
export function hostOf(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const domain = /^sc-domain:(.+)$/i.exec(raw)?.[1];
  let host: string;
  try {
    host =
      domain ??
      new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The domain of a client's own email address, unless it is a mailbox provider's. */
export function emailHost(email: string): string | null {
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain || SHARED_MAIL_DOMAINS.has(domain)) return null;
  return hostOf(domain);
}

/** `The Acme Pvt. Ltd.` → `acme`; `Acmé & Sons` → `acmesons`. */
export function nameKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !NAME_NOISE.has(word))
    .join('');
}

/** Same website, or one is a subdomain of the other (`shop.acme.in` and `acme.in`). */
function sameSite(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function suggestion(
  client: ClientCandidate,
  reason: SocialCompanyLocationSuggestion['reason'],
): SocialCompanyLocationSuggestion {
  return { clientId: client.id, clientName: client.name, reason };
}

export function suggestClient(
  asset: AssetForMatching,
  clients: readonly ClientCandidate[],
): SocialCompanyLocationSuggestion | null {
  const host =
    hostOf(asset.websiteUrl) ??
    (asset.platform === 'search_console' ? hostOf(asset.externalId) : null);
  if (host) {
    const byWebsite = clients.filter((client) =>
      client.hosts.some((clientHost) => sameSite(host, clientHost)),
    );
    if (byWebsite.length > 1) return null;
    if (byWebsite[0]) return suggestion(byWebsite[0], 'website');
  }
  const key = nameKey(asset.name);
  if (key.length < 3) return null;
  const byName = clients.filter((client) =>
    client.names.some((name) => {
      const clientKey = nameKey(name);
      return (
        clientKey.length >= 3 &&
        (clientKey === key || (clientKey.length >= 6 && key.includes(clientKey)))
      );
    }),
  );
  return byName.length === 1 && byName[0] ? suggestion(byName[0], 'name') : null;
}
