import { classifyMatch, isPlayerAvailable, summarizeManualSchedule } from "./scheduler";
import type { Player, RequiredPair, ScheduleResult, ScheduledMatch } from "./types";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  summary: ScheduleResult;
}

export function validateSchedule(matches: ScheduledMatch[], players: Player[], requiredPairs: RequiredPair[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const match of matches) {
    const matchPlayers = [...match.team1, ...match.team2];
    const uniquePlayerIds = new Set(matchPlayers.map((player) => player.playerId));
    if (uniquePlayerIds.size !== 4) {
      errors.push(`${match.court}코트 ${match.slotStart} 타임에 중복 선수가 있습니다.`);
    }
    const expectedType = classifyMatch(matchPlayers);
    if (!expectedType) {
      errors.push(`${match.court}코트 경기 조합이 허용되지 않습니다.`);
    } else if (expectedType !== match.matchType) {
      match.matchType = expectedType;
    }
    for (const player of matchPlayers) {
      if (!isPlayerAvailable(player, match.slotStart, match.slotEnd - match.slotStart)) {
        errors.push(`${player.name}의 출전 가능 시간이 맞지 않습니다.`);
      }
    }
  }

  const matchesBySlot = new Map<number, ScheduledMatch[]>();
  for (const match of matches) {
    matchesBySlot.set(match.slotStart, [...(matchesBySlot.get(match.slotStart) ?? []), match]);
  }
  for (const [slotStart, slotMatches] of matchesBySlot.entries()) {
    const seen = new Set<string>();
    for (const player of slotMatches.flatMap((match) => [...match.team1, ...match.team2])) {
      if (seen.has(player.playerId)) {
        errors.push(`${player.name}이 ${slotStart} 타임에 중복 출전합니다.`);
      }
      seen.add(player.playerId);
    }
  }

  const summary = summarizeManualSchedule(matches, players, requiredPairs);
  if (summary.repeatedTeamPairs.length > 0) {
    warnings.push(`반복 페어 ${summary.repeatedTeamPairs.length}건`);
  }
  if (summary.unmetRequiredPairs.length > 0) {
    warnings.push(`필수 페어 미충족 ${summary.unmetRequiredPairs.length}건`);
  }
  if (summary.playersWithTwoSlotWait.length > 0) {
    warnings.push(`2타임 대기자: ${summary.playersWithTwoSlotWait.join(", ")}`);
  }
  return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), summary };
}
