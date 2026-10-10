"use client";

import { Input, Label } from "@repo/ui/input";
import { useActionState } from "react";
import { SubmitButton } from "../../../../components/submit-button";
import { previewProcessAction, saveProcessedAction } from "../actions";

const field = "w-full rounded-md border border-border bg-bg p-2 text-sm";

/**
 * Crop / frame / annotate a screenshot (FR-MED-3). "Preview" renders without storing; "Save as new
 * asset" stores a processed copy linked to the original, which is never modified.
 */
export function ProcessForm({
  assetId,
  host,
  width,
  height,
}: {
  assetId: string;
  host: string | null;
  width: number | null;
  height: number | null;
}) {
  const [preview, previewAction] = useActionState(previewProcessAction, null);
  const [saved, saveAction] = useActionState(saveProcessedAction, null);
  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <form action={previewAction} className="space-y-3">
        <input type="hidden" name="assetId" value={assetId} />
        <div>
          <Label htmlFor="frame">Frame</Label>
          <select id="frame" name="frame" defaultValue="browser" className={`${field} h-10`}>
            <option value="browser">Browser window</option>
            <option value="phone">Phone</option>
            <option value="">None</option>
          </select>
        </div>
        <div>
          <Label htmlFor="host">Address bar text</Label>
          <Input id="host" name="host" defaultValue={host ?? ""} placeholder="example.com" />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">
            Crop (px)
            {width && height ? (
              <span className="font-normal text-muted">
                {" "}
                of {width}×{height}
              </span>
            ) : null}
          </legend>
          <div className="grid grid-cols-4 gap-1.5">
            {(["cropX", "cropY", "cropW", "cropH"] as const).map((k) => (
              <Input key={k} name={k} type="number" min={0} placeholder={k.slice(4)} aria-label={k} />
            ))}
          </div>
        </fieldset>
        <div>
          <Label htmlFor="annotations">Annotations, one per line</Label>
          <textarea
            id="annotations"
            name="annotations"
            rows={5}
            className={`${field} font-mono`}
            placeholder={"box 700 300 520 140\narrow 400 600 280 -150\nlabel 120 620 Live visitor count"}
          />
          <p className="mt-1 text-xs text-muted">
            <code>box x y w h</code> · <code>arrow x y dx dy</code> · <code>label x y text</code> — positions on the
            cropped image.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SubmitButton size="sm" variant="secondary" pendingLabel="Rendering…">
            Preview
          </SubmitButton>
          <SubmitButton size="sm" formAction={saveAction} pendingLabel="Saving…">
            Save as new asset
          </SubmitButton>
        </div>
        {[preview, saved].map((s, i) =>
          s ? (
            <p key={i} role={s.ok ? "status" : "alert"} className={`text-sm ${s.ok ? "text-success" : "text-danger"}`}>
              {s.message}
            </p>
          ) : null,
        )}
      </form>
      <div className="min-w-0 rounded-lg border border-dashed border-border bg-surface p-2">
        {preview?.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.preview} alt="Processed preview" className="mx-auto max-h-[70vh] w-auto" />
        ) : (
          <p className="p-8 text-center text-sm text-muted">The preview appears here.</p>
        )}
      </div>
    </div>
  );
}
