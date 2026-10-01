/** Added / removed permission codes between the saved set and the draft. */
export function roleDiff(oldPerms: readonly string[], newPerms: readonly string[]): { added: string[]; removed: string[] } {
  const before = new Set(oldPerms);
  const after = new Set(newPerms);
  return {
    added: [...after].filter((c) => !before.has(c)).sort(),
    removed: [...before].filter((c) => !after.has(c)).sort(),
  };
}

/** Counts as "+2 · −1" (added first, U+2212 minus); "" with no change. */
export function diffCounts(added: number, removed: number): string {
  return [...(added > 0 ? [`+${added}`] : []), ...(removed > 0 ? [`−${removed}`] : [])].join(" · ");
}

/** Submit-button text of a permission edit (SPEC-07 DEC-1: sent, not saved): "Gửi yêu cầu", "Gửi yêu cầu (−1)", "Gửi yêu cầu (+2 · −1)". */
export function requestDiffLabel(oldPerms: readonly string[], newPerms: readonly string[]): string {
  const { added, removed } = roleDiff(oldPerms, newPerms);
  const counts = diffCounts(added.length, removed.length);
  return counts === "" ? "Gửi yêu cầu" : `Gửi yêu cầu (${counts})`;
}
