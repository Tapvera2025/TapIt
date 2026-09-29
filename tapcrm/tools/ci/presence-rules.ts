import { relative, sep } from 'node:path';
import { locateInModule, type SourceFile } from './boundary.js';

/**
 * State machine ownership — attendance design §20, D26.
 *
 * The presence state machine is declared once, in
 * packages/contracts/src/presence.ts. Anything else that declares a
 * transition table or the PresenceState union is a second state machine,
 * and the two would drift. And attendance never imports live-status: the
 * projector port is how attendance reaches the board (design §4).
 */

export interface PresenceViolation {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

const HOME = ['packages', 'contracts', 'src', 'presence.ts'].join(sep);

/** A transition table's keys, or the union spelled out. */
const DECLARATIONS: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\b(?:NOT_IN|ON_BREAK)\s*:\s*\{/g, what: 'a presence transition table' },
  { pattern: /'NOT_IN'\s*\|\s*'WORKING'/g, what: 'the PresenceState union' },
];

const LIVE_STATUS_IMPORT =
  /\bfrom\s+['"][./]*(?:\.\.\/)+live-status\/|\bfrom\s+['"][^'"]*modules\/live-status\//g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function findPresenceViolations(
  files: readonly SourceFile[],
  root: string,
): PresenceViolation[] {
  const violations: PresenceViolation[] = [];
  for (const file of files) {
    const path = relative(root, file.path);
    if (path !== HOME && !path.endsWith('.test.ts')) {
      for (const { pattern, what } of DECLARATIONS) {
        for (const match of file.text.matchAll(pattern)) {
          violations.push({
            file: path,
            line: lineOf(file.text, match.index),
            what: `declares ${what}`,
          });
        }
      }
    }
    if (locateInModule(root, file.path)?.module === 'attendance') {
      for (const match of file.text.matchAll(LIVE_STATUS_IMPORT)) {
        violations.push({
          file: path,
          line: lineOf(file.text, match.index),
          what: 'imports live-status',
        });
      }
    }
  }
  return violations;
}
