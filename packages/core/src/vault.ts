import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { asc, eq, products, vaultSecrets, type DbOrTx } from "@repo/db";
import { z } from "zod";
import { recordAudit } from "./audit";
import { DomainError } from "./errors";

/**
 * Encrypted credential vault for hands-on trials (FR-RES-7). Values are JSON objects of strings,
 * sealed with AES-256-GCM under `VAULT_KEY` (never stored). The secret's name is bound in as
 * additional data, so a ciphertext copied onto another row does not decrypt.
 *
 * `VAULT_KEY` is either one base64 key (version 1) or a comma-separated rotation list
 * `"<version>:<base64>,..."` whose first entry encrypts new values; older entries still decrypt.
 * Plaintext never leaves `getSecret`: listings, audit entries and errors carry names only.
 */

export const VAULT_KINDS = ["test_identity", "product_credential"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];

/** The shared sign-up persona. `email` is used only when HANDS_ON_INBOX_DOMAIN is unset. */
export const TEST_IDENTITY_SECRET = "test_identity.default";
export const testIdentitySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200).optional(),
  password: z.string().min(12).max(200),
  company: z.string().trim().max(100).optional(),
});
export type TestIdentity = z.infer<typeof testIdentitySchema>;

/** Optional existing login for one product (used instead of signing up). */
export const productCredentialSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});
export type ProductCredential = z.infer<typeof productCredentialSchema>;

export const productCredentialName = (productId: string) => `product.${productId}.login`;

export interface VaultKey {
  version: number;
  key: Buffer;
}

export interface VaultKeyring {
  current: VaultKey;
  byVersion: Map<number, Buffer>;
}

function decodeKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new DomainError("invalid", `${label} must be 32 bytes, base64 encoded`);
  return key;
}

/** Parses `VAULT_KEY`; null when unset (the vault is then disabled). */
export function vaultKeyringFromEnv(env: NodeJS.ProcessEnv = process.env): VaultKeyring | null {
  const raw = env.VAULT_KEY?.trim();
  if (!raw) return null;
  const entries = raw.includes(":")
    ? raw.split(",").map((part) => {
        const [v, b64] = part.split(":");
        const version = Number(v);
        if (!Number.isInteger(version) || version < 1 || !b64) {
          throw new DomainError("invalid", 'VAULT_KEY rotation entries look like "2:<base64>"');
        }
        return { version, key: decodeKey(b64, `VAULT_KEY version ${version}`) };
      })
    : [{ version: 1, key: decodeKey(raw, "VAULT_KEY") }];
  return { current: entries[0]!, byVersion: new Map(entries.map((e) => [e.version, e.key])) };
}

export function vaultEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return vaultKeyringFromEnv(env) !== null;
  } catch {
    return false;
  }
}

function requireKeyring(keyring?: VaultKeyring | null): VaultKeyring {
  const ring = keyring === undefined ? vaultKeyringFromEnv() : keyring;
  if (!ring) {
    throw new DomainError(
      "invalid",
      "The vault is disabled: set VAULT_KEY (32 random bytes, base64) to store credentials",
    );
  }
  return ring;
}

