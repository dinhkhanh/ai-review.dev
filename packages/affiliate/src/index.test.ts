import { describe, expect, it } from "vitest";
import { linkFormatSchema } from "./index";

describe("linkFormatSchema", () => {
  it("accepts the three supported link formats", () => {
    expect(linkFormatSchema.parse({ kind: "query_param", param: "via", value: "aireview" }).kind).toBe("query_param");
    expect(linkFormatSchema.parse({ kind: "network_link", network: "impact", subIdParam: "subId1" }).kind).toBe(
      "network_link",
    );
    expect(linkFormatSchema.parse({ kind: "static_url" }).kind).toBe("static_url");
  });
  it("rejects unknown networks", () => {
    expect(linkFormatSchema.safeParse({ kind: "network_link", network: "made-up" }).success).toBe(false);
  });
});
