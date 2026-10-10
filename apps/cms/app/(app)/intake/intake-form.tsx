"use client";

import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Notice } from "../../../components/ui";
import { SubmitButton } from "../../../components/submit-button";
import { findCandidates, submitIntake, type IntakeState } from "./actions";

export function IntakeForm({ categories }: { categories: Array<{ slug: string; name: string }> }) {
  const [state, formAction] = useActionState<IntakeState, FormData>(submitIntake, { kind: "idle" });
  const [lookup, setLookup] = useState<IntakeState>({ kind: "idle" });
  const [searching, startSearch] = useTransition();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const shown = state.kind !== "idle" ? state : lookup;

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Product name</Label>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Notion"
          />
        </div>
        <div>
          <Label htmlFor="url">Website URL</Label>
          <Input
            id="url"
            name="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://notion.so"
          />
        </div>
      </div>
      {!url && name ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={searching}
          onClick={() => startSearch(async () => setLookup(await findCandidates(name)))}
        >
          {searching ? "Searching…" : "Find the official site"}
        </Button>
      ) : null}

      {shown.kind === "candidates" ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Which one did you mean?</legend>
          {shown.candidates.map((c) => (
            <button
              key={c.url}
              type="button"
              onClick={() => {
                setUrl(c.url);
                setLookup({ kind: "idle" });
              }}
              className="block w-full rounded-md border border-border p-3 text-left text-sm hover:border-brand"
            >
              <span className="font-medium">{c.name}</span> <span className="text-muted">{c.url}</span>
              {c.description ? <span className="mt-1 block text-xs text-muted">{c.description}</span> : null}
            </button>
          ))}
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="categorySlug">Category</Label>
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
          <Label htmlFor="preset">Preset</Label>
          <select id="preset" name="preset" className="h-10 w-full rounded-md border border-border bg-bg px-3 text-sm">
            <option value="quick_review">Quick review (no video)</option>
            <option value="full_review">Full review (video arrives in phase 2)</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="angle">Review angle (optional)</Label>
        <Input id="angle" name="angle" placeholder="e.g. for freelancers" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="keywords">Target keywords (comma-separated)</Label>
          <Input id="keywords" name="keywords" placeholder="notion review, notion pricing" />
        </div>
        <div>
          <Label htmlFor="competitors">Competitors to compare (comma-separated)</Label>
          <Input id="competitors" name="competitors" placeholder="Coda, Obsidian" />
        </div>
      </div>
      <div className="max-w-48">
        <Label htmlFor="costCeilingUsd">Cost ceiling, USD (optional)</Label>
        <Input id="costCeilingUsd" name="costCeilingUsd" type="number" step="0.5" min="0" placeholder="5" />
      </div>

      {shown.kind === "error" ? <Notice tone="error">{shown.message}</Notice> : null}
      {state.kind === "duplicate" ? (
        <div className="space-y-3 rounded-md border border-warning/40 bg-warning/10 p-4 text-sm">
          <p>
            <strong>{state.product.name}</strong> ({state.product.domain}) already exists
            {state.article ? ` with a ${state.article.status.replace(/_/g, " ")} review` : ""}. Refresh it instead of
            creating a duplicate?
          </p>
          <div className="flex gap-2">
            <input type="hidden" name="confirmRefresh" value="1" />
            <SubmitButton size="sm" pendingLabel="Starting…">
              Refresh existing review
            </SubmitButton>
            <Link
              href={`/products/${state.product.id}`}
              className="inline-flex h-8 items-center px-3 text-sm underline"
            >
              Open product
            </Link>
          </div>
        </div>
      ) : (
        <SubmitButton pendingLabel="Starting…">Start review</SubmitButton>
      )}
    </form>
  );
}
