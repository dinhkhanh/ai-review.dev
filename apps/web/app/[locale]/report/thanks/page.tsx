import { localePath } from "@repo/content";
import type { Metadata } from "next";
import Link from "next/link";
import { messagesFor, pageLocale } from "../../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await pageLocale());
  return { title: t.report.thanksMeta, robots: { index: false } };
}

export default async function ThanksPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">{t.report.thanksTitle}</h1>
      <p className="mt-2 text-muted">{t.report.thanksBody}</p>
      <Link href={localePath(locale, "/")} className="mt-6 inline-block text-brand underline">
        {t.notFound.back}
      </Link>
    </div>
  );
}
