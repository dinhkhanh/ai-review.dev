"use server";

import { markNotificationsRead } from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";

export async function markReadAction(form: FormData) {
  await requireUser();
  const id = form.get("id");
  await markNotificationsRead(getDb(), id ? [String(id)] : undefined);
  revalidatePath("/", "layout");
}
