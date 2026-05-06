import { buildCurrentWeekLabel, parseLocalDate, parseTimeToMinutes } from "./domain/time";
import type {
  AppSettings,
  AppState,
  AppStateV1,
  BackupV1,
  BackupV2,
  ClubState,
  Player,
  RequiredPair,
  ScheduleHistoryEntry,
} from "./domain/types";

const STORAGE_KEY = "tennis-draw:v2";
const V1_STORAGE_KEY = "tennis-draw:v1";
const LEGACY_STORAGE_KEY = "simple-tennis-matcher:v1";
const DEFAULT_CLUB_ID = "club-default";
const DEFAULT_CLUB_NAME = "기본 클럽";

export function defaultState(): AppState {
  const club = defaultClub(DEFAULT_CLUB_ID, DEFAULT_CLUB_NAME, sampleRoster());
  return {
    schemaVersion: 2,
    activeClubId: club.clubId,
    clubs: [club],
  };
}

export function defaultClub(clubId: string, name: string, roster: Player[] = []): ClubState {
  return {
    clubId,
    name,
    roster,
    settings: defaultSettings(),
    currentWeek: {
      weekLabel: buildCurrentWeekLabel(),
      participantIds: roster.map((player) => player.playerId),
      requiredPairs: [],
      lastSchedule: null,
      activeHistoryId: null,
    },
    scheduleHistory: [],
  };
}

export function loadState(storage: Storage = window.localStorage): AppState {
  const raw = storage.getItem(STORAGE_KEY) ?? storage.getItem(V1_STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as AppState | AppStateV1;
    if (parsed.schemaVersion === 2 && Array.isArray(parsed.clubs)) return normalizeState(parsed);
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.roster)) return migrateV1State(parsed);
    return defaultState();
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState, storage: Storage = window.localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createBackup(state: AppState): BackupV2 {
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    state,
  };
}

export function restoreBackup(raw: string): AppState {
  const parsed = JSON.parse(raw) as BackupV1 | BackupV2;
  if (parsed.schemaVersion === 2 && parsed.state.schemaVersion === 2) {
    return normalizeState(parsed.state);
  }
  if (parsed.schemaVersion === 1 && parsed.state.schemaVersion === 1) {
    return migrateV1State(parsed.state);
  }
  throw new Error("지원하지 않는 백업 파일입니다.");
}

function migrateV1State(state: AppStateV1): AppState {
  const defaults = defaultState();
  const club = normalizeClub({
    clubId: DEFAULT_CLUB_ID,
    name: DEFAULT_CLUB_NAME,
    roster: state.roster,
    settings: { ...defaultSettings(), ...state.settings },
    currentWeek: { ...defaults.clubs[0].currentWeek, ...state.currentWeek },
    scheduleHistory: state.scheduleHistory ?? [],
  });
  return {
    schemaVersion: 2,
    activeClubId: club.clubId,
    clubs: [club],
  };
}

function normalizeState(state: AppState): AppState {
  const fallback = defaultState();
  const clubs = (Array.isArray(state.clubs) && state.clubs.length > 0 ? state.clubs : fallback.clubs).map(normalizeClub);
  const activeClubId = clubs.some((club) => club.clubId === state.activeClubId) ? state.activeClubId : clubs[0].clubId;
  return {
    schemaVersion: 2,
    activeClubId,
    clubs,
  };
}

function normalizeClub(club: ClubState): ClubState {
  const fallback = defaultClub(club.clubId || createClubId(), club.name || DEFAULT_CLUB_NAME);
  const roster = Array.isArray(club.roster) ? club.roster.map(normalizePlayer) : [];
  const rosterIds = new Set(roster.map((player) => player.playerId));
  const scheduleHistory = Array.isArray(club.scheduleHistory) ? club.scheduleHistory.map(normalizeHistoryEntry) : [];
  const currentWeek = { ...fallback.currentWeek, ...club.currentWeek };
  const activeHistoryId = scheduleHistory.some((entry) => entry.historyId === currentWeek.activeHistoryId)
    ? currentWeek.activeHistoryId
    : null;
  return {
    clubId: club.clubId || fallback.clubId,
    name: (club.name || fallback.name).trim() || fallback.name,
    roster,
    settings: normalizeSettings({ ...fallback.settings, ...club.settings }),
    currentWeek: {
      ...currentWeek,
      weekLabel: normalizeDateLabel(currentWeek.weekLabel),
      participantIds: Array.isArray(currentWeek.participantIds) ? currentWeek.participantIds.filter((id) => rosterIds.has(id)) : [],
      requiredPairs: Array.isArray(currentWeek.requiredPairs)
        ? currentWeek.requiredPairs
            .filter((pair) => rosterIds.has(pair.player1Id) && rosterIds.has(pair.player2Id))
            .map(normalizeRequiredPair)
        : [],
      activeHistoryId,
    },
    scheduleHistory,
  };
}

function normalizeHistoryEntry(entry: ScheduleHistoryEntry): ScheduleHistoryEntry {
  return {
    ...entry,
    requiredPairs: Array.isArray(entry.requiredPairs) ? entry.requiredPairs.map(normalizeRequiredPair) : [],
  };
}

function normalizeRequiredPair(pair: RequiredPair): RequiredPair {
  return {
    player1Id: pair.player1Id,
    player2Id: pair.player2Id,
    mode: pair.mode === "hard" ? "hard" : "soft",
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    courts: settings.courts ?? 2,
    slotMinutes: settings.slotMinutes ?? 30,
    startTime: settings.startTime ?? parseTimeToMinutes("18:00"),
    endTime: settings.endTime ?? parseTimeToMinutes("20:00"),
  };
}

function normalizePlayer(player: Player): Player {
  return {
    ...player,
    availableStart: player.availableStart ?? parseTimeToMinutes("18:00"),
    availableEnd: player.availableEnd ?? parseTimeToMinutes("20:00"),
    canFillMaleSlot: player.canFillMaleSlot ?? false,
    showLateJoin: player.showLateJoin ?? false,
    showEarlyLeave: player.showEarlyLeave ?? false,
  };
}

function defaultSettings(): AppSettings {
  return {
    courts: 2,
    slotMinutes: 30,
    startTime: parseTimeToMinutes("18:00"),
    endTime: parseTimeToMinutes("20:00"),
  };
}

function normalizeDateLabel(value: string): string {
  try {
    parseLocalDate(value);
    return value;
  } catch {
    return buildCurrentWeekLabel();
  }
}

function createClubId(): string {
  return crypto.randomUUID?.() ?? `club-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sampleRoster(): Player[] {
  return [
    player("m1", "민준", "M"),
    player("m2", "서준", "M"),
    player("m3", "도윤", "M"),
    player("m4", "지호", "M"),
    player("f1", "서연", "F"),
    player("f2", "하윤", "F"),
    player("f3", "지우", "F"),
    player("f4", "수아", "F"),
  ];
}

function player(playerId: string, name: string, gender: "M" | "F"): Player {
  return {
    playerId,
    name,
    gender,
    availableStart: parseTimeToMinutes("18:00"),
    availableEnd: parseTimeToMinutes("20:00"),
    canFillMaleSlot: false,
    showLateJoin: false,
    showEarlyLeave: false,
  };
}
