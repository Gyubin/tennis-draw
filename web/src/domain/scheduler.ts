import type {
  MatchType,
  Player,
  PlayerSummary,
  RequiredPair,
  ScheduledMatch,
  ScheduleResult,
} from "./types";

export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  men_doubles: "남복",
  women_doubles: "여복",
  mixed_doubles: "혼복",
  men_doubles_substitute: "남복(대체)",
};

export type ScheduleSlot = ScheduledMatch["team1"][number];

interface MatchCandidate {
  teams: [[Player, Player], [Player, Player]];
  matchType: MatchType;
  playerIds: Set<string>;
  secondaryScore: number;
}

interface MutableStats {
  matches: Map<string, number>;
  sameGender: Map<string, number>;
  mixed: Map<string, number>;
  restStreaks: Map<string, number>;
  matchTypeCounts: Map<MatchType, number>;
  teamPairCounts: Map<string, number>;
  opponentPairCounts: Map<string, number>;
  satisfiedRequiredPairs: Set<string>;
}

export function buildSlots(players: Player[], slotMinutes: number): number[] {
  const earliestStart = Math.min(...players.map((player) => player.availableStart));
  const latestEnd = Math.max(...players.map((player) => player.availableEnd));
  const slots: number[] = [];
  for (let current = earliestStart; current + slotMinutes <= latestEnd; current += slotMinutes) {
    slots.push(current);
  }
  return slots;
}

export function isPlayerAvailable(player: Player, slotStart: number, slotMinutes: number): boolean {
  return player.availableStart <= slotStart && slotStart + slotMinutes <= player.availableEnd;
}

export function classifyMatch(players: Player[]): MatchType | null {
  const menCount = players.filter((player) => player.gender === "M").length;
  const womenCount = players.length - menCount;
  if (menCount === 4) return "men_doubles";
  if (womenCount === 4) return "women_doubles";
  if (menCount === 2 && womenCount === 2) return "mixed_doubles";
  if (menCount === 3 && womenCount === 1) {
    const substitute = players.find((player) => player.gender === "F");
    if (substitute?.canFillMaleSlot) return "men_doubles_substitute";
  }
  return null;
}

export function filledPlayers(match: ScheduledMatch): Player[] {
  return [...match.team1, ...match.team2].filter((player): player is Player => Boolean(player));
}

export function displayMatchType(match: ScheduledMatch): MatchType | null {
  const [team1Player1, team1Player2] = match.team1;
  const [team2Player1, team2Player2] = match.team2;
  if (!team1Player1 || !team1Player2 || !team2Player1 || !team2Player2) return null;

  const team1Genders = new Set([team1Player1.gender, team1Player2.gender]);
  const team2Genders = new Set([team2Player1.gender, team2Player2.gender]);
  if (team1Genders.size !== 1 && team2Genders.size !== 1) return "mixed_doubles";
  if (team1Genders.size === 1 && team2Genders.size === 1) {
    const team1Gender = team1Player1.gender;
    const team2Gender = team2Player1.gender;
    if (team1Gender === "M" && team2Gender === "M") return "men_doubles";
    if (team1Gender === "F" && team2Gender === "F") return "women_doubles";
  }
  return null;
}

export function displayMatchTypeLabel(match: ScheduledMatch): string {
  const matchType = displayMatchType(match);
  return matchType ? MATCH_TYPE_LABELS[matchType] : "";
}

function generateTeamings(playersInput: Player[]): Array<[[[Player, Player], [Player, Player]], MatchType]> {
  const players = [...playersInput];
  const matchType = classifyMatch(players);
  if (!matchType) return [];

  if (matchType === "mixed_doubles") {
    const men = players.filter((player) => player.gender === "M").sort(byPlayerId);
    const women = players.filter((player) => player.gender === "F").sort(byPlayerId);
    return [
      [[ [men[0], women[0]], [men[1], women[1]] ], matchType],
      [[ [men[0], women[1]], [men[1], women[0]] ], matchType],
    ];
  }

  if (matchType === "men_doubles_substitute") {
    const substitute = players.find((player) => player.gender === "F");
    const men = players.filter((player) => player.gender === "M").sort(byPlayerId);
    if (!substitute) return [];
    return [
      [[ [substitute, men[0]], [men[1], men[2]] ], matchType],
      [[ [substitute, men[1]], [men[0], men[2]] ], matchType],
      [[ [substitute, men[2]], [men[0], men[1]] ], matchType],
    ];
  }

  return [
    [[ [players[0], players[1]], [players[2], players[3]] ], matchType],
    [[ [players[0], players[2]], [players[1], players[3]] ], matchType],
    [[ [players[0], players[3]], [players[1], players[2]] ], matchType],
  ];
}

