import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "../../components/prose";
import { SITE } from "../../lib/site";

export const metadata: Metadata = { title: "Contact", description: `Contact the ${SITE.name} editor.` };

export default function ContactPage() {
  return (
    <Prose title="Contact">
      <p>
        Email the editor at <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>
      <p>
        Spotted outdated pricing or a mistake in a review? The quickest route is the{" "}
        <Link href="/report">report a change</Link> form, which goes straight to our review queue.
      </p>
      <p>Vendors: we do not accept payment for reviews or placement, but we welcome corrections with a source.</p>
    </Prose>
  );
}
