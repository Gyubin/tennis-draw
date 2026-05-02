import { describe, expect, it } from "vitest";
import { scheduleMatches } from "./domain/scheduler";
import { createBackup, defaultState, loadState, restoreBackup, saveState } from "./storage";

describe("storage", () => {
  it("returns defaults when storage is empty", () => {
    const storage = memoryStorage();
    expect(loadState(storage).schemaVersion).toBe(1);
    expect(loadState(storage).roster.length).toBeGreaterThan(0);
  });

  it("saves and restores state", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.roster[0].name = "Changed";

    saveState(state, storage);

    expect(loadState(storage).roster[0].name).toBe("Changed");
    expect(storage.getItem("tennis-draw:v1")).not.toBeNull();
  });

  it("loads legacy simple tennis matcher data", () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.roster[0].name = "Legacy";
    storage.setItem("simple-tennis-matcher:v1", JSON.stringify(state));

    expect(loadState(storage).roster[0].name).toBe("Legacy");
  });

  it("adds default operating times to older saved state", () => {
    const storage = memoryStorage();
    const state = defaultState();
    const legacy = {
      ...state,
      settings: {
        courts: state.settings.courts,
        slotMinutes: state.settings.slotMinutes,
      },
    };
    storage.setItem("tennis-draw:v1", JSON.stringify(legacy));

    const restored = loadState(storage);

    expect(restored.settings.startTime).toBe(18 * 60);
    expect(restored.settings.endTime).toBe(20 * 60);
  });

  it("adds history defaults to older saved state", () => {
    const storage = memoryStorage();
    const state = defaultState();
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

    const restored = loadState(storage);

    expect(restored.scheduleHistory).toEqual([]);
    expect(restored.currentWeek.activeHistoryId).toBeNull();
  });

  it("replaces invalid saved dates with a valid date label", () => {
    const storage = memoryStorage();
    const state = defaultState();
    storage.setItem(
      "tennis-draw:v1",
      JSON.stringify({
        ...state,
        currentWeek: {
          ...state.currentWeek,
          weekLabel: "2026-02-30",
        },
      }),
    );

    expect(loadState(storage).currentWeek.weekLabel).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const storage = memoryStorage();
    storage.setItem("tennis-draw:v1", "{");

    expect(loadState(storage).schemaVersion).toBe(1);
  });

  it("round trips JSON backup", () => {
    const state = defaultState();
    state.currentWeek.participantIds = ["m1"];
    const restored = restoreBackup(JSON.stringify(createBackup(state)));

    expect(restored.currentWeek.participantIds).toEqual(["m1"]);
  });

  it("round trips schedule history in JSON backup", () => {
    const state = defaultState();
    const schedule = scheduleMatches(state.roster, [], state.settings.slotMinutes, state.settings.courts);
    state.scheduleHistory.push({
      historyId: "h1",
      name: "2026-05-09 (1)",
      dateLabel: "2026-05-09",
      createdAt: "2026-05-03T00:00:00.000Z",
      settings: { ...state.settings },
      participantIds: [...state.currentWeek.participantIds],
      requiredPairs: [],
      schedule,
    });
    state.currentWeek.activeHistoryId = "h1";

    const restored = restoreBackup(JSON.stringify(createBackup(state)));

    expect(restored.scheduleHistory).toHaveLength(1);
    expect(restored.scheduleHistory[0].name).toBe("2026-05-09 (1)");
    expect(restored.currentWeek.activeHistoryId).toBe("h1");
  });
});

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
