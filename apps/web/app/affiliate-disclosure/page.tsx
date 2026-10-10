import type { Metadata } from "next";
import { Prose } from "../../components/prose";
import { SITE } from "../../lib/site";

export const metadata: Metadata = {
  title: "Affiliate disclosure",
  description: `How ${SITE.name} makes money and how affiliate links work.`,
};

export default function AffiliateDisclosurePage() {
  return (
    <Prose title="Affiliate disclosure" updated="October 2026">
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
