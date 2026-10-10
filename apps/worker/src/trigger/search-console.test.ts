import { describe, expect, it } from "vitest";
import { searchConsoleDaily, searchConsoleNow } from "./search-console";

describe("search console tasks (FR-MNT-3)", () => {
  it("registers the daily import and the on-demand backfill", () => {
    expect(searchConsoleDaily.id).toBe("search-console-import");
    expect(searchConsoleNow.id).toBe("search-console-import-now");
  });
});
