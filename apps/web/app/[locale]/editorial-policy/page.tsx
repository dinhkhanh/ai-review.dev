import { localePath } from "@repo/content";
import Link from "next/link";
import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";

export function generateMetadata() {
  return staticPageMetadata("/editorial-policy", (t) => ({
    title: t.pages.editorialPolicy,
    description:
      t.locale === "de"
        ? "Wie wir Software recherchieren, Fakten prüfen, bewerten und aktualisieren – und wie wir KI einsetzen."
        : "How we research, fact-check, score and update our software reviews, and how we use AI.",
  }));
}

export default async function EditorialPolicyPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const href = (path: string) => localePath(locale, path);
  if (locale === "de") {
    return (
      <Prose title={t.pages.editorialPolicy} updated={t.pages.lastUpdated("Oktober 2026")}>
        <h2>Recherche</h2>
        <p>Für jedes Produkt sammeln wir Belege aus:</p>
        <ul>
          <li>
            den eigenen Seiten des Anbieters: Startseite, Preise, Funktionen, Sicherheit, Dokumentation, Changelog;
          </li>
          <li>
            Bewertungsplattformen wie G2, Capterra und Trustpilot, mit Bewertung, Anzahl der Bewertungen und dem Datum,
            an dem wir sie gesehen haben;
          </li>
          <li>Community-Diskussionen (Reddit, Hacker News) und unabhängigen Testberichten in der Presse;</li>
          <li>eigenen, datierten Screenshots öffentlicher Seiten auf Desktop und Mobilgerät.</li>
        </ul>
        <p>
          Wir respektieren robots.txt und zitieren Quellen nur kurz. Jede Tatsachenbehauptung in einem Testbericht
          verweist auf ihre Quelle.
        </p>
        <h2>Faktenprüfung</h2>
        <p>
          Preise, Tariflimits, Bewertungen und Daten werden vor der Veröffentlichung mit dem zitierten Quelltext
          abgeglichen. Ein Testbericht kann nicht erscheinen, solange eine Aussage unbelegt oder veraltet ist. Jeder
          Testbericht zeigt, wann seine Fakten zuletzt geprüft wurden.
        </p>
        <h2>Bewertung</h2>
        <p>
          Wertungen entstehen aus einem gewichteten Schema: Funktionen, Bedienbarkeit, Preis-Leistung, Support und
          Dokumentation, Integrationen sowie Sicherheit und Zuverlässigkeit. Jede Dimension erhält eine Note von 1–10
          mit einer Begründung in einem Satz. Die Gesamtwertung wird aus den Gewichten berechnet, nie von Hand
          eingetragen. Wir veröffentlichen keine Durchschnittsbewertungen von Nutzern, die wir nicht selbst befragt
          haben.
        </p>
        <h2>Wie wir KI einsetzen</h2>
        <p>
          KI-Modelle helfen uns, Recherchen zu sammeln und zu ordnen, erste Entwürfe zu schreiben und Testberichte ins
          Deutsche zu übersetzen. Sie entscheiden nie allein über ein Fazit. Eine Redakteurin bzw. ein Redakteur prüft
          jeden Artikel, seine Quellen und Wertungen und kann jeden Teil umschreiben oder ablehnen. Aussagen aus
          Praxistests beschränken sich auf das, was wir tatsächlich festgehalten haben; wir behaupten keine Tests, die
          wir nicht durchgeführt haben.
        </p>
        <h2>Übersetzungen</h2>
        <p>
          Deutsche Testberichte sind Übersetzungen unserer englischen Testberichte. Preise, Tarife und Wertungen werden
          unverändert übernommen und in der Originalwährung angezeigt; Quellen sind häufig englischsprachig. Ändert sich
          der englische Testbericht, aktualisieren wir die Übersetzung.
        </p>
        <h2>Unabhängigkeit</h2>
        <p>
          Wir erhalten Affiliate-Provisionen für einige Links (siehe{" "}
          <Link href={href("/affiliate-disclosure")}>Hinweis zu Affiliate-Links</Link>). Provisionen ändern nie
          Wertungen oder Urteile, und wir testen Produkte unabhängig davon, ob es ein Partnerprogramm gibt.
        </p>
        <h2>Aktualisierungen und Korrekturen</h2>
        <p>
          Wir prüfen Testberichte regelmäßig und bei jeder Preisänderung. Wenn Ihnen etwas Veraltetes auffällt, nutzen
          Sie den Link „Änderung melden“ unter jeder Preistabelle oder{" "}
          <Link href={href("/contact")}>schreiben Sie uns</Link>.
        </p>
      </Prose>
    );
  }
  return (
    <Prose title={t.pages.editorialPolicy} updated={t.pages.lastUpdated("October 2026")}>
      <h2>Research</h2>
      <p>For every product we collect evidence from:</p>
      <ul>
        <li>the vendor&apos;s own pages: home, pricing, features, security, documentation and changelog;</li>
        <li>
          review platforms such as G2, Capterra and Trustpilot, with the rating, review count and the date we saw them;
        </li>
        <li>community discussions (Reddit, Hacker News) and independent reviews in the press;</li>
        <li>our own dated screenshots of public pages on desktop and mobile.</li>
      </ul>
      <p>
        We respect robots.txt and quote sources only briefly. Every factual statement in a review links to its source.
      </p>
      <h2>Fact-checking</h2>
      <p>
        Prices, plan limits, ratings and dates are checked against the cited source text before publication. A review
        cannot be published while any claim is unsupported or outdated. Each review shows when its facts were last
        verified.
      </p>
      <h2>Scoring</h2>
      <p>
        Scores come from a weighted rubric: features, ease of use, value for money, support and documentation,
        integrations, and security and reliability. Each dimension gets a 1–10 score with a one-sentence justification.
        The overall score is calculated from the weights, never typed in by hand. We do not publish aggregate ratings
        from users we did not survey.
      </p>
      <h2>How we use AI</h2>
      <p>
        AI models help us gather and organise research and write first drafts. They never decide a verdict on their own.
        An editor reviews every article, its sources and its scores, and can rewrite or reject any part of it. Hands-on
        statements are limited to what we actually captured; we do not claim tests we did not run.
      </p>
      <h2>Independence</h2>
      <p>
        We earn affiliate commissions on some links (see the{" "}
        <Link href={href("/affiliate-disclosure")}>affiliate disclosure</Link>). Commissions never change scores or
        verdicts, and we review products whether or not they have an affiliate program.
      </p>
      <h2>Updates and corrections</h2>
      <p>
        We re-check reviews regularly and whenever prices change. If you spot something out of date, use the “Report a
        change” link under any pricing table or <Link href={href("/contact")}>contact us</Link>.
      </p>
    </Prose>
  );
}
