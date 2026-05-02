import { describe, expect, it } from "vitest";
import { parseTimeToMinutes } from "./time";
import type { Gender, Player, RequiredPair } from "./types";
import { scheduleMatches } from "./scheduler";

describe("scheduleMatches", () => {
  it("prefers same-gender matches when possible", () => {
    const result = scheduleMatches(
      [
        player("m1", "M1", "M", "18:00", "18:30"),
        player("m2", "M2", "M", "18:00", "18:30"),
        player("m3", "M3", "M", "18:00", "18:30"),
        player("m4", "M4", "M", "18:00", "18:30"),
        player("f1", "F1", "F", "18:00", "18:30"),
        player("f2", "F2", "F", "18:00", "18:30"),
        player("f3", "F3", "F", "18:00", "18:30"),
        player("f4", "F4", "F", "18:00", "18:30"),
      ],
      [],
      30,
      2,
    );

    expect(result.matches).toHaveLength(2);
    expect(new Set(result.matches.map((match) => match.matchType))).toEqual(new Set(["men_doubles", "women_doubles"]));
  });

  it("limits women doubles to two matches when exactly four women participate", () => {
    const players = [
      ...Array.from({ length: 6 }, (_, index) => player(`m${index + 1}`, `M${index + 1}`, "M", "18:00", "20:00")),
      ...Array.from({ length: 4 }, (_, index) => player(`f${index + 1}`, `F${index + 1}`, "F", "18:00", "20:00")),
    ];

    const result = scheduleMatches(players, [], 30, 2);

    expect(result.matches.filter((match) => match.matchType === "women_doubles")).toHaveLength(2);
  });

  it("schedules required mixed pair together", () => {
    const players = [
      player("m1", "Min", "M", "18:00", "18:30"),
      player("m2", "Joon", "M", "18:00", "18:30"),
      player("f1", "Hana", "F", "18:00", "18:30"),
      player("f2", "Yuna", "F", "18:00", "18:30"),
    ];
    const requiredPairs: RequiredPair[] = [{ player1Id: "m1", player2Id: "f1" }];

    const result = scheduleMatches(players, requiredPairs, 30, 1);
    const teamKeys = result.matches.flatMap((match) => [match.team1, match.team2].map((team) => new Set(team.map((member) => member.playerId))));

    expect(teamKeys.some((team) => team.has("m1") && team.has("f1"))).toBe(true);
    expect(result.unmetRequiredPairs).toHaveLength(0);
  });

  it("does not use substitute match when override is false", () => {
    const result = scheduleMatches(
      [
        player("m1", "M1", "M", "18:00", "18:30"),
        player("m2", "M2", "M", "18:00", "18:30"),
        player("m3", "M3", "M", "18:00", "18:30"),
        player("f1", "F1", "F", "18:00", "18:30"),
      ],
      [],
      30,
      1,
    );

    expect(result.matches).toHaveLength(0);
  });

  it("allows substitute match when override woman can fill male slot", () => {
    const result = scheduleMatches(
      [
        player("m1", "M1", "M", "18:00", "18:30"),
        player("m2", "M2", "M", "18:00", "18:30"),
        player("m3", "M3", "M", "18:00", "18:30"),
        player("f1", "F1", "F", "18:00", "18:30", true),
      ],
      [],
      30,
      1,
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchType).toBe("men_doubles_substitute");
  });
});

function player(
  playerId: string,
  name: string,
  gender: Gender,
  start: string,
  end: string,
  canFillMaleSlot = false,
): Player {
  return {
    playerId,
    name,
    gender,
    availableStart: parseTimeToMinutes(start),
    availableEnd: parseTimeToMinutes(end),
    canFillMaleSlot,
    showLateJoin: false,
    showEarlyLeave: false,
  };
}
