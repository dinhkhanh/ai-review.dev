import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  DeviceRegisterRequestSchema,
  DeviceRegisterResponseSchema,
  DeviceSchema,
  DeviceUpdateRequestSchema,
  ErrorResponseSchema,
  PriceAlertListSchema,
  PriceAlertRequestSchema,
  SavedItemListSchema,
  SaveRequestSchema,
} from "@repo/contracts";
import {
  addPriceAlert,
  authenticateDevice,
  deleteDevice,
  DEVICE_LIMITS,
  getDeviceSummary,
  listPriceAlerts,
  listSavedItems,
  rateLimit,
  redisFromEnv,
  registerDevice,
  removePriceAlert,
  saveArticle,
  unsaveArticle,
  updateDevice,
  visitorFromHeaders,
} from "@repo/core";
import type { Context, Next } from "hono";
import type { AppEnv } from "../create-app";
import { webUrl } from "../mappers";

/**
 * Mobile endpoints (FR-API-4): anonymous device registration, saved items, price alerts.
 * Every route except registration needs `Authorization: Bearer <deviceId>.<secret>`.
 */

type DeviceEnv = AppEnv & { Variables: AppEnv["Variables"] & { deviceId: string } };

const SECURITY = [{ deviceToken: [] }];

const errorBody = (description: string) => ({
  content: { "application/json": { schema: ErrorResponseSchema } },
  description,
});
const json = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});
const ok = <T extends z.ZodType>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const authErrors = { 401: errorBody("Missing or invalid device token") };

/** Resolves the device token; 401 otherwise. Mobile responses are per device, so never cached. */
async function requireDevice(c: Context<DeviceEnv>, next: Next) {
  c.header("Cache-Control", "private, no-store");
  if (c.req.method === "POST" && c.req.path.endsWith("/devices")) return next();
  const device = await authenticateDevice(c.get("db"), c.req.header("authorization"));
  if (!device) return c.json({ error: { code: "unauthorized", message: "Missing or invalid device token" } }, 401);
  c.set("deviceId", device.id);
  return next();
}

const registerRoute = createRoute({
  method: "post",
  path: "/devices",
  tags: ["mobile"],
  summary: "Register an app install anonymously; returns the device token (shown once)",
  request: json(DeviceRegisterRequestSchema),
  responses: {
    201: ok(DeviceRegisterResponseSchema, "Registered"),
    400: errorBody("Invalid request"),
    429: errorBody("Rate limited"),
  },
});

const meRoute = createRoute({
  method: "get",
  path: "/devices/me",
  tags: ["mobile"],
  summary: "This device's settings and counts",
  security: SECURITY,
  responses: { 200: ok(DeviceSchema, "Device"), ...authErrors },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/devices/me",
  tags: ["mobile"],
  summary: "Update the push token (null turns push off), locale or app version",
  security: SECURITY,
  request: json(DeviceUpdateRequestSchema),
  responses: { 200: ok(DeviceSchema, "Updated"), 400: errorBody("Invalid request"), ...authErrors },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/devices/me",
  tags: ["mobile"],
  summary: "Delete this device with its saved items and alerts",
  security: SECURITY,
  responses: { 204: { description: "Deleted" }, ...authErrors },
});

const savedListRoute = createRoute({
  method: "get",
  path: "/me/saved",
  tags: ["mobile"],
  summary: "Saved articles, newest first",
  security: SECURITY,
  responses: { 200: ok(SavedItemListSchema, "Saved items"), ...authErrors },
});

const saveRoute = createRoute({
  method: "post",
  path: "/me/saved",
  tags: ["mobile"],
  summary: "Save an article (idempotent)",
  security: SECURITY,
  request: json(SaveRequestSchema),
  responses: {
    200: ok(SavedItemListSchema, "Saved items after the change"),
    404: errorBody("Article not found"),
    409: errorBody("Saved list is full"),
    ...authErrors,
  },
});

const unsaveRoute = createRoute({
  method: "delete",
  path: "/me/saved/{articleId}",
  tags: ["mobile"],
  summary: "Remove a saved article",
  security: SECURITY,
  request: { params: z.object({ articleId: z.uuid() }) },
  responses: { 200: ok(SavedItemListSchema, "Saved items after the change"), ...authErrors },
});

