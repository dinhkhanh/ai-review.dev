import type { Metadata } from "next";
import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";
import { LEGAL, missingLegalFields } from "../../../lib/legal";
import { SITE } from "../../../lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMetadata("/impressum", (t) => ({
    title: t.pages.impressum,
    description: t.locale === "de" ? `Anbieterkennzeichnung von ${SITE.name}.` : `Legal notice for ${SITE.name}.`,
  }));
  // Incomplete provider details must not be indexed (lib/legal.ts lists what the owner fills in).
  return missingLegalFields().length ? { ...meta, robots: { index: false, follow: true } } : meta;
}

/** Placeholder for a missing field: visible on purpose so an incomplete Impressum is caught in review. */
const missing = (label: string) => <span className="rounded bg-warning/20 px-1">[{label}]</span>;

/**
 * Impressum / legal notice (German DDG § 5, MStV § 18). Required for the German site; also linked
 * in English as "Legal notice". Provider details come from lib/legal.ts.
 */
export default async function ImpressumPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const de = locale === "de";
  const fill = de ? "bitte ergänzen" : "to be completed";
  return (
    <Prose title={t.pages.impressum}>
      <h2>{de ? "Angaben gemäß § 5 DDG" : "Provider (German DDG § 5)"}</h2>
      <p>
        {LEGAL.operatorName ?? missing(fill)}
        {LEGAL.representedBy ? (
          <>
            <br />
            {LEGAL.representedBy}
          </>
        ) : null}
        <br />
        {LEGAL.address.length
          ? LEGAL.address.map((line) => (
              <span key={line}>
                {line}
                <br />
              </span>
            ))
          : missing(fill)}
      </p>
      <h2>{de ? "Kontakt" : "Contact"}</h2>
      <p>
        {de ? "E-Mail" : "Email"}: {LEGAL.email ? <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> : missing(fill)}
        <br />
        {de ? "Telefon" : "Phone"}: {LEGAL.phone ?? missing(fill)}
      </p>
      {LEGAL.register ? (
        <>
          <h2>{de ? "Registereintrag" : "Register entry"}</h2>
          <p>{LEGAL.register}</p>
        </>
      ) : null}
      {LEGAL.vatId ? (
        <>
          <h2>{de ? "Umsatzsteuer-ID" : "VAT ID"}</h2>
          <p>{LEGAL.vatId}</p>
        </>
      ) : null}
      <h2>{de ? "Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV" : "Responsible for content (MStV § 18(2))"}</h2>
      <p>{LEGAL.editorResponsible ?? missing(fill)}</p>
      <h2>{de ? "Verbraucherstreitbeilegung" : "Consumer dispute resolution"}</h2>
      <p>
        {de
          ? "Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen."
          : "We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board."}
      </p>
    </Prose>
  );
}
