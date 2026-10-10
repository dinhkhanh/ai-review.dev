import type { AffiliateSignal } from "./affiliate-probe";
import type { SourcingCandidate } from "./collectors";

export interface ScoreComponents {
  /** 0–5: program found, commission (recurring weighted highest), cookie window, known network. */
  affiliate: number;
  /** 0–2: launch traction (PH votes / HN points) as a proxy for search demand. */
  demand: number;
  /** 0–1: classifier confidence that it is a paid product in a launch category. */
  fit: number;
  /** 0.5–1: newer launches rank higher; decays linearly from 7 to 60 days. */
  freshness: number;
}

/**
 * Affiliate value (0–5). Recurring commission and the cookie window dominate because they decide
 * lifetime revenue per referral; an unknown program keeps a small floor so strong launches are
 * still surfaced.
 *   not probed 0.25 · probed, no program 0.1 · program found: 1
 *   + recurring: min(pct, 50) / 20 (≤ 2.5), or one-time: min(pct, 50) / 50 (≤ 1), or unknown % 0.5
 *   + cookie: min(days, 90) / 90 (≤ 1) · + known network 0.5 (easier approval and reporting)
 */
export function affiliateValue(a: AffiliateSignal): number {
  if (!a.probed) return 0.25;
  if (!a.found) return 0.1;
  let v = 1;
  const pct = a.commissionPercent;
  if (pct !== null) v += a.recurring ? Math.min(pct, 50) / 20 : Math.min(pct, 50) / 50;
  else v += a.recurring ? 1 : 0.5;
  if (a.cookieDays !== null) v += Math.min(a.cookieDays, 90) / 90;
  if (a.network) v += 0.5;
  return Math.min(5, v);
}

/** Demand proxy (0–2): log-scaled traction, 1000 votes/points ≈ 2. */
export function demandValue(launch: SourcingCandidate["launch"]): number {
  const traction = Math.max(launch.votes ?? 0, launch.points ?? 0);
  if (traction <= 0) return 0.3;
  return Math.min(2, (Math.log10(1 + traction) / 3) * 2);
}

export function freshnessValue(publishedAt: string | null, now: Date): number {
  if (!publishedAt) return 0.75;
  const days = (now.getTime() - new Date(publishedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 7) return 1;
  if (days >= 60) return 0.5;
  return 1 - ((days - 7) / 53) * 0.5;
}

/**
 * Expected value used to rank suggestions (FR-INT-7):
 *   score = fit × freshness × (0.5 + affiliate) × (0.5 + demand)
 * Multiplicative so an off-topic launch never ranks on traction alone, and a strong recurring
 * program lifts a modest launch. Range ≈ 0–13.75; the default `minScore` of 1 keeps on-topic
 * launches with either some traction or a found program.
 */
export function expectedValue(
  candidate: SourcingCandidate,
  affiliate: AffiliateSignal,
  fit: number,
  now: Date,
): { score: number; components: ScoreComponents } {
  const components: ScoreComponents = {
    affiliate: round(affiliateValue(affiliate)),
    demand: round(demandValue(candidate.launch)),
    fit: round(Math.min(1, Math.max(0, fit))),
    freshness: round(freshnessValue(candidate.launch.publishedAt, now)),
  };
  const score = components.fit * components.freshness * (0.5 + components.affiliate) * (0.5 + components.demand);
  return { score: round(score), components };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
