"use client";

import { useEffect } from "react";

/**
 * Last-resort error page, shown when the root layout itself fails. It replaces the layout, so it
 * renders its own document and cannot use the message catalogues; the text is bilingual.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: "40rem", margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Something went wrong</h1>
        <p>The page could not be loaded. Please try again in a moment.</p>
        <p lang="de">Die Seite konnte nicht geladen werden. Bitte versuchen Sie es gleich noch einmal.</p>
        <p>
          <button type="button" onClick={reset} style={{ padding: ".5rem 1rem" }}>
            Try again / Erneut versuchen
          </button>{" "}
          {/* A full page load on purpose: the root layout is what failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Home</a>
        </p>
      </body>
    </html>
  );
}
