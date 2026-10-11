/**
 * Deterministic fixture catalogue for the browser e2e suite (Phase 4). Wipes the target database,
 * then builds a small, fully linked catalogue through the same `@repo/core` services the pipeline
 * and CMS use. Only runs against a database named `*_e2e` (or with E2E_ALLOW_SEED=1).
 *
 *   DATABASE_URL=postgres://…/aireview_e2e BETTER_AUTH_SECRET=… pnpm --filter e2e seed
 */
import {
  addArticleVersion,
  createArticle,
  createDeal,
  createLink,
  createProduct,
  createProgram,
  ensureGoSlug,
  publishArticle,
  saveFactSheet,
  saveTranslation,
  setCompetitors,
  setSetting,
  setVersionQa,
  transitionArticle,
  upsertSource,
} from "@repo/core";
import {
  authors,
  categories,
  createDb,
  eq,
  mediaAssets,
  mediaBlobs,
  sql,
  twoFactors,
  users,
  type Database,
} from "@repo/db";
import { seed } from "@repo/db/seed";
import { crc32, deflateSync } from "node:zlib";
// The admin is created through @repo/auth exactly as `pnpm db:seed` would.
import { createAuth } from "@repo/auth";
import { symmetricEncrypt } from "better-auth/crypto";
import { E2E } from "./fixtures";

type NewVersion = Parameters<typeof addArticleVersion>[2];
type ArticleBody = NewVersion["blocks"];
type Seo = NonNullable<NewVersion["seo"]>;
type QaScorecard = NonNullable<NewVersion["qaScorecard"]>;
type FactSheet = Parameters<typeof saveFactSheet>[2];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith("_e2e") && process.env.E2E_ALLOW_SEED !== "1") {
  throw new Error(`Refusing to wipe "${dbName}": the e2e seed only runs on a *_e2e database (or E2E_ALLOW_SEED=1)`);
}
const authSecret = process.env.BETTER_AUTH_SECRET;
if (!authSecret) throw new Error("BETTER_AUTH_SECRET is not set (must match the CMS server)");

const NOW = new Date();
const iso = NOW.toISOString();

