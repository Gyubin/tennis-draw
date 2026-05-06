import { describe, expect, it } from "vitest";
import { canSwapScheduleCells, swapScheduleCells, type ScheduleCell } from "./manualSchedule";
import type { Gender, MatchType, Player, ScheduledMatch } from "./types";

describe("manual schedule cell swaps", () => {
  it("allows swapping players across courts in the same time slot", () => {
    const matches = [
      match("18:00", 1, ["p1", "p2"], ["p3", "p4"]),
      match("18:00", 2, ["p5", "p6"], ["p7", "p8"]),
    ];
    const source: ScheduleCell = { matchIndex: 0, side: "team1", position: 0 };
    const target: ScheduleCell = { matchIndex: 1, side: "team2", position: 1 };

    expect(canSwapScheduleCells(matches, source, target)).toBe(true);
    expect(swapScheduleCells(matches, source, target)).toBe(true);
    expect(matches[0].team1[0]?.playerId).toBe("p8");
    expect(matches[1].team2[1]?.playerId).toBe("p1");
  });

  it("allows swapping a player with an empty cell in the same time slot", () => {
    const matches = [match("18:00", 1, ["p1", null], ["p3", "p4"])];

    expect(
      swapScheduleCells(matches, { matchIndex: 0, side: "team1", position: 0 }, { matchIndex: 0, side: "team1", position: 1 }),
    ).toBe(true);
    expect(matches[0].team1[0]).toBeNull();
    expect(matches[0].team1[1]?.playerId).toBe("p1");
  });

  it("rejects swaps across different time slots", () => {
    const matches = [
      match("18:00", 1, ["p1", "p2"], ["p3", "p4"]),
      match("18:30", 1, ["p5", "p6"], ["p7", "p8"]),
    ];

    expect(
      swapScheduleCells(matches, { matchIndex: 0, side: "team1", position: 0 }, { matchIndex: 1, side: "team1", position: 0 }),
    ).toBe(false);
    expect(matches[0].team1[0]?.playerId).toBe("p1");
    expect(matches[1].team1[0]?.playerId).toBe("p5");
  });

  it("treats dropping on the same cell as a no-op", () => {
    const matches = [match("18:00", 1, ["p1", "p2"], ["p3", "p4"])];
    const cell: ScheduleCell = { matchIndex: 0, side: "team1", position: 0 };

    expect(swapScheduleCells(matches, cell, cell)).toBe(false);
    expect(matches[0].team1[0]?.playerId).toBe("p1");
  });
});

function match(start: string, court: number, team1: [string | null, string | null], team2: [string | null, string | null]): ScheduledMatch {
  const slotStart = minutes(start);
  return {
    slotStart,
    slotEnd: slotStart + 30,
    court,
    team1: [playerOrNull(team1[0]), playerOrNull(team1[1])],
    team2: [playerOrNull(team2[0]), playerOrNull(team2[1])],
    matchType: "men_doubles" as MatchType,
  };
}

function playerOrNull(id: string | null): Player | null {
  if (!id) return null;
  return {
    playerId: id,
    name: id.toUpperCase(),
    gender: "M" as Gender,
    availableStart: 18 * 60,
    availableEnd: 19 * 60,
    canFillMaleSlot: false,
    showLateJoin: false,
    showEarlyLeave: false,
  };
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
