export function parseTimeToMinutes(value: string): number {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 2) {
    throw new Error("시간은 HH:MM 형식이어야 합니다.");
  }

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error("시간은 숫자 HH:MM 형식이어야 합니다.");
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("시간은 하루 범위 안이어야 합니다.");
  }
  return hour * 60 + minute;
}

export function formatMinutes(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function formatLocalDate(value: Date): string {
  return `${value.getFullYear()}-${(value.getMonth() + 1).toString().padStart(2, "0")}-${value
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

export function parseLocalDate(value: string): Date {
  const parts = value.split("-");
  if (parts.length !== 3) throw new Error("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  const [year, month, day] = parts.map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error("날짜는 숫자 YYYY-MM-DD 형식이어야 합니다.");
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("유효하지 않은 날짜입니다.");
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

export function buildCurrentWeekLabel(now = new Date()): string {
  const current = new Date(now);
  const day = current.getDay();
  const saturdayDay = 6;
  const daysUntilSaturday = (saturdayDay - day + 7) % 7;
  const saturday = new Date(current);
  saturday.setDate(current.getDate() + daysUntilSaturday);
  saturday.setHours(0, 0, 0, 0);

  const cutoff = new Date(saturday);
  cutoff.setHours(20, 0, 0, 0);
  if (current >= cutoff) {
    saturday.setDate(saturday.getDate() + 7);
  }

  return formatLocalDate(saturday);
}
