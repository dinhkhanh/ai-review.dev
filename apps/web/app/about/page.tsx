import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "../../components/prose";
import { SITE } from "../../lib/site";

export const metadata: Metadata = { title: "About us", description: `Who runs ${SITE.name} and why.` };

export default function AboutPage() {
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
        <Link href="/editorial-policy">editorial policy</Link>.
      </p>
      <h2>How we make money</h2>
      <p>
        Some links are affiliate links: if you buy, the vendor may pay us a commission at no extra cost to you. Vendors
        cannot buy reviews, scores or placement. See our <Link href="/affiliate-disclosure">affiliate disclosure</Link>.
      </p>
      <p>
        Questions or corrections? <Link href="/contact">Contact us</Link>.
      </p>
    </Prose>
  );
}
