import { describe, expect, it } from 'vitest';
import {
  emailHost,
  hostOf,
  nameKey,
  suggestClient,
  type ClientCandidate,
} from './suggestions.js';

const acme: ClientCandidate = {
  id: 'acme',
  name: 'Acme Dental',
  names: ['Acme Dental', 'Rohan Mehta'],
  hosts: ['acmedental.in'],
};
const zen: ClientCandidate = {
  id: 'zen',
  name: 'Zen Yoga',
  names: ['Zen Yoga'],
  hosts: [],
};
const asset = (name: string, websiteUrl: string | null = null) => ({
  platform: 'facebook' as const,
  externalId: '1',
  name,
  websiteUrl,
});

describe('Matching what a company login manages to CRM clients', () => {
  it('reads one host from any website form', () => {
    expect(hostOf('https://WWW.AcmeDental.in/book?x=1')).toBe('acmedental.in');
    expect(hostOf('acmedental.in')).toBe('acmedental.in');
    expect(hostOf('sc-domain:acmedental.in')).toBe('acmedental.in');
    expect(hostOf('not a website')).toBeNull();
    expect(hostOf('')).toBeNull();
  });

  it('uses a client email domain only when it is the client’s own', () => {
    expect(emailHost('owner@acmedental.in')).toBe('acmedental.in');
    expect(emailHost('owner@gmail.com')).toBeNull();
    expect(emailHost('broken')).toBeNull();
  });

  it('ignores case, accents, punctuation and company suffixes in names', () => {
    expect(nameKey('The Acmé Dental Pvt. Ltd.')).toBe('acmedental');
    expect(nameKey('Zen & Yoga')).toBe('zenyoga');
  });

  it('suggests the one client whose website matches, including subdomains', () => {
    expect(
      suggestClient(asset('Clinic page', 'https://www.acmedental.in/'), [acme, zen]),
    ).toEqual({
      clientId: 'acme',
      clientName: 'Acme Dental',
      reason: 'website',
    });
    expect(
      suggestClient(asset('Shop', 'https://shop.acmedental.in'), [acme, zen]),
    ).toMatchObject({ clientId: 'acme', reason: 'website' });
  });

  it('suggests by name when no website matches', () => {
    expect(suggestClient(asset('Zen Yoga'), [acme, zen])).toMatchObject({
      clientId: 'zen',
      reason: 'name',
    });
    // A longer page name that contains the client's full name still matches.
    expect(suggestClient(asset('Acme Dental Clinic Bandra'), [acme, zen])).toMatchObject({
      clientId: 'acme',
      reason: 'name',
    });
    // A contact person's name matches a member profile.
    expect(suggestClient(asset('Rohan Mehta'), [acme, zen])).toMatchObject({
      clientId: 'acme',
    });
  });

  it('suggests nothing when more than one client could fit, or none does', () => {
    const twin = { ...acme, id: 'acme-2', names: ['Acme Dental'] };
    expect(suggestClient(asset('Acme Dental'), [acme, twin])).toBeNull();
    expect(
      suggestClient(asset('Acme Dental', 'https://acmedental.in'), [
        acme,
        { ...twin, hosts: ['acmedental.in'] },
      ]),
    ).toBeNull();
    expect(suggestClient(asset('Corner Bakery'), [acme, zen])).toBeNull();
    // Too short to tell businesses apart.
    expect(suggestClient(asset('AB'), [{ ...zen, names: ['AB'] }])).toBeNull();
  });

  it('matches a Search Console property by its own domain', () => {
    expect(
      suggestClient(
        {
          platform: 'search_console',
          externalId: 'sc-domain:acmedental.in',
          name: 'acmedental.in',
          websiteUrl: null,
        },
        [acme, zen],
      ),
    ).toMatchObject({ clientId: 'acme', reason: 'website' });
  });
});
