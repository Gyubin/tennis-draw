export type Gender = "M" | "F";

export type MatchType =
  | "men_doubles"
  | "women_doubles"
  | "mixed_doubles"
  | "men_doubles_substitute";

export interface Player {
  playerId: string;
  name: string;
  gender: Gender;
  availableStart: number;
  availableEnd: number;
  canFillMaleSlot: boolean;
  showLateJoin: boolean;
  showEarlyLeave: boolean;
}

export interface RequiredPair {
  player1Id: string;
  player2Id: string;
}

export interface ScheduledMatch {
  slotStart: number;
  slotEnd: number;
  court: number;
  team1: [Player, Player];
  team2: [Player, Player];
  matchType: MatchType;
}

export interface PlayerSummary {
  playerId: string;
  name: string;
  gender: Gender;
  totalMatches: number;
  sameGenderDoublesMatches: number;
  mixedDoublesMatches: number;
  sameGenderRatio: number;
}

export interface ScheduleResult {
  matches: ScheduledMatch[];
  players: Player[];
  playerSummaries: PlayerSummary[];
  unmetRequiredPairs: RequiredPair[];
  repeatedTeamPairs: Array<{ names: [string, string]; count: number }>;
  playersWithTwoSlotWait: string[];
}

export interface AppSettings {
  courts: number;
  slotMinutes: number;
  startTime: number;
  endTime: number;
}

export interface WeekState {
  weekLabel: string;
  participantIds: string[];
  requiredPairs: RequiredPair[];
  lastSchedule: ScheduleResult | null;
}

export interface AppState {
  schemaVersion: 1;
  roster: Player[];
  settings: AppSettings;
  currentWeek: WeekState;
}

export interface BackupV1 {
  schemaVersion: 1;
  exportedAt: string;
  state: AppState;
}