function initializeStats(players: Player[]): MutableStats {
  return {
    matches: new Map(players.map((player) => [player.playerId, 0])),
    sameGender: new Map(players.map((player) => [player.playerId, 0])),
    mixed: new Map(players.map((player) => [player.playerId, 0])),
    restStreaks: new Map(players.map((player) => [player.playerId, 0])),
    matchTypeCounts: new Map(),
    teamPairCounts: new Map(),
    opponentPairCounts: new Map(),
    satisfiedRequiredPairs: new Set(),
  };
}

function calculateMatchScore(
  teams: [[Player, Player], [Player, Player]],
  matchType: MatchType,
  stats: MutableStats,
  requiredPairKeys: Set<string>,
  requiredPairSlotCounts: Map<string, number>,
  mixedPriorityPlayerIds: Set<string>,
  remainingSlotCounts: Map<string, number>,
  targetFloor: number,
  targetMax: number,
): number {
  const [team1, team2] = teams;
  const allPlayers = [...team1, ...team2];
  const currentMaxMatches = Math.max(0, ...Array.from(stats.matches.values()));
  const sameGenderMatch = countsAsSameGender(matchType, allPlayers);
  let score = 0;

  for (const player of allPlayers) {
    const totalBefore = getCount(stats.matches, player.playerId);
    const sameBefore = getCount(stats.sameGender, player.playerId);
    const sameAfter = sameBefore + (sameGenderMatch ? 1 : 0);
    const totalAfter = totalBefore + 1;
    const remainingSlots = Math.max(1, getCount(remainingSlotCounts, player.playerId));
    const beforeGap = Math.max(0, 0.6 * totalBefore - sameBefore);
    const afterGap = Math.max(0, 0.6 * totalAfter - sameAfter);
    const deficitToFloor = Math.max(0, targetFloor - totalBefore);
    const restStreak = getCount(stats.restStreaks, player.playerId);
    const prefersMixedPriority = mixedPriorityPlayerIds.has(player.playerId);
    const preferredSameBefore = preferredSameGenderCount(totalBefore, prefersMixedPriority);
    const preferredSameAfter = preferredSameGenderCount(totalAfter, prefersMixedPriority);

    score += (currentMaxMatches - totalBefore) * 20;
    if (totalBefore === 0) score += 12;
    score += (beforeGap - afterGap) * 120;
    score += (deficitToFloor / remainingSlots) * 70;
    score += restStreak * 90;
    score += (Math.abs(sameBefore - preferredSameBefore) - Math.abs(sameAfter - preferredSameAfter)) * 35;
    if (sameGenderMatch) {
      score += 8;
    } else if (beforeGap > 0) {
      score -= 8;
    }
    if (totalAfter > targetMax) {
      score -= (totalAfter - targetMax) * 250;
    }
  }

  if (matchType === "men_doubles_substitute") score -= 140;

  for (const team of [team1, team2]) {
    const key = pairKey(team[0].playerId, team[1].playerId);
    score -= getCount(stats.teamPairCounts, key) * 35;
    if (requiredPairKeys.has(key) && !stats.satisfiedRequiredPairs.has(key)) {
      score += 300 + 120 / Math.max(1, getCount(requiredPairSlotCounts, key));
    }
  }

  for (const player of team1) {
    for (const opponent of team2) {
      score -= getCount(stats.opponentPairCounts, pairKey(player.playerId, opponent.playerId)) * 5;
    }
  }

  return score;
}

