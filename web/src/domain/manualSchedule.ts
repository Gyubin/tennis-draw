import type { ScheduledMatch } from "./types";

export interface ScheduleCell {
  matchIndex: number;
  side: "team1" | "team2";
  position: 0 | 1;
}

export function canSwapScheduleCells(matches: ScheduledMatch[], source: ScheduleCell, target: ScheduleCell): boolean {
  const sourceMatch = matches[source.matchIndex];
  const targetMatch = matches[target.matchIndex];
  if (!sourceMatch || !targetMatch) return false;
  return sourceMatch.slotStart === targetMatch.slotStart;
}

export function isSameScheduleCell(source: ScheduleCell, target: ScheduleCell): boolean {
  return source.matchIndex === target.matchIndex && source.side === target.side && source.position === target.position;
}

export function swapScheduleCells(matches: ScheduledMatch[], source: ScheduleCell, target: ScheduleCell): boolean {
  if (isSameScheduleCell(source, target)) return false;
  if (!canSwapScheduleCells(matches, source, target)) return false;

  const sourceMatch = matches[source.matchIndex];
  const targetMatch = matches[target.matchIndex];
  const sourcePlayer = sourceMatch[source.side][source.position];
  sourceMatch[source.side][source.position] = targetMatch[target.side][target.position];
  targetMatch[target.side][target.position] = sourcePlayer;
  return true;
}
