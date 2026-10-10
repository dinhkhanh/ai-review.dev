import { Turnstile } from "./turnstile";

/** Footer newsletter sign-up (FR-API-3, double opt-in). Plain form post; no cookies. */
export function NewsletterForm() {
  return (
    <form action="/api/newsletter" method="post" className="max-w-md">
      <label htmlFor="newsletter-email" className="block text-sm font-medium text-text">
        Weekly email: new and updated reviews
      </label>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="newsletter-website">Leave empty</label>
        <input id="newsletter-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="mt-2 flex gap-2">
        <input
          id="newsletter-email"
          name="email"
          type="email"
          required
          maxLength={200}
          autoComplete="email"
          placeholder="you@example.com"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm"
        />
        <button className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Subscribe</button>
      </div>
      <Turnstile size="compact" />
      <p className="mt-1 text-xs">We will email you a link to confirm. Unsubscribe any time.</p>
    </form>
  );
}