async function truncateAll(db: Database) {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not like '__drizzle%'`,
  );
  const names = rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

const passedQa = (): QaScorecard => ({
  hardGatesPassed: true,
  checks: [
    { key: "fact_check", label: "Fact-check", hard: true, passed: true, value: 1 },
    { key: "unsupported_claims", label: "Unsupported claims", hard: true, passed: true, value: 0 },
    { key: "originality", label: "Originality", hard: true, passed: true, value: 0.02 },
    { key: "disclosure", label: "Disclosure", hard: true, passed: true, value: true },
  ],
  computedAt: iso,
});

async function researchedProduct(
  db: Database,
  p: { name: string; website: string; categoryId: string; tagline: string; plusPrice: number },
) {
  const product = await createProduct(db, {
    name: p.name,
    websiteUrl: p.website,
    categoryId: p.categoryId,
    tagline: p.tagline,
  });
  const go = await ensureGoSlug(db, product);
  const official = await upsertSource(db, {
    productId: product.id,
    url: `${p.website}/pricing`,
    kind: "official",
    title: `${p.name} pricing`,
    httpStatus: 200,
    robotsAllowed: true,
    contentMd: `# Pricing\nFree for up to 3 users. Plus costs $${p.plusPrice} per user per month. 14-day free trial.`,
  });
  const home = await upsertSource(db, {
    productId: product.id,
    url: p.website,
    kind: "official",
    title: p.name,
    httpStatus: 200,
    robotsAllowed: true,
    contentMd: `# ${p.name}\n${p.tagline}. Integrations with GitHub and Slack. SOC 2 Type II.`,
  });
  const g2 = await upsertSource(db, {
    productId: product.id,
    url: `https://www.g2.com/products/${product.slug}/reviews`,
    kind: "aggregator",
    title: `${p.name} reviews on G2`,
    httpStatus: 200,
    robotsAllowed: true,
    contentMd: `${p.name} is rated 4.5 out of 5. Reviewers praise speed and want better reporting.`,
  });
  const reddit = await upsertSource(db, {
    productId: product.id,
    url: `https://www.reddit.com/r/productivity/comments/e2e/${product.slug}`,
    kind: "community",
    title: `Anyone using ${p.name}?`,
    httpStatus: 200,
    robotsAllowed: true,
    contentMd: `Thread: ${p.name} is fast but lacks time tracking.`,
  });
  const c = (sourceId: string, quote?: string) => [{ sourceId, ...(quote ? { quote } : {}) }];
  const sheet: FactSheet = {
    name: p.name,
    tagline: { value: p.tagline, citations: c(home.id), confidence: "high" },
    website: p.website,
    pricing: {
      tiers: {
        value: [
          { name: "Free", price: 0, currency: "USD", period: "month", limits: ["3 users"], highlights: [] },
          { name: "Plus", price: p.plusPrice, currency: "USD", period: "month", limits: [], highlights: ["Per user"] },
        ],
        citations: c(official.id, `Plus costs $${p.plusPrice} per user per month`),
        confidence: "high",
      },
      freePlan: { value: true, citations: c(official.id), confidence: "high" },
      freeTrialDays: { value: 14, citations: c(official.id, "14-day free trial"), confidence: "high" },
      pricingUrl: `${p.website}/pricing`,
    },
    features: [
      { value: "Issue tracking", citations: c(home.id), confidence: "high" },
      { value: "GitHub integration", citations: c(home.id), confidence: "high" },
    ],
    integrations: { value: ["GitHub", "Slack"], citations: c(home.id), confidence: "high" },
    security: { value: ["SOC 2 Type II"], citations: c(home.id), confidence: "medium" },
    ratings: [
      {
        site: "G2",
        url: `https://www.g2.com/products/${product.slug}/reviews`,
        rating: 4.5,
        outOf: 5,
        count: 120,
        observedAt: iso,
      },
    ],
    limitations: [{ value: "No time tracking", citations: c(reddit.id), confidence: "medium" }],
  };
  await saveFactSheet(db, product.id, sheet);
  return { product, go, sources: { official, home, g2, reddit } };
}

type Researched = Awaited<ReturnType<typeof researchedProduct>>;

/** Solid-colour PNG (no sharp needed), standing in for the templated OG card. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * OG image stored with the `db` media driver (served by the web app's /media route), so no R2 is
 * needed. There is no core service for raw asset rows; @repo/media's saveImageAsset needs sharp.
 */
async function ogImage(db: Database, productId: string, name: string, rgb: [number, number, number]) {
  const bytes = solidPng(1200, 630, rgb);
  const key = `e2e/og/${productId}.png`;
  await db.insert(mediaBlobs).values({ key, data: bytes, mimeType: "image/png" });
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      kind: "graphic",
      origin: "templated",
      storage: "db",
      storageKey: key,
      mimeType: "image/png",
      width: 1200,
      height: 630,
      bytes: bytes.length,
      variants: {},
      alt: `${name} review: score card`,
      role: "og",
      productId,
    })
    .returning();
  return asset!.id;
}

