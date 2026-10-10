import { recordAudit } from "@repo/core";
import { accounts, getDb, sessions, twoFactors, users, verifications, type Database } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { twoFactor } from "better-auth/plugins/two-factor";

export const ROLES = ["admin", "editor"] as const;
export type Role = (typeof ROLES)[number];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Admin routes that set a password directly and bypass emailAndPassword length checks. */
const ADMIN_PASSWORD_ROUTES: Record<string, string> = {
  "/admin/create-user": "password",
  "/admin/set-user-password": "newPassword",
};

export interface CreateAuthOptions {
  db?: Database;
  secret?: string;
  baseURL?: string;
}

/**
 * CMS authentication (FR-CMS-1): email + password, mandatory TOTP 2FA (enforced by the CMS
 * layout), admin/editor roles, short sessions, sign-in audit trail. Public sign-up is disabled:
 * accounts are created by an admin or by `pnpm db:seed` (first admin).
 */
export function createAuth(options: CreateAuthOptions = {}) {
  const db = options.db ?? getDb();
  return betterAuth({
    appName: "AI Review CMS",
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    trustedOrigins: [process.env.NEXT_PUBLIC_CMS_URL ?? "http://localhost:3001"],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications, twoFactor: twoFactors },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    session: {
      expiresIn: 60 * 60 * 12, // 12h session timeout
      updateAge: 60 * 60, // refresh at most hourly while active
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
    hooks: {
      // The admin plugin does not apply the password policy; enforce it for those routes too.
      before: createAuthMiddleware(async (ctx) => {
        const field = ADMIN_PASSWORD_ROUTES[ctx.path];
        if (!field) return;
        const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
        if (
          typeof password !== "string" ||
          password.length < PASSWORD_MIN_LENGTH ||
          password.length > PASSWORD_MAX_LENGTH
        ) {
          throw new APIError("BAD_REQUEST", {
            message: `Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`,
          });
        }
      }),
    },
    plugins: [
      twoFactor({ issuer: "AI Review" }),
      admin({ defaultRole: "editor", adminRoles: ["admin"] }),
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await recordAudit(db, {
              actorUserId: session.userId,
              action: "auth.session_created",
              entityType: "user",
              entityId: session.userId,
              ip: session.ipAddress ?? null,
              data: { userAgent: session.userAgent ?? null },
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
