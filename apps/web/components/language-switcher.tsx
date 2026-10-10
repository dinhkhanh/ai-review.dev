"use client";

import { usePathname } from "next/navigation";

/**
 * Language switcher (phase 3). Links go through /api/locale-switch, which finds the translated
 * article when one exists and otherwise lands on the same page (indexes, policies) or the locale
 * home. Server-rendered with the current path, so it causes no layout shift; works without JS.
 */
export function LanguageSwitcher({
  current,
  locales,
  label,
}: {
  current: string;
  locales: Array<{ locale: string; name: string }>;
  label: string;
}) {
  const path = usePathname() || "/";
  return (
    <ul aria-label={label} className="flex items-center gap-1 text-xs font-medium uppercase">
      {locales.map((l) =>
        l.locale === current ? (
          <li key={l.locale}>
            <span aria-current="true" title={l.name} className="rounded px-1.5 py-1 text-text">
              {l.locale}
            </span>
          </li>
        ) : (
          <li key={l.locale}>
            <a
              href={`/api/locale-switch?to=${l.locale}&from=${encodeURIComponent(path)}`}
              hrefLang={l.locale}
              lang={l.locale}
              title={l.name}
              rel="nofollow"
              className="rounded px-1.5 py-1 text-muted hover:bg-surface hover:text-text"
            >
              {l.locale}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
