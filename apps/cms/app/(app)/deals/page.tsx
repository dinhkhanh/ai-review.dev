import { listDeals, listProducts } from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, PageHeader, StatusBadge, Table } from "../../../components/ui";
import { deleteDealAction, suggestDealsAction, toggleDealAction } from "./actions";
import { DealForm } from "./deal-form";

export const metadata = { title: "Deals" };

const select = "h-10 rounded-md border border-border bg-bg px-2 text-sm";

/** Deals and coupons (FR-WEB-8): shown on /deals and on review pages while active. */
export default async function DealsPage() {
  const db = getDb();
  const [rows, products] = await Promise.all([listDeals(db), listProducts(db, { limit: 200 })]);
  const productOptions = products.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  const now = new Date();
  return (
    <div className="space-y-8">
      <PageHeader
        title="Deals"
        subtitle="Promo codes, trials and guarantees. Active deals in their date window appear on /deals and the product's review."
      />

      <section className="rounded-lg border border-border bg-bg p-4">
        <h2 className="font-semibold">Suggest from fact sheet</h2>
        <p className="mt-1 text-sm text-muted">
          Creates inactive drafts from the latest fact sheet (free trial, free plan, money-back) and promo codes in
          affiliate program notes.
        </p>
        <ActionForm action={suggestDealsAction} className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="suggest-product" className="sr-only">
            Product
          </label>
          <select id="suggest-product" name="productId" required className={select} defaultValue="">
            <option value="">Choose a product…</option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <SubmitButton variant="secondary">Suggest deals</SubmitButton>
        </ActionForm>
      </section>

      <section className="rounded-lg border border-border bg-bg p-4">
        <h2 className="font-semibold">Add a deal</h2>
        <div className="mt-3">
          <DealForm products={productOptions} />
        </div>
      </section>

      {rows.length === 0 ? (
        <Empty>No deals yet.</Empty>
      ) : (
        <Table head={["Product", "Deal", "Code", "Window", "Source", "Status", ""]}>
          {rows.map(({ deal, productName }) => {
            const expired = !!deal.endsAt && deal.endsAt <= now;
            const status = expired ? "expired" : deal.active ? "active" : "paused";
            return (
              <tr key={deal.id} className="border-t border-border align-top">
                <td className="p-3">
                  <Link href={`/products/${deal.productId}`} className="hover:underline">
                    {productName}
                  </Link>
                </td>
                <td className="max-w-sm p-3">
                  <p className="font-medium">{deal.title}</p>
                  {deal.discountText ? <p className="text-xs text-muted">{deal.discountText}</p> : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-brand">Edit</summary>
                    <div className="mt-2 w-[min(80vw,48rem)]">
                      <DealForm deal={deal} products={productOptions} />
                    </div>
                  </details>
                </td>
                <td className="p-3 font-mono text-xs">{deal.code ?? "—"}</td>
                <td className="p-3 text-xs tabular-nums">
                  {deal.startsAt ? fmtDate(deal.startsAt).slice(0, 10) : "now"} →{" "}
                  {deal.endsAt ? fmtDate(deal.endsAt).slice(0, 10) : "open"}
                </td>
                <td className="p-3 text-xs">{deal.source.replace("_", " ")}</td>
                <td className="p-3">
                  <StatusBadge status={status} />
                </td>
                <td className="p-3">
                  <div className="flex flex-col gap-1">
                    <form action={toggleDealAction}>
                      <input type="hidden" name="dealId" value={deal.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {deal.active ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                    <form action={deleteDealAction}>
                      <input type="hidden" name="dealId" value={deal.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-danger">
                        Delete
                      </Button>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
