import { buildCurrentWeekLabel, parseLocalDate, parseTimeToMinutes } from "./domain/time";
import type { AppState, BackupV1, Player } from "./domain/types";

const STORAGE_KEY = "tennis-draw:v1";
const LEGACY_STORAGE_KEY = "simple-tennis-matcher:v1";

export function defaultState(): AppState {
  const roster = sampleRoster();
  return {
    schemaVersion: 1,
    roster,
    settings: {
      courts: 2,
      slotMinutes: 30,
      startTime: parseTimeToMinutes("18:00"),
      endTime: parseTimeToMinutes("20:00"),
    },
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
  const raw = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.roster)) return defaultState();
    return normalizeState({
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...parsed.settings },
      currentWeek: { ...defaultState().currentWeek, ...parsed.currentWeek },
      scheduleHistory: parsed.scheduleHistory ?? [],
    });
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState, storage: Storage = window.localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createBackup(state: AppState): BackupV1 {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
}

export function restoreBackup(raw: string): AppState {
  const parsed = JSON.parse(raw) as BackupV1;
  if (parsed.schemaVersion !== 1 || parsed.state.schemaVersion !== 1) {
    throw new Error("지원하지 않는 백업 파일입니다.");
  }
  return normalizeState({
    ...defaultState(),
    ...parsed.state,
    settings: { ...defaultState().settings, ...parsed.state.settings },
    currentWeek: { ...defaultState().currentWeek, ...parsed.state.currentWeek },
    scheduleHistory: parsed.state.scheduleHistory ?? [],
  });
}

function normalizeState(state: AppState): AppState {
  const scheduleHistory = Array.isArray(state.scheduleHistory) ? state.scheduleHistory : [];
  const activeHistoryId = scheduleHistory.some((entry) => entry.historyId === state.currentWeek.activeHistoryId)
    ? state.currentWeek.activeHistoryId
    : null;
  const weekLabel = normalizeDateLabel(state.currentWeek.weekLabel);
  return {
    ...state,
    settings: {
      ...state.settings,
      startTime: state.settings.startTime ?? parseTimeToMinutes("18:00"),
      endTime: state.settings.endTime ?? parseTimeToMinutes("20:00"),
    },
    roster: state.roster.map((player) => ({
      ...player,
      availableStart: player.availableStart ?? parseTimeToMinutes("18:00"),
      availableEnd: player.availableEnd ?? parseTimeToMinutes("20:00"),
      canFillMaleSlot: player.canFillMaleSlot ?? false,
      showLateJoin: player.showLateJoin ?? false,
      showEarlyLeave: player.showEarlyLeave ?? false,
    })),
    currentWeek: {
      ...state.currentWeek,
      weekLabel,
      activeHistoryId,
    },
    scheduleHistory,
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
