export interface GridPosition {
  readonly i: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Place every widget in the first available grid cell while keeping the
 * current visual order. An actively resized or dragged widget can be pinned
 * at its drop position; the remaining widgets then pack around it.
 */
export function reflowGridLayout<T extends GridPosition>(
  layout: readonly T[],
  columns: number,
  pinnedKey?: string,
): T[] {
  if (layout.length === 0) return [];

  const cols = Math.max(1, Math.floor(columns));
  const normalized = layout.map((item, index) => {
    const w = Math.max(1, Math.min(cols, Math.floor(item.w)));
    return {
      item,
      index,
      x: Math.max(0, Math.min(cols - w, Math.floor(item.x))),
      y: Math.max(0, Math.floor(item.y)),
      w,
      h: Math.max(1, Math.floor(item.h)),
    };
  });
  const pinned = normalized.find((entry) => entry.item.i === pinnedKey);
  const ordered = [
    ...(pinned ? [pinned] : []),
    ...normalized
      .filter((entry) => entry !== pinned)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index),
  ];

  const occupied: boolean[][] = [];
  const placed: Array<{ entry: typeof normalized[number]; x: number; y: number }> = [];
  const maxY = Math.max(
    ...ordered.map((entry) => entry.y + entry.h),
    0,
  ) + ordered.reduce((height, entry) => height + entry.h, 0) + 1;

  const isFree = (x: number, y: number, w: number, h: number): boolean => {
    for (let row = y; row < y + h; row += 1) {
      const cells = occupied[row];
      if (!cells) continue;
      for (let column = x; column < x + w; column += 1) {
        if (cells[column]) return false;
      }
    }
    return true;
  };

  const occupy = (x: number, y: number, w: number, h: number): void => {
    for (let row = y; row < y + h; row += 1) {
      const cells = occupied[row] ?? (occupied[row] = []);
      for (let column = x; column < x + w; column += 1) cells[column] = true;
    }
  };

  for (const entry of ordered) {
    let x = entry.x;
    let y = entry.y;
    if (entry !== pinned) {
      let found = false;
      for (let candidateY = 0; candidateY <= maxY && !found; candidateY += 1) {
        for (let candidateX = 0; candidateX <= cols - entry.w; candidateX += 1) {
          if (!isFree(candidateX, candidateY, entry.w, entry.h)) continue;
          x = candidateX;
          y = candidateY;
          found = true;
          break;
        }
      }
      if (!found) {
        y = maxY;
        x = 0;
      }
    }
    occupy(x, y, entry.w, entry.h);
    placed.push({ entry, x, y });
  }

  return placed
    .sort((a, b) => a.entry.index - b.entry.index)
    .map(({ entry, x, y }) => ({
      ...entry.item,
      x,
      y,
      w: entry.w,
      h: entry.h,
    }));
}
