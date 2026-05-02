import type { ScheduleHistoryEntry } from "./types";

export function nextHistoryName(dateLabel: string, entries: Pick<ScheduleHistoryEntry, "dateLabel">[]): string {
  const count = entries.filter((entry) => entry.dateLabel === dateLabel).length + 1;
  return `${dateLabel} (${count})`;
}
