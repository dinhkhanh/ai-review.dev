import { z } from "zod";

/** Program lifecycle (FR-AFF-2). */
export const programStatusSchema = z.enum([
  "not_found",
  "found",
  "applied",
  "approved",
  "active",
  "paused",
  "rejected",
  "terminated",
]);
export type ProgramStatus = z.infer<typeof programStatusSchema>;

/** Whether the program's terms allow our /go redirect (FR-AFF-9, constraint C-2). */
export const redirectPolicySchema = z.enum(["allowed", "forbidden", "unknown"]);
export type RedirectPolicy = z.infer<typeof redirectPolicySchema>;

export const commissionModelSchema = z.enum([
  "recurring_percent",
  "one_time_percent",
  "flat_per_sale",
  "flat_per_lead",
  "hybrid",
  "unknown",
]);
export type CommissionModel = z.infer<typeof commissionModelSchema>;

export const linkStatusSchema = z.enum(["pending", "active", "paused", "broken"]);
export type LinkStatus = z.infer<typeof linkStatusSchema>;

export const KNOWN_NETWORKS = [
  "direct",
  "partnerstack",
  "impact",
  "awin",
  "shareasale",
  "cj",
  "rewardful",
  "firstpromoter",
  "tolt",
  "lemonsqueezy",
  "gumroad",
  "appsumo",
  "paddle",
  "skimlinks",
  "sovrn",
  "amazon",
  "other",
] as const;
export const networkSchema = z.enum(KNOWN_NETWORKS);
export type Network = z.infer<typeof networkSchema>;

/**
 * How to build a tracked URL for a program (FR-AFF-4). Consumed by `buildTrackedUrl` (./links).
 * Stored in `affiliate_programs.link_format`; additive changes only.
 */
export const linkFormatSchema = z.discriminatedUnion("kind", [
  /** e.g. https://vendor.com/?via=aireview — `value` is our account's referral id. */
  z.object({
    kind: z.literal("query_param"),
    param: z.string().min(1),
    value: z.string().min(1),
    /** Some referral schemes also accept a sub-id (FirstPromoter `fp_sid`, PartnerStack `ps_xid`). */
    subIdParam: z.string().min(1).optional(),
  }),
  /** Network-generated tracking link (Impact, PartnerStack, Awin...). SubID goes in `subIdParam`. */
  z.object({ kind: z.literal("network_link"), network: networkSchema, subIdParam: z.string().min(1).optional() }),
  /** Vendor gave us a fixed URL; we can only append a SubID if `subIdParam` is known. */
  z.object({ kind: z.literal("static_url"), subIdParam: z.string().min(1).optional() }),
]);
export type LinkFormat = z.infer<typeof linkFormatSchema>;

export * from "./links";
export * from "./resolve";
export * from "./click";
