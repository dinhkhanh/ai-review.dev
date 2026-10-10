import { KNOWN_NETWORKS } from "@repo/affiliate";
import type { affiliateLinks, affiliatePrograms } from "@repo/db";
import { Input, Label } from "@repo/ui/input";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { saveLinkAction, saveProgramAction } from "../actions";

type Program = typeof affiliatePrograms.$inferSelect;
type Link = typeof affiliateLinks.$inferSelect;

const select = "h-9 w-full rounded-md border border-border bg-bg px-2 text-sm";
const PROGRAM_STATUSES = ["not_found", "found", "applied", "approved", "active", "paused", "rejected", "terminated"];
const MODELS = ["recurring_percent", "one_time_percent", "flat_per_sale", "flat_per_lead", "hybrid", "unknown"];

/** Program form (FR-AFF-1..4, 9): terms, lifecycle status, link format and redirect policy. */
export function ProgramForm({ productId, program }: { productId: string; program?: Program }) {
  const f = program?.linkFormat;
  return (
    <ActionForm action={saveProgramAction} className="grid gap-3 sm:grid-cols-4">
      <input type="hidden" name="productId" value={productId} />
      {program ? <input type="hidden" name="programId" value={program.id} /> : null}
      <div className="sm:col-span-2">
        <Label>Name</Label>
        <Input name="name" defaultValue={program?.name ?? ""} required />
      </div>
      <div>
        <Label>Network</Label>
        <select name="network" defaultValue={program?.network ?? "direct"} className={select}>
          {KNOWN_NETWORKS.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Status</Label>
        <select name="status" defaultValue={program?.status ?? "found"} className={select}>
          {PROGRAM_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Commission model</Label>
        <select name="commissionModel" defaultValue={program?.commissionModel ?? "unknown"} className={select}>
          {MODELS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Commission (% or flat)</Label>
        <Input name="commissionValue" type="number" step="0.01" defaultValue={program?.commissionValue ?? ""} />
      </div>
      <div>
        <Label>Recurring months</Label>
        <Input name="recurringMonths" type="number" defaultValue={program?.recurringMonths ?? ""} />
      </div>
      <div>
        <Label>Cookie days</Label>
        <Input name="cookieDays" type="number" defaultValue={program?.cookieDays ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <Label>Sign-up URL</Label>
        <Input name="signupUrl" type="url" defaultValue={program?.signupUrl ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <Label>Terms URL</Label>
        <Input name="termsUrl" type="url" defaultValue={program?.termsUrl ?? ""} />
      </div>
      <div>
        <Label>Redirect policy</Label>
        <select name="redirectPolicy" defaultValue={program?.redirectPolicy ?? "unknown"} className={select}>
          <option value="allowed">allowed (use /go)</option>
          <option value="forbidden">forbidden (link directly)</option>
          <option value="unknown">unknown (treated as allowed)</option>
        </select>
      </div>
      <div>
        <Label>Link format</Label>
        <select name="formatKind" defaultValue={f?.kind ?? ""} className={select}>
          <option value="">pasted links (no template)</option>
          <option value="query_param">referral parameter (?via=…)</option>
          <option value="network_link">network tracking link</option>
          <option value="static_url">fixed vendor URL</option>
        </select>
      </div>
      <div>
        <Label>Param / your id</Label>
        <div className="flex gap-1">
          <Input name="formatParam" placeholder="via" defaultValue={f?.kind === "query_param" ? f.param : ""} />
          <Input name="formatValue" placeholder="aireview" defaultValue={f?.kind === "query_param" ? f.value : ""} />
        </div>
      </div>
      <div>
        <Label>SubID param (optional)</Label>
        <Input name="subIdParam" placeholder="network default" defaultValue={f?.subIdParam ?? ""} />
      </div>
      <div className="sm:col-span-4">
        <Label>Notes</Label>
        <Input name="notes" defaultValue={program?.notes ?? ""} />
      </div>
      <div className="sm:col-span-4">
        <SubmitButton size="sm">{program ? "Save program" : "Add program"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Affiliate link form (FR-AFF-3): offer, destination, region, status, priority, weight, dates. */
export function LinkForm({ productId, programs, link }: { productId: string; programs: Program[]; link?: Link }) {
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
  return (
    <ActionForm action={saveLinkAction} className="grid gap-3 sm:grid-cols-6">
      <input type="hidden" name="productId" value={productId} />
      {link ? <input type="hidden" name="linkId" value={link.id} /> : null}
      <div className="sm:col-span-2">
        <Label>Destination URL</Label>
        <Input name="destinationUrl" type="url" required defaultValue={link?.destinationUrl ?? ""} />
      </div>
      <div>
        <Label>Label</Label>
        <Input name="label" defaultValue={link?.label ?? "Default"} />
      </div>
      <div>
        <Label>Program</Label>
        <select name="programId" defaultValue={link?.programId ?? ""} className={select}>
          <option value="">none (manual)</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.status})
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Status</Label>
        <select name="status" defaultValue={link?.status ?? "active"} className={select}>
          {["pending", "active", "paused", "broken"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Region</Label>
        <Input name="region" defaultValue={link?.region ?? "global"} placeholder="global or US" />
      </div>
      <div>
        <Label>Priority (lower first)</Label>
        <Input name="priority" type="number" defaultValue={link?.priority ?? 100} />
      </div>
      <div>
        <Label>Weight (A/B)</Label>
        <Input name="weight" type="number" defaultValue={link?.weight ?? 100} />
      </div>
      <div>
        <Label>Starts</Label>
        <Input name="startsAt" type="date" defaultValue={day(link?.startsAt)} />
      </div>
      <div>
        <Label>Ends</Label>
        <Input name="endsAt" type="date" defaultValue={day(link?.endsAt)} />
      </div>
      <div className="sm:col-span-2">
        <Label>Notes</Label>
        <Input name="notes" defaultValue={link?.notes ?? ""} />
      </div>
      <div className="flex items-end">
        <SubmitButton size="sm">{link ? "Save" : "Add link"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
