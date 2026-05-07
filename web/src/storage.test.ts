import { describe, expect, it } from "vitest";
import { scheduleMatches } from "./domain/scheduler";
import type { AppStateV1, Player } from "./domain/types";
import { createBackup, defaultClub, defaultState, loadState, restoreBackup, saveState } from "./storage";

describe("storage", () => {
  it("returns v2 defaults when storage is empty", () => {
    const storage = memoryStorage();
    const state = loadState(storage);

    expect(state.schemaVersion).toBe(2);
    expect(state.clubs).toHaveLength(1);
    expect(state.clubs[0].name).toBe("기본 클럽");
    expect(state.clubs[0].roster.length).toBeGreaterThan(0);
    expect(state.activeClubId).toBe(state.clubs[0].clubId);
  });

  it("saves and restores v2 state", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.clubs[0].roster[0].name = "Changed";

    saveState(state, storage);

    const restored = loadState(storage);
    expect(restored.clubs[0].roster[0].name).toBe("Changed");
    expect(storage.getItem("tennis-draw:v2")).not.toBeNull();
  });

  it("migrates legacy simple tennis matcher data into a default club", () => {
    const storage = memoryStorage();
    const legacy = legacyState();
    legacy.roster[0].name = "Legacy";
    storage.setItem("simple-tennis-matcher:v1", JSON.stringify(legacy));

    const restored = loadState(storage);

    expect(restored.schemaVersion).toBe(2);
    expect(restored.clubs).toHaveLength(1);
    expect(restored.clubs[0].name).toBe("기본 클럽");
    expect(restored.clubs[0].roster[0].name).toBe("Legacy");
  });

  it("adds default operating times to older saved state during migration", () => {
    const storage = memoryStorage();
    const state = legacyState();
    const legacy = {
      ...state,
      settings: {
        courts: state.settings.courts,
        slotMinutes: state.settings.slotMinutes,
      },
    };
    storage.setItem("tennis-draw:v1", JSON.stringify(legacy));

    const restored = loadState(storage).clubs[0];

    expect(restored.settings.startTime).toBe(18 * 60);
    expect(restored.settings.endTime).toBe(20 * 60);
  });

  it("adds history defaults to older saved state during migration", () => {
    const storage = memoryStorage();
    const state = legacyState();
    const legacy = {
      ...state,
      currentWeek: {
        weekLabel: state.currentWeek.weekLabel,
        participantIds: state.currentWeek.participantIds,
        requiredPairs: state.currentWeek.requiredPairs,
        lastSchedule: state.currentWeek.lastSchedule,
      },
    };
    storage.setItem("tennis-draw:v1", JSON.stringify(legacy));

    const restored = loadState(storage).clubs[0];

    expect(restored.scheduleHistory).toEqual([]);
    expect(restored.currentWeek.activeHistoryId).toBeNull();
  });

  it("replaces invalid saved dates with a valid date label", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.clubs[0].currentWeek.weekLabel = "2026-02-30";
    storage.setItem("tennis-draw:v2", JSON.stringify(state));

    expect(loadState(storage).clubs[0].currentWeek.weekLabel).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const storage = memoryStorage();
    storage.setItem("tennis-draw:v2", "{");

    expect(loadState(storage).schemaVersion).toBe(2);
  });

  it("round trips JSON backup", () => {
    const state = defaultState();
    state.clubs[0].currentWeek.participantIds = ["m1"];
    const restored = restoreBackup(JSON.stringify(createBackup(state)));

    expect(restored.clubs[0].currentWeek.participantIds).toEqual(["m1"]);
  });

  it("restores v1 JSON backup by migrating it into a default club", () => {
    const state = legacyState();
    state.currentWeek.participantIds = ["m1"];
    const restored = restoreBackup(JSON.stringify({ schemaVersion: 1, exportedAt: "2026-05-03T00:00:00.000Z", state }));

    expect(restored.schemaVersion).toBe(2);
    expect(restored.clubs[0].currentWeek.participantIds).toEqual(["m1"]);
  });

  it("round trips schedule history in JSON backup", () => {
    const state = defaultState();
    const club = state.clubs[0];
    const schedule = scheduleMatches(club.roster, [], club.settings.slotMinutes, club.settings.courts);
    club.scheduleHistory.push({
      historyId: "h1",
      name: "2026-05-09 (1)",
      dateLabel: "2026-05-09",
      createdAt: "2026-05-03T00:00:00.000Z",
      settings: { ...club.settings },
      participantIds: [...club.currentWeek.participantIds],
      requiredPairs: [],
      schedule,
    });
    club.currentWeek.activeHistoryId = "h1";

    const restored = restoreBackup(JSON.stringify(createBackup(state)));

    expect(restored.clubs[0].scheduleHistory).toHaveLength(1);
    expect(restored.clubs[0].scheduleHistory[0].name).toBe("2026-05-09 (1)");
    expect(restored.clubs[0].currentWeek.activeHistoryId).toBe("h1");
  });

  it("preserves multiple clubs and repairs an invalid active club id", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.clubs.push(defaultClub("club-2", "두번째 클럽"));
    state.activeClubId = "missing";
    storage.setItem("tennis-draw:v2", JSON.stringify(state));

    const restored = loadState(storage);

    expect(restored.clubs.map((club) => club.name)).toEqual(["기본 클럽", "두번째 클럽"]);
    expect(restored.activeClubId).toBe(restored.clubs[0].clubId);
  });

  it("normalizes saved required pairs to soft mode by default", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.clubs[0].currentWeek.requiredPairs = [{ player1Id: "m1", player2Id: "m2" }];
    storage.setItem("tennis-draw:v2", JSON.stringify(state));

    const restored = loadState(storage);

    expect(restored.clubs[0].currentWeek.requiredPairs).toEqual([{ player1Id: "m1", player2Id: "m2", mode: "soft" }]);
  });

  it("adds empty guest participants to older saved clubs", () => {
    const storage = memoryStorage();
    const state = defaultState();
    const legacyClub = {
      ...state.clubs[0],
      currentWeek: {
        weekLabel: state.clubs[0].currentWeek.weekLabel,
        participantIds: state.clubs[0].currentWeek.participantIds,
        requiredPairs: state.clubs[0].currentWeek.requiredPairs,
        lastSchedule: state.clubs[0].currentWeek.lastSchedule,
        activeHistoryId: state.clubs[0].currentWeek.activeHistoryId,
      },
    };
    storage.setItem("tennis-draw:v2", JSON.stringify({ ...state, clubs: [legacyClub] }));

    const restored = loadState(storage);

    expect(restored.clubs[0].currentWeek.guestParticipants).toEqual([]);
  });

  it("preserves current week guest participants and pairs in v2 state", () => {
    const storage = memoryStorage();
    const state = defaultState();
    const guest = player("guest-1", "게스트 1", "F");
    state.clubs[0].currentWeek.guestParticipants = [guest];
    state.clubs[0].currentWeek.participantIds = ["m1", guest.playerId];
    state.clubs[0].currentWeek.requiredPairs = [{ player1Id: "m1", player2Id: guest.playerId }];
    storage.setItem("tennis-draw:v2", JSON.stringify(state));

    const restored = loadState(storage);

    expect(restored.clubs[0].currentWeek.guestParticipants).toEqual([guest]);
    expect(restored.clubs[0].currentWeek.participantIds).toEqual(["m1", guest.playerId]);
    expect(restored.clubs[0].currentWeek.requiredPairs).toEqual([{ player1Id: "m1", player2Id: guest.playerId, mode: "soft" }]);
  });

  it("removes participant ids and pairs for missing guests during normalization", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.clubs[0].currentWeek.participantIds = ["m1", "guest-missing"];
    state.clubs[0].currentWeek.requiredPairs = [{ player1Id: "m1", player2Id: "guest-missing" }];
    storage.setItem("tennis-draw:v2", JSON.stringify(state));

    const restored = loadState(storage);

    expect(restored.clubs[0].currentWeek.participantIds).toEqual(["m1"]);
    expect(restored.clubs[0].currentWeek.requiredPairs).toEqual([]);
  });
});

function legacyState(): AppStateV1 {
  const state = defaultState();
  const club = state.clubs[0];
  return {
    schemaVersion: 1,
    roster: club.roster,
    settings: club.settings,
    currentWeek: club.currentWeek,
    scheduleHistory: club.scheduleHistory,
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  };
}

function player(playerId: string, name: string, gender: "M" | "F"): Player {
  return {
    playerId,
    name,
    gender,
    availableStart: 18 * 60,
    availableEnd: 20 * 60,
    canFillMaleSlot: false,
    showLateJoin: false,
    showEarlyLeave: false,
  };
}
