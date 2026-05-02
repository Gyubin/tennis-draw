import { displayMatchType, filledPlayers, isPlayerAvailable, summarizeManualSchedule } from "./scheduler";
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
    const matchPlayers = filledPlayers(match);
    const uniquePlayerIds = new Set(matchPlayers.map((player) => player.playerId));
    if (uniquePlayerIds.size !== matchPlayers.length) {
      errors.push(`${match.court}코트 ${match.slotStart} 타임에 중복 선수가 있습니다.`);
    }
    const expectedType = matchPlayers.length === 4 ? displayMatchType(match) : null;
    if (expectedType) {
      match.matchType = expectedType;
    } else if (matchPlayers.length === 4) {
      warnings.push("성비가 어긋납니다.");
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
    for (const player of slotMatches.flatMap(filledPlayers)) {
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
