import { mediaBlobs, type DbOrTx } from "@repo/db";
import { AwsClient } from "aws4fetch";
import type { StorageKind } from "./urls";

export interface StorageDriver {
  kind: StorageKind;
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
}

/** Cloudflare R2 over its S3 API. Objects are immutable (content-addressed keys), so cache forever. */
export function createR2Storage(config: R2Config, fetchImpl: typeof fetch = fetch): StorageDriver {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  return {
    kind: "r2",
    async put(key, bytes, mimeType) {
      const request = await client.sign(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        body: new Uint8Array(bytes),
        headers: { "Content-Type": mimeType, "Cache-Control": "public, max-age=31536000, immutable" },
      });
      const res = await fetchImpl(request);
      if (!res.ok) throw new Error(`R2 upload failed for ${key}: HTTP ${res.status} ${await res.text()}`);
    },
  };
}

/** Fallback when R2 is not configured: bytes live in Postgres and the web app serves them. */
export function createDbStorage(db: DbOrTx): StorageDriver {
  return {
    kind: "db",
    async put(key, bytes, mimeType) {
      await db
        .insert(mediaBlobs)
        .values({ key, data: bytes, mimeType })
        .onConflictDoUpdate({ target: mediaBlobs.key, set: { data: bytes, mimeType } });
    },
  };
}

/** R2 when its credentials are present, otherwise the database driver. */
export function createStorage(db: DbOrTx, env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const r2 = r2ConfigFromEnv(env);
  return r2 ? createR2Storage(r2) : createDbStorage(db);
}