function generateMatchCandidates(
  availablePlayers: Player[],
  stats: MutableStats,
  requiredPairKeys: Set<string>,
  requiredPairSlotCounts: Map<string, number>,
  mixedPriorityPlayerIds: Set<string>,
  remainingSlotCounts: Map<string, number>,
  targetFloor: number,
  targetMax: number,
  womenDoublesLimit: number | null,
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const players of combinations(availablePlayers, 4)) {
    for (const [teams, matchType] of generateTeamings(players)) {
      if (
        womenDoublesLimit !== null &&
        matchType === "women_doubles" &&
        getCount(stats.matchTypeCounts, "women_doubles") >= womenDoublesLimit
      ) {
        continue;
      }
      candidates.push({
        teams,
        matchType,
        playerIds: new Set([...teams[0], ...teams[1]].map((player) => player.playerId)),
        secondaryScore: calculateMatchScore(
          teams,
          matchType,
          stats,
          requiredPairKeys,
          requiredPairSlotCounts,
          mixedPriorityPlayerIds,
          remainingSlotCounts,
          targetFloor,
          targetMax,
        ),
      });
    }
  }
  return candidates;
}

function chooseBestMatchesForSlot(args: {
  availablePlayers: Player[];
  courts: number;
  stats: MutableStats;
  requiredPairKeys: Set<string>;
  requiredPairSlotCounts: Map<string, number>;
  mixedPriorityPlayerIds: Set<string>;
  unpairedPlayerIds: Set<string>;
  earliestStartPlayerIds: Set<string>;
  forbiddenWaitingPair: string | null;
  preferEarlyLeave: boolean;
  preferWaitingPair: boolean;
  remainingSlotCounts: Map<string, number>;
  targetFloor: number;
  targetMax: number;
  womenDoublesLimit: number | null;
}): MatchCandidate[] {
  let candidates = generateMatchCandidates(
    args.availablePlayers,
    args.stats,
    args.requiredPairKeys,
    args.requiredPairSlotCounts,
    args.mixedPriorityPlayerIds,
    args.remainingSlotCounts,
    args.targetFloor,
    args.targetMax,
    args.womenDoublesLimit,
  );
  if (candidates.length === 0) return [];

  const regularCandidates = candidates.filter((candidate) => candidate.matchType !== "men_doubles_substitute");
  if (maxSelectionSize(regularCandidates, args.courts) === maxSelectionSize(candidates, args.courts)) {
    candidates = regularCandidates;
    if (candidates.length === 0) return [];
  }

  let bestSelection: MatchCandidate[] = [];
  let bestKey: [number, number[], [number, number, number], [number, number, number], number] | null = null;

  const backtrack = (startIndex: number, chosen: MatchCandidate[], usedPlayerIds: Set<string>) => {
    const key: [number, number[], [number, number, number], [number, number, number], number] = [
      chosen.length,
      buildBalanceSignature(chosen, args.stats),
      buildRestSignature(chosen, args.stats, args.availablePlayers),
      buildLowPriorityPreferenceSignature(
        chosen,
        args.availablePlayers,
        args.requiredPairKeys,
        args.unpairedPlayerIds,
        args.forbiddenWaitingPair,
        args.preferEarlyLeave,
        args.preferWaitingPair,
        args.earliestStartPlayerIds,
      ),
      chosen.reduce((sum, candidate) => sum + candidate.secondaryScore, 0),
    ];
    if (!bestKey || compareSelectionKey(key, bestKey) > 0) {
      bestKey = key;
      bestSelection = [...chosen];
    }
    if (chosen.length === args.courts) return;

    for (let index = startIndex; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (setsIntersect(candidate.playerIds, usedPlayerIds)) continue;
      chosen.push(candidate);
      for (const id of candidate.playerIds) usedPlayerIds.add(id);
      backtrack(index + 1, chosen, usedPlayerIds);
      for (const id of candidate.playerIds) usedPlayerIds.delete(id);
      chosen.pop();
    }
  };

  backtrack(0, [], new Set());
  return bestSelection;
}

function maxSelectionSize(candidates: MatchCandidate[], courts: number): number {
  let best = 0;
  const backtrack = (startIndex: number, chosenCount: number, usedPlayerIds: Set<string>) => {
    best = Math.max(best, chosenCount);
    if (chosenCount === courts) return;
    if (chosenCount + (candidates.length - startIndex) <= best) return;
    for (let index = startIndex; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (setsIntersect(candidate.playerIds, usedPlayerIds)) continue;
      for (const id of candidate.playerIds) usedPlayerIds.add(id);
      backtrack(index + 1, chosenCount + 1, usedPlayerIds);
      for (const id of candidate.playerIds) usedPlayerIds.delete(id);
    }
  };
  backtrack(0, 0, new Set());
  return best;
}

