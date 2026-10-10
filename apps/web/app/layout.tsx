import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SITE } from "../lib-site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — Honest SaaS reviews`, template: `%s — ${SITE.name}` },
  description: SITE.description,
  openGraph: { siteName: SITE.name, type: "website" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f14" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
          Skip to content
        </a>
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="font-semibold tracking-tight">
              {SITE.name}
            </Link>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
            <p>
              Some links on this site are affiliate links. If you buy through them we may earn a commission, at no extra
              cost to you. It never changes our verdicts.
            </p>
            <p className="mt-2">
              © {new Date().getFullYear()} {SITE.name}
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
