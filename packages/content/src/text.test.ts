import { describe, expect, it } from "vitest";
import {
  extractClaims,
  overlapRatio,
  parseInline,
  readingGrade,
  serializeInline,
  splitSentences,
  type ArticleBody,
} from "./index";

const ID = "6f1c2b8e-1a2b-4c3d-8e9f-001122334455";

describe("inline markdown", () => {
  it("parses marks, links, go-links and citations", () => {
    const out = parseInline(
      "Plans start at **$10**/mo[^S1]. See [pricing](https://x.com/p) or [try it](go:notion#verdict).",
      {
        resolveCitation: (ref) => (ref === "S1" ? ID : null),
      },
    );
    expect(out).toEqual([
      { text: "Plans start at ", marks: [] },
      { text: "$10", marks: [{ type: "bold" }] },
      { text: "/mo", marks: [] },
      { text: "", marks: [{ type: "citation", citation: { sourceId: ID } }] },
      { text: ". See ", marks: [] },
      { text: "pricing", marks: [{ type: "link", href: "https://x.com/p" }] },
      { text: " or ", marks: [] },
      { text: "try it", marks: [{ type: "golink", slug: "notion", placement: "verdict" }] },
      { text: ".", marks: [] },
    ]);
  });
  it("drops unknown citation refs and keeps unmatched markers literal", () => {
    expect(parseInline("a[^S9] b", { resolveCitation: () => null })).toEqual([{ text: "a b", marks: [] }]);
    expect(parseInline("5 * 3 = 15 and 2*x, **open")).toEqual([{ text: "5 * 3 = 15 and 2*x, **open", marks: [] }]);
    expect(parseInline("`tick and [x](javascript:alert(1))")).toEqual([
      { text: "`tick and [x](javascript:alert(1))", marks: [] },
    ]);
  });
  it("supports italics, code and escapes", () => {
    expect(parseInline("*fast* `npm i` \\*literal\\*")).toEqual([
      { text: "fast", marks: [{ type: "italic" }] },
      { text: " ", marks: [] },
      { text: "npm i", marks: [{ type: "code" }] },
      { text: " *literal*", marks: [] },
    ]);
  });
  it("round-trips through serialize", () => {
    const src =
      "Plans start at **$10**/mo[^S1]. *Very* `fast`, see [docs](https://x.com/) and [buy](go:x#pricing). 2\\*3";
    const refs = { S1: ID } as Record<string, string>;
    const parsed = parseInline(src, { resolveCitation: (r) => refs[r] ?? null });
    const back = serializeInline(parsed, { citationRef: (id) => (id === ID ? "S1" : id) });
    expect(back).toBe(src);
    expect(parseInline(back, { resolveCitation: (r) => refs[r] ?? null })).toEqual(parsed);
  });
});

describe("claims", () => {
  const blocks: ArticleBody = [
    {
      id: "p1",
      type: "paragraph",
      children: parseInline("Pro costs $12 per month.[^A] It feels quick. Free plan has 3 projects. [^B] We like it.", {
        resolveCitation: (r) => (r === "A" ? "src-a" : r === "B" ? "src-b" : null),
      }),
    },
    {
      id: "r1",
      type: "rubric",
      dimensions: [
        {
          key: "value",
          label: "Value",
          weight: 1,
          score: 7,
          justification: "Cheap.",
          citations: [{ sourceId: "src-a" }],
        },
        { key: "x", label: "X", weight: 0, score: 5, justification: "n/a", citations: [] },
      ],
    },
  ];
  it("attaches markers to the sentence they follow and flags uncited figures", () => {
    expect(extractClaims(blocks)).toEqual([
      { id: "p1:0:0", blockId: "p1", text: "Pro costs $12 per month.", sourceIds: ["src-a"] },
      { id: "p1:0:2", blockId: "p1", text: "Free plan has 3 projects.", sourceIds: ["src-b"] },
      { id: "r1:value", blockId: "r1", text: "Cheap.", sourceIds: ["src-a"] },
    ]);
  });
  it("includes uncited numeric sentences with no sources", () => {
    const claims = extractClaims([
      { id: "x", type: "paragraph", children: [{ text: "It has 200 integrations. Nice.", marks: [] }] },
    ]);
    expect(claims).toEqual([{ id: "x:0:0", blockId: "x", text: "It has 200 integrations.", sourceIds: [] }]);
  });
});

describe("text metrics", () => {
  it("splits sentences", () => {
    expect(splitSentences("One. Two!  Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
  });
  it("grades simple prose lower than dense prose", () => {
    const simple = "The app is fast. It is easy to use. We like it a lot.";
    const dense =
      "Organizational interoperability considerations notwithstanding, comprehensive administrative configurability substantially differentiates enterprise-oriented collaboration infrastructure.";
    expect(readingGrade(simple)).toBeLessThan(readingGrade(dense));
    expect(readingGrade("")).toBe(0);
  });
  it("measures verbatim overlap", () => {
    const src = "the quick brown fox jumps over the lazy dog every single morning without fail";
    expect(overlapRatio(src, [src])).toBe(1);
    expect(overlapRatio("completely different words that share nothing with the source text at all ok", [src])).toBe(0);
    expect(overlapRatio("short", [src])).toBe(0);
  });
});
