import {
  getHandsOnPolicy,
  getSetting,
  listHandsOnProducts,
  listHandsOnSessions,
  listSecrets,
  TEST_IDENTITY_SECRET,
  vaultEnabled,
} from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { duration, Empty, fmtDate, Notice, PageHeader, StatusBadge, Table, usd } from "../../../components/ui";
import { requireUser } from "../../../lib/auth";
import { setGlobalSwitchAction, setOptInAction, startSessionAction } from "./actions";
import { stopReasonLabel } from "./labels";

export const metadata = { title: "Hands-on trials" };

/**
 * Hands-on trials (FR-RES-7): the browser agent signs up for a free plan or trial with the test
 * identity and records what it sees. Needs the global switch, a per-product opt-in and the vault.
 */
export default async function HandsOnPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const db = getDb();
  const [globalOn, policy, productRows, sessions, secrets] = await Promise.all([
    getSetting(db, "pipeline.handsOnTrials"),
    getHandsOnPolicy(db),
    listHandsOnProducts(db),
    listHandsOnSessions(db, { limit: 100 }),
    listSecrets(db),
  ]);
  const vaultOn = vaultEnabled();
  const identity = secrets.some((s) => s.name === TEST_IDENTITY_SECRET);
  const inboxDomain = process.env.HANDS_ON_INBOX_DOMAIN?.trim() || null;
  const lastByProduct = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) if (!lastByProduct.has(s.productId)) lastByProduct.set(s.productId, s);
  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hands-on trials"
        subtitle={
          <>
            A browser agent signs up for a product&apos;s free plan or trial with our test identity, uses it briefly and
            saves screenshots and notes as a first-party source. It never enters payment details, solves CAPTCHAs or
            gives a phone number. Limits: {policy.maxSteps} steps, {usd.format(policy.maxCostUsd)}, {policy.maxMinutes}{" "}
            minutes per session (
            <Link href="/settings" className="underline">
              handsOn.policy
            </Link>
            ).
          </>
        }
      />
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">Global switch</p>
          <p className="mt-1 text-muted">
            {globalOn ? "On: opted-in products get a trial in full reviews." : "Off: no trials run."}
          </p>
          {isAdmin ? (
            <form action={setGlobalSwitchAction} className="mt-2">
              <input type="hidden" name="on" value={globalOn ? "false" : "true"} />
              <SubmitButton size="sm" variant={globalOn ? "secondary" : "primary"} pendingLabel="Saving…">
                {globalOn ? "Turn off" : "Turn on"}
              </SubmitButton>
            </form>
          ) : null}
        </div>
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">Vault and test identity</p>
          <p className="mt-1 text-muted">
            {!vaultOn ? "VAULT_KEY is not set." : identity ? "Test identity stored." : "No test identity yet."}
          </p>
          {isAdmin ? (
            <Link href="/vault" className="mt-2 inline-block text-brand hover:underline">
              Open vault
            </Link>
          ) : null}
        </div>
        <div className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">Verification inbox</p>
          <p className="mt-1 text-muted">
            {inboxDomain
              ? `Sign-ups use fresh addresses on ${inboxDomain}, read through Resend.`
              : "HANDS_ON_INBOX_DOMAIN is not set: sessions stop at email verification."}
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Products</h2>
        <p className="text-sm text-muted">
          Opt a product in only when its terms allow automated sign-ups for evaluation. A full review of an opted-in
          product runs a trial before research is extracted.
        </p>
        {productRows.length === 0 ? (
          <Empty>No products yet.</Empty>
        ) : (
          <Table head={["Product", "Opt-in", "Last session", ""]}>
            {productRows.map((p) => {
              const last = lastByProduct.get(p.id);
              return (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="p-3">
                    <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted">{p.websiteUrl}</div>
                  </td>
                  <td className="p-3">
                    <form action={setOptInAction}>
                      <input type="hidden" name="productId" value={p.id} />
                      <input type="hidden" name="optIn" value={p.handsOnOptIn ? "false" : "true"} />
                      <Button type="submit" size="sm" variant={p.handsOnOptIn ? "secondary" : "ghost"}>
                        {p.handsOnOptIn ? "Opted in · turn off" : "Opt in"}
                      </Button>
                    </form>
                  </td>
                  <td className="p-3">
                    {last ? (
                      <Link href={`/hands-on/${last.id}`} className="hover:underline">
                        <StatusBadge status={last.status} /> <span className="text-xs">{fmtDate(last.createdAt)}</span>
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {p.handsOnOptIn ? (
                      <ActionForm action={startSessionAction}>
                        <input type="hidden" name="productId" value={p.id} />
                        <SubmitButton size="sm" pendingLabel="Starting…" disabled={!globalOn || !vaultOn || !identity}>
                          Start session
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sessions</h2>
        {sessions.length === 0 ? (
          <Empty>No sessions yet.</Empty>
        ) : (
          <Table head={["Started", "Product", "Status", "Stopped because", "Screens", "Duration", "Cost"]}>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-3 tabular-nums">
                  <Link href={`/hands-on/${s.id}`} className="text-brand hover:underline">
                    {fmtDate(s.startedAt ?? s.createdAt)}
                  </Link>
                </td>
                <td className="p-3">{s.productName}</td>
                <td className="p-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="p-3 text-xs">{stopReasonLabel(s.stopReason) ?? "—"}</td>
                <td className="p-3 tabular-nums">{s.screenshots.length}</td>
                <td className="p-3 tabular-nums">{duration(s.startedAt, s.finishedAt)}</td>
                <td className="p-3 tabular-nums">{usd.format(Number(s.costUsd))}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
