export const SITE = {
  name: "AI Review",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  description:
    "Evidence-backed reviews of AI tools, marketing software, developer tools, hosting and productivity apps.",
  /** Public contact address shown on the contact and policy pages. */
  contactEmail: "editor@ai-review.dev",
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}
