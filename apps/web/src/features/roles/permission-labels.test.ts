import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS, permissionGroup, permissionLabel, PERMISSION_GROUP_INFRA } from "./permission-labels";
import { roleLabels } from "../../app/me";

// Mirror of packages/rbac PERMISSIONS (GET /roles returns these codes).
const ALL_CODES = [
  "audit:read", "contract:approve", "contract:issue", "contract:read", "contract:submit", "contract:write",
  "flags:read", "flags:write", "notes:read", "notes:write", "settings:read", "settings:write",
  "template:write", "users:read", "users:write",
];

describe("permission labels", () => {
  it.each(ALL_CODES)("%s has a Vietnamese label, never the raw code", (code) => {
    const label = permissionLabel(code);
    expect(label).not.toBe(code);
    expect(label).not.toMatch(/^[a-z_]+:[a-z_]+$/);
    expect(PERMISSION_LABELS[code]).toBeDefined();
  });

  it("puts base RUNWAY permissions in the infrastructure group", () => {
    for (const code of ["flags:read", "flags:write", "notes:read", "notes:write", "settings:read", "settings:write"]) {
      expect(permissionGroup(code)).toBe(PERMISSION_GROUP_INFRA);
    }
    expect(permissionGroup("contract:read")).not.toBe(PERMISSION_GROUP_INFRA);
    expect(PERMISSION_GROUP_INFRA).toBe("Hạ tầng (nền hệ thống)");
  });

  it("labels the base member role", () => {
    expect(roleLabels["member"]).toBe("Thành viên (nền)");
  });
});
