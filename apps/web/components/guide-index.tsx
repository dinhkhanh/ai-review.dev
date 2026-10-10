import { ARTICLE_ROUTE_PREFIX } from "@repo/content";
import { listPublishedArticles } from "@repo/core";
import { getDb } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl } from "../lib/site";
import { GuideGrid } from "./guide-card";
import type { GuideType } from "./guide-page";

const COPY: Record<GuideType, { title: string; description: string }> = {
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
};

export function guideIndexMetadata(type: GuideType): Metadata {
  return {
    title: COPY[type].title,
    description: COPY[type].description,
    alternates: { canonical: absoluteUrl(ARTICLE_ROUTE_PREFIX[type]) },
  };
}

export async function GuideIndex({ type }: { type: GuideType }) {
  const guides = await listPublishedArticles(getDb(), { types: [type], limit: 100 });
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/" className="hover:underline">
          Home
        </Link>{" "}
        / {COPY[type].title}
      </nav>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{COPY[type].title}</h1>
      <p className="mt-2 max-w-2xl text-muted">{COPY[type].description}</p>
      <div className="mt-8">
        {guides.length ? <GuideGrid guides={guides} /> : <p className="text-muted">Nothing published here yet.</p>}
      </div>
    </div>
  );
}
