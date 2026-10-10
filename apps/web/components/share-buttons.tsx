"use client";

import { useState } from "react";

/** Share links (FR-WEB-10): plain links that work without JS, plus copy / native share when available. */
export function ShareButtons({
  url,
  title,
  t,
}: {
  url: string;
  title: string;
  t: { share: string; copyLink: string; linkCopied: string; email: string };
}) {
  const [copied, setCopied] = useState(false);
  const u = encodeURIComponent(url);
  const ti = encodeURIComponent(title);
  const links = [
    { label: "X", href: `https://x.com/intent/post?url=${u}&text=${ti}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { label: t.email, href: `mailto:?subject=${ti}&body=${u}` },
  ];
  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ url, title });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Dismissed share sheet or blocked clipboard: nothing to do.
    }
  }
  const cls = "inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">{t.share}</span>
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className={cls}>
          {l.label}
        </a>
      ))}
      <button type="button" onClick={share} className={cls} aria-live="polite">
        {copied ? t.linkCopied : t.copyLink}
      </button>
    </div>
  );
}