export function scheduleMatches(playersInput: Player[], requiredPairs: RequiredPair[], slotMinutes: number, courts: number): ScheduleResult {
  if (slotMinutes <= 0) throw new Error("slotMinutes must be greater than zero.");
  if (courts <= 0) throw new Error("courts must be greater than zero.");
  if (playersInput.length < 4) throw new Error("최소 4명의 참가자가 필요합니다.");

  const players = [...playersInput].sort(byPlayerId);
  const playersById = new Map(players.map((player) => [player.playerId, player]));
  const requiredPairKeys = new Set(requiredPairs.map((pair) => pairKey(pair.player1Id, pair.player2Id)));
  const slots = buildSlots(players, slotMinutes);
  const stats = initializeStats(players);
  const requiredPairSlotCounts = computeRequiredPairSlotCounts(requiredPairs, playersById, slots, slotMinutes);
  const matches: ScheduledMatch[] = [];
  const [targetFloor, targetMax] = estimateMatchCountTargets(players, slotMinutes, courts);
  const womenDoublesLimit = determineWomenDoublesLimit(players);
  const mixedPriorityPlayerIds = buildMixedPriorityPlayerIds(requiredPairs, playersById);
  const requiredPairPlayerIds = buildRequiredPairPlayerIds(requiredPairs);
  const unpairedPlayerIds = new Set(players.filter((player) => !requiredPairPlayerIds.has(player.playerId)).map((player) => player.playerId));
  const earliestStart = Math.min(...players.map((player) => player.availableStart));
  const earliestStartPlayerIds = new Set(players.filter((player) => player.availableStart === earliestStart).map((player) => player.playerId));
  const remainingSlotCountsByIndex = buildRemainingSlotCountsByIndex(players, slots, slotMinutes);
  let firstSlotWaitingPair: string | null = null;

  slots.forEach((slotStart, slotIndex) => {
    const availablePlayers = players.filter((player) => isPlayerAvailable(player, slotStart, slotMinutes));
    const selectedMatches = chooseBestMatchesForSlot({
      availablePlayers,
      courts,
      stats,
      requiredPairKeys,
      requiredPairSlotCounts,
      mixedPriorityPlayerIds,
      unpairedPlayerIds,
      earliestStartPlayerIds,
      forbiddenWaitingPair: slotIndex === slots.length - 1 ? firstSlotWaitingPair : null,
      preferEarlyLeave: slotIndex === slots.length - 1,
      preferWaitingPair: slotIndex === 0 || slotIndex === slots.length - 1,
      remainingSlotCounts: remainingSlotCountsByIndex[slotIndex],
      targetFloor,
      targetMax,
      womenDoublesLimit,
    });
    if (slotIndex === 0) {
      firstSlotWaitingPair = buildWaitingPairKey(selectedMatches, availablePlayers);
    }
    const playedPlayerIds = new Set(selectedMatches.flatMap((candidate) => Array.from(candidate.playerIds)));
    updateRestStreaksForSlot(stats, availablePlayers, playedPlayerIds);
    selectedMatches.forEach((candidate, courtIndex) => {
      matches.push({
        slotStart,
        slotEnd: slotStart + slotMinutes,
        court: courtIndex + 1,
        team1: candidate.teams[0],
        team2: candidate.teams[1],
        matchType: candidate.matchType,
      });
      updateStats(candidate.teams, candidate.matchType, stats, requiredPairKeys);
    });
  });

  return buildScheduleResult(matches, players, requiredPairs, stats, playersById);
}

export function buildScheduleResult(
  matches: ScheduledMatch[],
  players: Player[],
  requiredPairs: RequiredPair[],
  stats: MutableStats,
  playersById: Map<string, Player>,
): ScheduleResult {
  const playerSummaries: PlayerSummary[] = players.map((player) => {
    const totalMatches = getCount(stats.matches, player.playerId);
    const sameGenderDoublesMatches = getCount(stats.sameGender, player.playerId);
    const mixedDoublesMatches = getCount(stats.mixed, player.playerId);
    return {
      playerId: player.playerId,
      name: player.name,
      gender: player.gender,
      totalMatches,
      sameGenderDoublesMatches,
      mixedDoublesMatches,
      sameGenderRatio: totalMatches === 0 ? 0 : sameGenderDoublesMatches / totalMatches,
    };
  });
  return {
    matches: [...matches],
    players: [...players],
    playerSummaries,
    unmetRequiredPairs: requiredPairs.filter((pair) => !stats.satisfiedRequiredPairs.has(pairKey(pair.player1Id, pair.player2Id))),
    repeatedTeamPairs: buildRepeatedTeamPairs(stats, playersById),
    playersWithTwoSlotWait: computePlayersWithTwoSlotWait(matches, players),
  };
}

