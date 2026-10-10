import { createDb, eq, users } from "@repo/db";
import { createAuth } from "../index";

/**
 * Creates the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD. Idempotent: does nothing
 * if the user exists. The admin must enrol TOTP on first sign-in (enforced by the CMS).
 */
const url = process.env.DATABASE_URL;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
if (!url) throw new Error("DATABASE_URL is not set");
if (!email || !password) {
  console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; skipping admin creation");
  process.exit(0);
}
if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set (openssl rand -base64 32)");

const { db, close } = createDb(url, { max: 1 });
try {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    console.log(`Admin ${email} already exists`);
  } else {
    const auth = createAuth({ db });
    await auth.api.createUser({ body: { email, password, name: "Admin", role: "admin" } });
    console.log(
      `Created admin ${email}. Sign in at ${process.env.NEXT_PUBLIC_CMS_URL ?? "http://localhost:3001"} and enrol 2FA.`,
    );
  }
} finally {
  await close();
}
