import { listCategories } from "@repo/core";
import { getDb } from "@repo/db";
import { Card, CardDescription, CardTitle } from "@repo/ui/card";
import { SITE } from "../lib-site";

// ISR: rebuilt at most every 5 minutes; publishing will also revalidate by tag (FR-WEB-2).
export const revalidate = 300;

export default async function HomePage() {
  const categories = await listCategories(getDb());
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <p className="text-sm font-medium text-brand">Independent, evidence-backed</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Find the right software before you pay for it.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">{SITE.description}</p>
      </section>

      <section aria-labelledby="categories-heading">
        <h2 id="categories-heading" className="text-xl font-semibold">
          Browse by category
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li key={c.id}>
              <Card className="h-full">
                <CardTitle>{c.name}</CardTitle>
                {c.description ? <CardDescription>{c.description}</CardDescription> : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
