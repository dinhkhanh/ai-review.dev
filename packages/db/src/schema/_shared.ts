import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
});

/** Default content locale (NFR-14: every content table carries a locale). */
export const DEFAULT_LOCALE = "en";

/** Content locales the site ships (NFR-14). English is canonical; German is the phase 3 second locale. */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

/** Per-locale overrides for shared catalogue rows, e.g. { de: { name: "...", tagline: "..." } }. */
export type LocalizedFields = Partial<Record<Locale, Record<string, string>>>;
