import { describe, expect, it } from "vitest";
import { parseTimeToMinutes } from "./time";
import type { Gender, Player, RequiredPair, ScheduledMatch } from "./types";
import { displayMatchTypeLabel, scheduleMatches, summarizeManualSchedule } from "./scheduler";
import { validateSchedule } from "./validation";

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
    const teamKeys = result.matches.flatMap((match) =>
      [match.team1, match.team2].map((team) => new Set(team.filter((member): member is Player => Boolean(member)).map((member) => member.playerId))),
    );

    expect(teamKeys.some((team) => team.has("m1") && team.has("f1"))).toBe(true);
    expect(result.unmetRequiredPairs).toHaveLength(0);
  });

  it("keeps a hard same-gender pair together only in same-gender matches", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "20:30"),
      player("m2", "M2", "M", "18:00", "20:30"),
      player("m3", "M3", "M", "18:00", "20:30"),
      player("m4", "M4", "M", "18:00", "20:30"),
      player("f1", "F1", "F", "18:00", "20:30"),
      player("f2", "F2", "F", "18:00", "20:30"),
    ];

    const baseline = scheduleMatches(players, [], 30, 1);
    const result = scheduleMatches(players, [{ player1Id: "m1", player2Id: "m2", mode: "hard" }], 30, 1);

    expect(matchTypeCounts(result.matches)).toEqual(matchTypeCounts(baseline.matches));
    expect(nonTargetMatchSignature(result.matches, new Set(["men_doubles", "men_doubles_substitute"]))).toEqual(
      nonTargetMatchSignature(baseline.matches, new Set(["men_doubles", "men_doubles_substitute"])),
    );
    for (const match of result.matches.filter((item) => item.matchType === "men_doubles" || item.matchType === "men_doubles_substitute")) {
      expect(matchHasNoPairMemberOrTeam(match, "m1", "m2")).toBe(true);
    }
    expect(result.unmetRequiredPairs).toEqual([]);
  });

  it("keeps a hard mixed pair together only in mixed doubles", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "20:30"),
      player("m2", "M2", "M", "18:00", "20:30"),
      player("m3", "M3", "M", "18:00", "20:30"),
      player("m4", "M4", "M", "18:00", "20:30"),
      player("f1", "F1", "F", "18:00", "20:30"),
      player("f2", "F2", "F", "18:00", "20:30"),
    ];

    const baseline = scheduleMatches(players, [], 30, 1);
    const result = scheduleMatches(players, [{ player1Id: "m1", player2Id: "f1", mode: "hard" }], 30, 1);

    expect(matchTypeCounts(result.matches)).toEqual(matchTypeCounts(baseline.matches));
    expect(nonTargetMatchSignature(result.matches, new Set(["mixed_doubles"]))).toEqual(
      nonTargetMatchSignature(baseline.matches, new Set(["mixed_doubles"])),
    );
    for (const match of result.matches.filter((item) => item.matchType === "mixed_doubles")) {
      expect(matchHasNoPairMemberOrTeam(match, "m1", "f1")).toBe(true);
    }
    expect(result.unmetRequiredPairs).toEqual([]);
  });

  it("relaxes an impossible hard pair without changing the generated match count", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "18:30"),
      player("m2", "M2", "M", "18:00", "18:30"),
      player("m3", "M3", "M", "18:00", "18:30"),
      player("m4", "M4", "M", "18:00", "18:30"),
    ];
    const result = scheduleMatches(
      players,
      [
        { player1Id: "m1", player2Id: "m2", mode: "hard" },
        { player1Id: "m1", player2Id: "m3", mode: "hard" },
      ],
      30,
      1,
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].matchType).toBe("men_doubles");
    expect(result.unmetRequiredPairs.length).toBeGreaterThan(0);
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

  it("summarizes per-player match statistics", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "19:00"),
      player("m2", "M2", "M", "18:00", "19:00"),
      player("m3", "M3", "M", "18:00", "19:00"),
      player("m4", "M4", "M", "18:00", "19:00"),
      player("f1", "F1", "F", "18:00", "19:00"),
      player("f2", "F2", "F", "18:00", "19:00"),
    ];
    const matches: ScheduledMatch[] = [
      match("18:00", 1, [players[0], players[1]], [players[2], players[3]], "men_doubles"),
      match("18:30", 1, [players[0], players[4]], [players[1], players[5]], "mixed_doubles"),
    ];

    const result = summarizeManualSchedule(matches, players, []);
    const m1 = result.playerSummaries.find((summary) => summary.playerId === "m1");
    const m3 = result.playerSummaries.find((summary) => summary.playerId === "m3");

    expect(m1).toMatchObject({
      gender: "M",
      totalMatches: 2,
      sameGenderDoublesMatches: 1,
      mixedDoublesMatches: 1,
      sameGenderRatio: 0.5,
    });
    expect(m3).toMatchObject({
      totalMatches: 1,
      sameGenderDoublesMatches: 1,
      mixedDoublesMatches: 0,
      sameGenderRatio: 1,
    });
  });

  it("keeps validation summary fields for the schedule analysis section", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "19:00"),
      player("m2", "M2", "M", "18:00", "19:00"),
      player("m3", "M3", "M", "18:00", "19:00"),
      player("m4", "M4", "M", "18:00", "19:00"),
      player("m5", "M5", "M", "18:00", "19:00"),
    ];
    const requiredPairs: RequiredPair[] = [{ player1Id: "m1", player2Id: "m3" }];
    const matches: ScheduledMatch[] = [
      match("18:00", 1, [players[0], players[1]], [players[2], players[3]], "men_doubles"),
      match("18:30", 1, [players[0], players[1]], [players[2], players[3]], "men_doubles"),
    ];

    const result = summarizeManualSchedule(matches, players, requiredPairs);

    expect(result.repeatedTeamPairs).toContainEqual({ names: ["M1", "M2"], count: 2 });
    expect(result.playersWithTwoSlotWait).toEqual(["M5"]);
    expect(result.unmetRequiredPairs).toEqual(requiredPairs);
  });

  it("recalculates player statistics when a manual schedule slot is emptied", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "19:00"),
      player("m2", "M2", "M", "18:00", "19:00"),
      player("m3", "M3", "M", "18:00", "19:00"),
      player("m4", "M4", "M", "18:00", "19:00"),
    ];
    const matches: ScheduledMatch[] = [match("18:00", 1, [players[0], null], [players[2], players[3]], "men_doubles")];

    const result = summarizeManualSchedule(matches, players, []);

    expect(result.playerSummaries.find((summary) => summary.playerId === "m1")?.totalMatches).toBe(1);
    expect(result.playerSummaries.find((summary) => summary.playerId === "m2")?.totalMatches).toBe(0);
    expect(result.playerSummaries.find((summary) => summary.playerId === "m3")?.totalMatches).toBe(1);
    expect(displayMatchTypeLabel(result.matches[0])).toBe("");
  });

  it("warns about mismatched gender ratios without blocking the match", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "18:30"),
      player("m2", "M2", "M", "18:00", "18:30"),
      player("f1", "F1", "F", "18:00", "18:30"),
      player("f2", "F2", "F", "18:00", "18:30"),
    ];
    const matches: ScheduledMatch[] = [match("18:00", 1, [players[0], players[1]], [players[2], players[3]], "mixed_doubles")];

    const validation = validateSchedule(matches, players, []);

    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toContain("성비가 어긋납니다.");
    expect(displayMatchTypeLabel(validation.summary.matches[0])).toBe("");
  });

  it("allows empty slots without gender-ratio warnings", () => {
    const players = [
      player("m1", "M1", "M", "18:00", "18:30"),
      player("m2", "M2", "M", "18:00", "18:30"),
      player("m3", "M3", "M", "18:00", "18:30"),
      player("m4", "M4", "M", "18:00", "18:30"),
    ];
    const matches: ScheduledMatch[] = [match("18:00", 1, [players[0], null], [players[2], players[3]], "men_doubles")];

    const validation = validateSchedule(matches, players, []);

    expect(validation.errors).toEqual([]);
    expect(validation.warnings).not.toContain("성비가 어긋납니다.");
  });
});

