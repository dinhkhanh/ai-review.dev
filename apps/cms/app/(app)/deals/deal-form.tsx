import type { deals } from "@repo/db";
import { Input, Label } from "@repo/ui/input";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { saveDealAction } from "./actions";

type Deal = typeof deals.$inferSelect;
const select = "h-10 w-full rounded-md border border-border bg-bg px-2 text-sm";
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

/** Create or edit a deal (FR-WEB-8). */
export function DealForm({ deal, products }: { deal?: Deal; products: Array<{ id: string; name: string }> }) {
  return (
    <ActionForm action={saveDealAction} className="grid gap-3 sm:grid-cols-4">
      {deal ? <input type="hidden" name="dealId" value={deal.id} /> : null}
      <div className="sm:col-span-2">
        <Label htmlFor={`product-${deal?.id ?? "new"}`}>Product</Label>
        <select
          id={`product-${deal?.id ?? "new"}`}
          name="productId"
          defaultValue={deal?.productId ?? ""}
          required
          className={select}
        >
          <option value="">Choose…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label>Title</Label>
        <Input
          name="title"
          defaultValue={deal?.title ?? ""}
          required
          maxLength={140}
          placeholder="Acme: 20% off yearly plans"
        />
      </div>
      <div>
        <Label>Badge text</Label>
        <Input name="discountText" defaultValue={deal?.discountText ?? ""} maxLength={60} placeholder="20% off" />
      </div>
      <div>
        <Label>Promo code</Label>
        <Input name="code" defaultValue={deal?.code ?? ""} maxLength={60} />
      </div>
      <div>
        <Label>Starts</Label>
        <Input name="startsAt" type="date" defaultValue={day(deal?.startsAt)} />
      </div>
      <div>
        <Label>Ends</Label>
        <Input name="endsAt" type="date" defaultValue={day(deal?.endsAt)} />
      </div>
      <div className="sm:col-span-3">
        <Label>Description</Label>
        <Input name="description" defaultValue={deal?.description ?? ""} maxLength={1000} />
      </div>
      <div>
        <Label>Position</Label>
        <Input name="position" type="number" defaultValue={deal?.position ?? 0} />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-3">
        <input type="checkbox" name="active" defaultChecked={deal?.active ?? true} /> Active (shown on the site)
      </label>
      <div className="flex justify-end">
        <SubmitButton>{deal ? "Save" : "Add deal"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
