import { createAuth, type Role } from "@repo/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const auth = createAuth();

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"];

/**
 * Server-side guard for every CMS page (FR-CMS-1):
 * signed in -> 2FA enrolled -> role allowed. The proxy only does an optimistic cookie check.
 */
export async function requireUser(opts: { roles?: Role[] } = {}): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.twoFactorEnabled) redirect("/setup-2fa");
  const role = (session.user.role ?? "editor") as Role;
  if (session.user.banned) redirect("/login?error=banned");
  if (opts.roles && !opts.roles.includes(role)) redirect("/?error=forbidden");
  return session.user;
}
