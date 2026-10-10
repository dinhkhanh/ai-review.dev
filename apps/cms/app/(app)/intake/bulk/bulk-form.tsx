"use client";

import { Input, Label } from "@repo/ui/input";
import { useActionState } from "react";
import { SubmitButton } from "../../../../components/submit-button";
import { Notice } from "../../../../components/ui";
import { submitBulkIntake, type BulkState } from "./actions";

export function BulkForm({ categories }: { categories: Array<{ slug: string; name: string }> }) {
  const [state, action] = useActionState<BulkState, FormData>(submitBulkIntake, null);
  return (
    <form action={action} className="max-w-3xl space-y-4">
      <div>
        <Label htmlFor="list">Products</Label>
        <textarea
          id="list"
          name="list"
          required
          rows={12}
          className="w-full rounded-md border border-border bg-bg p-3 font-mono text-sm"
          placeholder={
            "One per line: URL, or name and URL\nnotion.so\nLinear, linear.app\n\nor CSV with a header:\nurl,name,category,angle\nplausible.io,Plausible,marketing,for privacy-minded sites"
          }
        />
        <p className="mt-1 text-xs text-muted">Up to 100 products. Lines starting with # are ignored.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="preset">Preset</Label>
          <select id="preset" name="preset" className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm">
            <option value="quick_review">Quick review</option>
            <option value="full_review">Full review</option>
          </select>
        </div>
        <div>
          <Label htmlFor="categorySlug">Default category</Label>
          <select
            id="categorySlug"
            name="categorySlug"
            className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm"
          >
            <option value="">Detect automatically</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="costCeilingUsd">Cost ceiling per job (USD)</Label>
          <Input id="costCeilingUsd" name="costCeilingUsd" type="number" step="0.5" min="0" placeholder="default" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="refreshExisting" value="1" /> Refresh products we already have (otherwise they are
        skipped)
      </label>
      {state && !state.ok ? <Notice tone="error">{state.message}</Notice> : null}
      <SubmitButton>Create jobs</SubmitButton>
    </form>
  );
}
