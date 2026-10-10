"use client";

import { useState } from "react";

/** Promo code with a copy button (FR-WEB-8). The code stays selectable text without JS. */
export function PromoCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <code className="rounded border border-dashed border-border bg-surface px-2 py-1 font-mono text-sm">{code}</code>
      <button
        type="button"
        className="text-xs text-brand underline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked: the code is still selectable.
          }
        }}
        aria-live="polite"
      >
        {copied ? "Copied" : "Copy code"}
      </button>
    </span>
  );
}
