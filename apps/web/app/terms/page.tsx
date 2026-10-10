import type { Metadata } from "next";
import { Prose } from "../../components/prose";
import { SITE } from "../../lib/site";

export const metadata: Metadata = {
  title: "Terms and trademarks",
  description: `Terms of use and trademark notice for ${SITE.name}.`,
};

export default function TermsPage() {
  return (
    <Prose title="Terms and trademarks" updated="October 2026">
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
