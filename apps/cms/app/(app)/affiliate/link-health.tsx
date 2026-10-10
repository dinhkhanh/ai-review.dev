import { Button } from "@repo/ui/button";
import { fmtDate } from "../../../components/ui";
import { checkLinkNowAction } from "./actions";

/** Last health check of an affiliate link with a "Check now" button (FR-AFF-10). */
export function LinkHealth({
  link,
  productId,
}: {
  link: {
    id: string;
    status: string;
    lastHealthCheckAt: Date | null;
    healthDetail: string | null;
    healthFailures: number;
    finalUrl: string | null;
  };
  productId: string;
}) {
  const failing = link.status === "broken" || link.healthFailures > 0;
  return (
    <div className={`mb-3 rounded-md px-3 py-2 text-xs ${failing ? "bg-danger/10" : "bg-surface"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Health:</span>
        <span className="text-muted">
          {link.lastHealthCheckAt ? `checked ${fmtDate(link.lastHealthCheckAt)}` : "never checked"}
          {link.healthFailures > 0 ? ` · ${link.healthFailures} consecutive failure(s)` : ""}
        </span>
        <form action={checkLinkNowAction} className="ml-auto">
          <input type="hidden" name="linkId" value={link.id} />
          <input type="hidden" name="productId" value={productId} />
          <Button type="submit" size="sm" variant="ghost">
            Check now
          </Button>
        </form>
      </div>
      {link.healthDetail ? <p className="mt-1 break-words">{link.healthDetail}</p> : null}
      {link.finalUrl ? <p className="mt-1 break-all text-muted">Lands on {link.finalUrl}</p> : null}
    </div>
  );
}