function match(
  start: string,
  court: number,
  team1: ScheduledMatch["team1"],
  team2: ScheduledMatch["team2"],
  matchType: ScheduledMatch["matchType"],
): ScheduledMatch {
  const slotStart = parseTimeToMinutes(start);
  return {
    slotStart,
    slotEnd: slotStart + 30,
    court,
    team1,
    team2,
    matchType,
  };
}

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

function matchTypeCounts(matches: ScheduledMatch[]): Record<string, number> {
  return matches.reduce<Record<string, number>>((counts, match) => {
    counts[match.matchType] = (counts[match.matchType] ?? 0) + 1;
    return counts;
  }, {});
}

function nonTargetMatchSignature(matches: ScheduledMatch[], targetTypes: Set<ScheduledMatch["matchType"]>): string[] {
  return matches
    .filter((match) => !targetTypes.has(match.matchType))
    .map((match) => `${match.slotStart}:${match.court}:${teamKey(match.team1)}:${teamKey(match.team2)}:${match.matchType}`);
}

function teamKey(team: ScheduledMatch["team1"]): string {
  return team
    .map((player) => player?.playerId ?? "")
    .sort()
    .join("/");
}

function matchHasNoPairMemberOrTeam(match: ScheduledMatch, player1Id: string, player2Id: string): boolean {
  const teamCounts = [match.team1, match.team2].map(
    (team) => team.filter((player) => player?.playerId === player1Id || player?.playerId === player2Id).length,
  );
  const totalCount = teamCounts[0] + teamCounts[1];
  return totalCount === 0 || teamCounts.includes(2);
}
