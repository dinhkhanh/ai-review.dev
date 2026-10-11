/** Shared constants between the seed and the specs. Everything here is fake, local-only data. */
export const E2E = {
  admin: {
    email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.com",
    password: process.env.E2E_ADMIN_PASSWORD ?? "e2e-password-0123456789",
    /** Fixed TOTP secret (32 chars, like better-auth generates). */
    totpSecret: process.env.E2E_TOTP_SECRET ?? "E2eFixedTotpSecretForCiOnly00000",
  },
  category: "developer-tools",
  /** Published review with an active affiliate program (go-link → affiliate URL with SubID). */
  acme: {
    name: "Acme Tracker",
    website: "https://acme-tracker-e2e.com",
    slug: "acme-tracker",
    reviewSlug: "acme-tracker-review",
    deReviewTitle: "Acme Tracker Test 2026: Preise, Funktionen, Vor- und Nachteile",
    affiliateUrl: "https://acme-tracker-e2e.com/pricing",
    referralParam: "fpr",
    referralValue: "aireview",
    subIdParam: "fp_sid",
    dealCode: "E2E20",
  },
  /** Review waiting in the CMS queue; no affiliate program (go-link → vendor URL with UTM). */
  beacon: {
    name: "Beacon Notes",
    website: "https://beacon-notes-e2e.com",
    slug: "beacon-notes",
    reviewSlug: "beacon-notes-review",
  },
  comparisonSlug: "acme-tracker-vs-beacon-notes",
} as const;

export const urls = {
  site: process.env.E2E_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  cms: process.env.E2E_CMS_URL ?? process.env.NEXT_PUBLIC_CMS_URL ?? "http://localhost:3001",
  api: process.env.E2E_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3002",
};
