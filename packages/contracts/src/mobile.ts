import { z } from "@hono/zod-openapi";

/**
 * Mobile app contracts (FR-API-4). Devices are anonymous: registration returns a device token
 * (`<deviceId>.<secret>`) that the app keeps in secure storage and sends as
 * `Authorization: Bearer <token>`. Only a hash of the secret is stored server-side.
 */

export const DevicePlatformSchema = z.enum(["ios", "android", "web"]).openapi("DevicePlatform");
export const DeviceLocaleSchema = z.enum(["en", "de"]).openapi("DeviceLocale");

/** Expo push tokens look like `ExponentPushToken[xxxxxxxx]` (or `ExpoPushToken[...]`). */
export const ExpoPushTokenSchema = z
  .string()
  .max(200)
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, "Not an Expo push token")
  .openapi({ example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" });

export const DeviceRegisterRequestSchema = z
  .object({
    platform: DevicePlatformSchema,
    locale: DeviceLocaleSchema.default("en"),
    appVersion: z.string().max(40).optional(),
    pushToken: ExpoPushTokenSchema.optional(),
  })
  .openapi("DeviceRegisterRequest");

export const DeviceRegisterResponseSchema = z
  .object({
    deviceId: z.uuid(),
    token: z.string().openapi({
      description: "Send as `Authorization: Bearer <token>`. Shown once; store it in secure storage.",
    }),
  })
  .openapi("DeviceRegisterResponse");

export const DeviceUpdateRequestSchema = z
  .object({
    pushToken: ExpoPushTokenSchema.nullable().optional().openapi({ description: "null turns push off" }),
    locale: DeviceLocaleSchema.optional(),
    appVersion: z.string().max(40).optional(),
  })
  .openapi("DeviceUpdateRequest");

export const DeviceSchema = z
  .object({
    deviceId: z.uuid(),
    platform: DevicePlatformSchema,
    locale: DeviceLocaleSchema,
    pushEnabled: z.boolean(),
    savedCount: z.number().int(),
    alertCount: z.number().int(),
  })
  .openapi("Device");

export const SavedItemSchema = z
  .object({
    articleId: z.uuid(),
    type: z.enum(["review", "comparison", "alternatives", "best_of"]),
    slug: z.string(),
    locale: DeviceLocaleSchema,
    title: z.string(),
    description: z.string().nullable(),
    score: z.number().nullable(),
    productName: z.string().nullable(),
    url: z.url().openapi({ description: "Canonical web URL" }),
    savedAt: z.iso.datetime(),
  })
  .openapi("SavedItem");

export const SavedItemListSchema = z.object({ data: z.array(SavedItemSchema) }).openapi("SavedItemList");

export const SaveRequestSchema = z
  .object({
    type: z.enum(["review", "comparison", "alternatives", "best_of"]).default("review"),
    slug: z.string().min(1).max(120),
    locale: DeviceLocaleSchema.default("en"),
  })
  .openapi("SaveRequest");

export const PriceChangeSummarySchema = z
  .object({ summary: z.string(), detectedAt: z.iso.datetime() })
  .openapi("PriceChangeSummary");

export const PriceAlertSchema = z
  .object({
    productSlug: z.string(),
    productName: z.string(),
    reviewSlug: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastChange: PriceChangeSummarySchema.nullable(),
  })
  .openapi("PriceAlert");

export const PriceAlertListSchema = z.object({ data: z.array(PriceAlertSchema) }).openapi("PriceAlertList");

export const PriceAlertRequestSchema = z
  .object({ product: z.string().min(1).max(120).openapi({ description: "Product slug" }) })
  .openapi("PriceAlertRequest");

export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequestSchema>;
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponseSchema>;
export type DeviceUpdateRequest = z.infer<typeof DeviceUpdateRequestSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type SavedItem = z.infer<typeof SavedItemSchema>;
export type PriceAlert = z.infer<typeof PriceAlertSchema>;
