"use client";

import { useState, type FormEvent, type ReactNode } from "react";

/**
 * "Was this helpful?" (FR-WEB-10). A plain form POST to /api/vote works without JavaScript; with JS
 * the vote is sent with fetch and the thanks message replaces the buttons in place.
 */
export function HelpfulVote({
  articleSlug,
  returnTo,
  children,
}: {
  articleSlug: string;
  returnTo: string;
  children?: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(form);
    if (submitter?.name) data.set(submitter.name, submitter.value);
    setState("sending");
    try {
      const res = await fetch("/api/vote", { method: "POST", body: data, headers: { Accept: "application/json" } });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }
  if (state === "done") {
    return (
      <p role="status" className="text-sm">
        Thanks for the feedback.
      </p>
    );
  }
  const btn =
    "inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-surface disabled:opacity-50";
  return (
    <form action="/api/vote" method="post" onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="article" value={articleSlug} />
      <input type="hidden" name="return" value={returnTo} />
      <span id="helpful-label" className="text-sm font-medium">
        Was this review helpful?
      </span>
      <div role="group" aria-labelledby="helpful-label" className="flex gap-2">
        <button name="helpful" value="yes" className={btn} disabled={state === "sending"}>
          Yes
        </button>
        <button name="helpful" value="no" className={btn} disabled={state === "sending"}>
          No
        </button>
      </div>
      {children}
      {state === "error" ? (
        <p role="alert" className="w-full text-sm text-danger">
          Could not record your vote. Please try again later.
        </p>
      ) : null}
    </form>
  );
}
