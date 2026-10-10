import { listHandsOnProducts, listSecrets, TEST_IDENTITY_SECRET, vaultEnabled, vaultKeyringFromEnv } from "@repo/core";
import { getDb } from "@repo/db";
import { Button } from "@repo/ui/button";
import { Input, Label } from "@repo/ui/input";
import { ActionForm } from "../../../components/action-form";
import { SubmitButton } from "../../../components/submit-button";
import { Empty, fmtDate, Notice, PageHeader, Table } from "../../../components/ui";
import { requireUser } from "../../../lib/auth";
import { deleteSecretAction, rotateVaultAction, saveProductCredentialAction, saveTestIdentityAction } from "./actions";

export const metadata = { title: "Vault" };

function keyVersion() {
  try {
    return vaultKeyringFromEnv()?.current.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Credential vault (FR-RES-7), admins only. Values are encrypted with VAULT_KEY and are write-only
 * here: the CMS shows names and dates, never the stored values.
 */
export default async function VaultPage() {
  await requireUser({ roles: ["admin"] });
  const db = getDb();
  const [secrets, productRows] = await Promise.all([listSecrets(db), listHandsOnProducts(db)]);
  const enabled = vaultEnabled();
  const version = keyVersion();
  const identity = secrets.find((s) => s.name === TEST_IDENTITY_SECRET);
  const inboxDomain = process.env.HANDS_ON_INBOX_DOMAIN?.trim() || null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vault"
        subtitle="Encrypted credentials for hands-on trials. Values are write-only: replace them here, they are never shown again."
        actions={
          enabled ? (
            <ActionForm action={rotateVaultAction}>
              <SubmitButton size="sm" variant="secondary" pendingLabel="Re-encrypting…">
                Re-encrypt with current key
              </SubmitButton>
            </ActionForm>
          ) : null
        }
      />
      {!enabled ? (
        <Notice tone="error">
          The vault is disabled. Set VAULT_KEY to 32 random bytes, base64 encoded (<code>openssl rand -base64 32</code>
          ), on the CMS and the worker. To rotate, set it to <code>2:&lt;new&gt;,1:&lt;old&gt;</code> and re-encrypt.
        </Notice>
      ) : (
        <p className="text-sm text-muted">Encrypting with key version {version}.</p>
      )}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Test identity</h2>
        <p className="text-sm text-muted">
          The persona used for sign-ups. {identity ? `Last saved ${fmtDate(identity.updatedAt)}.` : "Not set yet."}{" "}
          {inboxDomain
            ? `Each session signs up with a fresh address on ${inboxDomain}; the email below is not used.`
            : "Without HANDS_ON_INBOX_DOMAIN, sessions sign up with the email below and cannot read verification mail."}{" "}
          Use a name that is clearly a test persona and a password used nowhere else.
        </p>
        <ActionForm action={saveTestIdentityAction} className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="v-name">Name</Label>
            <Input id="v-name" name="name" required placeholder="Ada Tester" autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="v-company">Company (optional)</Label>
            <Input id="v-company" name="company" placeholder="AI Review" autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="v-email">Email (optional)</Label>
            <Input id="v-email" name="email" type="email" autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="v-password">Password (12+ characters)</Label>
            <Input
              id="v-password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </div>
          <div className="sm:col-span-2">
            <SubmitButton disabled={!enabled} pendingLabel="Saving…">
              {identity ? "Replace test identity" : "Save test identity"}
            </SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Product logins</h2>
        <p className="text-sm text-muted">
          An existing account for one product (for example one the vendor gave us). The agent can sign in with it
          instead of signing up.
        </p>
        <ActionForm action={saveProductCredentialAction} className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="c-product">Product</Label>
            <select
              id="c-product"
              name="productId"
              required
              className="h-10 w-full rounded-md border border-border bg-bg px-2 text-sm"
            >
              <option value="">—</option>
              {productRows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="c-user">Username or email</Label>
            <Input id="c-user" name="username" required autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="c-password">Password</Label>
            <Input id="c-password" name="password" type="password" required autoComplete="new-password" />
          </div>
          <div className="sm:col-span-3">
            <SubmitButton disabled={!enabled} pendingLabel="Saving…">
              Save login
            </SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Entries</h2>
        {secrets.length === 0 ? (
          <Empty>The vault is empty.</Empty>
        ) : (
          <Table head={["Name", "Kind", "Product", "Key", "Last used", "Updated", ""]}>
            {secrets.map((s) => (
              <tr key={s.id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{s.name}</td>
                <td className="p-3">{s.kind.replace("_", " ")}</td>
                <td className="p-3">{s.productName ?? "—"}</td>
                <td className="p-3 tabular-nums">v{s.keyVersion}</td>
                <td className="p-3 tabular-nums">{fmtDate(s.lastUsedAt)}</td>
                <td className="p-3 tabular-nums">{fmtDate(s.updatedAt)}</td>
                <td className="p-3 text-right">
                  <form action={deleteSecretAction}>
                    <input type="hidden" name="name" value={s.name} />
                    <Button type="submit" size="sm" variant="ghost">
                      Delete
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