function reviewBlocks(r: Researched, plusPrice: number, de = false): ArticleBody {
  const { product, go, sources } = r;
  const cite = (sourceId: string) => ({ type: "citation" as const, citation: { sourceId } });
  const t = de
    ? {
        verdict: `${product.name} ist ein schneller Issue-Tracker für kleine Softwareteams.`,
        bestFor: ["Kleine Entwicklerteams"],
        notFor: ["Teams, die Zeiterfassung brauchen"],
        cta: `${product.name} kostenlos testen`,
        pricing: "Preise",
        intro: "Wir haben Preise, Funktionen und Nutzerstimmen ausgewertet.",
        pros: ["Sehr schnell", "Großzügiger Gratis-Tarif"],
        cons: ["Keine Zeiterfassung"],
        faq: "Gibt es eine kostenlose Version?",
        faqA: "Ja, für bis zu 3 Nutzer.",
        tip: "Der Plus-Tarif lohnt sich ab vier Nutzern.",
        sources: "Quellen",
      }
    : {
        verdict: `${product.name} is a fast issue tracker for small software teams.`,
        bestFor: ["Small engineering teams"],
        notFor: ["Teams that need time tracking"],
        cta: `Try ${product.name} free`,
        pricing: "Pricing",
        intro: "We reviewed pricing, features and user feedback.",
        pros: ["Very fast", "Generous free plan"],
        cons: ["No time tracking"],
        faq: "Is there a free plan?",
        faqA: "Yes, for up to 3 users.",
        tip: "The Plus plan pays off from four users.",
        sources: "Sources",
      };
  return [
    { id: "verdict", type: "verdict", score: 8.2, summary: t.verdict, bestFor: t.bestFor, notFor: t.notFor },
    { id: "cta-verdict", type: "cta", goSlug: go.slug, placement: "verdict", label: t.cta },
    { id: "h-overview", type: "heading", level: 2, text: de ? "Überblick" : "Overview" },
    {
      id: "p-overview",
      type: "paragraph",
      children: [
        { text: `${t.intro} `, marks: [] },
        { text: `${product.name}`, marks: [{ type: "golink", slug: go.slug, placement: "inline" }] },
        { text: de ? " bietet einen Gratis-Tarif." : " offers a free plan.", marks: [cite(sources.official.id)] },
      ],
    },
    {
      id: "rubric",
      type: "rubric",
      dimensions: [
        {
          key: "features",
          label: de ? "Funktionen" : "Features",
          weight: 0.5,
          score: 8,
          justification: de ? "Solide Kernfunktionen." : "Solid core features.",
          citations: [{ sourceId: sources.home.id }],
        },
        {
          key: "value",
          label: de ? "Preis-Leistung" : "Value",
          weight: 0.5,
          score: 8.4,
          justification: de ? "Fairer Preis." : "Fair price.",
          citations: [{ sourceId: sources.official.id }],
        },
      ],
    },
    { id: "h-pricing", type: "heading", level: 2, text: t.pricing },
    {
      id: "pricing",
      type: "pricing_table",
      verifiedAt: iso,
      tiers: [
        { name: "Free", price: 0, currency: "USD", period: "month", highlights: ["3 users"], citations: [] },
        {
          name: "Plus",
          price: plusPrice,
          currency: "USD",
          period: "month",
          highlights: [de ? "Pro Nutzer" : "Per user"],
          citations: [{ sourceId: sources.official.id }],
        },
      ],
    },
    { id: "cta-pricing", type: "cta", goSlug: go.slug, placement: "pricing", label: t.cta },
    { id: "pros-cons", type: "pros_cons", pros: t.pros, cons: t.cons },
    { id: "tip", type: "callout", tone: "tip", children: [{ text: t.tip, marks: [] }] },
    { id: "h-faq", type: "heading", level: 2, text: "FAQ" },
    {
      id: "faq",
      type: "faq",
      items: [{ question: t.faq, answer: [{ text: t.faqA, marks: [cite(sources.official.id)] }] }],
    },
    { id: "h-sources", type: "heading", level: 2, text: t.sources },
    { id: "sources", type: "sources" },
  ];
}

const reviewSeo = (name: string, ogImageAssetId: string, de = false): Seo => ({
  title: de ? `${name} Test 2026: Preise und Funktionen` : `${name} Review 2026: Pricing and Features`,
  metaDescription: de
    ? `${name} im Test: Preise, Funktionen, Vor- und Nachteile.`
    : `${name} review: pricing, features, pros and cons, and who it is for.`,
  primaryKeyword: de ? `${name} Test` : `${name} review`,
  secondaryKeywords: [],
  intent: "review",
  ogImageAssetId,
  internalLinks: [],
});

