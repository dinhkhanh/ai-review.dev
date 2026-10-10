import type { ReactNode } from "react";

/** Long-form text pages (policies). Reading width ~720px (SRS §4.1). */
export function Prose({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {updated ? <p className="mt-2 text-sm text-muted">Last updated {updated}</p> : null}
      <div className="mt-8 space-y-4 leading-7 [&_a]:text-brand [&_a]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </div>
  );
}
