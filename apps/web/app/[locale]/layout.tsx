import { CONTENT_LOCALES, localePath } from "@repo/content";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "../../components/language-switcher";
import { NewsletterForm } from "../../components/newsletter-form";
import { SearchBox } from "../../components/search-box";
import { currentLocale, enabledLocales, feedPath, messagesFor } from "../../lib/i18n";
import { SITE } from "../../lib/site";
import { staticPages } from "../../lib/static-pages";
import "../globals.css";

export function generateStaticParams() {
  return CONTENT_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  const t = messagesFor(locale);
  return {
    metadataBase: new URL(SITE.url),
    title: { default: t.site.titleDefault, template: `%s — ${SITE.name}` },
    description: t.site.description,
    openGraph: { siteName: SITE.name, type: "website", locale: t.intl.replace("-", "_") },
    twitter: { card: "summary_large_image" },
    alternates: { types: { "application/rss+xml": `${SITE.url}${feedPath(locale)}` } },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  const t = messagesFor(locale);
  const href = (path: string) => localePath(locale, path);
  const locales = await enabledLocales();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-bg focus:p-2"
        >
          {t.nav.skip}
        </a>
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
            <Link href={href("/")} className="font-semibold tracking-tight">
              {SITE.name}
            </Link>
            <nav aria-label={t.nav.main} className="flex items-center gap-5 text-sm">
              <Link href={href("/reviews")} className="hover:underline">
                {t.nav.reviews}
              </Link>
              <Link href={href("/compare")} className="hidden hover:underline sm:inline">
                {t.nav.compare}
              </Link>
              <Link href={href("/deals")} className="hover:underline">
                {t.nav.deals}
              </Link>
              <SearchBox action={href("/search")} label={t.nav.searchLabel} placeholder={t.nav.searchPlaceholder} />
              <Link href={href("/editorial-policy")} className="hidden hover:underline sm:inline">
                {t.nav.howWeReview}
              </Link>
              {locales.length > 1 ? (
                <LanguageSwitcher
                  current={locale}
                  locales={locales.map((l) => ({ locale: l, name: t.localeNames[l] ?? l }))}
                  label={t.nav.language}
                />
              ) : null}
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="mt-24 border-t border-border pb-20 md:pb-0">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
            <NewsletterForm locale={locale} t={t.newsletter} />
            <nav aria-label={t.nav.footer} className="mt-8 flex flex-wrap gap-x-5 gap-y-2">
              {staticPages(locale).map((p) => (
                <Link key={p.path} href={href(p.path)} className="hover:underline">
                  {p.title}
                </Link>
              ))}
              <a href={feedPath(locale)} className="hover:underline">
                {t.footer.rss}
              </a>
            </nav>
            <p className="mt-4">
              {t.footer.affiliateNote}{" "}
              <Link href={href("/affiliate-disclosure")} className="underline">
                {t.footer.learnMore}
              </Link>
              .
            </p>
            {t.ads.footnote ? <p className="mt-2">{t.ads.footnote}</p> : null}
            <p className="mt-2">{t.footer.copyright(new Date().getFullYear(), SITE.name)}</p>
          </div>
        </footer>
        {plausibleDomain ? (
          // Cookieless, no personal data: no consent banner required (FR-WEB-11, see /privacy).
          <Script
            defer
            data-domain={plausibleDomain}
            src="https://plausible.io/js/script.outbound-links.js"
            strategy="afterInteractive"
          />
        ) : null}
      </body>
    </html>
  );
}
