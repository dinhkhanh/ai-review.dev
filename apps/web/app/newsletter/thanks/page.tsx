import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Check your inbox", robots: { index: false } };

export default async function NewsletterThanksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {error ? (
        <>
          <h1 className="text-2xl font-bold">That did not work</h1>
          <p role="alert" className="mt-2 text-muted">
            {error === "email"
              ? "Please enter a valid email address."
              : "We could not verify the request. Please wait a few minutes and try again."}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Check your inbox</h1>
          <p className="mt-2 text-muted">
            If the address can receive our email, a confirmation link is on its way. Click it to start your
            subscription.
          </p>
        </>
      )}
      <Link href="/" className="mt-6 inline-block text-brand underline">
        Back to home
      </Link>
    </div>
  );
}
