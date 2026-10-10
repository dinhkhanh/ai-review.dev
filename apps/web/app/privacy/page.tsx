import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "../../components/prose";
import { SITE } from "../../lib/site";

export const metadata: Metadata = { title: "Privacy policy", description: `What data ${SITE.name} collects and why.` };

export default function PrivacyPage() {
  return (
    <Prose title="Privacy policy" updated="October 2026">
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
        <Link href="/contact">Contact us</Link> or email {SITE.contactEmail}.
      </p>
    </Prose>
  );
}
