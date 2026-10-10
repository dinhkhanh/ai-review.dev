import { isContentLocale, type ContentLocale } from "@repo/content";
import { de } from "../messages/de";
import { en, type Messages } from "../messages/en";

/** Message catalogues by locale (NFR-14). Safe anywhere, including route handlers. */
export const MESSAGES: Record<ContentLocale, Messages> = { en, de };

export function messagesFor(locale: string | null | undefined): Messages {
  return isContentLocale(locale) ? MESSAGES[locale] : en;
}

/** Locale-aware date, always in UTC (dates are stored as UTC days). */
export function formatDate(
  t: Pick<Messages, "intl">,
  date: Date | string,
  style: "long" | "short" | "month" = "long",
): string {
  const options: Intl.DateTimeFormatOptions =
    style === "month"
      ? { month: "short", year: "numeric", timeZone: "UTC" }
      : { year: "numeric", month: style === "long" ? "long" : "short", day: "numeric", timeZone: "UTC" };
  return new Date(date).toLocaleDateString(t.intl, options);
}

export type { Messages };
