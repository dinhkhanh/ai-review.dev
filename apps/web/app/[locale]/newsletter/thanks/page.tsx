import { localePath } from "@repo/content";
import type { Metadata } from "next";
import Link from "next/link";
import { messagesFor, pageLocale } from "../../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await pageLocale());
  return { title: t.newsletterPages.thanksMeta, robots: { index: false } };
}

export default async function NewsletterThanksPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await pageLocale();
  const t = messagesFor(locale).newsletterPages;
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      {error ? (
        <>
          <h1 className="text-2xl font-bold">{t.failedTitle}</h1>
          <p role="alert" className="mt-2 text-muted">
            {error === "email" ? t.invalidEmail : t.retry}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">{t.inboxTitle}</h1>
          <p className="mt-2 text-muted">{t.inboxBody}</p>
        </>
      )}
      <Link href={localePath(locale, "/")} className="mt-6 inline-block text-brand underline">
        {messagesFor(locale).notFound.back}
      </Link>
    </div>
  );
}
