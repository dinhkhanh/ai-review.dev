import { listCategories } from "@repo/core";
import { getDb } from "@repo/db";
import { PageHeader } from "../../../components/ui";
import { IntakeForm } from "./intake-form";

export const metadata = { title: "New review" };

export default async function IntakePage() {
  const categories = await listCategories(getDb());
  return (
    <div className="space-y-6">
      <PageHeader
        title="New review"
        subtitle="Give a URL (or a name and pick the official site). The pipeline researches, writes, fact-checks and queues the article for your review."
      />
      <IntakeForm categories={categories} />
    </div>
  );
}
