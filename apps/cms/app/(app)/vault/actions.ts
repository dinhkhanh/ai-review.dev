"use server";

import {
  deleteSecret,
  DomainError,
  productCredentialName,
  productCredentialSchema,
  putSecret,
  rotateVault,
  TEST_IDENTITY_SECRET,
  testIdentitySchema,
} from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";

type State = { ok: boolean; message: string } | null;

const message = (error: unknown) => (error instanceof DomainError ? error.message : String(error).slice(0, 300));
const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** Vault entries are written here and never read back into the CMS (FR-RES-7). Admins only. */
export async function saveTestIdentityAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser({ roles: ["admin"] });
  const parsed = testIdentitySchema.safeParse({
    name: field(form, "name"),
    email: field(form, "email"),
    // Passwords keep their exact characters (no trim).
    password: form.get("password") || undefined,
    company: field(form, "company"),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const value = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
  try {
    await putSecret(getDb(), {
      name: TEST_IDENTITY_SECRET,
      kind: "test_identity",
      value,
      description: `Sign-up persona: ${Object.keys(value).sort().join(", ")}`,
      actorUserId: user.id,
    });
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  revalidatePath("/vault");
  return { ok: true, message: "Test identity saved." };
}

export async function saveProductCredentialAction(_prev: State, form: FormData): Promise<State> {
  const user = await requireUser({ roles: ["admin"] });
  const productId = field(form, "productId");
  if (!productId) return { ok: false, message: "Choose a product." };
  const parsed = productCredentialSchema.safeParse({
    username: field(form, "username"),
    password: form.get("password") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Username and password are required." };
  try {
    await putSecret(getDb(), {
      name: productCredentialName(productId),
      kind: "product_credential",
      productId,
      value: parsed.data,
      description: "Existing login used instead of signing up",
      actorUserId: user.id,
    });
  } catch (error) {
    return { ok: false, message: message(error) };
  }
  revalidatePath("/vault");
  return { ok: true, message: "Login saved." };
}

export async function deleteSecretAction(form: FormData) {
  const user = await requireUser({ roles: ["admin"] });
  await deleteSecret(getDb(), String(form.get("name")), user.id).catch(() => {});
  revalidatePath("/vault");
}

export async function rotateVaultAction(_prev: State, _form: FormData): Promise<State> {
  const user = await requireUser({ roles: ["admin"] });
  try {
    const { rotated } = await rotateVault(getDb(), { actorUserId: user.id });
    revalidatePath("/vault");
    return {
      ok: true,
      message: rotated
        ? `Re-encrypted ${rotated} entries with the current key.`
        : "All entries already use the current key.",
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}
