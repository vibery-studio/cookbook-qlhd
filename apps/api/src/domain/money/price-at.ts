/**
 * Dated price levels (SPEC-08 FR-3). Dates are ISO `YYYY-MM-DD` strings, compared lexically; no time zones.
 * `effective_to` is computed on read (the day before the next newer level), never stored.
 */
export interface DatedLevel {
  effective_from: string;
}

/** Greatest effective_from ≤ date, or null. */
export function levelAt<T extends DatedLevel>(levels: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const l of levels) {
    if (l.effective_from <= date && (best === null || l.effective_from > best.effective_from)) best = l;
  }
  return best;
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** Newest first; effective_to = the day before the next newer level (null for the newest). */
export function withEffectiveTo<T extends DatedLevel>(levels: readonly T[]): Array<T & { effective_to: string | null }> {
  const sorted = [...levels].sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
  return sorted.map((l, i) => {
    const newer = sorted[i - 1];
    return { ...l, effective_to: newer ? dayBefore(newer.effective_from) : null };
  });
}

export function levelStatus(level: DatedLevel, levels: readonly DatedLevel[], today: string): "past" | "current" | "scheduled" {
  if (level.effective_from > today) return "scheduled";
  return levelAt(levels, today)?.effective_from === level.effective_from ? "current" : "past";
}
