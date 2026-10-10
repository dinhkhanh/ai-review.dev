import { localePath } from "@repo/content";
import Link from "next/link";
import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";
import { SITE } from "../../../lib/site";

export function generateMetadata() {
  return staticPageMetadata("/contact", (t) => ({
    title: t.pages.contact,
    description: t.locale === "de" ? `Kontakt zur Redaktion von ${SITE.name}.` : `Contact the ${SITE.name} editor.`,
  }));
}

export default async function ContactPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const report = localePath(locale, "/report");
  if (locale === "de") {
    return (
      <Prose title={t.pages.contact}>
        <p>
          Schreiben Sie der Redaktion an <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
        <p>
          Veraltete Preise oder einen Fehler in einem Testbericht entdeckt? Am schnellsten geht es über das Formular{" "}
          <Link href={report}>Änderung melden</Link> – es landet direkt in unserer Prüfwarteschlange.
        </p>
        <p>
          Anbieter: Wir nehmen kein Geld für Testberichte oder Platzierungen an, freuen uns aber über Korrekturen mit
          Quelle.
        </p>
      </Prose>
    );
  }
  return (
    <Prose title={t.pages.contact}>
      <p>
        Email the editor at <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>
      <p>
        Spotted outdated pricing or a mistake in a review? The quickest route is the{" "}
        <Link href={report}>report a change</Link> form, which goes straight to our review queue.
      </p>
      <p>Vendors: we do not accept payment for reviews or placement, but we welcome corrections with a source.</p>
    </Prose>
  );
}
