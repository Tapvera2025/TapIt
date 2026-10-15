import { relative } from 'node:path';
import type { SourceFile } from './boundary.js';

export interface MoneyRuleViolation {
  readonly file: string;
  readonly line: number;
}

export interface MoneyRuleResult {
  readonly violations: readonly MoneyRuleViolation[];
  readonly compound: readonly MoneyRuleViolation[];
}

/**
 * CI-21 — identify authoritative money fields represented as JavaScript
 * numbers without treating ordinary counters as money.
 *
 * `total` is intentionally handled using surrounding context: it is used for
 * both invoice totals and pagination/unread counts throughout the application.
 */
const DIRECT_MONEY =
  /(?:^|[^A-Za-z0-9_$])(amount|balance|price|salary|discount|net|gross|tax|paid|due|cost|fee)(?:[A-Z]\w*)?\s*[?]?:\s*number\b(?!\()/;
const BARE_TOTAL = /(?:^|[^A-Za-z0-9_$])total\s*[?]?:\s*number\b(?!\()/;
const COMPOUND_MONEY = /\b\w+(?:Value|Amount|Price|Total|Balance)\s*[?]?:\s*number\b/;
const COUNT_CONTEXT =
  /\b(unread|count|counts|rows|items|page|pageSize|totalPages|pagination|direct|group|project|keywords|blogs)\b/i;
const NON_MONEY_NUMBER =
  /count|percent|index|length|version|attempts|limit|port|seconds|minutes|units|ms\b|bps\b|Bps\b|pages|keywords|blogs/i;
const MONEY_CONTEXT =
  /\b(currency|invoice|payment|commercial|money|financial|minor|paise|decimal|currencyCode)\b/i;

function nearby(lines: readonly string[], index: number): string {
  return lines.slice(Math.max(0, index - 6), index + 7).join('\n');
}

export function findMoneyViolations(
  files: readonly SourceFile[],
  root: string,
): MoneyRuleResult {
  const violations: MoneyRuleViolation[] = [];
  const compound: MoneyRuleViolation[] = [];

  for (const file of files) {
    const lines = file.text.split('\n');
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      if (NON_MONEY_NUMBER.test(line)) return;

      const context = nearby(lines, index);
      const hasDirectMoney = DIRECT_MONEY.test(line);
      const hasTotal = BARE_TOTAL.test(line);
      const hasCompound = COMPOUND_MONEY.test(line);

      if (hasDirectMoney || (hasTotal && MONEY_CONTEXT.test(context) && !COUNT_CONTEXT.test(context))) {
        violations.push({ file: relative(root, file.path), line: index + 1 });
      } else if (hasCompound) {
        compound.push({ file: relative(root, file.path), line: index + 1 });
      }
    });
  }

  return { violations, compound };
}

