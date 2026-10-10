/**
 * Reads verification emails for hands-on sign-ups (FR-RES-7) from Resend's receiving API:
 * GET /emails/receiving lists received emails (newest first), GET /emails/receiving/:id returns the
 * body. The inbox domain (HANDS_ON_INBOX_DOMAIN) must point its MX records at Resend.
 */

export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  receivedAt: Date;
  text: string;
  /** Links found in the body, verification-looking ones first. */
  links: Array<{ url: string; label: string }>;
  /** Likely one-time codes (4–8 characters) found near "code"/"verify" wording. */
  codes: string[];
}

export interface Inbox {
  /** Waits for the first email to `to` received at or after `since`, skipping ids in `seen`. */
  waitFor(opts: {
    to: string;
    since: Date;
    seen?: Set<string>;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<InboxMessage | null>;
}

interface ListedEmail {
  id: string;
  to?: string[];
  from?: string;
  subject?: string;
  created_at?: string;
}

const RESEND_API = "https://api.resend.com";

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const VERIFY_WORDS = /(verify|verification|confirm|activate|magic|sign.?in|log.?in|get started|complete)/i;
const SKIP_LINK =
  /(unsubscribe|preferences|privacy|terms|help|support|twitter|facebook|linkedin|instagram|youtube|mailto:)/i;

/** Pulls links and one-time codes out of an email body. */
export function parseVerificationEmail(input: { html?: string | null; text?: string | null }): {
  text: string;
  links: Array<{ url: string; label: string }>;
  codes: string[];
} {
  const html = input.html ?? "";
  const text = input.text?.trim() || htmlToText(html);
  const links: Array<{ url: string; label: string }> = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = m[1]!.replace(/&amp;/g, "&");
    if (!/^https?:/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label: htmlToText(m[2]!).slice(0, 80) });
  }
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    links.push({ url: m[0], label: "" });
  }
  const useful = links.filter((l) => !SKIP_LINK.test(`${l.url} ${l.label}`));
  useful.sort(
    (a, b) => Number(VERIFY_WORDS.test(`${b.label} ${b.url}`)) - Number(VERIFY_WORDS.test(`${a.label} ${a.url}`)),
  );

  const codes = new Set<string>();
  for (const m of text.matchAll(
    /(?:code|verification|verify|one.?time|otp|pin)[^\n\d]{0,40}?\b(?=[A-Z0-9]*\d)([A-Z0-9]{4,8})\b/gi,
  )) {
    codes.add(m[1]!);
  }
  // A standalone 6-digit line is the most common format.
  for (const m of text.matchAll(/^\s*(\d{6})\s*$/gm)) codes.add(m[1]!);
  return { text: text.slice(0, 4000), links: useful.slice(0, 10), codes: [...codes].slice(0, 5) };
}

/** Resend-backed inbox. */
export function createResendInbox(opts: { apiKey: string; fetch?: typeof fetch; now?: () => number }): Inbox {
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const headers = { Authorization: `Bearer ${opts.apiKey}` };

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${RESEND_API}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Resend receiving API ${path.split("?")[0]}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async waitFor({ to, since, seen, timeoutMs = 120_000, pollMs = 5_000 }) {
      const deadline = now() + timeoutMs;
      const target = to.toLowerCase();
      for (;;) {
        const list = await getJson<{ data?: ListedEmail[] }>("/emails/receiving?limit=50");
        const match = (list.data ?? [])
          .filter((e) => (e.to ?? []).some((addr) => addr.toLowerCase().includes(target)))
          .filter((e) => !seen?.has(e.id))
          .filter((e) => !e.created_at || new Date(e.created_at).getTime() >= since.getTime() - 60_000)
          .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())[0];
        if (match) {
          const full = await getJson<{
            html?: string | null;
            text?: string | null;
            from?: string;
            subject?: string;
            created_at?: string;
          }>(`/emails/receiving/${encodeURIComponent(match.id)}`);
          const parsed = parseVerificationEmail(full);
          return {
            id: match.id,
            from: full.from ?? match.from ?? "",
            subject: full.subject ?? match.subject ?? "",
            receivedAt: new Date(full.created_at ?? match.created_at ?? now()),
            ...parsed,
          };
        }
        if (now() + pollMs > deadline) return null;
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
