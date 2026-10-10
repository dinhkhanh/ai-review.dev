import { HANDS_ON_STOP_REASONS, type HandsOnStopReason } from "@repo/core";

export function stopReasonLabel(reason: string | null) {
  if (!reason) return null;
  return HANDS_ON_STOP_REASONS[reason as HandsOnStopReason] ?? reason;
}
