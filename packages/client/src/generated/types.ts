/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Regenerate with: pnpm --filter @runway/client generate
 * Source spec:     packages/contracts/dist/openapi.json
 *
 * CI runs `pnpm --filter @runway/client check` which diffs this
 * file against a fresh regeneration and fails on drift, so keep the
 * committed copy in sync with every OpenAPI-visible change.
 */
/* eslint-disable */

export interface paths {
    "/auth/signup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a new user account */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SignupRequest"];
                };
            };
            responses: {
                /** @description User created; verification email queued */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SignupResponse"];
                    };
                };
                /** @description Email already registered */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Signups temporarily disabled via feature flag */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Consume an email verification token */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["VerifyRequest"];
                };
            };
            responses: {
                /** @description Email verified */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            verified: true;
                        };
                    };
                };
                /** @description Token already used, expired, or unknown */
                410: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate an invited account with the link token and a password */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ActivateRequest"];
                };
            };
            responses: {
                /** @description Activated */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description invalid_or_expired_token: unknown, used or expired link */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed / weak password */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Authenticate with email + password */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["LoginRequest"];
                };
            };
            responses: {
                /** @description Authenticated; session cookies set */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            user_id: string;
                        };
                    };
                };
                /** @description Invalid credentials */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Account not verified or disabled */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Rate limited (Phase 10) */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current session */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Logged out */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rotate the refresh token and mint a new access token */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Rotated; new session cookies set */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
                /** @description Missing or expired refresh cookie, or reuse detected */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the current authenticated user */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current user profile with roles and permissions */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MeResponse"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export all data owned by the authenticated user */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Signed archive of the authenticated user's data */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MeExportResponse"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Export requested too recently */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request permanent deletion of the authenticated account */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["MeDeleteRequest"];
                };
            };
            responses: {
                /** @description Deletion scheduled; sessions revoked immediately */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MeDeleteResponse"];
                    };
                };
                /** @description Invalid password or not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Body validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/delete/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel a pending account deletion before the grace window elapses */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deletion cancelled */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            cancelled: true;
                        };
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description No pending deletion, or grace window already elapsed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users (cursor-paginated) */
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated user list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["AdminUserItem"][];
                            next_cursor: string | null;
                        };
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing users:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Invite a user (returns a one-time activation link) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["InviteUserRequest"];
                };
            };
            responses: {
                /** @description User created (pending) with activation link */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InviteUserResponse"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing users:write permission, or rule owner_only (only a giam_doc holder assigns a role carrying roles:write — admin, giam_doc, custom) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Email already registered */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed, or unknown-role (role name does not exist / is not assignable) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change role, status or display name */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateUserRequest"];
                };
            };
            responses: {
                /** @description Updated user */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AdminUser"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing users:write permission, or rule self_role (own role) | admin_only (only an admin edits a user holding admin) | owner_only (only a giam_doc holder assigns a role carrying roles:write) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description User not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description last_admin: cannot disable or demote the last active admin */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed, or unknown-role (role name does not exist / is not assignable) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/admin/users/{id}/invite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Re-issue the activation link (old link stops working) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description New activation link */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReinviteResponse"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing users:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description User not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description already_active: user has already activated */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Role x permission matrix + full permission catalog */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Roles (with holders, can/locked_reason for the caller) and the permission catalog */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RolesResponse"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a custom role (clone = create with the source's permissions); name is server-made r_<ulid> */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateRoleRequest"];
                };
            };
            responses: {
                /** @description Role created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Role"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write, or `forbidden` with rule own_role (caller carries the role) | admin_role (admin is immutable) | system_role (system roles are not deleted) | grant_not_held (+ `permissions`: codes the caller lacks). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description duplicate (label, case/space-insensitive) | role-limit (50 custom roles) | sod-conflict (+ `pairs`: declared pairs the set holds both codes of) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (unknown or repeated permission, label 1–60, description ≤ 200, extra keys) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete a custom role nobody carries */
        delete: {
            parameters: {
                query: {
                    expected_version: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Role deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write, or `forbidden` with rule own_role (caller carries the role) | admin_role (admin is immutable) | system_role (system roles are not deleted) | grant_not_held (+ `permissions`: codes the caller lacks). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Role not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description stale (version mismatch) | role-in-use (+ `holders`) | request-pending (the role has a pending change request) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** Edit a role's label and/or description (optimistic lock by expected_version). Permission changes go through POST /roles/{id}/change-requests */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["PatchRoleRequest"];
                };
            };
            responses: {
                /** @description Role updated (version + 1) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Role"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write, or `forbidden` with rule own_role (caller carries the role) | admin_role (admin is immutable) | system_role (system roles are not deleted) | grant_not_held (+ `permissions`: codes the caller lacks). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Role not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description stale (version mismatch) | duplicate (label) | request-pending (the role has a pending change request) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (incl. a `permissions` key — use a change request) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/roles/{id}/change-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request a change of the role's permission set (full new set; applied only when someone else approves) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateChangeRequest"];
                };
            };
            responses: {
                /** @description Request created (pending, expires in 7 days) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChangeRequest"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write, or `forbidden` with rule own_role (not for the admin role: admin proposes, Giám đốc approves) | grant_not_held (+ `permissions`). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Role not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description sod-conflict (+ `pairs`) | stale (version mismatch) | request-pending (role already has a pending request) | no-eligible-approver (nobody else can approve; for the admin role: no other giam_doc holder) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (unknown or repeated code, note > 500, nothing changes → errors[{path:'permissions'}]) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-change-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Permission change requests, newest first (no status = all) */
        get: {
            parameters: {
                query?: {
                    status?: "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "cancelled";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Requests with can/locked_reason for the caller */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChangeRequestList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (unknown status) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-change-requests/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve and apply a pending request (CAS on the role version; holders' cache purged) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ApproveChangeRequest"];
                };
            };
            responses: {
                /** @description Approved; the role after the change */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApproveChangeRequestResponse"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write, or `forbidden` with rule self_approve (you sent it) | jit_actor (caller has an active JIT grant) | owner_only (approve only: a change to the admin role needs a giam_doc holder) | own_role (approve only: adding codes to a role you carry; not for giam_doc holders on giam_doc) | grant_not_held (approve only: the requester no longer holds an added code, + `permissions`). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Request not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description not-pending | expired | stale (role changed) | sod-conflict (+ `pairs`, a pair declared after the request) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-change-requests/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a pending request (note required) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["RejectChangeRequest"];
                };
            };
            responses: {
                /** @description Rejected */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChangeRequest"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write, or `forbidden` with rule self_approve (you sent it) | jit_actor (caller has an active JIT grant) | owner_only (approve only: a change to the admin role needs a giam_doc holder) | own_role (approve only: adding codes to a role you carry; not for giam_doc holders on giam_doc) | grant_not_held (approve only: the requester no longer holds an added code, + `permissions`). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Request not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description not-pending | expired */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (note 1–500) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-change-requests/{id}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Withdraw your own pending request */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Withdrawn */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ChangeRequest"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description `forbidden`: only the requester may withdraw (one permission.denied row) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Request not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description not-pending */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sod-pairs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Declared conflicting permission pairs (any logged-in user) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pairs */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SodPairList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Declare a conflicting permission pair (stored perm_a < perm_b) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateSodPair"];
                };
            };
            responses: {
                /** @description Pair declared */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SodPair"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description sod-conflict (+ `roles`: roles already holding both codes) | duplicate (same pair, either order) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (unknown code, same code twice, reason > 200) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sod-pairs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a pair (roles are not touched) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pair removed */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing roles:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Pair not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/jit-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Temporary admin grants, newest first (?active=true → only active) */
        get: {
            parameters: {
                query?: {
                    active?: "true" | "false";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Grants */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JitGrantList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing users:read */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Grant temporary admin to someone else (reason 10–500, 15–480 minutes); Idempotency-Key replays */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateJitGrant"];
                };
            };
            responses: {
                /** @description Grant active until expires_at */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JitGrant"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing jit:grant, or `forbidden` with rule self_grant | jit_actor (caller has an active JIT grant). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description User not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description already-admin (user carries admin permanently) | jit-active (user already has an active grant) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (reason, minutes, user not active) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/jit-grants/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End a grant early (jit:grant holder, or the recipient themself) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JitGrant"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description `forbidden`: neither a permanent jit:grant holder nor the recipient (one permission.denied row) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Grant not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description not-active (already revoked or expired) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-reviews/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The open review (else this quarter's), its rows for the caller, progress and overdue */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current review (review:null when none) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CurrentAccessReview"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Needs reviews:write or roles:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Open the review of the current quarter (Asia/Ho_Chi_Minh) if none exists */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Review opened */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AccessReview"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing reviews:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description duplicate (this quarter already has a review) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-reviews/{id}/items/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Keep or remove (= disable the account) one row */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["DecideReviewItem"];
                };
            };
            responses: {
                /** @description Row decided */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AccessReviewItem"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description `forbidden` with rule jit_actor | self_review | admin_only, or not a reviewer of this row (reviews:write; the director's row: a permanent roles:write holder). One permission.denied row each. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Review or row not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description review-closed | item-changed (role or status changed since the snapshot) | last-admin */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-reviews/{id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Close the review once every row is decided or changed */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Closed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AccessReview"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing reviews:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Review not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description review-incomplete | review-closed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audit log (newest first, cursor-paginated) */
        get: {
            parameters: {
                query?: {
                    action?: string;
                    actor?: string;
                    target?: string;
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Audit events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AuditList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing audit:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search / list customers (cursor-paginated) */
        get: {
            parameters: {
                query?: {
                    q?: string;
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Customers */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CustomerList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a customer (blocks duplicate phone / tax code) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateCustomerRequest"];
                };
            };
            responses: {
                /** @description Customer created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Customer"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description duplicate phone or tax code; body carries existing_id */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a customer */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Customer */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Customer"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Customer not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update a customer (optimistic lock by expected_version) */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateCustomerRequest"];
                };
            };
            responses: {
                /** @description Customer updated (version + 1) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Customer"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Customer not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description stale (version mismatch) or duplicate (body carries existing_id) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/products": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Products with the price level in force on `date` (default: today, Vietnam time) and the next one */
        get: {
            parameters: {
                query?: {
                    date?: string;
                    kind?: "service" | "goods";
                    active?: "true" | "false";
                    q?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Services first, then by code */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProductList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (date not a real date, limit, kind, active) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Add a product (code trimmed + upper-cased, immutable); optional first price level; Idempotency-Key replays */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateProductBody"];
                };
            };
            responses: {
                /** @description Product created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Product"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing product:write, or price:write when first_price is sent (one permission.denied row) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description duplicate (code already used, case/space-insensitive) | product-limit (500 products) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed | price-backdated (first_price before today). Order: schema → price-backdated → 409 */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A product with its full price history (newest first, past | current | scheduled) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Product */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProductDetail"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Product not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit name / unit / duration / active (optimistic lock by expected_version; code and kind never change) */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["PatchProductBody"];
                };
            };
            responses: {
                /** @description Product updated (version + 1) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Product"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing product:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Product not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description stale (version mismatch) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (incl. sending code or kind) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/products/{id}/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a price level (ex-VAT + VAT rate) from a date; levels are never edited; Idempotency-Key replays */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["AddPriceBody"];
                };
            };
            responses: {
                /** @description Level added */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Level"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing price:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Product not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description duplicate (a level already starts that day) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed | price-backdated (before tomorrow when levels exist; before today for the first) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/products/{id}/prices/{priceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Cancel a scheduled price level (never one already in effect) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    priceId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cancelled */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing price:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Product or level not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description price-in-effect (effective_from ≤ today) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pricing/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Price lines on today's date (ex-VAT, per-line discount, VAT per rate group); nothing is stored */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["PricingPreviewBody"];
                };
            };
            responses: {
                /** @description Priced lines + totals */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PricingPreview"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:write */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (errors[].path `lines.<i>.product_id` for unknown / duplicate) | product-inactive | no-price (errors name the lines) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List templates with their current version (cursor-paginated; `?type` = one doc type) */
        get: {
            parameters: {
                query?: {
                    type?: components["schemas"]["DocType"];
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Templates */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TemplateList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a template with its version 1 (director only) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateTemplateRequest"];
                };
            };
            responses: {
                /** @description Template created at v1 */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TemplateDetail"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing template:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description duplicate name; body carries existing_id */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (shape) or template-check-failed (errors[] with code/key/source) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a template at a version (default: the current version) */
        get: {
            parameters: {
                query?: {
                    version_no?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Template */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TemplateDetail"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Template or version_no not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Append a new version; it becomes current (director only) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateTemplateVersionRequest"];
                };
            };
            responses: {
                /** @description Version appended */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TemplateDetail"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing template:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Template not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description stale: expected_version_no is not the current version */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (shape) or template-check-failed (errors[] with code/key/source) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/templates/import/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview a Word (.docx) template import: placeholders, suggested fields, base policy, warnings (director only; stores nothing) */
        post: {
            parameters: {
                query?: {
                    template_id?: string;
                    lines_table?: number | null;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": string;
                };
            };
            responses: {
                /** @description Preview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TemplateImportPreview"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing template:write permission (permission.denied audited) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description template_id not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description payload-too-large: file over 2 MB */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description unsupported-media-type: Content-Type is not the .docx type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (lines_table beyond the table count) | docx-invalid with `reason` (not_docx | macro_enabled | no_document | xml_invalid | too_large_inflated | too_many_entries) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List documents (team-wide, `?type` = one doc type) with status counts under the same filters */
        get: {
            parameters: {
                query?: {
                    type?: components["schemas"]["DocType"];
                    status?: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
                    customer_id?: string;
                    created_by?: string;
                    template_id?: string;
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Contracts + counts */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContractList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a draft contract (prices + totals computed server-side) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateContractRequest"];
                };
            };
            responses: {
                /** @description Draft created (number = null) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing the write permission of the document type (contract:write · quote:write · payment_request:write · delivery_note:write) → permission.denied */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description template or customer not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description idempotency-conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (errors[].path `lines` = DEC-10 rule, `lines.<i>.product_id` = unknown/duplicate) | product-inactive | no-price | missing-fields (missing_fields[]) | unresolved-placeholder (placeholders[]) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Document detail: snapshot, steps, timeline, parent/children refs, can{} (+ create_child reasons) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Contract */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        /** Hard-delete a draft (creator only); audit keeps the id only */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Draft deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing the type's write permission, or not the creator (rule creator_only) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict (current_status) — only drafts can be deleted */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** Edit a draft (creator only, optimistic lock) */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["UpdateContractRequest"];
                };
            };
            responses: {
                /** @description Draft updated (version + 1) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing the type's write permission, or not the creator (permission.denied) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict (current_status) | stale */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (lines / lines.<i>.product_id) | product-inactive | no-price | missing-fields | unresolved-placeholder */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/contracts/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit a draft for approval (creator only) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["EmptyRequest"];
                };
            };
            responses: {
                /** @description Contract pending, steps created */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:submit, or not the creator */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict | no-eligible-approver (step_no, label) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve the current step */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ApproveRequest"];
                };
            };
            responses: {
                /** @description Step approved (contract pending or approved) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing permission/role for the step, or SoD (rule: creator_cannot_approve | one_person_one_step) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict | would-block-later-step (step_no, label) | changed-after-approval */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject the contract (note required) — terminal */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["RejectRequest"];
                };
            };
            responses: {
                /** @description Contract rejected */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing permission/role for the step, or SoD (rule) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (note required) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/issue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Issue an approved contract: gap-free number + stored print */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["EmptyRequest"];
                };
            };
            responses: {
                /** @description Contract issued (number) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:issue permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict | changed-after-approval */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/void": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Void an issued contract (reason required; number kept) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["VoidRequest"];
                };
            };
            responses: {
                /** @description Contract voided */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:issue permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed (reason required) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Copy a rejected/voided contract into a new draft (today's prices + current template) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["EmptyRequest"];
                };
            };
            responses: {
                /** @description New draft (source_contract_id set) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing the write permission of the document type (contract:write · quote:write · payment_request:write · delivery_note:write) → permission.denied */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict (source not rejected/voided, or voided already replaced) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description missing-fields | validation | product-inactive | no-price (today's data) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Withdraw a pending contract back to draft (creator only, no step decided yet) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["EmptyRequest"];
                };
            };
            responses: {
                /** @description Contract back to draft (waiting steps removed, version + 1) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:submit permission, or not the creator (rule creator_only) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description already-decided (a step was decided) | state-conflict (not pending) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/render": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Printable HTML (stored bytes once issued; ETag = rendered_hash) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description HTML; CSP default-src 'none'; ETag when issued */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/html": string;
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download the issued PDF (made on the first request, then served from storage; voided keeps the original) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description PDF bytes; Content-Disposition attachment; filename="<number>.pdf"; ETag = sha256 of the file */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/pdf": string;
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description state-conflict (not issued; current_status) */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description PDF renderer unavailable (contract untouched; use the printable paper) */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audit trail of one contract (newest first) */
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Audit events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AuditList"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing audit:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Contract not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contracts/{id}/children": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Make a child document from an issued parent (BG → HĐ, HĐ → DNTT); lines + prices frozen from the parent */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateChildRequest"];
                };
            };
            responses: {
                /** @description Child draft created (number = null) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contract"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:read, or the child type's write code (quote:write | contract:write | payment_request:write | delivery_note:write; permission.denied audited) */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Parent (or template_id) not found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description parent-not-issued | quote-expired | child-exists (existing_id = the live child) | idempotency-conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description validation (schema; errors[].path `lines` = the BG breaks the HĐ line rule, DEC-7) | child-type (pair not in CHILD_OF) | lines-locked (values.giam_gia sent) | template-type (template of another type) | nothing-to-pay (HĐ total 0) | missing-fields (missing_fields[]) */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Approval steps the caller may act on now (permission + role, not creator, not yet decided) */
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Queue */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApprovalQueue"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing contract:approve permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all system settings */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All registered settings + current values */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["SettingSnapshot"][];
                        };
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing settings:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/settings/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a single system setting */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    key: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The setting's current value */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SettingSnapshot"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing settings:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown setting key */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        /** Update a system setting */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    key: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["SettingsUpdateRequest"];
                };
            };
            responses: {
                /** @description Updated snapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SettingSnapshot"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing settings:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown setting key */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Value failed the registry schema */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/flags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List all feature flags */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All registered flags + current state */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["FlagSnapshot"][];
                        };
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing flags:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/flags/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a single feature flag */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    key: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The flag's current state */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FlagSnapshot"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing flags:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown flag key */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        /** Update a feature flag */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    key: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["FlagUpdateRequest"];
                };
            };
            responses: {
                /** @description Updated snapshot */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FlagSnapshot"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing flags:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Unknown flag key */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
                /** @description Update body failed validation */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/problem+json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/demo/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List notes (cursor-paginated) */
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paginated note list */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["Note"][];
                            next_cursor: string | null;
                        };
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing notes:read permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        put?: never;
        /** Create a note (idempotency demo) */
        post: {
            parameters: {
                query?: never;
                header?: {
                    "Idempotency-Key"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateNoteRequest"];
                };
            };
            responses: {
                /** @description Note created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Note"];
                    };
                };
                /** @description Idempotency-Key present without authentication */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not authenticated */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Missing notes:write permission */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency key reused with a different request body */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Validation failed */
                422: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Idempotency key request already in flight */
                425: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
                /** @description Not implemented */
                501: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Problem"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SignupResponse: {
            user_id: string;
        };
        Problem: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            detail?: string;
            instance?: string;
            request_id?: string;
            errors?: {
                path: string;
                message: string;
                code?: string;
                key?: string;
                source?: string;
            }[];
            existing_id?: string;
            missing_fields?: {
                key: string;
                label: string;
            }[];
            placeholders?: string[];
            step_no?: number;
            label?: string;
            current_status?: string;
            rule?: string;
            permissions?: string[];
            holders?: number;
            pairs?: string[][];
            reason?: string;
            children?: {
                id: string;
                type: string;
                number: string | null;
                status: string;
                total: number;
                doc_date: string;
            }[];
            roles?: {
                id: string;
                name: string;
                label: string;
            }[];
        };
        SignupRequest: {
            /** Format: email */
            email: string;
            password: string;
        };
        VerifyRequest: {
            token: string;
        };
        ActivateRequest: {
            token: string;
            password: string;
        };
        LoginRequest: {
            /** Format: email */
            email: string;
            password: string;
        };
        MeResponse: {
            id: string;
            /** Format: email */
            email: string;
            display_name: string | null;
            roles: string[];
            permissions: string[];
            jit: {
                expires_at: number;
            } | null;
        };
        MeExportResponse: {
            export_id: string;
            generated_at: number;
            archive: {
                /** @enum {number} */
                schema_version: 1;
                generated_at: number;
                user_id: string;
                tables: {
                    [key: string]: unknown[];
                };
                signature: string;
            };
        };
        MeDeleteResponse: {
            scheduled_completion_at: number;
        };
        MeDeleteRequest: {
            password: string;
        };
        AdminUserItem: {
            id: string;
            /** Format: email */
            email: string;
            display_name: string | null;
            /** @enum {string} */
            status: "pending" | "active" | "disabled";
            roles: string[];
        };
        InviteUserResponse: {
            user: components["schemas"]["AdminUser"];
            activation_url: string;
            expires_at: number;
        };
        AdminUser: {
            id: string;
            /** Format: email */
            email: string;
            display_name: string | null;
            /** @enum {string} */
            status: "pending" | "active" | "disabled";
            roles: string[];
        };
        InviteUserRequest: {
            /** Format: email */
            email: string;
            display_name: string;
            role: string;
        };
        UpdateUserRequest: {
            role?: string;
            /** @enum {string} */
            status?: "active" | "disabled";
            display_name?: string;
        };
        ReinviteResponse: {
            activation_url: string;
            expires_at: number;
        };
        RolesResponse: {
            items: components["schemas"]["Role"][];
            catalog: string[];
        };
        Role: {
            /** @example 01ROLE000000000000QUANLY00 */
            id: string;
            name: string;
            label: string;
            description: string | null;
            is_system: boolean;
            version: number;
            holders: number;
            permissions: string[];
            can: {
                edit: boolean;
                delete: boolean;
                request: boolean;
            };
            /** @enum {string|null} */
            locked_reason: "system" | "own_role" | "admin" | null;
            /** @enum {string|null} */
            request_locked_reason: "request_pending" | "no_approver" | null;
            pending_request: components["schemas"]["PendingRequestSummary"];
        };
        PendingRequestSummary: {
            id: string;
            added: string[];
            removed: string[];
            requested_by_name: string | null;
            expires_at: number;
        } | null;
        CreateRoleRequest: {
            label: string;
            description?: string;
            permissions: ("audit:read" | "contract:approve" | "contract:issue" | "contract:read" | "contract:submit" | "contract:write" | "delivery_note:write" | "flags:read" | "flags:write" | "jit:grant" | "notes:read" | "notes:write" | "payment_request:write" | "price:write" | "product:write" | "quote:write" | "reviews:write" | "roles:write" | "settings:read" | "settings:write" | "template:write" | "users:read" | "users:write")[];
        };
        PatchRoleRequest: {
            expected_version: number;
            label?: string;
            description?: string;
        };
        ChangeRequest: {
            id: string;
            /** @example 01ROLE000000000000QUANLY00 */
            role_id: string;
            role_name: string;
            role_label: string;
            base_version: number;
            added: string[];
            removed: string[];
            note: string | null;
            /** @enum {string} */
            status: "pending" | "approved" | "rejected" | "withdrawn" | "expired" | "cancelled";
            requested_by: string;
            requested_by_name: string | null;
            requested_at: number;
            expires_at: number;
            decided_by: string | null;
            decided_by_name: string | null;
            decided_at: number | null;
            decision_note: string | null;
            can: {
                approve: boolean;
                reject: boolean;
                withdraw: boolean;
            };
            /** @enum {string|null} */
            locked_reason: "self_approve" | "jit_actor" | "owner_only" | "own_role" | null;
        };
        CreateChangeRequest: {
            expected_version: number;
            permissions: ("audit:read" | "contract:approve" | "contract:issue" | "contract:read" | "contract:submit" | "contract:write" | "delivery_note:write" | "flags:read" | "flags:write" | "jit:grant" | "notes:read" | "notes:write" | "payment_request:write" | "price:write" | "product:write" | "quote:write" | "reviews:write" | "roles:write" | "settings:read" | "settings:write" | "template:write" | "users:read" | "users:write")[];
            note?: string;
        };
        ChangeRequestList: {
            items: components["schemas"]["ChangeRequest"][];
        };
        ApproveChangeRequestResponse: {
            request: components["schemas"]["ChangeRequest"];
            role: components["schemas"]["Role"];
        };
        ApproveChangeRequest: {
            note?: string;
        };
        RejectChangeRequest: {
            note: string;
        };
        SodPairList: {
            items: components["schemas"]["SodPair"][];
        };
        SodPair: {
            id: string;
            perm_a: string;
            perm_b: string;
            reason: string | null;
            created_by_name: string | null;
            created_at: number;
        };
        CreateSodPair: {
            /** @enum {string} */
            perm_a: "audit:read" | "contract:approve" | "contract:issue" | "contract:read" | "contract:submit" | "contract:write" | "delivery_note:write" | "flags:read" | "flags:write" | "jit:grant" | "notes:read" | "notes:write" | "payment_request:write" | "price:write" | "product:write" | "quote:write" | "reviews:write" | "roles:write" | "settings:read" | "settings:write" | "template:write" | "users:read" | "users:write";
            /** @enum {string} */
            perm_b: "audit:read" | "contract:approve" | "contract:issue" | "contract:read" | "contract:submit" | "contract:write" | "delivery_note:write" | "flags:read" | "flags:write" | "jit:grant" | "notes:read" | "notes:write" | "payment_request:write" | "price:write" | "product:write" | "quote:write" | "reviews:write" | "roles:write" | "settings:read" | "settings:write" | "template:write" | "users:read" | "users:write";
            reason?: string;
        };
        JitGrantList: {
            items: components["schemas"]["JitGrant"][];
        };
        JitGrant: {
            id: string;
            user_id: string;
            user_name: string | null;
            reason: string;
            granted_by: string;
            granted_by_name: string | null;
            created_at: number;
            expires_at: number;
            revoked_at: number | null;
            /** @enum {string} */
            state: "active" | "revoked" | "expired";
        };
        CreateJitGrant: {
            user_id: string;
            reason: string;
            minutes: number;
        };
        CurrentAccessReview: {
            review: components["schemas"]["AccessReview"];
            items: components["schemas"]["AccessReviewItem"][];
            progress: {
                decided: number;
                total: number;
            };
            overdue: boolean;
        };
        AccessReview: {
            id: string;
            period: string;
            /** @enum {string} */
            status: "open" | "closed";
            opened_by: string;
            opened_at: number;
            due_at: number;
            closed_at: number | null;
        } | null;
        AccessReviewItem: {
            user: {
                id: string;
                display_name: string | null;
            };
            role: {
                name: string;
                label: string;
            };
            /** @enum {string|null} */
            decision: "keep" | "remove" | null;
            decided_by_name: string | null;
            decided_at: number | null;
            /** @enum {string} */
            state: "open" | "decided" | "changed";
            can: {
                keep: boolean;
                remove: boolean;
            };
            /** @enum {string|null} */
            locked_reason: "self_review" | "admin_only" | "not_reviewer" | null;
        };
        DecideReviewItem: {
            /** @enum {string} */
            decision: "keep" | "remove";
        };
        AuditList: {
            items: components["schemas"]["AuditEvent"][];
            next_cursor: string | null;
        };
        AuditEvent: {
            id: string;
            ts: number;
            actor: string | null;
            actor_name: string | null;
            action: string;
            target: string | null;
            metadata: {
                [key: string]: unknown;
            } | null;
            ip: string | null;
        };
        CustomerList: {
            items: components["schemas"]["Customer"][];
            next_cursor: string | null;
        };
        Customer: {
            id: string;
            name: string;
            contact_person: string | null;
            tax_code: string | null;
            phone: string | null;
            email: string | null;
            address: string | null;
            created_by: string | null;
            created_at: number;
            updated_at: number;
            version: number;
            issued_count: number;
            issued_total: number;
        };
        CreateCustomerRequest: {
            name: string;
            contact_person?: string;
            tax_code?: string;
            phone?: string;
            /** Format: email */
            email?: string;
            address?: string;
        };
        UpdateCustomerRequest: {
            name?: string;
            contact_person?: string;
            tax_code?: string;
            phone?: string;
            /** Format: email */
            email?: string;
            address?: string;
            expected_version: number;
        };
        ProductList: {
            date: string;
            items: components["schemas"]["Product"][];
        };
        Product: {
            /** @example 01PROD000000000000000000G6 */
            id: string;
            /** @enum {string} */
            kind: "service" | "goods";
            code: string;
            name: string;
            unit: string;
            duration_value: number | null;
            /** @enum {string|null} */
            duration_unit: "day" | "month" | null;
            active: boolean;
            version: number;
            price: components["schemas"]["Level"];
            next_price: components["schemas"]["Level"];
            can: {
                edit: boolean;
                price: boolean;
            };
        };
        Level: {
            /** @example 01PROD000000000000000000G6 */
            id: string;
            effective_from: string;
            effective_to: string | null;
            unit_price_ex_vat: number;
            vat_rate_bps: 0 | 500 | 800 | 1000 | null;
            unit_price_inc_vat: number;
        } | null;
        ProductDetail: components["schemas"]["Product"] & {
            prices: components["schemas"]["PriceHistoryItem"][];
        };
        PriceHistoryItem: components["schemas"]["Level"] & {
            /** @enum {string} */
            status: "past" | "current" | "scheduled";
            created_by_name: string | null;
        };
        CreateProductBody: {
            /** @enum {string} */
            kind: "service" | "goods";
            code: string;
            name: string;
            unit: string;
            duration_value?: number;
            /** @enum {string} */
            duration_unit?: "day" | "month";
            first_price?: components["schemas"]["AddPriceBody"];
        };
        AddPriceBody: {
            unit_price_ex_vat: number;
            vat_rate_bps: 0 | 500 | 800 | 1000 | null;
            /** @example 2026-07-01 */
            effective_from: string;
        };
        PatchProductBody: {
            expected_version: number;
            name?: string;
            unit?: string;
            duration_value?: number;
            /** @enum {string} */
            duration_unit?: "day" | "month";
            active?: boolean;
        };
        PricingPreview: {
            doc_date: string;
            lines: components["schemas"]["SnapshotLine"][];
            vat_groups: components["schemas"]["VatGroup"][];
            subtotal_ex_vat: number;
            discount_amount: number;
            total_ex_vat: number;
            vat_total: number;
            total: number;
            total_words: string;
        };
        SnapshotLine: {
            /** @example 01PROD000000000000000000G6 */
            product_id: string;
            code: string;
            name: string;
            /** @enum {string} */
            kind: "service" | "goods";
            unit: string;
            duration_value: number | null;
            /** @enum {string|null} */
            duration_unit: "day" | "month" | null;
            qty: number;
            unit_price_ex_vat: number;
            vat_rate_bps: 0 | 500 | 800 | 1000 | null;
            price_from: string;
            amount_ex_vat: number;
            discount_amount: number;
            net_ex_vat: number;
        };
        VatGroup: {
            vat_rate_bps: 0 | 500 | 800 | 1000 | null;
            base: number;
            vat: number;
        };
        PricingPreviewBody: {
            lines: components["schemas"]["LineInput"][];
            discount_bps: number;
        };
        LineInput: {
            /** @example 01PROD000000000000000000G6 */
            product_id: string;
            qty: number;
        };
        TemplateList: {
            items: components["schemas"]["TemplateListItem"][];
            next_cursor: string | null;
        };
        TemplateListItem: {
            id: string;
            type: string;
            name: string;
            active: boolean;
            current_version: {
                id: string;
                version_no: number;
                created_at: number;
                created_by_name: string | null;
            };
            required_fields: string[];
            steps_summary: string[];
        };
        /** @enum {string} */
        DocType: "quote" | "contract" | "payment_request" | "delivery_note";
        TemplateDetail: {
            id: string;
            type: string;
            name: string;
            subject_type: string;
            active: boolean;
            version: components["schemas"]["TemplateVersion"];
            versions: components["schemas"]["TemplateVersionRef"][];
        };
        TemplateVersion: {
            id: string;
            version_no: number;
            body: string;
            fields: components["schemas"]["TemplateField"][];
            field_rules: components["schemas"]["TemplateFieldRule"][];
            default_line_items: {
                [key: string]: unknown;
            }[];
            default_clauses: {
                [key: string]: unknown;
            }[];
            approval_policy: components["schemas"]["TemplateApprovalPolicy"];
            note: string | null;
            created_at: number;
            created_by_name: string | null;
        };
        TemplateField: {
            key: string;
            label: string;
            /** @enum {string} */
            type: "text" | "paragraph" | "money" | "number" | "percent" | "date" | "choice" | "lines" | "goods";
            required: boolean;
            source: string;
            options?: string[];
            default?: string | number;
        };
        TemplateFieldRule: {
            all_or_none: string[];
        };
        TemplateApprovalPolicy: {
            /** @enum {string} */
            mode: "none" | "steps" | "threshold" | "combined";
            steps?: {
                step_no?: number;
                label: string;
                permission: string;
                role?: string;
            }[];
            rules?: {
                when: {
                    var: string;
                    /** @enum {string} */
                    op: "gt" | "gte" | "lt" | "lte" | "eq";
                    value: number;
                };
                add_steps: {
                    step_no?: number;
                    label: string;
                    permission: string;
                    role?: string;
                }[];
            }[];
        };
        TemplateVersionRef: {
            id: string;
            version_no: number;
            created_at: number;
            created_by_name: string | null;
            note: string | null;
        };
        CreateTemplateRequest: {
            type: components["schemas"]["DocType"];
            name: string;
            /** @enum {string} */
            subject_type: "customer";
            version: components["schemas"]["TemplateVersionInput"];
        };
        TemplateVersionInput: {
            body: string;
            fields: components["schemas"]["TemplateField"][];
            /** @default [] */
            field_rules: components["schemas"]["TemplateFieldRule"][];
            default_line_items: {
                [key: string]: unknown;
            }[];
            default_clauses: {
                [key: string]: unknown;
            }[];
            approval_policy: components["schemas"]["TemplateApprovalPolicy"];
            note?: string;
        };
        CreateTemplateVersionRequest: {
            expected_version_no: number;
            body: string;
            fields: components["schemas"]["TemplateField"][];
            /** @default [] */
            field_rules: components["schemas"]["TemplateFieldRule"][];
            default_line_items: {
                [key: string]: unknown;
            }[];
            default_clauses: {
                [key: string]: unknown;
            }[];
            approval_policy: components["schemas"]["TemplateApprovalPolicy"];
            note?: string;
        };
        TemplateImportPreview: {
            body: string;
            placeholders: components["schemas"]["TemplateImportPlaceholder"][];
            tables: components["schemas"]["TemplateImportTable"][];
            removed: components["schemas"]["TemplateImportRemoved"][];
            warnings: components["schemas"]["TemplateImportWarning"][];
            sources: string[];
            base: components["schemas"]["TemplateImportBase"];
            check_errors: components["schemas"]["TemplateImportCheckError"][];
            stats: {
                body_bytes: number;
                fields: number;
            };
        };
        TemplateImportPlaceholder: {
            key: string;
            original: string;
            count: number;
            table_index: number | null;
            suggested: components["schemas"]["TemplateField"];
            /** @enum {string} */
            suggestion_from: "current_version" | "other_template" | "none";
        };
        TemplateImportTable: {
            index: number;
            rows: number;
            cols: number;
            placeholder_keys: string[];
        };
        TemplateImportRemoved: {
            /** @enum {string} */
            kind: "internal_note";
            text: string;
        };
        TemplateImportWarning: {
            code: string;
            message: string;
            count: number;
        };
        TemplateImportBase: {
            template_id: string | null;
            version_no: number | null;
            approval_policy: components["schemas"]["TemplateApprovalPolicy"];
            field_rules: components["schemas"]["TemplateFieldRule"][];
            default_line_items: {
                [key: string]: unknown;
            }[];
            default_clauses: {
                [key: string]: unknown;
            }[];
        };
        TemplateImportCheckError: {
            path: string;
            code: string;
            key?: string;
            source?: string;
            message: string;
        };
        Contract: {
            id: string;
            type: components["schemas"]["DocType"];
            /** @enum {string} */
            status: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
            number: string | null;
            seq: number | null;
            series_year: number | null;
            template_id: string;
            template_version_id: string;
            customer_id: string;
            customer_name: string;
            total: number;
            created_by: string;
            doc_date: string;
            version: number;
            snapshot: {
                [key: string]: unknown;
            };
            snapshot_hash: string;
            source_contract_id: string | null;
            replaced_by_id: string | null;
            valid_until: string | null;
            parent: components["schemas"]["ContractRef"];
            children: components["schemas"]["ContractRef"][];
            submitted_at: number | null;
            decided_at: number | null;
            issued_by: string | null;
            issued_at: number | null;
            rendered_hash: string | null;
            voided_by: string | null;
            voided_at: number | null;
            void_reason: string | null;
            /**
             * @description SPEC-05: none = not issued · pending = made on the first GET /contracts/{id}/pdf · ready = stored
             * @enum {string}
             */
            pdf_status: "none" | "pending" | "ready";
            pdf_size: number | null;
            created_at: number;
            updated_at: number;
            steps: components["schemas"]["ContractStep"][];
            timeline: components["schemas"]["ContractTimelineItem"][];
            can: components["schemas"]["ContractCan"];
        };
        ContractRef: {
            id: string;
            type: components["schemas"]["DocType"];
            number: string | null;
            /** @enum {string} */
            status: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
            total: number;
            doc_date: string;
        } | null;
        ContractStep: {
            id: string;
            step_no: number;
            label: string;
            /** @enum {string} */
            status: "waiting" | "approved" | "rejected";
            required_permission: string;
            required_role: string | null;
            decided_by: string | null;
            decided_by_name: string | null;
            decided_at: number | null;
            note: string | null;
            snapshot_hash_at_decision: string | null;
        };
        ContractTimelineItem: {
            action: string;
            at: number;
            actor?: string | null;
        };
        ContractCan: {
            edit: boolean;
            submit: boolean;
            approve: boolean;
            reject: boolean;
            issue: boolean;
            void: boolean;
            copy: boolean;
            withdraw: boolean;
            delete: boolean;
            create_child: {
                type: components["schemas"]["DocType"];
                allowed: boolean;
                /** @enum {string|null} */
                reason_code: "parent-not-issued" | "quote-expired" | "child-exists" | "forbidden" | null;
            }[];
        };
        CreateContractRequest: {
            template_id: string;
            customer_id: string;
            lines: components["schemas"]["LineInput"][];
            values: components["schemas"]["ContractValues"];
        };
        ContractValues: {
            giam_gia?: number;
            chuc_vu_nguoi_ky?: string;
            ngay_bat_dau?: string;
            so_bao_gia?: string;
            ngay_bao_gia?: string;
            ly_do_xuat_kho?: string;
            xuat_tai_kho?: string;
            dia_diem?: string;
        } & {
            [key: string]: string | number;
        };
        ContractList: {
            items: components["schemas"]["ContractListItem"][];
            next_cursor: string | null;
            counts: components["schemas"]["ContractCounts"];
        };
        ContractListItem: {
            id: string;
            type: components["schemas"]["DocType"];
            parent_id: string | null;
            valid_until: string | null;
            number: string | null;
            /** @enum {string} */
            status: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
            customer_name: string;
            template_name: string;
            total: number;
            created_by: string;
            created_by_name: string | null;
            updated_at: number;
        };
        ContractCounts: {
            draft: number;
            pending: number;
            approved: number;
            issued: number;
            rejected: number;
            voided: number;
        };
        UpdateContractRequest: {
            expected_version: number;
            customer_id?: string;
            lines?: components["schemas"]["LineInput"][];
            values?: components["schemas"]["ContractValues"];
            use_latest_template?: boolean;
        };
        EmptyRequest: Record<string, never>;
        ApproveRequest: {
            note?: string;
        };
        RejectRequest: {
            note: string;
        };
        VoidRequest: {
            reason: string;
        };
        CreateChildRequest: {
            type: components["schemas"]["DocType"];
            template_id?: string;
            values?: components["schemas"]["ContractValues"];
        };
        ApprovalQueue: {
            items: components["schemas"]["ApprovalQueueItem"][];
            next_cursor: string | null;
        };
        ApprovalQueueItem: {
            contract_id: string;
            type: components["schemas"]["DocType"];
            step_no: number;
            label: string;
            customer_name: string;
            total: number;
            created_by: string;
            created_by_name: string | null;
            submitted_at: number | null;
        };
        SettingSnapshot: {
            key: string;
            value?: unknown;
            description: string;
            updated_at: number | null;
            updated_by: string | null;
        };
        SettingsUpdateRequest: {
            value?: unknown;
        };
        FlagSnapshot: {
            key: string;
            /** @enum {string} */
            kind: "boolean" | "percentage";
            enabled: boolean;
            percentage: number | null;
            allowlist: string[] | null;
            description: string;
            updated_at: number | null;
            updated_by: string | null;
        };
        FlagUpdateRequest: {
            enabled?: boolean;
            percentage?: number | null;
            allowlist?: string[] | null;
        };
        Note: {
            id: string;
            title: string;
            body: string;
            createdAt: number;
        };
        CreateNoteRequest: {
            title: string;
            body: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
