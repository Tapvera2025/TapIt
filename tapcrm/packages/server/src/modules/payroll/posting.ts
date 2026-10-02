export interface PostingLine {
  readonly role: string;        // semantic role e.g. 'salary-expense', 'salary-payable'
  readonly amountPaise: bigint; // always positive
  readonly side: 'debit' | 'credit';
}

export interface PostingIntent {
  readonly kind: 'posting' | 'zero-delta-revision';
  readonly lines: PostingLine[];
  readonly debitTotalPaise: bigint;
  readonly creditTotalPaise: bigint;
}

export interface SlipComponent {
  readonly code: string;
  readonly kind: 'earning' | 'deduction' | 'employer-contribution';
  readonly amountPaise: bigint;
  /** Configured debit and credit roles for this component. */
  readonly debitRole: string;
  readonly creditRole: string;
}

/**
 * Build a balanced posting intent for the original monthly run.
 * Earnings → salary-expense (DR) / salary-payable (CR).
 * Deductions → salary-payable (DR) / statutory-liability (CR).
 * Employer-contributions → employer-contribution-expense (DR) / statutory-liability (CR).
 */
export function buildRunPostingIntent(components: SlipComponent[]): PostingIntent {
  const lines: PostingLine[] = [];
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const c of components) {
    if (c.amountPaise === 0n) continue;
    lines.push({ role: c.debitRole, amountPaise: c.amountPaise, side: 'debit' });
    lines.push({ role: c.creditRole, amountPaise: c.amountPaise, side: 'credit' });
    debitTotal += c.amountPaise;
    creditTotal += c.amountPaise;
  }

  if (lines.length === 0) {
    return { kind: 'zero-delta-revision', lines: [], debitTotalPaise: 0n, creditTotalPaise: 0n };
  }
  return { kind: 'posting', lines, debitTotalPaise: debitTotal, creditTotalPaise: creditTotal };
}

/**
 * Build a balanced delta posting intent for a revision.
 * For each component: compute signed change (new - old).
 * Positive delta: normal debit/credit roles.
 * Negative delta: absolute value with reversed roles.
 * Zero across all components: zero-delta-revision marker.
 */
export function buildRevisionPostingIntent(
  previousComponents: SlipComponent[],
  newComponents: SlipComponent[],
): PostingIntent {
  // Build maps by code
  const prevMap = new Map<string, SlipComponent>(previousComponents.map(c => [c.code, c]));
  const newMap = new Map<string, SlipComponent>(newComponents.map(c => [c.code, c]));
  const allCodes = new Set([...prevMap.keys(), ...newMap.keys()]);

  const lines: PostingLine[] = [];
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const code of allCodes) {
    const prev = prevMap.get(code);
    const next = newMap.get(code);
    const prevAmount = prev?.amountPaise ?? 0n;
    const nextAmount = next?.amountPaise ?? 0n;
    const delta = nextAmount - prevAmount;
    if (delta === 0n) continue;

    // Get roles from whichever component exists (prefer new)
    const comp = next ?? prev!;

    if (delta > 0n) {
      // Normal: positive delta
      lines.push({ role: comp.debitRole, amountPaise: delta, side: 'debit' });
      lines.push({ role: comp.creditRole, amountPaise: delta, side: 'credit' });
      debitTotal += delta;
      creditTotal += delta;
    } else {
      // Reversing: abs(delta) with swapped sides
      const abs = -delta;
      lines.push({ role: comp.creditRole, amountPaise: abs, side: 'debit' });
      lines.push({ role: comp.debitRole, amountPaise: abs, side: 'credit' });
      debitTotal += abs;
      creditTotal += abs;
    }
  }

  if (lines.length === 0) {
    return { kind: 'zero-delta-revision', lines: [], debitTotalPaise: 0n, creditTotalPaise: 0n };
  }
  return { kind: 'posting', lines, debitTotalPaise: debitTotal, creditTotalPaise: creditTotal };
}
