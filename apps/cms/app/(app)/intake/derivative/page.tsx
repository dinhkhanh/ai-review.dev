import { listCategories, listResearchedProducts } from "@repo/core";
import { getDb } from "@repo/db";
import { PageHeader } from "../../../../components/ui";
import { IntakeTabs } from "../bulk/page";
import { DerivativeForm } from "./derivative-form";

export const metadata = { title: "Comparison or list" };

export default async function DerivativeIntakePage() {
  const db = getDb();
  const [products, categories] = await Promise.all([listResearchedProducts(db), listCategories(db)]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="New review"
        subtitle="Comparisons, alternatives and best-of lists are written from products we have already researched (FR-CON-8)."
      />
      <IntakeTabs active="derivative" />
      <DerivativeForm
        categories={categories}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          categoryName: p.categoryName,
          factSheetAt: p.factSheetAt.toISOString(),
        }))}
      />
    </div>
  );
}