/** base64(iv[12] | tag[16] | ciphertext). */
export function sealSecret(value: Record<string, string>, name: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function openSecret(sealed: string, name: string, key: Buffer): Record<string, string> {
  const buf = Buffer.from(sealed, "base64");
  if (buf.length < 29) throw new DomainError("invalid", `Vault entry ${name} is corrupt`);
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(buf.subarray(12, 28));
  try {
    const json = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
    return z.record(z.string(), z.string()).parse(JSON.parse(json));
  } catch {
    // Wrong key or tampered row; never echo anything about the content.
    throw new DomainError("invalid", `Vault entry ${name} could not be decrypted (wrong VAULT_KEY or tampered)`);
  }
}

export interface PutSecretInput {
  name: string;
  kind: VaultKind;
  productId?: string | null;
  value: Record<string, string>;
  description?: string | null;
  actorUserId?: string | null;
}

/** Creates or replaces a secret. The audit entry records the name and field names, never values. */
export async function putSecret(db: DbOrTx, input: PutSecretInput, opts: { keyring?: VaultKeyring | null } = {}) {
  const ring = requireKeyring(opts.keyring);
  const name = input.name.trim();
  if (!/^[a-z0-9_.:-]{3,120}$/i.test(name))
    throw new DomainError("invalid", "Secret names use letters, digits and . _ : -");
  const ciphertext = sealSecret(input.value, name, ring.current.key);
  const values = {
    name,
    kind: input.kind,
    productId: input.productId ?? null,
    ciphertext,
    keyVersion: ring.current.version,
    description: input.description ?? null,
    createdByUserId: input.actorUserId ?? null,
  };
  const [row] = await db
    .insert(vaultSecrets)
    .values(values)
    .onConflictDoUpdate({
      target: vaultSecrets.name,
      set: {
        kind: values.kind,
        productId: values.productId,
        ciphertext: values.ciphertext,
        keyVersion: values.keyVersion,
        description: values.description,
      },
    })
    .returning({ id: vaultSecrets.id, name: vaultSecrets.name });
  await recordAudit(db, {
    actorUserId: input.actorUserId ?? null,
    action: "vault.put",
    entityType: "vault_secret",
    entityId: row!.id,
    data: { name, kind: input.kind, fields: Object.keys(input.value).sort() },
  });
  return row!;
}

/** Decrypts a secret for use by the hands-on agent; null when absent. Touches `lastUsedAt`. */
export async function getSecret(
  db: DbOrTx,
  name: string,
  opts: { keyring?: VaultKeyring | null } = {},
): Promise<Record<string, string> | null> {
  const ring = requireKeyring(opts.keyring);
  const [row] = await db.select().from(vaultSecrets).where(eq(vaultSecrets.name, name)).limit(1);
  if (!row) return null;
  const key = ring.byVersion.get(row.keyVersion);
  if (!key) throw new DomainError("invalid", `VAULT_KEY has no version ${row.keyVersion} (needed for ${name})`);
  const value = openSecret(row.ciphertext, row.name, key);
  await db.update(vaultSecrets).set({ lastUsedAt: new Date() }).where(eq(vaultSecrets.id, row.id));
  return value;
}

export async function deleteSecret(db: DbOrTx, name: string, actorUserId?: string | null) {
  const [row] = await db
    .delete(vaultSecrets)
    .where(eq(vaultSecrets.name, name))
    .returning({ id: vaultSecrets.id, kind: vaultSecrets.kind });
  if (!row) throw new DomainError("not_found", `No vault entry named ${name}`);
  await recordAudit(db, {
    actorUserId: actorUserId ?? null,
    action: "vault.delete",
    entityType: "vault_secret",
    entityId: row.id,
    data: { name, kind: row.kind },
  });
}

/** Metadata only: never ciphertext, never plaintext. */
export async function listSecrets(db: DbOrTx) {
  return db
    .select({
      id: vaultSecrets.id,
      name: vaultSecrets.name,
      kind: vaultSecrets.kind,
      productId: vaultSecrets.productId,
      productName: products.name,
      keyVersion: vaultSecrets.keyVersion,
      description: vaultSecrets.description,
      lastUsedAt: vaultSecrets.lastUsedAt,
      updatedAt: vaultSecrets.updatedAt,
    })
    .from(vaultSecrets)
    .leftJoin(products, eq(products.id, vaultSecrets.productId))
    .orderBy(asc(vaultSecrets.name));
}

/** Re-encrypts every entry under the current key version (after adding a new key to VAULT_KEY). */
export async function rotateVault(
  db: DbOrTx,
  opts: { keyring?: VaultKeyring | null; actorUserId?: string | null } = {},
) {
  const ring = requireKeyring(opts.keyring);
  const rows = await db.select().from(vaultSecrets);
  let rotated = 0;
  for (const row of rows) {
    if (row.keyVersion === ring.current.version) continue;
    const key = ring.byVersion.get(row.keyVersion);
    if (!key) throw new DomainError("invalid", `VAULT_KEY has no version ${row.keyVersion} (needed for ${row.name})`);
    const value = openSecret(row.ciphertext, row.name, key);
    await db
      .update(vaultSecrets)
      .set({ ciphertext: sealSecret(value, row.name, ring.current.key), keyVersion: ring.current.version })
      .where(eq(vaultSecrets.id, row.id));
    rotated++;
  }
  await recordAudit(db, {
    actorUserId: opts.actorUserId ?? null,
    action: "vault.rotate",
    entityType: "vault_secret",
    data: { rotated, version: ring.current.version },
  });
  return { rotated };
}
