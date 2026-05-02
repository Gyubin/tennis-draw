import { describe, expect, it } from "vitest";
import { formatLocalDate, parseLocalDate } from "./time";

describe("date helpers", () => {
  it("round trips local YYYY-MM-DD dates without timezone conversion", () => {
    expect(formatLocalDate(parseLocalDate("2026-05-09"))).toBe("2026-05-09");
  });

  it("rejects invalid calendar dates", () => {
    expect(() => parseLocalDate("2026-02-30")).toThrow("유효하지 않은 날짜입니다.");
  });
});
