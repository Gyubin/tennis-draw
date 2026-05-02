import { buildCurrentWeekLabel, parseTimeToMinutes } from "./domain/time";
import type { AppState, BackupV1, Player } from "./domain/types";

const STORAGE_KEY = "simple-tennis-matcher:v1";

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
    },
  };
}

export function loadState(storage: Storage = window.localStorage): AppState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.roster)) return defaultState();
    return normalizeState({
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...parsed.settings },
      currentWeek: { ...defaultState().currentWeek, ...parsed.currentWeek },
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
  });
}

function normalizeState(state: AppState): AppState {
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
  };
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
