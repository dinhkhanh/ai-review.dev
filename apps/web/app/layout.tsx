import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import type { ReactNode } from "react";
import { SITE } from "../lib/site";
import { STATIC_PAGES } from "../lib/static-pages";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — Honest SaaS reviews`, template: `%s — ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, type: "website" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
  alternates: { types: { "application/rss+xml": `${SITE.url}/feed.xml` } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-bg focus:p-2"
        >
          Skip to content
        </a>
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
            <Link href="/" className="font-semibold tracking-tight">
              {SITE.name}
            </Link>
            <nav aria-label="Main" className="flex items-center gap-5 text-sm">
              <Link href="/reviews" className="hover:underline">
                Reviews
              </Link>
              <Link href="/editorial-policy" className="hidden hover:underline sm:inline">
                How we review
              </Link>
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="mt-24 border-t border-border pb-20 md:pb-0">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
            <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
              {STATIC_PAGES.map((p) => (
                <Link key={p.path} href={p.path} className="hover:underline">
                  {p.title}
                </Link>
              ))}
              <a href="/feed.xml" className="hover:underline">
                RSS
              </a>
            </nav>
            <p className="mt-4">
              Some links on this site are affiliate links. If you buy through them we may earn a commission, at no extra
              cost to you. It never changes our verdicts.{" "}
              <Link href="/affiliate-disclosure" className="underline">
                Learn more
              </Link>
              .
            </p>
            <p className="mt-2">
              © {new Date().getFullYear()} {SITE.name}
            </p>
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
