import type { Messages } from "../messages/en";
import { Turnstile } from "./turnstile";

/**
 * Footer newsletter sign-up (FR-API-3, double opt-in). Plain form post; no cookies. `locale`
 * decides which digest the subscriber receives (FR-WEB-9) and the language of the replies.
 */
export function NewsletterForm({ locale, t }: { locale: string; t: Messages["newsletter"] }) {
  return (
    <form action="/api/newsletter" method="post" className="max-w-md">
      <input type="hidden" name="locale" value={locale} />
      <label htmlFor="newsletter-email" className="block text-sm font-medium text-text">
        {t.label}
      </label>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="newsletter-website">{t.honeypot}</label>
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
          placeholder={t.placeholder}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 text-sm"
        />
        <button className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">{t.subscribe}</button>
      </div>
      <Turnstile size="compact" />
      <p className="mt-1 text-xs">{t.note}</p>
    </form>
  );
}
