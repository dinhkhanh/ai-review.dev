# @repo/auth

Better Auth configuration for the CMS (FR-CMS-1).

- `createAuth()` — server instance (email + password, TOTP 2FA, admin/editor roles, audit hook).
- `createCmsAuthClient()` — browser client (`@repo/auth/client`).
- `pnpm db:seed` (root) runs `create-admin`, which creates the first admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

The auth tables live in `packages/db/src/schema/auth.ts`. Their field names must match Better Auth's
expected schema for the plugins in use. After upgrading `better-auth` or adding a plugin, compare
against `getAuthTables()` from `better-auth/db` and add a migration for any new field.
