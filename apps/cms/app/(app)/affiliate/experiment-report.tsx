import type { ExperimentReport } from "@repo/core";
import { Notice, StatusBadge, Table, usd } from "../../../components/ui";

const pct = (n: number | null, digits = 1) => (n === null ? "—" : `${(n * 100).toFixed(digits)}%`);
const pValue = (p: number | null) => (p === null ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));

/**
 * Per-variant A/B report (FR-AFF-13): clicks, conversions, conversion rate, commission, EPC and
 * p-values against the leader. Shared by the product page and the affiliate overview.
 */
export function ExperimentReportTable({ report }: { report: ExperimentReport }) {
  const { verdict, policy } = report;
  return (
    <div className="space-y-3">
      <Notice tone={verdict.state === "winner" ? "success" : "info"}>
        {verdict.message}
        <span className="block text-xs text-muted">
          Decision test: earnings per click at {Math.round(policy.confidence * 100)}% confidence (Bonferroni-corrected
          for more than two variants), minimum {policy.minClicksPerVariant} human clicks per variant. Commission
          includes pending conversions; reversed ones are excluded.
        </span>
      </Notice>
      <Table
        head={[
          "Variant",
          "Weight",
          "Clicks",
          "Share",
          "Conv.",
          "Conv. rate",
          "p (rate)",
          "Commission",
          "EPC",
          "p (EPC)",
        ]}
      >
        {report.variants.map((v) => (
          <tr key={v.linkId} className="border-t border-border align-top">
            <td className="p-3">
              <span className="font-medium">{v.label}</span>
              {v.linkId === verdict.winnerLinkId ? (
                <span className="ml-2">
                  <StatusBadge status="active" />
                </span>
              ) : v.linkId === verdict.leaderLinkId ? (
                <span className="ml-2 text-xs text-muted">leading</span>
              ) : null}
              <p className="text-xs text-muted">
                {v.programName ?? "no program"} · {v.status}
              </p>
              {!v.enoughData ? (
                <p className="text-xs text-muted">needs {policy.minClicksPerVariant - v.clicks} more clicks</p>
              ) : null}
            </td>
            <td className="p-3 tabular-nums">{v.weight}</td>
            <td className="p-3 tabular-nums">{v.clicks}</td>
            <td className="p-3 tabular-nums">{pct(v.trafficShare, 0)}</td>
            <td className="p-3 tabular-nums">{v.conversions}</td>
            <td className="p-3 tabular-nums">{pct(v.conversionRate, 2)}</td>
            <td className="p-3 tabular-nums">{pValue(v.pConversionRate)}</td>
            <td className="p-3 tabular-nums">
              {usd.format(v.commission)}
              {v.confirmedCommission !== v.commission ? (
                <p className="text-xs text-muted">{usd.format(v.confirmedCommission)} confirmed</p>
              ) : null}
            </td>
            <td className="p-3 tabular-nums">{v.epc === null ? "—" : usd.format(v.epc)}</td>
            <td className="p-3 tabular-nums">{pValue(v.pEpc)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
