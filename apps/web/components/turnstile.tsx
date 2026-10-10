import Script from "next/script";

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile widget (FR-API-3, NFR-7) for public forms. The script adds a hidden
 * `cf-turnstile-response` field to the surrounding form. Renders nothing when no site key is set.
 */
export function Turnstile({ size = "flexible" }: { size?: "normal" | "compact" | "flexible" }) {
  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-size={size} data-appearance="interaction-only" />
    </>
  );
}

export const turnstileEnabled = () => !!siteKey;
