import { localePath } from "@repo/content";
import Link from "next/link";
import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";
import { SITE } from "../../../lib/site";

export function generateMetadata() {
  return staticPageMetadata("/about", (t) => ({
    title: t.pages.about,
    description: t.locale === "de" ? `Wer hinter ${SITE.name} steht und warum.` : `Who runs ${SITE.name} and why.`,
  }));
}

export default async function AboutPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const href = (path: string) => localePath(locale, path);
  if (locale === "de") {
    return (
      <Prose title={`Über ${SITE.name}`}>
        <p>
          {SITE.name} veröffentlicht unabhängige Software-Testberichte: KI-Tools, Marketing-Software, Entwickler-Tools,
          Hosting und Produktivitäts-Apps – und behält neue Veröffentlichungen im Blick, die einen Blick wert sind.
        </p>
        <p>
          Unser Ziel ist einfach: Ihnen bei der Entscheidung zu helfen, bevor Sie bezahlen. Jeder Testbericht nennt den
          geprüften Preis und das Datum der Prüfung, zeigt die Quelle jeder Angabe und gibt ein klares Fazit mit allen
          Vor- und Nachteilen.
        </p>
        <h2>So arbeiten wir</h2>
        <p>
          Wir recherchieren jedes Produkt anhand der offiziellen Seiten, Bewertungsplattformen, Community-Diskussionen
          und Presseberichte, erstellen eigene Screenshots und bewerten nach einem veröffentlichten Bewertungsschema. KI
          hilft uns bei Recherche, Entwurf und Übersetzung; eine Redakteurin bzw. ein Redakteur prüft und gibt jeden
          Testbericht frei, bevor er erscheint. Lesen Sie unsere vollständigen{" "}
          <Link href={href("/editorial-policy")}>redaktionellen Richtlinien</Link>.
        </p>
        <h2>So finanzieren wir uns</h2>
        <p>
          Einige Links sind Affiliate-Links: Wenn Sie kaufen, zahlt uns der Anbieter eventuell eine Provision – für Sie
          ändert sich der Preis nicht. Anbieter können keine Testberichte, Wertungen oder Platzierungen kaufen. Siehe
          unseren <Link href={href("/affiliate-disclosure")}>Hinweis zu Affiliate-Links</Link>.
        </p>
        <p>
          Fragen oder Korrekturen? <Link href={href("/contact")}>Kontaktieren Sie uns</Link>.
        </p>
      </Prose>
    );
  }
  return (
    <Prose title={`About ${SITE.name}`}>
      <p>
        {SITE.name} publishes independent reviews of software: AI tools, marketing software, developer tools, hosting
        and productivity apps, plus a running track of new releases worth a look.
      </p>
      <p>
        Our goal is simple: help you decide before you pay. Every review states the price we verified and when, shows
        where each fact comes from, and gives a clear verdict with the trade-offs.
      </p>
      <h2>How we work</h2>
      <p>
        We research each product from its official pages, review platforms, community discussions and the press, capture
        our own screenshots, and score it against a published rubric. AI helps us research and draft; an editor checks
        and approves every review before it goes live. Read the full{" "}
        <Link href={href("/editorial-policy")}>{t.pages.editorialPolicy.toLowerCase()}</Link>.
      </p>
      <h2>How we make money</h2>
      <p>
        Some links are affiliate links: if you buy, the vendor may pay us a commission at no extra cost to you. Vendors
        cannot buy reviews, scores or placement. See our{" "}
        <Link href={href("/affiliate-disclosure")}>{t.pages.affiliateDisclosure.toLowerCase()}</Link>.
      </p>
      <p>
        Questions or corrections? <Link href={href("/contact")}>Contact us</Link>.
      </p>
    </Prose>
  );
}
