/** Added / removed permission codes between the saved set and the draft. */
export function roleDiff(oldPerms: readonly string[], newPerms: readonly string[]): { added: string[]; removed: string[] } {
  const before = new Set(oldPerms);
  const after = new Set(newPerms);
  return {
    added: [...after].filter((c) => !before.has(c)).sort(),
    removed: [...before].filter((c) => !after.has(c)).sort(),
  };
}

/** Save-button text: "Lưu", "Lưu (−1 quyền)", "Lưu (+2 quyền · −1 quyền)" (U+2212 minus). */
export function roleDiffLabel(oldPerms: readonly string[], newPerms: readonly string[]): string {
  const { added, removed } = roleDiff(oldPerms, newPerms);
  const parts = [
    ...(added.length > 0 ? [`+${added.length} quyền`] : []),
    ...(removed.length > 0 ? [`−${removed.length} quyền`] : []),
  ];
  return parts.length > 0 ? `Lưu (${parts.join(" · ")})` : "Lưu";
}
