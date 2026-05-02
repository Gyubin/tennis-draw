import { displayMatchTypeLabel } from "./domain/scheduler";
import { formatMinutes } from "./domain/time";
import type { ScheduleResult, ScheduledMatch } from "./domain/types";

export interface ShareRow {
  time: string;
  courts: Array<{
    court: number;
    text: string;
    type: string;
  }>;
}

export function buildShareRows(result: ScheduleResult): ShareRow[] {
  const bySlot = new Map<number, ScheduledMatch[]>();
  for (const match of result.matches) {
    bySlot.set(match.slotStart, [...(bySlot.get(match.slotStart) ?? []), match]);
  }

  return Array.from(bySlot.entries())
    .sort(([a], [b]) => a - b)
    .map(([slotStart, matches]) => ({
      time: `${formatMinutes(slotStart)}-${formatMinutes(matches[0].slotEnd)}`,
      courts: [...matches]
        .sort((a, b) => a.court - b.court)
        .map((match) => ({
          court: match.court,
          text: `${slotName(match.team1[0])}/${slotName(match.team1[1])} vs ${slotName(match.team2[0])}/${slotName(match.team2[1])}`,
          type: displayMatchTypeLabel(match),
        })),
    }));
}

export function buildShareSvg(result: ScheduleResult, title: string): string {
  const rows = buildShareRows(result);
  const maxCourts = Math.max(1, ...rows.map((row) => row.courts.length));
  const width = 1080;
  const titleHeight = 88;
  const rowHeight = 104;
  const footerHeight = 44;
  const timeWidth = 150;
  const courtWidth = Math.floor((width - timeWidth - 40) / maxCourts);
  const height = titleHeight + rows.length * rowHeight + footerHeight;

  const cells = rows
    .map((row, rowIndex) => {
      const y = titleHeight + rowIndex * rowHeight;
      const courtCells = Array.from({ length: maxCourts }, (_, courtIndex) => {
        const court = row.courts[courtIndex];
        const x = 20 + timeWidth + courtIndex * courtWidth;
        const meta = court ? `${court.court}코트${court.type ? ` · ${court.type}` : ""}` : "";
        return `
          <rect x="${x}" y="${y}" width="${courtWidth}" height="${rowHeight}" fill="${courtIndex % 2 === 0 ? "#ffffff" : "#f7faf4"}" stroke="#293126" stroke-width="2"/>
          <text x="${x + 14}" y="${y + 30}" font-size="24" font-weight="800" fill="#263020">${escapeXml(meta)}</text>
          <text x="${x + 14}" y="${y + 70}" font-size="27" font-weight="700" fill="#111811">${court ? escapeXml(compactNames(court.text)) : ""}</text>
        `;
      }).join("");
      return `
        <rect x="20" y="${y}" width="${timeWidth}" height="${rowHeight}" fill="#e6efe0" stroke="#293126" stroke-width="2"/>
        <text x="95" y="${y + 61}" text-anchor="middle" font-size="27" font-weight="900" fill="#111811">${escapeXml(row.time)}</text>
        ${courtCells}
      `;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#f7f8f4"/>
      <text x="20" y="44" font-size="34" font-weight="900" fill="#111811">${escapeXml(title)}</text>
      <text x="20" y="74" font-size="22" font-weight="700" fill="#4d5947">총 ${result.matches.length}경기 · ${rows.length}타임</text>
      ${cells}
      <text x="20" y="${height - 16}" font-size="18" fill="#65705f">Tennis Draw</text>
    </svg>
  `;
}

export async function createSharePngBlob(result: ScheduleResult, title: string): Promise<Blob> {
  const svg = buildShareSvg(result, title);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지를 만들 수 없습니다.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 변환에 실패했습니다."));
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("공유 이미지를 불러오지 못했습니다."));
    image.src = url;
  });
}

function compactNames(value: string): string {
  return value.replaceAll(",", "/");
}

function slotName(player: ScheduledMatch["team1"][number]): string {
  return player?.name ?? "빈칸";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
