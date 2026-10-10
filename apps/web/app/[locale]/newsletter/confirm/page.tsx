import { localePath } from "@repo/content";
import type { Metadata } from "next";
import Link from "next/link";
import { messagesFor, pageLocale } from "../../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await pageLocale());
  return { title: t.newsletterPages.confirmMeta, robots: { index: false } };
}

/**
 * Double opt-in landing page (FR-API-3). Confirmation needs a button press (POST) so that email
 * link scanners opening the URL do not subscribe anyone.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const locale = await pageLocale();
  const t = messagesFor(locale).newsletterPages;
  const { token = "", status } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {status === "confirmed" ? (
        <>
          <h1 className="text-2xl font-bold">{t.confirmedTitle}</h1>
          <p className="mt-2 text-muted">{t.confirmedBody}</p>
        </>
      ) : status === "invalid" ? (
        <>
          <h1 className="text-2xl font-bold">{t.expiredTitle}</h1>
          <p role="alert" className="mt-2 text-muted">
            {t.expiredBody}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">{t.confirmTitle}</h1>
          <p className="mt-2 text-muted">{t.confirmBody}</p>
          <form action="/api/newsletter/confirm" method="post" className="mt-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="locale" value={locale} />
            <button className="h-10 rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">{t.confirm}</button>
          </form>
        </>
      )}
      <Link href={localePath(locale, "/")} className="mt-6 inline-block text-brand underline">
        {messagesFor(locale).notFound.back}
      </Link>
    </div>
  );
}
