import { describe, expect, it } from "vitest";
import { chunkMarkdown, clip } from "./chunk";
import { classifyThirdParty, selectOfficialUrls } from "./urls";

describe("selectOfficialUrls", () => {
  it("keeps home + pricing, picks one page per type, skips blogs, locales and fragments", () => {
    const picked = selectOfficialUrls(
      [
        "https://acme.dev/",
        "https://acme.dev/#pricing",
        "https://acme.dev/pricing",
        "https://acme.dev/fr/pricing",
        "https://acme.dev/blog/how-we-grew",
        "https://acme.dev/features",
        "https://acme.dev/features/roadmaps/deep/page",
        "https://acme.dev/security",
        "https://acme.dev/en/changelog",
        "https://other.com/pricing",
        "https://acme.dev/logo.png",
      ],
      { websiteUrl: "https://acme.dev", pricingUrl: "https://acme.dev/#pricing" },
    );
    expect(picked.map((p) => `${p.key} ${p.url}`)).toEqual([
      "home https://acme.dev",
      "pricing https://acme.dev/pricing",
      "features https://acme.dev/features",
      "features https://acme.dev/features/roadmaps/deep/page",
      "security https://acme.dev/security",
      "changelog https://acme.dev/en/changelog",
    ]);
  });
  it("respects the limit", () => {
    expect(
      selectOfficialUrls(["https://a.com/pricing", "https://a.com/features"], {
        websiteUrl: "https://a.com",
        limit: 2,
      }),
    ).toHaveLength(2);
  });
});

describe("classifyThirdParty", () => {
  it("buckets sources by domain", () => {
    expect(classifyThirdParty("https://www.g2.com/products/x")).toBe("aggregator");
    expect(classifyThirdParty("https://old.reddit.com/r/x")).toBe("community");
    expect(classifyThirdParty("https://www.youtube.com/watch?v=1")).toBe("video");
    expect(classifyThirdParty("https://techcrunch.com/x")).toBe("news");
    expect(classifyThirdParty("not a url")).toBe("news");
  });
});

describe("chunkMarkdown", () => {
  it("strips images and link targets, chunks with overlap", () => {
    const md = `![logo](x.png)\n\n${"Para about [pricing](https://x) and plans. ".repeat(120)}\n\nShort end.`;
    const chunks = chunkMarkdown(md, 1000, 100);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 1100)).toBe(true);
    expect(chunks.join(" ")).not.toContain("https://x");
    expect(chunks.at(-1)).toContain("Short end.");
    expect(chunkMarkdown("   ")).toEqual([]);
  });
  it("clips long text", () => {
    expect(clip("abcdef", 3)).toBe("abc\n[…truncated]");
    expect(clip(null, 3)).toBe("");
  });
});
