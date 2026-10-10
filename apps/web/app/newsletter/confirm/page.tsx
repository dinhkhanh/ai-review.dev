import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Confirm your subscription", robots: { index: false } };

/**
 * Double opt-in landing page (FR-API-3). Confirmation needs a button press (POST) so that email
 * link scanners opening the URL do not subscribe anyone.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token = "", status } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {status === "confirmed" ? (
        <>
          <h1 className="text-2xl font-bold">You are subscribed</h1>
          <p className="mt-2 text-muted">Thanks! You will get our email with new and updated reviews.</p>
        </>
      ) : status === "invalid" ? (
        <>
          <h1 className="text-2xl font-bold">This link has expired</h1>
          <p role="alert" className="mt-2 text-muted">
            Confirmation links work for 7 days. Sign up again from the form at the bottom of any page.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Confirm your subscription</h1>
          <p className="mt-2 text-muted">One click and you will get our weekly email with new and updated reviews.</p>
          <form action="/api/newsletter/confirm" method="post" className="mt-6">
            <input type="hidden" name="token" value={token} />
            <button className="h-10 rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">Confirm</button>
          </form>
        </>
      )}
      <Link href="/" className="mt-6 inline-block text-brand underline">
        Back to home
      </Link>
    </div>
  );
}