export function summarizeManualSchedule(matches: ScheduledMatch[], players: Player[], requiredPairs: RequiredPair[]): ScheduleResult {
  const playersById = new Map(players.map((player) => [player.playerId, player]));
  const stats = initializeStats(players);
  const requiredPairKeys = new Set(requiredPairs.map((pair) => pairKey(pair.player1Id, pair.player2Id)));
  for (const match of matches) {
    updateManualStats(match, stats, requiredPairKeys);
  }
  return buildScheduleResult([...matches].sort((a, b) => a.slotStart - b.slotStart || a.court - b.court), players, requiredPairs, stats, playersById);
}

function computeRequiredPairSlotCounts(requiredPairs: RequiredPair[], playersById: Map<string, Player>, slots: number[], slotMinutes: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pair of requiredPairs) {
    const player1 = playersById.get(pair.player1Id);
    const player2 = playersById.get(pair.player2Id);
    if (!player1 || !player2) continue;
    counts.set(
      pairKey(pair.player1Id, pair.player2Id),
      slots.filter((slotStart) => isPlayerAvailable(player1, slotStart, slotMinutes) && isPlayerAvailable(player2, slotStart, slotMinutes)).length,
    );
  }
  return counts;
}

function updateRestStreaksForSlot(stats: MutableStats, availablePlayers: Player[], playedPlayerIds: Set<string>): void {
  const availablePlayerIds = new Set(availablePlayers.map((player) => player.playerId));
  for (const playerId of stats.restStreaks.keys()) {
    if (availablePlayerIds.has(playerId)) {
      stats.restStreaks.set(playerId, playedPlayerIds.has(playerId) ? 0 : getCount(stats.restStreaks, playerId) + 1);
    } else {
      stats.restStreaks.set(playerId, 0);
    }
  }
}

function updateStats(teams: [[Player, Player], [Player, Player]], matchType: MatchType, stats: MutableStats, requiredPairKeys: Set<string>): void {
  const allPlayers = [...teams[0], ...teams[1]];
  const sameGenderMatch = countsAsSameGender(matchType, allPlayers);
  for (const player of allPlayers) {
    increment(stats.matches, player.playerId);
    increment(sameGenderMatch ? stats.sameGender : stats.mixed, player.playerId);
  }
  increment(stats.matchTypeCounts, matchType);
  for (const team of teams) {
    const key = pairKey(team[0].playerId, team[1].playerId);
    increment(stats.teamPairCounts, key);
    if (requiredPairKeys.has(key)) stats.satisfiedRequiredPairs.add(key);
  }
  for (const player of teams[0]) {
    for (const opponent of teams[1]) {
      increment(stats.opponentPairCounts, pairKey(player.playerId, opponent.playerId));
    }
  }
}

function updateManualStats(match: ScheduledMatch, stats: MutableStats, requiredPairKeys: Set<string>): void {
  const players = filledPlayers(match);
  const matchType = displayMatchType(match);
  for (const player of players) {
    increment(stats.matches, player.playerId);
    if (matchType) increment(countsAsSameGender(matchType, players) ? stats.sameGender : stats.mixed, player.playerId);
  }
  if (matchType) increment(stats.matchTypeCounts, matchType);

  const fullTeams = [match.team1, match.team2].filter((team): team is [Player, Player] => Boolean(team[0] && team[1]));
  for (const team of fullTeams) {
    const key = pairKey(team[0].playerId, team[1].playerId);
    increment(stats.teamPairCounts, key);
    if (requiredPairKeys.has(key)) stats.satisfiedRequiredPairs.add(key);
  }
  if (fullTeams.length !== 2) return;
  for (const player of fullTeams[0]) {
    for (const opponent of fullTeams[1]) {
      increment(stats.opponentPairCounts, pairKey(player.playerId, opponent.playerId));
    }
  }
}

