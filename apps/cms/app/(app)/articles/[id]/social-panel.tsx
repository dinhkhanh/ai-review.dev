import type { SocialSnippets } from "@repo/content";
import { ActionForm } from "../../../../components/action-form";
import { SubmitButton } from "../../../../components/submit-button";
import { fmtDate } from "../../../../components/ui";
import { regenerateSocialAction } from "../social-actions";
import { CopyButton } from "./copy-button";

const NETWORKS = [
  { key: "x", label: "X", max: 280 },
  { key: "linkedin", label: "LinkedIn", max: 3000 },
  { key: "threads", label: "Threads", max: 500 },
] as const;

/** Social posts for the article (FR-CON-8): copy-ready, regenerated with one click. */
export function SocialPanel({ articleId, social }: { articleId: string; social: SocialSnippets | null }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Social posts</h2>
      {social ? (
        <>
          <p className="text-xs text-muted">Generated {fmtDate(social.generatedAt)}. Links go to the article page.</p>
          {NETWORKS.map((n) => (
            <div key={n.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{n.label}</span>
                <span className="text-muted">
                  {social[n.key].length}/{n.max} <CopyButton text={social[n.key]} />
                </span>
              </div>
              <textarea
                readOnly
                value={social[n.key]}
                rows={n.key === "linkedin" ? 6 : 3}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs"
              />
            </div>
          ))}
        </>
      ) : (
        <p className="text-sm text-muted">No posts yet. They are generated after QA, or now:</p>
      )}
      <ActionForm action={regenerateSocialAction}>
        <input type="hidden" name="articleId" value={articleId} />
        <SubmitButton size="sm" variant="secondary" pendingLabel="Writing…">
          {social ? "Regenerate posts" : "Generate posts"}
        </SubmitButton>
      </ActionForm>
    </section>
  );
}
