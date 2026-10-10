import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";
import { SITE } from "../../../lib/site";

export function generateMetadata() {
  return staticPageMetadata("/affiliate-disclosure", (t) => ({
    title: t.pages.affiliateDisclosure,
    description:
      t.locale === "de"
        ? `Wie sich ${SITE.name} finanziert und wie Affiliate-Links funktionieren.`
        : `How ${SITE.name} makes money and how affiliate links work.`,
  }));
}

export default async function AffiliateDisclosurePage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  if (locale === "de") {
    return (
      <Prose title={t.pages.affiliateDisclosure} updated={t.pages.lastUpdated("Oktober 2026")}>
        <p>
          {SITE.name} finanziert sich über seine Leserinnen und Leser. Einige Links auf dieser Website sind
          Affiliate-Links: Wenn Sie einen anklicken und etwas kaufen, zahlt uns der Anbieter eventuell eine Provision.
          Der Preis für Sie bleibt derselbe.
        </p>
        <h2>Kennzeichnung</h2>
        <p>
          Affiliate-Links sind Werbung. Wir kennzeichnen sie mit einem Sternchen (*); Schaltflächen zu Anbietern tragen
          zusätzlich den Hinweis „Anzeige“. Jede Seite mit solchen Links enthält oben einen entsprechenden Hinweis.
        </p>
        <h2>So funktionieren die Links</h2>
        <p>
          Schaltflächen und Links zu Anbietern laufen über Adressen, die mit <code>/go/</code> beginnen. Sie leiten Sie
          zum Anbieter weiter und erfassen einen anonymen Klick (ohne Cookies; siehe Datenschutzerklärung), damit wir
          wissen, welche Seiten hilfreich sind. Manche Anbieter erlauben keine Weiterleitung; dann verlinken wir direkt.
          Alle diese Links sind für Suchmaschinen als „sponsored“ markiert.
        </p>
        <h2>Unser Versprechen</h2>
        <ul>
          <li>Anbieter können nicht für einen Testbericht, eine Wertung oder eine bessere Platzierung bezahlen.</li>
          <li>Wir testen Produkte mit und ohne Partnerprogramm nach demselben Bewertungsschema.</li>
          <li>Passt ein Produkt nicht zu Ihnen, sagen wir das und nennen Alternativen.</li>
        </ul>
        <p>
          Dieser Hinweis folgt den Kennzeichnungspflichten für Werbung (§ 5a UWG, § 22 MStV) sowie den Endorsement
          Guides der US Federal Trade Commission (16 CFR Part 255).
        </p>
      </Prose>
    );
  }
  return (
    <Prose title={t.pages.affiliateDisclosure} updated={t.pages.lastUpdated("October 2026")}>
      <p>
        {SITE.name} is reader-supported. Some links on this site are affiliate links: if you click one and buy, the
        vendor may pay us a commission. The price you pay is the same.
      </p>
      <h2>How the links work</h2>
      <p>
        Buttons and links to vendors go through addresses that start with <code>/go/</code>. They forward you to the
        vendor and record an anonymous click (no cookies; see our privacy policy) so we know which pages are useful.
        Some vendors do not allow forwarding; for those we link directly. All such links are marked as sponsored for
        search engines.
      </p>
      <h2>Our promise</h2>
      <ul>
        <li>Vendors cannot pay for a review, a score or a better position.</li>
        <li>We review products with and without affiliate programs, using the same rubric.</li>
        <li>When a product is not right for you, we say so and point to alternatives.</li>
      </ul>
      <p>
        This disclosure follows the U.S. Federal Trade Commission&apos;s Endorsement Guides (16 CFR Part 255) and
        similar rules elsewhere.
      </p>
    </Prose>
  );
}