function estimateMatchCountTargets(players: Player[], slotMinutes: number, courts: number): [number, number] {
  let totalAppearances = 0;
  for (const slotStart of buildSlots(players, slotMinutes)) {
    const availableCount = players.filter((player) => isPlayerAvailable(player, slotStart, slotMinutes)).length;
    totalAppearances += Math.min(courts, Math.floor(availableCount / 4)) * 4;
  }
  const average = totalAppearances / Math.max(1, players.length);
  return [Math.floor(average), Math.ceil(average)];
}

function determineWomenDoublesLimit(players: Player[]): number | null {
  return players.filter((player) => player.gender === "F").length === 4 ? 2 : null;
}

function preferredSameGenderCount(totalMatches: number, prefersMixedPriority = false): number {
  if (totalMatches <= 0) return 0;
  const minimumSame = Math.ceil(totalMatches * 0.6);
  const preferredRatio = prefersMixedPriority ? 0.6 : 0.8;
  return Math.max(minimumSame, Math.round(totalMatches * preferredRatio));
}

function buildMixedPriorityPlayerIds(requiredPairs: RequiredPair[], playersById: Map<string, Player>): Set<string> {
  const result = new Set<string>();
  for (const pair of requiredPairs) {
    const player1 = playersById.get(pair.player1Id);
    const player2 = playersById.get(pair.player2Id);
    if (!player1 || !player2 || player1.gender === player2.gender) continue;
    result.add(player1.playerId);
    result.add(player2.playerId);
  }
  return result;
}

function buildRequiredPairPlayerIds(requiredPairs: RequiredPair[]): Set<string> {
  return new Set(requiredPairs.flatMap((pair) => [pair.player1Id, pair.player2Id]));
}

function buildRemainingSlotCountsByIndex(players: Player[], slots: number[], slotMinutes: number): Array<Map<string, number>> {
  const remainingCounts = new Map(players.map((player) => [player.playerId, 0]));
  const matrix = slots.map((slotStart) => new Map(players.map((player) => [player.playerId, isPlayerAvailable(player, slotStart, slotMinutes)])));
  const result: Array<Map<string, number>> = Array.from({ length: slots.length }, () => new Map());
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    for (const player of players) {
      if (matrix[index].get(player.playerId)) {
        remainingCounts.set(player.playerId, getCount(remainingCounts, player.playerId) + 1);
      }
    }
    result[index] = new Map(remainingCounts);
  }
  return result;
}

function buildBalanceSignature(selectedMatches: MatchCandidate[], stats: MutableStats): number[] {
  const projectedCounts = new Map(stats.matches);
  for (const candidate of selectedMatches) {
    for (const playerId of candidate.playerIds) increment(projectedCounts, playerId);
  }
  return Array.from(projectedCounts.values()).sort((a, b) => a - b);
}

function buildRestSignature(selectedMatches: MatchCandidate[], stats: MutableStats, availablePlayers: Player[]): [number, number, number] {
  const projectedRestStreaks = new Map(stats.restStreaks);
  const playedPlayerIds = new Set(selectedMatches.flatMap((candidate) => Array.from(candidate.playerIds)));
  const availablePlayerIds = new Set(availablePlayers.map((player) => player.playerId));
  for (const playerId of projectedRestStreaks.keys()) {
    if (availablePlayerIds.has(playerId)) {
      projectedRestStreaks.set(playerId, playedPlayerIds.has(playerId) ? 0 : getCount(projectedRestStreaks, playerId) + 1);
    } else {
      projectedRestStreaks.set(playerId, 0);
    }
  }
  const values = Array.from(projectedRestStreaks.values());
  return [-Math.max(0, ...values), -values.filter((value) => value >= 2).length, -values.reduce((sum, value) => sum + value, 0)];
}

