import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token = "", status } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {status === "done" ? (
        <>
          <h1 className="text-2xl font-bold">You are unsubscribed</h1>
          <p className="mt-2 text-muted">You will not get any more emails from us.</p>
        </>
      ) : status === "invalid" ? (
        <>
          <h1 className="text-2xl font-bold">Link not recognised</h1>
          <p role="alert" className="mt-2 text-muted">
            Use the unsubscribe link from your latest email, or write to us via the contact page.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Unsubscribe from our emails?</h1>
          <form action="/api/newsletter/unsubscribe" method="post" className="mt-6">
            <input type="hidden" name="token" value={token} />
            <button className="h-10 rounded-md border border-border px-5 text-sm font-medium">Unsubscribe</button>
          </form>
        </>
      )}
      <Link href="/" className="mt-6 inline-block text-brand underline">
        Back to home
      </Link>
    </div>
  );
}
