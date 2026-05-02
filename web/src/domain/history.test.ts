import { describe, expect, it } from "vitest";
import { nextHistoryName } from "./history";

describe("history", () => {
  it("builds date-scoped default names", () => {
    expect(
      nextHistoryName("2026-05-09", [
        { dateLabel: "2026-05-09" },
        { dateLabel: "2026-05-16" },
        { dateLabel: "2026-05-09" },
      ]),
    ).toBe("2026-05-09 (3)");
  });
});
