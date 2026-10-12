import type { ParsedFieldConfidence } from '@tapcrm/contracts';
import { classifyHeading } from '../ats/text.js';
import {
  CREDENTIALS,
  DOCUMENT_TITLES,
  HONORIFICS,
  NAME_PARTICLES,
  NON_NAME_WORDS,
  PLACES,
  ROLE_MODIFIERS,
  ROLE_NOUNS,
} from './lexicon.js';

/**
 * The candidate's name.
 *
 * Every short line near the top (and, for PDFs and Word files, every line set
 * in a large font) is a candidate. A candidate must look like a name — capitalised
 * words or initials, no digits, no section or document title — and is then
 * scored on font size, position, whether the email address contains it and
 * whether it reads like a job title instead. A "Name: …" label wins outright.
 */

export interface NameLine {
  readonly text: string;
  readonly index: number;
  readonly size: number | null;
  readonly page: number | null;
  readonly section: string;
  readonly heading: boolean;
}

export interface FoundName {
  readonly value: string;
  readonly confidence: ParsedFieldConfidence;
  readonly lineIndex: number | null;
}

const LABELLED_NAME = /^(?:candidate'?s?\s+|full\s+|applicant'?s?\s+|your\s+)?name(?:\s+of\s+(?:the\s+)?(?:candidate|applicant))?\s*[:\-=]\s*(.+)$/i;

function isInitialToken(token: string): boolean {
  if (/^(?:\p{Lu}\.){1,3}\p{Lu}?$/u.test(token) || /^\p{Lu}$/u.test(token)) return true;
  return /^\p{Lu}{2,3}$/u.test(token) && !/[AEIOUY]/.test(token);
}

