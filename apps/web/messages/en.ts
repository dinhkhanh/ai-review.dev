import type { RenderLabels } from "@repo/ui/article";

/**
 * English UI strings (NFR-14). Every string the public site shows comes from a catalogue; German
 * (`de.ts`) must provide every key, which the `Messages` type enforces at compile time.
 */
const none = null as string | null;

export const en = {
  locale: "en",
  /** BCP 47 tag for Intl date and number formatting. */
  intl: "en-US",
  /** RSS <language>. */
  rssLanguage: "en",
  site: {
    titleDefault: "AI Review — Honest SaaS reviews",
    description:
      "Evidence-backed reviews of AI tools, marketing software, developer tools, hosting and productivity apps.",
  },
  nav: {
    skip: "Skip to content",
    main: "Main",
    footer: "Footer",
    breadcrumb: "Breadcrumb",
    home: "Home",
    reviews: "Reviews",
    compare: "Compare",
    deals: "Deals",
    howWeReview: "How we review",
    searchLabel: "Search reviews",
    searchPlaceholder: "Search reviews",
    language: "Language",
  },
  localeNames: { en: "English", de: "Deutsch" } as Record<string, string>,
  footer: {
    affiliateNote:
      "Some links on this site are affiliate links. If you buy through them we may earn a commission, at no extra cost to you. It never changes our verdicts.",
    learnMore: "Learn more",
    rss: "RSS",
    copyright: (year: number, name: string) => `© ${year} ${name}`,
  },
  /** Advertising labels (German practice marks affiliate links; English relies on the disclosure). */
  ads: {
    /** Label shown with CTA buttons, or null. */
    label: none,
    /** Marker appended to affiliate link text, or "". */
    marker: "",
    /** Footnote explaining the marker, or null. */
    footnote: none,
  },
  newsletter: {
    label: "Weekly email: new and updated reviews",
    honeypot: "Leave empty",
    placeholder: "you@example.com",
    subscribe: "Subscribe",
    note: "We will email you a link to confirm. Unsubscribe any time.",
  },
  home: {
    kicker: "Independent, evidence-backed",
    title: "Find the right software before you pay for it.",
    trust: "Every review cites its sources, shows the date we verified prices, and is checked by our editor.",
    howWeReview: "How we review",
    latest: "Latest reviews",
    allReviews: "All reviews →",
    guides: "Comparisons and shortlists",
    comparisons: "Comparisons",
    bestOf: "Best of",
    browse: "Browse by category",
    reviewCount: (n: number) => `${n} review${n === 1 ? "" : "s"}`,
  },
  reviews: {
    title: "All reviews",
    description: "Every software review we have published, newest first.",
    matching: (q: string) => `Reviews matching “${q}”`,
    searchLabel: "Search reviews",
    placeholder: "Search by product name",
    search: "Search",
    none: "No reviews found yet.",
  },
  article: {
    notFound: "Review not found",
    guideNotFound: "Not found",
    by: "By",
    updated: (date: string) => `Updated ${date}`,
    verified: (date: string) => `Facts verified ${date}`,
    ourProcess: "Our process",
    scoreOutOf10: "Our score out of 10",
    onThisPage: "On this page",
    fullReviews: "Full reviews",
    /** Fixed AI disclosure for this locale; null uses the CMS setting `editorial.aiDisclosure`. */
    aiDisclosure: none,
    editorFallback: "Editor",
    /** Shown on an article whose translation exists. */
    alsoIn: (language: string) => `Also available in ${language}`,
  },
  card: {
    verified: (date: string) => `Verified ${date}`,
    productsCompared: (n: number) => `${n} products compared`,
  },
  types: {
    review: "Review",
    comparison: "Comparison",
    alternatives: "Alternatives",
    best_of: "Best of",
  } as Record<"review" | "comparison" | "alternatives" | "best_of", string>,
  guideIndex: {
    comparison: {
      title: "Software comparisons",
      description: "Head-to-head comparisons of pricing, features and fit, with every fact cited.",
    },
    alternatives: {
      title: "Alternatives",
      description: "Leaving a tool or checking your options? Researched alternatives with cited facts.",
    },
    best_of: {
      title: "Best software by category",
      description: "Ranked shortlists for common jobs, built from our research and reviews.",
    },
    empty: "Nothing published here yet.",
  },
  category: {
    notFound: "Category not found",
    title: (name: string) => `${name} reviews`,
    fallbackDescription: (name: string) => `Independent reviews of ${name.toLowerCase()} software.`,
    guides: "Comparisons and shortlists",
    empty: "We have not published reviews in this category yet. Check back soon.",
  },
  author: {
    notFound: "Author not found",
    at: (name: string, site: string) => `${name} at ${site}`,
    reviews: "Reviews",
    empty: "No reviews yet.",
  },
  search: {
    title: "Search",
    results: (q: string) => `Results for “${q}”`,
    label: "Search",
    placeholder: "Product, feature or category",
    category: "Category",
    allCategories: "All categories",
    type: "Type",
    allTypes: "All types",
    submit: "Search",
    noMatches: "No matches. Try fewer or different words.",
    count: (n: number) => `${n} result${n === 1 ? "" : "s"}`,
  },
  deals: {
    metaTitle: "Software deals and coupons",
    metaDescription: "Current promo codes, free trials and discounts for the software we review.",
    title: "Deals and coupons",
    intro:
      "Promo codes, trials and guarantees for products we have reviewed. We check them when we refresh each review.",
    affiliate: "Deal links are affiliate links: we may earn a commission at no extra cost to you.",
    learnMore: "Learn more",
    empty: "No active deals right now. Check back soon.",
    other: "Other",
    getDeal: "Get the deal",
    readReview: (product: string) => `Read our ${product} review`,
    ends: (date: string) => `Ends ${date}`,
    copyCode: "Copy code",
    copied: "Copied",
  },
  extras: {
    currentDeals: (product: string) => `Current ${product} deals`,
    allDeals: "All deals",
    helpful: "Was this review helpful?",
    yes: "Yes",
    no: "No",
    thanks: "Thanks for the feedback.",
    voteError: "Could not record your vote. Please try again later.",
    share: "Share:",
    copyLink: "Copy link",
    linkCopied: "Link copied",
    email: "Email",
  },
  video: {
    heading: "Video review",
    play: (title: string) => `Play video: ${title}`,
  },
  discontinued: {
    gone: (product: string) => `${product} is no longer available.`,
    fallbackNote: "The product appears to have been discontinued.",
    kept: "This review is kept for reference; prices and features may no longer apply.",
    consider: "Consider instead:",
  },
  report: {
    title: "Report a change",
    intro: "Prices or features changed? Spotted a mistake? Tell us and we will re-check our sources.",
    error: "Please describe the change in a few words and try again in a few minutes.",
    what: "What changed?",
    kinds: { pricing: "Pricing or plans", error: "A factual error", other: "Something else" },
    details: "Details",
    email: "Email (optional, only to follow up)",
    send: "Send report",
    thanksMeta: "Thanks for your report",
    thanksTitle: "Thanks, we got it",
    thanksBody: "Our editor will re-check the sources and update the review if needed.",
  },
  newsletterPages: {
    confirmMeta: "Confirm your subscription",
    confirmedTitle: "You are subscribed",
    confirmedBody: "Thanks! You will get our email with new and updated reviews.",
    expiredTitle: "This link has expired",
    expiredBody: "Confirmation links work for 7 days. Sign up again from the form at the bottom of any page.",
    confirmTitle: "Confirm your subscription",
    confirmBody: "One click and you will get our weekly email with new and updated reviews.",
    confirm: "Confirm",
    thanksMeta: "Check your inbox",
    failedTitle: "That did not work",
    invalidEmail: "Please enter a valid email address.",
    retry: "We could not verify the request. Please wait a few minutes and try again.",
    inboxTitle: "Check your inbox",
    inboxBody:
      "If the address can receive our email, a confirmation link is on its way. Click it to start your subscription.",
    unsubscribeMeta: "Unsubscribe",
    unsubscribedTitle: "You are unsubscribed",
    unsubscribedBody: "You will not get any more emails from us.",
    unknownTitle: "Link not recognised",
    unknownBody: "Use the unsubscribe link from your latest email, or write to us via the contact page.",
    unsubscribeTitle: "Unsubscribe from our emails?",
    unsubscribe: "Unsubscribe",
  },
  notFound: {
    title: "Page not found",
    body: "The page you are looking for does not exist or has moved.",
    back: "Back to home",
  },
  pages: {
    about: "About us",
    editorialPolicy: "Editorial policy",
    affiliateDisclosure: "Affiliate disclosure",
    privacy: "Privacy policy",
    terms: "Terms and trademarks",
    contact: "Contact",
    impressum: "Legal notice",
    lastUpdated: (date: string) => `Last updated ${date}`,
  },
  /** Article renderer strings; English uses the renderer defaults. */
  render: {} as Partial<RenderLabels>,
};

export type Messages = typeof en;