function buildLowPriorityPreferenceSignature(
  selectedMatches: MatchCandidate[],
  availablePlayers: Player[],
  requiredPairKeys: Set<string>,
  unpairedPlayerIds: Set<string>,
  forbiddenWaitingPair: string | null,
  preferEarlyLeave: boolean,
  preferWaitingPair: boolean,
  earliestStartPlayerIds: Set<string>,
): [number, number, number] {
  const playedPlayerIds = new Set(selectedMatches.flatMap((candidate) => Array.from(candidate.playerIds)));
  const waitingPlayers = availablePlayers.filter((player) => !playedPlayerIds.has(player.playerId));
  const waitingPair = waitingPlayers.length === 2 ? pairKey(waitingPlayers[0].playerId, waitingPlayers[1].playerId) : "";
  const avoidRepeatedWaitingPair = forbiddenWaitingPair && waitingPlayers.length === 2 ? (waitingPair !== forbiddenWaitingPair ? 1 : 0) : 0;
  let waitingPairScore = 0;
  if (preferWaitingPair && waitingPlayers.length === 2) {
    if (requiredPairKeys.has(waitingPair)) waitingPairScore = 2;
    else if (waitingPlayers.every((player) => unpairedPlayerIds.has(player.playerId))) waitingPairScore = 1;
  }
  const earlyLeaveCount = preferEarlyLeave ? waitingPlayers.filter((player) => earliestStartPlayerIds.has(player.playerId)).length : 0;
  return [avoidRepeatedWaitingPair, waitingPairScore, earlyLeaveCount];
}

function buildWaitingPairKey(selectedMatches: MatchCandidate[], availablePlayers: Player[]): string | null {
  const playedPlayerIds = new Set(selectedMatches.flatMap((candidate) => Array.from(candidate.playerIds)));
  const waitingPlayerIds = availablePlayers.filter((player) => !playedPlayerIds.has(player.playerId)).map((player) => player.playerId);
  return waitingPlayerIds.length === 2 ? pairKey(waitingPlayerIds[0], waitingPlayerIds[1]) : null;
}

function buildRepeatedTeamPairs(stats: MutableStats, playersById: Map<string, Player>): Array<{ names: [string, string]; count: number }> {
  return Array.from(stats.teamPairCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [id1, id2] = key.split("|");
      return { names: [playersById.get(id1)?.name ?? id1, playersById.get(id2)?.name ?? id2] as [string, string], count };
    })
    .sort((a, b) => b.count - a.count || a.names.join("-").localeCompare(b.names.join("-")));
}

function computePlayersWithTwoSlotWait(matches: ScheduledMatch[], players: Player[]): string[] {
  if (matches.length === 0) return [];
  const slotMinutes = matches[0].slotEnd - matches[0].slotStart;
  const slots = Array.from(new Set(matches.map((match) => match.slotStart))).sort((a, b) => a - b);
  const playedBySlot = new Map(
    slots.map((slotStart) => [
      slotStart,
      new Set(matches.filter((match) => match.slotStart === slotStart).flatMap((match) => filledPlayers(match).map((player) => player.playerId))),
    ]),
  );
  const result: string[] = [];
  for (const player of players) {
    let restStreak = 0;
    let maxRestStreak = 0;
    for (const slotStart of slots) {
      if (!isPlayerAvailable(player, slotStart, slotMinutes)) {
        restStreak = 0;
      } else if (playedBySlot.get(slotStart)?.has(player.playerId)) {
        restStreak = 0;
      } else {
        restStreak += 1;
        maxRestStreak = Math.max(maxRestStreak, restStreak);
      }
    }
    if (maxRestStreak >= 2) result.push(player.name);
  }
  return result.sort();
}

function countsAsSameGender(matchType: MatchType, players: Player[]): boolean {
  if (matchType === "men_doubles" || matchType === "women_doubles" || matchType === "men_doubles_substitute") return true;
  return new Set(players.map((player) => player.gender)).size === 1;
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const choose = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      choose(index + 1, current);
      current.pop();
    }
  };
  choose(0, []);
  return result;
}

function compareSelectionKey(
  a: [number, number[], [number, number, number], [number, number, number], number],
  b: [number, number[], [number, number, number], [number, number, number], number],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  const balance = compareNumberArrays(a[1], b[1]);
  if (balance !== 0) return balance;
  const rest = compareNumberArrays(a[2], b[2]);
  if (rest !== 0) return rest;
  const low = compareNumberArrays(a[3], b[3]);
  if (low !== 0) return low;
  return a[4] - b[4];
}

function compareNumberArrays(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function byPlayerId(a: Player, b: Player): number {
  return a.playerId.localeCompare(b.playerId);
}

function getCount<K>(map: Map<K, number>, key: K): number {
  return map.get(key) ?? 0;
}

function increment<K>(map: Map<K, number>, key: K): void {
  map.set(key, getCount(map, key) + 1);
}

function setsIntersect<T>(a: Set<T>, b: Set<T>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}