/** Strips titles, credentials and wrapping punctuation; null if what is left is not a name. */
export function cleanName(raw: string): string | null {
  let value = raw
    .replace(/^[\s\-*]+/, '')
    .replace(/^(?:resume|résumé|curriculum vitae|cv|bio-?data|profile)\s*(?:of\b|[-:])\s*/i, '')
    .replace(/^[("'[]+|[)"'\]]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const honorific = /^([A-Za-z]{1,6})\.?\s+(?=\p{Lu})/u.exec(value);
  if (honorific?.[1] && HONORIFICS.has(honorific[1].toLowerCase())) value = value.slice(honorific[0].length);

  for (let guard = 0; guard < 3; guard += 1) {
    const credential = /(?:,\s*|\s+)([A-Za-z][A-Za-z.-]{1,7})$/.exec(value);
    const token = credential?.[1];
    if (!credential || !token || !CREDENTIALS.has(token.toLowerCase())) break;
    if (!/^[A-Z.-]+$/.test(token) && !token.includes('.')) break;
    const rest = value.slice(0, credential.index).trim();
    if (rest.split(' ').length < 2 && rest === rest.toUpperCase()) break; // "ARJUN ME" is not "Arjun"
    value = rest;
  }
  // "Priya Sharma, MBBS, MD": capitalised abbreviations after a comma are post-nominals.
  value = value.replace(/(?:,\s*[A-Z][A-Za-z.]{0,6}[A-Z.])+$/, '').replace(/[,.;:]+$/, '').trim();

  if (!value || value.length > 48 || /[\d@/\\:_#$%^*=+<>{}~|&()[\]]/.test(value)) return null;
  const lower = value.toLowerCase();
  if (DOCUMENT_TITLES.has(lower) || classifyHeading(value) !== null) return null;

  const tokens = value.split(' ');
  if (tokens.length > 5) return null;
  let fullWords = 0;
  let lowercaseWords = 0;
  for (const [position, token] of tokens.entries()) {
    const key = token.toLowerCase().replace(/[.,]+$/, '');
    if (NON_NAME_WORDS.has(key)) return null;
    if (position > 0 && NAME_PARTICLES.has(key) && token === key) continue;
    if (isInitialToken(token)) continue;
    if (/^\p{Lu}[\p{L}'’-]*\.?$/u.test(token) && token.replace(/[^\p{L}]/gu, '').length >= 2) {
      fullWords += 1;
      continue;
    }
    // Scripts without capital letters (Devanagari, Tamil…): any word of letters.
    if (/^\p{Lo}[\p{Lo}\p{M}]+$/u.test(token)) {
      fullWords += 1;
      continue;
    }
    if (/^\p{Ll}[\p{L}'’-]+$/u.test(token)) {
      fullWords += 1;
      lowercaseWords += 1;
      continue;
    }
    return null;
  }
  if (fullWords === 0 || (lowercaseWords > 0 && lowercaseWords !== tokens.length)) return null;
  if (tokens.every((token) => PLACES.has(token.toLowerCase())) || PLACES.has(lower)) return null;
  return value;
}

/** "ROHIT KUMAR VERMA" → "Rohit Kumar Verma"; mixed case ("DeSouza") is kept as written. */
export function displayName(value: string): string {
  const letters = value.replace(/[^\p{L}]/gu, '');
  if (letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return value;
  return value
    .split(' ')
    .map((token, position) => {
      if (isInitialToken(token)) return token;
      const key = token.toLowerCase();
      if (position > 0 && NAME_PARTICLES.has(key) && key.length <= 4) return key;
      return key.replace(/(^|[-'’])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
    })
    .join(' ');
}

function tokensOf(name: string): string[] {
  return name.split(' ').map((token) => token.toLowerCase().replace(/[^\p{L}]/gu, '')).filter(Boolean);
}

/** Pieces of a line that could each be the name: "Emily Chen, PMP", "Rohit Verma | Sales". */
function fragments(text: string): string[] {
  return text
    .split(/\t| \| | ?• ?| · | - | — |\s{3,}|,\s*/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .slice(0, 3);
}

interface Candidate {
  readonly name: string;
  readonly line: NameLine;
  readonly score: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

export function findName(lines: readonly NameLine[], emails: readonly string[]): FoundName | null {
  for (const line of lines.slice(0, 60)) {
    const match = LABELLED_NAME.exec(line.text.replace(/\t/g, ' '));
    const value = match?.[1]?.split(/\s{2,}|\||,|;/)[0];
    const name = value ? cleanName(value) : null;
    if (name && name.split(' ').length >= 1) {
      return { value: displayName(name), confidence: 'high', lineIndex: line.index };
    }
  }

  const firstPage = lines.filter((line) => line.size !== null && (line.page ?? 1) === 1);
  const hasSizes = firstPage.length >= 3;
  const sizeRanks = [...new Set(firstPage.map((line) => line.size!))].sort((a, b) => b - a);
  const bodySize = median(firstPage.map((line) => line.size!));
  const locals = emails.map((email) => email.split('@')[0] ?? '');

  const candidates: Candidate[] = [];
  for (const line of lines) {
    const large = hasSizes && line.size !== null && (line.page ?? 1) === 1 && line.size >= bodySize * 1.25;
    if ((line.index >= 30 && !large) || line.heading) continue;
    const pieces = fragments(line.text);
    for (const [position, piece] of pieces.entries()) {
      const name = cleanName(piece);
      if (!name) continue;
      candidates.push({ name, line, score: scoreCandidate(name, line, position) });
    }
  }

  function scoreCandidate(name: string, line: NameLine, position: number): number {
    const tokens = name.split(' ');
    const keys = tokensOf(name);
    let score = 10 - Math.min(line.index, 30) * (hasSizes ? 0.3 : 0.6) - position * 2;
    const rank = hasSizes && line.size !== null && (line.page ?? 1) === 1 ? sizeRanks.indexOf(line.size) : -1;
    if (rank === 0) score += 12;
    else if (rank === 1) score += 5;
    if (hasSizes && line.size !== null && line.size >= bodySize * 1.4) score += 4;

    if (tokens.length === 2 || tokens.length === 3) score += 4;
    else if (tokens.length === 4) score += 1;
    else if (tokens.length === 1) score -= 5;
    else score -= 3;

    const emailHits = keys.filter((key) => key.length >= 3 && locals.some((local) => local.toLowerCase().includes(key))).length;
    score += Math.min(emailHits, 2) * 6;

    const last = keys.at(-1) ?? '';
    if (ROLE_NOUNS.has(last)) score -= 15;
    else if (keys.some((key) => ROLE_NOUNS.has(key))) score -= 10;
    score -= keys.filter((key) => ROLE_MODIFIERS.has(key)).length * 2;

    if (line.section === 'header') score += 3;
    else if (rank !== 0 && line.section !== 'other') score -= 6;
    if (name === name.toLowerCase()) score -= 4;
    return score;
  }

  candidates.sort((a, b) => b.score - a.score || a.line.index - b.line.index);
  let best = candidates[0];

  // Stacked names: "ARJUN" over "MEHTA", set in the same large type.
  if (best && best.name.split(' ').length === 1) {
    const partner = candidates.find((candidate) => candidate !== best
      && candidate.name.split(' ').length === 1
      && candidate.score >= best!.score - 12
      && !tokensOf(candidate.name).some((key) => ROLE_NOUNS.has(key) || ROLE_MODIFIERS.has(key))
      && Math.abs(candidate.line.index - best!.line.index) === 1
      && (candidate.line.size ?? 0) === (best!.line.size ?? 0));
    if (partner) {
      const [first, second] = partner.line.index < best.line.index ? [partner, best] : [best, partner];
      best = { name: `${first.name} ${second.name}`, line: first.line, score: Math.max(best.score, partner.score) + 6 };
    }
  }

  if (best && best.score >= 5) {
    const confidence: ParsedFieldConfidence = best.score >= 25 ? 'high' : best.score >= 14 ? 'medium' : 'low';
    return { value: displayName(best.name), confidence, lineIndex: best.line.index };
  }

  return nameFromEmail(lines, emails[0]);
}

/** Last resort: "rohit.verma88@…" → "Rohit Verma", if those words appear in the resume. */
function nameFromEmail(lines: readonly NameLine[], email: string | undefined): FoundName | null {
  const local = email?.split('@')[0];
  if (!local) return null;
  const parts = local.split(/[._-]+/).map((part) => part.replace(/\d+/g, '')).filter((part) => /^[a-z]{2,}$/i.test(part));
  if (parts.length < 2 || parts.length > 3) return null;
  const text = lines.map((line) => line.text.toLowerCase()).join('\n');
  const present = parts.every((part) => new RegExp(`\\b${part.toLowerCase()}\\b`).test(text));
  return {
    value: parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' '),
    confidence: present ? 'medium' : 'low',
    lineIndex: null,
  };
}
