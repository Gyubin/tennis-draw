import { describe, expect, it } from "vitest";
import { comparePlayerSummaries } from "./sorting";
import type { Gender, PlayerSummary } from "./types";

describe("player summary sorting", () => {
  it("orders men before women", () => {
    const summaries = [
      summary("1", "서연", "F"),
      summary("2", "민준", "M"),
    ];

    expect(summaries.sort(comparePlayerSummaries).map((item) => item.name)).toEqual(["민준", "서연"]);
  });

  it("sorts Korean names alphabetically within the same gender", () => {
    const summaries = [summary("3", "지호", "M"), summary("1", "도윤", "M"), summary("2", "민준", "M")];

    expect(summaries.sort(comparePlayerSummaries).map((item) => item.name)).toEqual(["도윤", "민준", "지호"]);
  });

  it("sorts English names alphabetically within the same gender", () => {
    const summaries = [summary("3", "Sofia", "F"), summary("1", "alex", "F"), summary("2", "Bella", "F")];

    expect(summaries.sort(comparePlayerSummaries).map((item) => item.name)).toEqual(["alex", "Bella", "Sofia"]);
  });

  it("uses player id as a deterministic tie breaker for duplicate names", () => {
    const summaries = [summary("p2", "민준", "M"), summary("p1", "민준", "M")];

    expect(summaries.sort(comparePlayerSummaries).map((item) => item.playerId)).toEqual(["p1", "p2"]);
  });
});

function summary(playerId: string, name: string, gender: Gender): PlayerSummary {
  return {
    playerId,
    name,
    gender,
    totalMatches: 0,
    sameGenderDoublesMatches: 0,
    mixedDoublesMatches: 0,
    sameGenderRatio: 0,
  };
}
