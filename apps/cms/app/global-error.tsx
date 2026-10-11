"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort error page when the root layout fails; it renders its own document. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: "40rem", margin: "4rem auto", padding: "0 1rem" }}>
        <h1>Something went wrong</h1>
        <p>The CMS hit an unexpected error{error.digest ? ` (reference ${error.digest})` : ""}.</p>
        <p>
          <button type="button" onClick={reset} style={{ padding: ".5rem 1rem" }}>
            Try again
          </button>{" "}
          {/* A full page load on purpose: the root layout is what failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Dashboard</a>
        </p>
      </body>
    </html>
  );
}
