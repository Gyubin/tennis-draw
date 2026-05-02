import { describe, expect, it } from "vitest";
import { buildShareRows, buildShareSvg } from "./shareImage";
import { parseTimeToMinutes } from "./domain/time";
import type { Player, ScheduleResult, ScheduledMatch } from "./domain/types";

describe("share image", () => {
  it("keeps all time slots and courts in compact rows", () => {
    const result = sampleResult();

    const rows = buildShareRows(result);

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.courts.length === 2)).toBe(true);
    expect(rows.flatMap((row) => row.courts)).toHaveLength(12);
  });

  it("renders an svg containing every match", () => {
    const result = sampleResult();

    const svg = buildShareSvg(result, "테니스 대진표");

    expect(svg).toContain("총 12경기");
    expect(svg).toContain("17:00-17:30");
    expect(svg).toContain("19:30-20:00");
    expect(svg).toContain("A1/A2 vs B1/B2");
  });
});

function sampleResult(): ScheduleResult {
  const players = [
    player("a1", "A1", "M"),
    player("a2", "A2", "M"),
    player("b1", "B1", "M"),
    player("b2", "B2", "M"),
    player("c1", "C1", "F"),
    player("c2", "C2", "F"),
    player("d1", "D1", "F"),
    player("d2", "D2", "F"),
  ];
  const matches: ScheduledMatch[] = [];
  for (let slot = 0; slot < 6; slot += 1) {
    const slotStart = parseTimeToMinutes("17:00") + slot * 30;
    matches.push(match(slotStart, 1, players.slice(0, 4) as [Player, Player, Player, Player]));
    matches.push(match(slotStart, 2, players.slice(4, 8) as [Player, Player, Player, Player]));
  }
  return {
    matches,
    players,
    playerSummaries: [],
    unmetRequiredPairs: [],
    repeatedTeamPairs: [],
    playersWithTwoSlotWait: [],
  };
}

function match(slotStart: number, court: number, players: [Player, Player, Player, Player]): ScheduledMatch {
  return {
    slotStart,
    slotEnd: slotStart + 30,
    court,
    team1: [players[0], players[1]],
    team2: [players[2], players[3]],
    matchType: players[0].gender === "M" ? "men_doubles" : "women_doubles",
  };
}

function player(playerId: string, name: string, gender: "M" | "F"): Player {
  return {
    playerId,
    name,
    gender,
    availableStart: parseTimeToMinutes("17:00"),
    availableEnd: parseTimeToMinutes("20:00"),
    canFillMaleSlot: false,
    showLateJoin: false,
    showEarlyLeave: false,
  };
}