async function main() {
  const { db, close } = createDb(url!, { max: 2 });
  try {
    await truncateAll(db);
    await seed(db);
    await setSetting(db, "i18n.policy", { enabledLocales: ["en", "de"], autoTranslate: [] });
    await setSetting(db, "publishing.dailyCap", 100);

    const [category] = await db.select().from(categories).where(eq(categories.slug, E2E.category)).limit(1);
    const [author] = await db.select().from(authors).where(eq(authors.slug, "editor-in-chief")).limit(1);
    if (!category || !author) throw new Error("Base seed did not create categories/author");
    await db
      .update(authors)
      .set({ name: "Erin Editor", bio: "Editor-in-chief. Reviews every article before it goes live." })
      .where(eq(authors.id, author.id));

    const acme = await researchedProduct(db, {
      name: E2E.acme.name,
      website: E2E.acme.website,
      categoryId: category.id,
      tagline: "Issue tracking for small software teams",
      plusPrice: 12,
    });
    const beacon = await researchedProduct(db, {
      name: E2E.beacon.name,
      website: E2E.beacon.website,
      categoryId: category.id,
      tagline: "Team notes and docs",
      plusPrice: 8,
    });
    await setCompetitors(db, acme.product.id, [
      { competitorProductId: beacon.product.id, relation: "alternative", note: "Docs-first alternative" },
    ]);

    // Active affiliate program + link for Acme only (Beacon falls back to vendor URL + UTM).
    const program = await createProgram(db, {
      productId: acme.product.id,
      network: "firstpromoter",
      name: `${E2E.acme.name} partner program`,
      status: "active",
      commissionModel: "recurring_percent",
      commissionValue: 30,
      recurringMonths: 12,
      cookieDays: 60,
      redirectPolicy: "allowed",
      linkFormat: {
        kind: "query_param",
        param: E2E.acme.referralParam,
        value: E2E.acme.referralValue,
        subIdParam: E2E.acme.subIdParam,
      },
    });
    await createLink(db, {
      productId: acme.product.id,
      programId: program.id,
      label: "Free trial",
      destinationUrl: E2E.acme.affiliateUrl,
      status: "active",
      priority: 1,
    });
    await createDeal(db, {
      productId: acme.product.id,
      programId: program.id,
      title: `20% off ${E2E.acme.name} Plus`,
      description: "First year on annual billing.",
      code: E2E.acme.dealCode,
      discountText: "20% off",
      active: true,
      source: "manual",
    });

    const acmeOg = await ogImage(db, acme.product.id, E2E.acme.name, [37, 99, 235]);
    const beaconOg = await ogImage(db, beacon.product.id, E2E.beacon.name, [22, 163, 74]);

    // Published English review + published German translation.
    const acmeReview = await createArticle(db, {
      type: "review",
      productId: acme.product.id,
      title: `${E2E.acme.name} Review 2026: Pricing, Features, Pros and Cons`,
      slug: E2E.acme.reviewSlug,
      authorId: author.id,
    });
    const acmeV1 = await addArticleVersion(db, acmeReview.id, {
      blocks: reviewBlocks(acme, 12),
      seo: reviewSeo(E2E.acme.name, acmeOg),
      overallScore: 8.2,
      qaScorecard: passedQa(),
      changeNote: "e2e fixture",
    });
    await transitionArticle(db, acmeReview.id, "in_review");
    await transitionArticle(db, acmeReview.id, "approved");
    await publishArticle(db, acmeReview.id);

    const de = await saveTranslation(db, {
      sourceArticleId: acmeReview.id,
      sourceVersionId: acmeV1.id,
      locale: "de",
      title: E2E.acme.deReviewTitle,
      blocks: reviewBlocks(acme, 12, true),
      seo: reviewSeo(E2E.acme.name, acmeOg, true),
      overallScore: 8.2,
      factCheck: null,
      promptVersions: {},
      changeNote: "e2e fixture (de)",
    });
    await setVersionQa(db, de.versionId, { qaScorecard: passedQa() });
    await transitionArticle(db, de.articleId, "in_review");
    await transitionArticle(db, de.articleId, "approved");
    await publishArticle(db, de.articleId);

    // Review waiting in the CMS queue (approve → publish flow).
    const beaconReview = await createArticle(db, {
      type: "review",
      productId: beacon.product.id,
      title: `${E2E.beacon.name} Review 2026: Pricing, Features, Pros and Cons`,
      slug: E2E.beacon.reviewSlug,
      authorId: author.id,
    });
    await addArticleVersion(db, beaconReview.id, {
      blocks: reviewBlocks(beacon, 8),
      seo: reviewSeo(E2E.beacon.name, beaconOg),
      overallScore: 7.6,
      qaScorecard: passedQa(),
      changeNote: "e2e fixture",
    });
    await transitionArticle(db, beaconReview.id, "in_review");

    // Published comparison (A vs B).
    const comparison = await createArticle(db, {
      type: "comparison",
      productId: null,
      productIds: [acme.product.id, beacon.product.id],
      title: `${E2E.acme.name} vs ${E2E.beacon.name} (2026)`,
      slug: E2E.comparisonSlug,
      authorId: author.id,
      categoryId: category.id,
    });
    await addArticleVersion(db, comparison.id, {
      blocks: [
        {
          id: "verdict",
          type: "verdict",
          score: 8.2,
          summary: `${E2E.acme.name} wins for issue tracking; ${E2E.beacon.name} for docs.`,
          bestFor: [],
          notFor: [],
        },
        {
          id: "table",
          type: "comparison_table",
          productIds: [acme.product.id, beacon.product.id],
          rows: [
            { label: "Free plan", values: ["Yes, 3 users", "Yes, 3 users"] },
            { label: "Plus price", values: ["$12 / user / month", "$8 / user / month"] },
          ],
        },
        { id: "cta-table", type: "cta", goSlug: acme.go.slug, placement: "comparison", label: `Try ${E2E.acme.name}` },
        { id: "sources", type: "sources" },
      ],
      seo: {
        title: `${E2E.acme.name} vs ${E2E.beacon.name} (2026)`,
        metaDescription: `${E2E.acme.name} vs ${E2E.beacon.name}: pricing, features and which to pick.`,
        primaryKeyword: `${E2E.acme.name} vs ${E2E.beacon.name}`,
        secondaryKeywords: [],
        intent: "comparison",
        ogImageAssetId: acmeOg,
        internalLinks: [],
      },
      overallScore: null,
      qaScorecard: passedQa(),
      changeNote: "e2e fixture",
    });
    await transitionArticle(db, comparison.id, "in_review");
    await transitionArticle(db, comparison.id, "approved");
    await publishArticle(db, comparison.id);

    await createAdminWith2fa(db);
    console.log(
      `e2e seed complete on ${dbName}: 2 products, 3 live articles (en review, de review, comparison), 1 in review, admin ${E2E.admin.email}`,
    );
  } finally {
    await close();
  }
}

/** Server-created admin (as `pnpm db:seed` does) with TOTP enrolled and verified on a fixed secret. */
async function createAdminWith2fa(db: Database) {
  const auth = createAuth({ db, secret: authSecret, baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001" });
  await auth.api.createUser({
    body: { email: E2E.admin.email, password: E2E.admin.password, name: "E2E Admin", role: "admin" },
  });
  const [user] = await db.select().from(users).where(eq(users.email, E2E.admin.email)).limit(1);
  if (!user) throw new Error("Admin was not created");
  // Encrypt exactly as better-auth's enableTwoFactor does (secretConfig is the plain secret string
  // when BETTER_AUTH_SECRETS rotation is not configured).
  await db.insert(twoFactors).values({
    id: crypto.randomUUID(),
    userId: user.id,
    secret: await symmetricEncrypt({ key: authSecret!, data: E2E.admin.totpSecret }),
    backupCodes: await symmetricEncrypt({ key: authSecret!, data: JSON.stringify(["e2eb1-ackup", "e2eb2-ackup"]) }),
    verified: true,
  });
  await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, user.id));
}

await main();
