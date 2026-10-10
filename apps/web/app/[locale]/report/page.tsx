import type { Metadata } from "next";
import { Turnstile } from "../../../components/turnstile";
import { messagesFor, pageLocale } from "../../../lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = messagesFor(await pageLocale());
  return { title: t.report.title, robots: { index: false } };
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ article?: string; error?: string }>;
}) {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const { article = "", error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">{t.report.title}</h1>
      <p className="mt-2 text-muted">{t.report.intro}</p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-danger/10 p-3 text-sm text-danger">
          {t.report.error}
        </p>
      ) : null}
      <form action="/api/report" method="post" className="mt-6 space-y-4">
        <input type="hidden" name="article" value={article} />
        <input type="hidden" name="locale" value={locale} />
        <div className="hidden" aria-hidden="true">
          <label htmlFor="website">{t.newsletter.honeypot}</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="kind" className="mb-1.5 block text-sm font-medium">
            {t.report.what}
          </label>
          <select id="kind" name="kind" className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm">
            <option value="pricing">{t.report.kinds.pricing}</option>
            <option value="error">{t.report.kinds.error}</option>
            <option value="other">{t.report.kinds.other}</option>
          </select>
        </div>
        <div>
          <label htmlFor="message" className="mb-1.5 block text-sm font-medium">
            {t.report.details}
          </label>
          <textarea
            id="message"
            name="message"
            required
            minLength={5}
            maxLength={2000}
            rows={5}
            className="w-full rounded-md border border-border bg-bg p-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            {t.report.email}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            maxLength={200}
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
          />
        </div>
        <Turnstile />
        <button className="h-10 rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">{t.report.send}</button>
      </form>
    </div>
  );
}
