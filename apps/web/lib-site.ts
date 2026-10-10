export const SITE = {
  name: "AI Review",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  description:
    "Evidence-backed reviews of AI tools, marketing software, developer tools, hosting and productivity apps.",
} as const;
