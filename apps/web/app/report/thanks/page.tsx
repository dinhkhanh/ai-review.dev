import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Thanks for your report", robots: { index: false } };

export default function ThanksPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Thanks, we got it</h1>
      <p className="mt-2 text-muted">Our editor will re-check the sources and update the review if needed.</p>
      <Link href="/" className="mt-6 inline-block text-brand underline">
        Back to home
      </Link>
    </div>
  );
}
