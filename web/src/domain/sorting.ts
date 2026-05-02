import type { PlayerSummary } from "./types";

const nameCollator = new Intl.Collator(["ko-KR", "en-US"], {
  numeric: true,
  sensitivity: "base",
});

const genderOrder: Record<PlayerSummary["gender"], number> = {
  M: 0,
  F: 1,
};

export function comparePlayerSummaries(a: PlayerSummary, b: PlayerSummary): number {
  return genderOrder[a.gender] - genderOrder[b.gender] || nameCollator.compare(a.name, b.name) || a.playerId.localeCompare(b.playerId);
}
