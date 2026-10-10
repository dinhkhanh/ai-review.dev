/**
 * UI message catalogue (NFR-14). The app follows the device language: German devices get German
 * UI and German content (`locale=de` on API requests); everything else is English.
 */
export type AppLocale = "en" | "de";

const en = {
  "tabs.home": "Home",
  "tabs.search": "Search",
  "tabs.saved": "Saved",
  "tabs.alerts": "Alerts",
  "home.latest": "Latest reviews",
  "home.categories": "Categories",
  "home.empty": "No reviews yet.",
  "search.placeholder": "Search reviews, comparisons, tools…",
  "search.empty": "No results for “{q}”.",
  "search.hint": "Search by product name, category or what you need.",
  "saved.empty": "Save reviews to read them later. Tap the bookmark on any review.",
  "alerts.title": "Price alerts",
  "alerts.empty": "Follow a product from its review to get a notification when its pricing changes.",
  "alerts.pushOff": "Notifications are off. Turn them on to receive price alerts.",
  "alerts.enable": "Turn on notifications",
  "alerts.lastChange": "Last change: {summary}",
  "alerts.unfollow": "Unfollow",
  "settings.title": "Settings",
  "settings.privacy": "No account needed. This device has an anonymous id; saved items and alerts are stored with it.",
  "settings.delete": "Delete my data",
  "settings.deleteConfirm": "This removes your saved items and price alerts from our servers.",
  "settings.deleted": "Your data was deleted.",
  "review.save": "Save",
  "review.saved": "Saved",
  "review.follow": "Alert me on price changes",
  "review.following": "Price alerts on",
  "review.score": "Score",
  "review.verdict": "Verdict",
  "review.bestFor": "Best for",
  "review.notFor": "Not for",
  "review.pros": "Pros",
  "review.cons": "Cons",
  "review.pricing": "Pricing",
  "review.verified": "Verified {date}",
  "review.sources": "Sources",
  "review.faq": "FAQ",
  "review.visit": "Visit {name}",
  "review.watch": "Watch the video review",
  "review.openWeb": "Open on the web",
  "review.notFound": "This article is not available.",
  "disclosure.affiliate":
    "We may earn a commission when you buy through links in this article. It never affects our ratings.",
  "price.free": "Free",
  "price.custom": "Custom",
  "period.month": "/mo",
  "period.year": "/yr",
  "period.one_time": " once",
  "period.usage": " usage-based",
  "period.custom": "",
  "error.generic": "Something went wrong. Pull to retry.",
  "error.offline": "You appear to be offline.",
  "common.retry": "Retry",
  "common.cancel": "Cancel",
} as const;

export type MessageKey = keyof typeof en;

const de: Record<MessageKey, string> = {
  "tabs.home": "Start",
  "tabs.search": "Suche",
  "tabs.saved": "Gemerkt",
  "tabs.alerts": "Alarme",
  "home.latest": "Neueste Testberichte",
  "home.categories": "Kategorien",
  "home.empty": "Noch keine Testberichte.",
  "search.placeholder": "Testberichte, Vergleiche, Tools suchen…",
  "search.empty": "Keine Ergebnisse für „{q}“.",
  "search.hint": "Suche nach Produktname, Kategorie oder Anwendungsfall.",
  "saved.empty": "Merke dir Testberichte für später. Tippe dazu auf das Lesezeichen.",
  "alerts.title": "Preisalarme",
  "alerts.empty": "Folge einem Produkt in seinem Testbericht, um bei Preisänderungen benachrichtigt zu werden.",
  "alerts.pushOff": "Mitteilungen sind aus. Schalte sie ein, um Preisalarme zu erhalten.",
  "alerts.enable": "Mitteilungen einschalten",
  "alerts.lastChange": "Letzte Änderung: {summary}",
  "alerts.unfollow": "Nicht mehr folgen",
  "settings.title": "Einstellungen",
  "settings.privacy":
    "Kein Konto nötig. Dieses Gerät hat eine anonyme Kennung; Merkliste und Alarme sind daran gebunden.",
  "settings.delete": "Meine Daten löschen",
  "settings.deleteConfirm": "Damit werden deine Merkliste und Preisalarme von unseren Servern gelöscht.",
  "settings.deleted": "Deine Daten wurden gelöscht.",
  "review.save": "Merken",
  "review.saved": "Gemerkt",
  "review.follow": "Bei Preisänderung benachrichtigen",
  "review.following": "Preisalarm aktiv",
  "review.score": "Wertung",
  "review.verdict": "Fazit",
  "review.bestFor": "Ideal für",
  "review.notFor": "Nicht ideal für",
  "review.pros": "Vorteile",
  "review.cons": "Nachteile",
  "review.pricing": "Preise",
  "review.verified": "Geprüft am {date}",
  "review.sources": "Quellen",
  "review.faq": "Häufige Fragen",
  "review.visit": "Zu {name}",
  "review.watch": "Video-Test ansehen",
  "review.openWeb": "Im Web öffnen",
  "review.notFound": "Dieser Artikel ist nicht verfügbar.",
  "disclosure.affiliate":
    "Wir erhalten ggf. eine Provision, wenn du über Links in diesem Artikel kaufst (Werbung). Unsere Bewertungen beeinflusst das nie.",
  "price.free": "Kostenlos",
  "price.custom": "Auf Anfrage",
  "period.month": "/Monat",
  "period.year": "/Jahr",
  "period.one_time": " einmalig",
  "period.usage": " nutzungsbasiert",
  "period.custom": "",
  "error.generic": "Etwas ist schiefgelaufen. Zum Aktualisieren ziehen.",
  "error.offline": "Du bist offenbar offline.",
  "common.retry": "Erneut versuchen",
  "common.cancel": "Abbrechen",
};

const CATALOGUES: Record<AppLocale, Record<MessageKey, string>> = { en, de };

/** Picks the app locale from the device's preferred language tags (e.g. ["de-AT", "en-US"]). */
export function pickLocale(languageTags: ReadonlyArray<string | null | undefined>): AppLocale {
  const first = languageTags.find((t) => !!t)?.toLowerCase() ?? "en";
  return first.startsWith("de") ? "de" : "en";
}

export function translate(locale: AppLocale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const template = CATALOGUES[locale][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function formatDate(iso: string | null | undefined, locale: AppLocale): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale === "de" ? "de-DE" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];
export const catalogue = (locale: AppLocale) => CATALOGUES[locale];
