import { describe, expect, it } from "vitest";
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
    storage.setItem("simple-tennis-matcher:v1", JSON.stringify(legacy));

    const restored = loadState(storage);

    expect(restored.settings.startTime).toBe(18 * 60);
    expect(restored.settings.endTime).toBe(20 * 60);
  });

  it("falls back to defaults on corrupt JSON", () => {
    const storage = memoryStorage();
    storage.setItem("simple-tennis-matcher:v1", "{");

    expect(loadState(storage).schemaVersion).toBe(1);
  });

  it("round trips JSON backup", () => {
    const state = defaultState();
    state.currentWeek.participantIds = ["m1"];
    const restored = restoreBackup(JSON.stringify(createBackup(state)));

    expect(restored.currentWeek.participantIds).toEqual(["m1"]);
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
