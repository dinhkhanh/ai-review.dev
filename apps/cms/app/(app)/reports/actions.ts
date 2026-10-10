"use server";

import { recordAudit, setErrorReportStatus } from "@repo/core";
import { getDb } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "../../../lib/auth";

export async function setReportStatusAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("reportId"));
  const status = String(form.get("status")) as "open" | "resolved" | "dismissed";
  await setErrorReportStatus(getDb(), id, status);
  await recordAudit(getDb(), {
    actorUserId: user.id,
    action: `report.${status}`,
    entityType: "error_report",
    entityId: id,
  });
  revalidatePath("/reports");
}
