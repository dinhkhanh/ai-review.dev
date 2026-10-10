import type { Metadata } from "next";

export const metadata: Metadata = { title: "Report a change", robots: { index: false } };

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ article?: string; error?: string }>;
}) {
  const { article = "", error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-bold">Report a change</h1>
      <p className="mt-2 text-muted">
        Prices or features changed? Spotted a mistake? Tell us and we will re-check our sources.
      </p>
      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-danger/10 p-3 text-sm text-danger">
          Please describe the change in a few words and try again.
        </p>
      ) : null}
      <form action="/api/report" method="post" className="mt-6 space-y-4">
        <input type="hidden" name="article" value={article} />
        <div className="hidden" aria-hidden="true">
          <label htmlFor="website">Leave empty</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="kind" className="mb-1.5 block text-sm font-medium">
            What changed?
          </label>
          <select id="kind" name="kind" className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm">
            <option value="pricing">Pricing or plans</option>
            <option value="error">A factual error</option>
            <option value="other">Something else</option>
          </select>
        </div>
        <div>
          <label htmlFor="message" className="mb-1.5 block text-sm font-medium">
            Details
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
            Email (optional, only to follow up)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            maxLength={200}
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
          />
        </div>
        <button className="h-10 rounded-md bg-brand px-5 text-sm font-medium text-brand-fg">Send report</button>
      </form>
    </div>
  );
}
