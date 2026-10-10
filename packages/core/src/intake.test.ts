import { describe, expect, it } from "vitest";
import { parseBulkIntake, splitCsvLine } from "./intake";

describe("bulk intake parsing (FR-INT-2)", () => {
  it("splits quoted CSV fields", () => {
    expect(splitCsvLine('notion.so,"Notion, Inc.","say ""hi"""')).toEqual(["notion.so", "Notion, Inc.", 'say "hi"']);
  });

  it("reads a pasted list with names on either side and drops duplicates", () => {
    const { rows, errors } = parseBulkIntake(
      "# my list\nhttps://www.notion.so\nLinear, linear.app\ncal.com Cal\nnotion.so/pricing\nnot a url\nhttp://localhost:3000",
    );
    expect(rows.map((r) => [r.url, r.name])).toEqual([
      ["https://www.notion.so", null],
      ["https://linear.app", "Linear"],
      ["https://cal.com", "Cal"],
    ]);
    expect(errors.map((e) => e.line)).toEqual([5, 6, 7]);
    expect(errors[0]!.message).toMatch(/duplicate/);
  });

  it("reads CSV with a header in any column order", () => {
    const { rows } = parseBulkIntake(
      "Name,URL,Category,Angle\nPlausible,plausible.io,Marketing,for privacy-minded sites\n",
    );
    expect(rows).toEqual([
      {
        line: 2,
        url: "https://plausible.io",
        name: "Plausible",
        categorySlug: "marketing",
        angle: "for privacy-minded sites",
      },
    ]);
  });
});
