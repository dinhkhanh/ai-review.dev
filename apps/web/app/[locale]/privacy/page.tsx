import { localePath } from "@repo/content";
import Link from "next/link";
import { Prose } from "../../../components/prose";
import { messagesFor, pageLocale, staticPageMetadata } from "../../../lib/i18n";
import { LEGAL } from "../../../lib/legal";
import { SITE } from "../../../lib/site";

export function generateMetadata() {
  return staticPageMetadata("/privacy", (t) => ({
    title: t.pages.privacy,
    description:
      t.locale === "de"
        ? `Welche Daten ${SITE.name} verarbeitet und warum.`
        : `What data ${SITE.name} collects and why.`,
  }));
}

export default async function PrivacyPage() {
  const locale = await pageLocale();
  const t = messagesFor(locale);
  const href = (path: string) => localePath(locale, path);
  if (locale === "de") {
    return (
      <Prose title={t.pages.privacy} updated={t.pages.lastUpdated("Oktober 2026")}>
        <p>Wir erheben so wenige Daten wie möglich und verkaufen keine personenbezogenen Daten.</p>
        <h2>Verantwortlicher</h2>
        <p>
          Verantwortlich im Sinne der DSGVO ist {LEGAL.operatorName ?? "[Betreiber – siehe Impressum]"}
          {LEGAL.address.length ? `, ${LEGAL.address.join(", ")}` : ""}, E-Mail: {LEGAL.email ?? SITE.contactEmail}.
          Weitere Angaben finden Sie im <Link href={href("/impressum")}>Impressum</Link>.
        </p>
        <h2>Hosting und Server-Logs</h2>
        <p>
          Beim Aufruf der Website verarbeitet unser Hosting-Anbieter technisch notwendige Daten (IP-Adresse, Zeitpunkt,
          aufgerufene Adresse, Browserkennung), um die Seiten auszuliefern und vor Missbrauch zu schützen.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren, funktionierenden
          Angebot).
        </p>
        <h2>Reichweitenmessung</h2>
        <p>
          Wir nutzen eine datenschutzfreundliche, cookielose Statistik, die Seitenaufrufe, Verweisquellen und Länder
          zählt. Sie setzt keine Cookies, speichert keine personenbezogenen Daten und verfolgt Sie nicht über Websites
          hinweg; eine Einwilligung ist daher nicht erforderlich. Sollten wir jemals ein Werkzeug einsetzen, das Cookies
          setzt oder Sie verfolgt, fragen wir vorher nach Ihrer Einwilligung.
        </p>
        <h2>Klicks auf Anbieter-Links</h2>
        <p>
          Wenn Sie einen Link zu einem Anbieter anklicken, speichern wir Zeitpunkt, Seite und Schaltfläche, Ihr Land und
          Ihren Gerätetyp sowie einen Einweg-Hash Ihrer IP-Adresse und Browserkennung. Der Hash verwendet einen täglich
          wechselnden Schlüssel, sodass Klicks weder tageübergreifend verknüpft noch Ihnen zugeordnet werden können. Es
          werden keine Cookies verwendet. Rohdaten werden nach 13 Monaten gelöscht; danach behalten wir nur Summen.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
        </p>
        <h2>Newsletter</h2>
        <p>
          Für den Newsletter speichern wir Ihre E-Mail-Adresse und den Zeitpunkt von Anmeldung und Bestätigung
          (Double-Opt-in). Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie jederzeit über
          den Abmeldelink in jeder E-Mail widerrufen können. Der Versand erfolgt über einen E-Mail-Dienstleister in
          unserem Auftrag.
        </p>
        <h2>Meldungen und Nachrichten</h2>
        <p>
          Wenn Sie eine Änderung melden oder uns schreiben, speichern wir Ihre Nachricht und – falls angegeben – Ihre
          E-Mail-Adresse ausschließlich für Rückfragen. Sie können die Löschung jederzeit verlangen.
        </p>
        <h2>Schutz vor Missbrauch</h2>
        <p>
          Formulare (Bewertungen, Meldungen, Newsletter) sind durch Cloudflare Turnstile geschützt. Dabei werden
          technische Merkmale Ihres Browsers an Cloudflare übermittelt, um automatisierte Anfragen zu erkennen.
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.
        </p>
        <h2>Ihre Rechte</h2>
        <p>
          Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit
          und Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Außerdem können Sie sich
          bei einer Datenschutz-Aufsichtsbehörde beschweren. <Link href={href("/contact")}>Kontaktieren Sie uns</Link>{" "}
          oder schreiben Sie an {SITE.contactEmail}.
        </p>
      </Prose>
    );
  }
  return (
    <Prose title={t.pages.privacy} updated={t.pages.lastUpdated("October 2026")}>
      <p>We collect as little as possible and do not sell personal data.</p>
      <h2>Analytics</h2>
      <p>
        We use privacy-friendly, cookieless analytics to count page views, referrers and countries. It sets no cookies,
        stores no personal data and does not track you across sites, so no consent banner is needed. If we ever add a
        tool that sets cookies or tracks you, we will ask for consent first.
      </p>
      <h2>Outbound clicks</h2>
      <p>
        When you click a link to a vendor, we record the time, the page and button you used, your country and device
        type, and a one-way hash of your IP address and browser string. The hash uses a key that changes every day, so
        clicks cannot be linked across days or back to you. No cookies are used. Raw click records are deleted after 13
        months; we keep only aggregate totals after that.
      </p>
      <h2>Reports and messages</h2>
      <p>
        If you report a change or contact us, we keep your message and, if you give it, your email address, only to
        follow up. Ask us at any time to delete it.
      </p>
      <h2>Your rights</h2>
      <p>
        Under the GDPR and similar laws you can ask what we hold about you, and ask us to correct or delete it.{" "}
        <Link href={href("/contact")}>Contact us</Link> or email {SITE.contactEmail}.
      </p>
    </Prose>
  );
}
