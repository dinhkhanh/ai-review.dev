import { localePath } from "@repo/content";
import type { Metadata } from "next";
import Link from "next/link";
import { messagesFor, pageLocale } from "../../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await pageLocale());
  return { title: t.newsletterPages.unsubscribeMeta, robots: { index: false } };
}

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const locale = await pageLocale();
  const t = messagesFor(locale).newsletterPages;
  const { token = "", status } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {status === "done" ? (
        <>
          <h1 className="text-2xl font-bold">{t.unsubscribedTitle}</h1>
          <p className="mt-2 text-muted">{t.unsubscribedBody}</p>
        </>
      ) : status === "invalid" ? (
        <>
          <h1 className="text-2xl font-bold">{t.unknownTitle}</h1>
          <p role="alert" className="mt-2 text-muted">
            {t.unknownBody}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">{t.unsubscribeTitle}</h1>
          <form action="/api/newsletter/unsubscribe" method="post" className="mt-6">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="locale" value={locale} />
            <button className="h-10 rounded-md border border-border px-5 text-sm font-medium">{t.unsubscribe}</button>
          </form>
        </>
      )}
      <Link href={localePath(locale, "/")} className="mt-6 inline-block text-brand underline">
        {messagesFor(locale).notFound.back}
      </Link>
    </div>
  );
}
