import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";
import { SITE } from "../../../lib/site";

export function generateMetadata() {
  return staticPageMetadata("/terms", (t) => ({
    title: t.pages.terms,
    description:
      t.locale === "de"
        ? `Nutzungsbedingungen und Markenhinweis für ${SITE.name}.`
        : `Terms of use and trademark notice for ${SITE.name}.`,
  }));
}

export default async function TermsPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  if (locale === "de") {
    return (
      <Prose title={t.pages.terms} updated={t.pages.lastUpdated("Oktober 2026")}>
        <h2>Nutzung dieser Website</h2>
        <p>
          Unsere Testberichte sind Meinungen auf Grundlage der zitierten Quellen, Stand der angegebenen Daten. Preise
          und Funktionen ändern sich; prüfen Sie vor dem Kauf immer die Website des Anbieters. Für Produkte und
          Leistungen der Anbieter übernehmen wir keine Verantwortung.
        </p>
        <h2>Haftung für Links</h2>
        <p>
          Unsere Seiten verlinken auf externe Websites, auf deren Inhalte wir keinen Einfluss haben. Für diese Inhalte
          ist stets der jeweilige Anbieter verantwortlich. Werden uns Rechtsverletzungen bekannt, entfernen wir
          betroffene Links umgehend.
        </p>
        <h2>Marken</h2>
        <p>
          Produktnamen, Logos und Marken sind Eigentum ihrer Inhaber. Wir verwenden sie nur, um die getesteten Produkte
          zu bezeichnen. Die Verwendung bedeutet keine Billigung durch die Inhaber und keine Verbindung zu ihnen.
        </p>
        <h2>Urheberrecht und Beanstandungen</h2>
        <p>
          Unsere Texte, Wertungen, selbst erstellten Screenshots und Grafiken sind © {SITE.name}. Fremde Quellen
          zitieren wir nur kurz und verlinken sie. Wenn Sie meinen, dass Inhalte auf dieser Website Ihre Rechte
          verletzen, schreiben Sie an {SITE.contactEmail} mit der Seitenadresse, dem betroffenen Inhalt und Ihren
          Kontaktdaten; wir reagieren umgehend.
        </p>
      </Prose>
    );
  }
  return (
    <Prose title={t.pages.terms} updated={t.pages.lastUpdated("October 2026")}>
      <h2>Use of this site</h2>
      <p>
        Our reviews are opinions based on the sources we cite, as of the dates shown. Prices and features change; always
        check the vendor&apos;s site before you buy. We are not responsible for vendors&apos; products or services.
      </p>
      <h2>Trademarks</h2>
      <p>
        Product names, logos and brands are the property of their owners. We use them only to identify the products we
        review (nominative use). Their use does not imply endorsement by or affiliation with the owners.
      </p>
      <h2>Copyright and takedowns</h2>
      <p>
        Our text, scores, screenshots we captured and graphics are © {SITE.name}. We quote third-party sources only
        briefly and link to them. If you believe content on this site infringes your rights, email {SITE.contactEmail}{" "}
        with the page address, the material concerned and your contact details, and we will respond promptly.
      </p>
    </Prose>
  );
}