const alertsListRoute = createRoute({
  method: "get",
  path: "/me/alerts",
  tags: ["mobile"],
  summary: "Products this device gets price-change pushes for",
  security: SECURITY,
  responses: { 200: ok(PriceAlertListSchema, "Price alerts"), ...authErrors },
});

const alertAddRoute = createRoute({
  method: "post",
  path: "/me/alerts",
  tags: ["mobile"],
  summary: "Follow a product's pricing (idempotent)",
  security: SECURITY,
  request: json(PriceAlertRequestSchema),
  responses: {
    200: ok(PriceAlertListSchema, "Price alerts after the change"),
    404: errorBody("Product not found"),
    409: errorBody("Too many price alerts"),
    ...authErrors,
  },
});

const alertRemoveRoute = createRoute({
  method: "delete",
  path: "/me/alerts/{product}",
  tags: ["mobile"],
  summary: "Stop following a product's pricing",
  security: SECURITY,
  request: { params: z.object({ product: z.string().max(120) }) },
  responses: { 200: ok(PriceAlertListSchema, "Price alerts after the change"), ...authErrors },
});

const savedPayload = async (c: Context<DeviceEnv>) => {
  const rows = await listSavedItems(c.get("db"), c.get("deviceId"), webUrl());
  return { data: rows.map((r) => ({ ...r, savedAt: r.savedAt.toISOString() })) };
};

const alertsPayload = async (c: Context<DeviceEnv>) => {
  const rows = await listPriceAlerts(c.get("db"), c.get("deviceId"));
  return {
    data: rows.map((r) => ({
      productSlug: r.productSlug,
      productName: r.productName,
      reviewSlug: r.reviewSlug,
      createdAt: r.createdAt.toISOString(),
      lastChange:
        r.lastChangeSummary && r.lastChangeAt
          ? { summary: r.lastChangeSummary, detectedAt: new Date(r.lastChangeAt).toISOString() }
          : null,
    })),
  };
};

const app = new OpenAPIHono<DeviceEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { error: { code: "invalid_request", message: result.error.issues.map((i) => i.message).join("; ") } },
        400,
      );
    }
  },
});

app.openAPIRegistry.registerComponent("securitySchemes", "deviceToken", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "<deviceId>.<secret>",
  description: "Device token from POST /v1/devices. Anonymous; one per app install.",
});

app.use("/devices", requireDevice);
app.use("/devices/*", requireDevice);
app.use("/me/*", requireDevice);

export const mobileRoutes = app
  .openapi(registerRoute, async (c) => {
    const { ipHash } = await visitorFromHeaders(c.req.raw.headers);
    const limit = await rateLimit(`device-register:${ipHash}`, {
      ...DEVICE_LIMITS.register,
      redis: redisFromEnv(),
    });
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfter));
      return c.json({ error: { code: "rate_limited", message: "Too many requests" } }, 429);
    }
    const body = c.req.valid("json");
    const registered = await registerDevice(c.get("db"), body);
    return c.json(registered, 201);
  })
  .openapi(meRoute, async (c) => c.json(await getDeviceSummary(c.get("db"), c.get("deviceId")), 200))
  .openapi(updateRoute, async (c) => {
    await updateDevice(c.get("db"), c.get("deviceId"), c.req.valid("json"));
    return c.json(await getDeviceSummary(c.get("db"), c.get("deviceId")), 200);
  })
  .openapi(deleteRoute, async (c) => {
    await deleteDevice(c.get("db"), c.get("deviceId"));
    return c.body(null, 204);
  })
  .openapi(savedListRoute, async (c) => c.json(await savedPayload(c), 200))
  .openapi(saveRoute, async (c) => {
    await saveArticle(c.get("db"), c.get("deviceId"), c.req.valid("json"));
    return c.json(await savedPayload(c), 200);
  })
  .openapi(unsaveRoute, async (c) => {
    await unsaveArticle(c.get("db"), c.get("deviceId"), c.req.valid("param").articleId);
    return c.json(await savedPayload(c), 200);
  })
  .openapi(alertsListRoute, async (c) => c.json(await alertsPayload(c), 200))
  .openapi(alertAddRoute, async (c) => {
    await addPriceAlert(c.get("db"), c.get("deviceId"), c.req.valid("json").product);
    return c.json(await alertsPayload(c), 200);
  })
  .openapi(alertRemoveRoute, async (c) => {
    await removePriceAlert(c.get("db"), c.get("deviceId"), c.req.valid("param").product);
    return c.json(await alertsPayload(c), 200);
  });
