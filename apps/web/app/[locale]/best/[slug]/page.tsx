import type { Metadata } from "next";
import { GuidePage, guideMetadata } from "../../../../components/guide-page";

// Static on first request, then ISR; publishing revalidates on demand (FR-WEB-2).
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return guideMetadata("best_of", (await params).slug);
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <GuidePage type="best_of" slug={(await params).slug} />;
}
