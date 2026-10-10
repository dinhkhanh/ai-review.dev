/** Launch focus categories (decision D-2 in docs/srs.md). Seeded into `categories`. */
export const LAUNCH_CATEGORIES = [
  { slug: "ai-tools", name: "AI Tools", description: "AI writing, image, video, voice, agents and assistants." },
  { slug: "marketing", name: "Marketing", description: "SEO, email, social, ads, CRM and analytics tools." },
  {
    slug: "developer-tools",
    name: "Developer Tools",
    description: "Code, CI/CD, APIs, databases, monitoring and testing.",
  },
  {
    slug: "hosting",
    name: "Hosting & Servers",
    description: "Web hosting, VPS, cloud, edge platforms and managed databases.",
  },
  {
    slug: "productivity",
    name: "Productivity",
    description: "Notes, docs, project management, automation and collaboration.",
  },
  {
    slug: "new-releases",
    name: "New Releases",
    description: "Recently launched tools worth a look, prioritised by commission.",
  },
] as const;

export type LaunchCategorySlug = (typeof LAUNCH_CATEGORIES)[number]["slug"];

/** Default review rubric (FR-CON-3). Weights sum to 1. Per-category overrides live in settings. */
export const DEFAULT_RUBRIC = [
  { key: "features", label: "Features", weight: 0.25 },
  { key: "ease_of_use", label: "Ease of use", weight: 0.2 },
  { key: "value", label: "Value for money", weight: 0.2 },
  { key: "support", label: "Support & docs", weight: 0.1 },
  { key: "integrations", label: "Integrations", weight: 0.15 },
  { key: "security", label: "Security & reliability", weight: 0.1 },
] as const;

/** Overall score is computed from weighted dimensions, never free-typed (FR-CON-3). */
export function computeOverallScore(dimensions: ReadonlyArray<{ weight: number; score: number }>): number {
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  if (totalWeight <= 0) throw new Error("Rubric weights must sum to a positive number");
  const weighted = dimensions.reduce((sum, d) => sum + d.weight * d.score, 0) / totalWeight;
  return Math.round(weighted * 10) / 10;
}
