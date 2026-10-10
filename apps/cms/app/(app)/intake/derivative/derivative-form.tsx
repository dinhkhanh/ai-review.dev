"use client";

import { Input, Label } from "@repo/ui/input";
import { useActionState, useState } from "react";
import { SubmitButton } from "../../../../components/submit-button";
import { Notice } from "../../../../components/ui";
import { submitDerivative, type DerivativeState } from "./actions";

type Product = { id: string; name: string; categoryName: string | null; factSheetAt: string };

const KINDS = [
  { value: "comparison", label: "Comparison (A vs B)", hint: "Pick 2–3 products." },
  {
    value: "alternatives",
    label: "Alternatives to a product",
    hint: "Pick the reference product; others default to its researched competitors.",
  },
  {
    value: "best_of",
    label: "Best-of list",
    hint: "Pick a category (top-scored researched products are used) or 3–10 products.",
  },
] as const;

export function DerivativeForm({
  products,
  categories,
}: {
  products: Product[];
  categories: Array<{ slug: string; name: string }>;
}) {
  const [state, action] = useActionState<DerivativeState, FormData>(submitDerivative, null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("comparison");
  const [filter, setFilter] = useState("");
  const shown = products.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <form action={action} className="max-w-3xl space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">Article type</legend>
        {KINDS.map((k) => (
          <label key={k.value} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="kind"
              value={k.value}
              checked={kind === k.value}
              onChange={() => setKind(k.value)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{k.label}</span> <span className="text-muted">{k.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "alternatives" ? (
        <div>
          <Label htmlFor="referenceProductId">Alternatives to</Label>
          <select
            id="referenceProductId"
            name="referenceProductId"
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
          >
            <option value="">Choose a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {kind === "best_of" ? (
        <div>
          <Label htmlFor="categorySlug">Category</Label>
          <select
            id="categorySlug"
            name="categorySlug"
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <Label htmlFor="filter">
          Products{" "}
          {kind === "alternatives" ? "(optional: the alternatives to cover)" : kind === "best_of" ? "(optional)" : ""}
        </Label>
        <Input id="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" />
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
          {shown.map((p) => (
            <li key={p.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="productIds" value={p.id} />
                <span>{p.name}</span>
                <span className="text-xs text-muted">
                  {p.categoryName ?? "uncategorised"} · researched {p.factSheetAt.slice(0, 10)}
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 ? <li className="text-muted">No researched products match.</li> : null}
        </ul>
        <p className="mt-1 text-xs text-muted">
          Only products with a fact sheet appear. Research others first with a single review or bulk intake.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="angle">Angle (optional)</Label>
          <Input id="angle" name="angle" placeholder="e.g. for small agencies" />
        </div>
        <div>
          <Label htmlFor="keywords">Target keywords (optional)</Label>
          <Input id="keywords" name="keywords" placeholder="comma separated" />
        </div>
        <div>
          <Label htmlFor="costCeilingUsd">Cost ceiling (USD)</Label>
          <Input id="costCeilingUsd" name="costCeilingUsd" type="number" step="0.5" min="0" placeholder="default" />
        </div>
      </div>
      {state && !state.ok ? <Notice tone="error">{state.message}</Notice> : null}
      <SubmitButton>Create article job</SubmitButton>
    </form>
  );
}
