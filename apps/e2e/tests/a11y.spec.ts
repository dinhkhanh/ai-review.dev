import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { E2E } from "../src/fixtures";

/** FR-WEB-12: WCAG 2.1 AA on the public site. Serious and critical violations fail the run. */
const PAGES = [
  { name: "home", path: "/" },
  { name: "category", path: `/categories/${E2E.category}` },
  { name: "review (en)", path: `/reviews/${E2E.acme.reviewSlug}` },
  { name: "review (de)", path: "/de/reviews/acme-tracker-test-2026-preise-funktionen-vor-und-nachteile" },
  { name: "search", path: "/search?q=acme" },
  { name: "deals", path: "/deals" },
  { name: "newsletter thanks", path: "/newsletter/thanks" },
  { name: "comparison", path: `/compare/${E2E.comparisonSlug}` },
  { name: "report", path: `/report?article=${E2E.acme.reviewSlug}` },
];

for (const { name, path } of PAGES) {
  test(`a11y: ${name}`, async ({ page }, info) => {
    const res = await page.goto(path);
    expect(res?.ok(), `${path} responds`).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    if (results.violations.length) {
      await info.attach("axe-violations.json", {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });
    }
    const summary = blocking.map(
      (v) => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  });
}
