import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "../../components/prose";

export const metadata: Metadata = {
  title: "Editorial policy",
  description: "How we research, fact-check, score and update our software reviews, and how we use AI.",
};

export default function EditorialPolicyPage() {
  return (
    <Prose title="Editorial policy" updated="October 2026">
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
        <Link href="/affiliate-disclosure">affiliate disclosure</Link>). Commissions never change scores or verdicts,
        and we review products whether or not they have an affiliate program.
      </p>
      <h2>Updates and corrections</h2>
      <p>
        We re-check reviews regularly and whenever prices change. If you spot something out of date, use the “Report a
        change” link under any pricing table or <Link href="/contact">contact us</Link>.
      </p>
    </Prose>
  );
}
