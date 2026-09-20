export { PERMISSIONS, ROLE_NAMES, isPermission } from "./catalog";
export type { Permission, RoleName } from "./catalog";
export { can } from "./policy";
export type { Principal, ResourceContext } from "./types";
export { requirePermission } from "./middleware";
export type {
  DenyPayload,
  RequirePermissionOptions,
  ResourceContextResolver,
} from "./middleware";
