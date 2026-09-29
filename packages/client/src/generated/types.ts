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
                /** @description Missing users:write permission */
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
                /** @description last_admin: cannot disable or demote the last active admin */
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
        /** Role x permission matrix */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Roles with their permissions */
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
        post?: never;
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
    "/price-list": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Packages in force on a date (default: today, Vietnam time) */
        get: {
            parameters: {
                query?: {
                    date?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Price list for the date */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PriceList"];
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
                /** @description Bad date */
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
    "/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List contract templates with their current version (cursor-paginated) */
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
    "/contracts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List contracts (team-wide) with status counts */
        get: {
            parameters: {
                query?: {
                    status?: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
                    customer_id?: string;
                    created_by?: string;
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
                /** @description Missing contract:write permission */
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
                /** @description validation | missing-fields (missing_fields[]) | unresolved-placeholder (placeholders[]) */
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
    "/contracts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Contract detail: snapshot, steps, timeline, can{} */
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
                /** @description Missing contract:write, or not the creator (permission.denied) */
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
                /** @description validation | missing-fields | unresolved-placeholder */
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
                /** @description Missing contract:write permission */
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
                /** @description missing-fields | validation (today's data) */
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
            /** @enum {string} */
            role: "giam_doc" | "quan_ly" | "nhan_vien";
        };
        UpdateUserRequest: {
            /** @enum {string} */
            role?: "giam_doc" | "quan_ly" | "nhan_vien" | "admin";
            /** @enum {string} */
            status?: "active" | "disabled";
            display_name?: string;
        };
        ReinviteResponse: {
            activation_url: string;
            expires_at: number;
        };
        RolesResponse: {
            items: components["schemas"]["RoleItem"][];
        };
        RoleItem: {
            name: string;
            description: string | null;
            permissions: string[];
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
        PriceList: {
            date: string;
            items: components["schemas"]["PriceItem"][];
        };
        PriceItem: {
            code: string;
            name: string;
            duration_value: number;
            /** @enum {string} */
            duration_unit: "day" | "month";
            unit_price: number;
            effective_from: string;
            effective_to: string | null;
            note: string | null;
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
            type: "text" | "paragraph" | "money" | "number" | "percent" | "date" | "choice";
            required: boolean;
            source: string;
            options?: string[];
            options_from?: string;
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
            /** @enum {string} */
            type: "contract";
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
        Contract: {
            id: string;
            type: string;
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
            submitted_at: number | null;
            decided_at: number | null;
            issued_by: string | null;
            issued_at: number | null;
            rendered_hash: string | null;
            voided_by: string | null;
            voided_at: number | null;
            void_reason: string | null;
            created_at: number;
            updated_at: number;
            steps: components["schemas"]["ContractStep"][];
            timeline: components["schemas"]["ContractTimelineItem"][];
            can: components["schemas"]["ContractCan"];
        };
        ContractStep: {
            id: string;
            step_no: number;
            label: string;
            /** @enum {string} */
            status: "waiting" | "approved" | "rejected";
            required_permission: string;
            required_role: string | null;
            decided_by: string | null;
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
        };
        CreateContractRequest: {
            template_id: string;
            customer_id: string;
            values: components["schemas"]["ContractValues"];
        };
        ContractValues: {
            ma_goi: string;
            so_cua_hang: number;
            giam_gia?: number;
            chuc_vu_nguoi_ky?: string;
            ngay_bat_dau?: string;
            so_bao_gia?: string;
            ngay_bao_gia?: string;
        };
        ContractList: {
            items: components["schemas"]["ContractListItem"][];
            next_cursor: string | null;
            counts: components["schemas"]["ContractCounts"];
        };
        ContractListItem: {
            id: string;
            number: string | null;
            /** @enum {string} */
            status: "draft" | "pending" | "approved" | "rejected" | "issued" | "voided";
            customer_name: string;
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
        ApprovalQueue: {
            items: components["schemas"]["ApprovalQueueItem"][];
            next_cursor: string | null;
        };
        ApprovalQueueItem: {
            contract_id: string;
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
