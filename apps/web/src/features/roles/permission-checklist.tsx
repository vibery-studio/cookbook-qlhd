import { groupCatalog, permissionLabel } from "./permission-labels";

export const NOT_HELD_REASON = "Bạn không có quyền này nên không cấp được";

/**
 * Permission checkboxes grouped Hợp đồng · Quản trị · Hạ tầng. A box is disabled when `lockedAll` (nobody can edit this
 * role) or `cannotGrant(code)` (caller lacks it, so cannot hand it out) — greyed with a tooltip, one note on top, no per-row text.
 */
export function PermissionChecklist({
  catalog,
  selected,
  lockedAll,
  cannotGrant,
  onToggle,
}: {
  catalog: readonly string[];
  selected: ReadonlySet<string>;
  lockedAll: boolean;
  cannotGrant: (code: string) => boolean;
  onToggle: (code: string) => void;
}) {
  const anyNoGrant = !lockedAll && catalog.some((code) => cannotGrant(code));
  return (
    <div className="grid gap-s4">
      {anyNoGrant ? <p className="text-sm text-muted">Quyền mờ: bạn không có nên không cấp được.</p> : null}
      {groupCatalog(catalog).map(({ group, codes }) => (
        <fieldset key={group} className="grid gap-s1">
          <legend className="pb-s1 text-sm font-semibold text-muted">{group}</legend>
          {codes.map((code) => {
            const noGrant = !lockedAll && cannotGrant(code);
            return (
              <div key={code} className="grid gap-[2px]">
                <label title={noGrant ? NOT_HELD_REASON : undefined} className="flex min-h-[var(--row-h)] cursor-pointer items-center gap-s3 rounded-r2 px-s2 text-md text-body hover:bg-hover has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input
                    type="checkbox"
                    className="size-[18px] accent-[var(--color-accent)]"
                    checked={selected.has(code)}
                    disabled={lockedAll || noGrant}
                    onChange={() => onToggle(code)}
                  />
                  <span className="text-strong">{permissionLabel(code)}</span>
                  <code className="rounded-r1 bg-sunken px-s1 font-mono text-sm text-muted">{code}</code>
                </label>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
