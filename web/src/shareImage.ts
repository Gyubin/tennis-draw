import { displayMatchTypeLabel, filledPlayers } from "./domain/scheduler";
import { formatMinutes } from "./domain/time";
import type { Player, RequiredPair, ScheduleResult, ScheduledMatch } from "./domain/types";

const analysisFooterHeight = 112;

export interface ShareRow {
  time: string;
  waiting: string[];
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
      waiting: waitingPlayersForSlot(result.players, matches),
      courts: [...matches]
        .sort((a, b) => a.court - b.court)
        .map((match) => ({
          court: match.court,
          text: `${slotName(match.team1[0])}/${slotName(match.team1[1])} vs ${slotName(match.team2[0])}/${slotName(match.team2[1])}`,
          type: displayMatchTypeLabel(match),
        })),
    }));
}

export function buildShareSvg(result: ScheduleResult, title: string, requiredPairs: RequiredPair[] = []): string {
  const rows = buildShareRows(result);
  const playerStatCards = buildPlayerStatCards(result);
  const validationCards = buildValidationCards(result, requiredPairs);
  const maxCourts = Math.max(1, ...rows.map((row) => row.courts.length));
  const width = 1080;
  const titleHeight = 88;
  const matchAreaHeight = 104;
  const rowMetrics = rows.map((row) => {
    const waitingLines = wrapText(`대기: ${row.waiting.length > 0 ? row.waiting.join(", ") : "없음"}`, 54);
    return {
      waitingLines,
      height: matchAreaHeight + 22 + waitingLines.length * 24,
    };
  });
  const footerHeight = calculateAnalysisHeight(playerStatCards, validationCards);
  const timeWidth = 150;
  const courtWidth = Math.floor((width - timeWidth - 40) / maxCourts);
  const scheduleHeight = rowMetrics.reduce((total, metric) => total + metric.height, 0);
  const height = titleHeight + scheduleHeight + footerHeight;
  const analysisY = titleHeight + scheduleHeight;

  const cells = rows
    .map((row, rowIndex) => {
      const y = titleHeight + rowMetrics.slice(0, rowIndex).reduce((total, metric) => total + metric.height, 0);
      const rowHeight = rowMetrics[rowIndex].height;
      const waitingLines = rowMetrics[rowIndex].waitingLines;
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
        <line x1="20" y1="${y + matchAreaHeight}" x2="${width - 20}" y2="${y + matchAreaHeight}" stroke="#c8d4bf" stroke-width="2"/>
        <text x="${20 + timeWidth + 14}" y="${y + matchAreaHeight + 28}" font-size="21" font-weight="800" fill="#3f4a3a">
          ${waitingLines.map((line, lineIndex) => `<tspan x="${20 + timeWidth + 14}" dy="${lineIndex === 0 ? 0 : 24}">${escapeXml(line)}</tspan>`).join("")}
        </text>
      `;
    })
    .join("");

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#f7f8f4"/>
      <text x="20" y="44" font-size="34" font-weight="900" fill="#111811">${escapeXml(title)}</text>
      <text x="20" y="74" font-size="22" font-weight="700" fill="#4d5947">총 ${result.matches.length}경기 · ${rows.length}타임</text>
      ${cells}
      ${renderAnalysisSections(analysisY, playerStatCards, validationCards)}
      <text x="20" y="${height - 16}" font-size="18" fill="#65705f">Tennis Draw</text>
    </svg>
  `;
}

export async function createSharePngBlob(result: ScheduleResult, title: string, requiredPairs: RequiredPair[] = []): Promise<Blob> {
  const svg = buildShareSvg(result, title, requiredPairs);
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

function waitingPlayersForSlot(players: Player[], matches: ScheduledMatch[]): string[] {
  const playedIds = new Set(matches.flatMap((match) => filledPlayers(match).map((player) => player.playerId)));
  return players.filter((player) => !playedIds.has(player.playerId)).map((player) => player.name);
}

interface PlayerStatCard {
  name: string;
  total: string;
  doubles: string;
  ratio: string;
}

interface ValidationCard {
  label: string;
  value: string;
  tone: "ok" | "warn";
}

function buildPlayerStatCards(result: ScheduleResult): PlayerStatCard[] {
  if (result.playerSummaries.length === 0) {
    return [
      {
        name: "선수 통계",
        total: "집계 없음",
        doubles: "",
        ratio: "",
      },
    ];
  }
  return result.playerSummaries.map((summary) => ({
    name: summary.name,
    total: `총 ${summary.totalMatches}경기`,
    doubles: `동성 ${summary.sameGenderDoublesMatches} · 혼성 ${summary.mixedDoublesMatches}`,
    ratio: `동성비율 ${Math.round(summary.sameGenderRatio * 100)}%`,
  }));
}

function buildValidationCards(result: ScheduleResult, requiredPairs: RequiredPair[]): ValidationCard[] {
  return [
    {
      label: "동일 페어 반복",
      value: buildRepeatedPairsText(result),
      tone: result.repeatedTeamPairs.length === 0 ? "ok" : "warn",
    },
    {
      label: "2타임 이상 대기자",
      value: buildTwoSlotWaitText(result),
      tone: result.playersWithTwoSlotWait.length === 0 ? "ok" : "warn",
    },
    {
      label: "필수 페어",
      value: buildRequiredPairsText(result, requiredPairs),
      tone: result.unmetRequiredPairs.length === 0 ? "ok" : "warn",
    },
  ];
}

function calculateAnalysisHeight(playerStatCards: PlayerStatCard[], validationCards: ValidationCard[]): number {
  const statRows = Math.ceil(playerStatCards.length / 4);
  const validationLines = Math.max(...validationCards.map((card) => wrapText(card.value, 24).length));
  const validationCardHeight = Math.max(96, 56 + validationLines * 23);
  return 34 + statRows * 92 + 30 + validationCardHeight + analysisFooterHeight;
}

function renderAnalysisSections(y: number, playerStatCards: PlayerStatCard[], validationCards: ValidationCard[]): string {
  const margin = 20;
  const gap = 10;
  const contentWidth = 1040;
  const statColumns = 4;
  const statCardWidth = Math.floor((contentWidth - gap * (statColumns - 1)) / statColumns);
  const statCardHeight = 82;
  const statRows = Math.ceil(playerStatCards.length / statColumns);
  const statHeaderY = y + 30;
  const statCardsY = y + 44;
  const validationY = statCardsY + statRows * 92 + 30;
  const validationColumns = 3;
  const validationCardWidth = Math.floor((contentWidth - gap * (validationColumns - 1)) / validationColumns);
  const validationLines = Math.max(...validationCards.map((card) => wrapText(card.value, 24).length));
  const validationCardHeight = Math.max(96, 56 + validationLines * 23);

  return `
    <rect x="0" y="${y}" width="1080" height="${calculateAnalysisHeight(playerStatCards, validationCards)}" fill="#eef3e9"/>
    <text x="${margin}" y="${statHeaderY}" font-size="22" font-weight="900" fill="#1f2a1e">통계</text>
    ${playerStatCards
      .map((card, index) => {
        const column = index % statColumns;
        const row = Math.floor(index / statColumns);
        const x = margin + column * (statCardWidth + gap);
        const cardY = statCardsY + row * 92;
        return `
          <rect x="${x}" y="${cardY}" width="${statCardWidth}" height="${statCardHeight}" rx="8" fill="#ffffff" stroke="#cdd8c6"/>
          <text x="${x + 14}" y="${cardY + 25}" font-size="21" font-weight="900" fill="#172019">${escapeXml(card.name)}</text>
          <text x="${x + 14}" y="${cardY + 49}" font-size="18" font-weight="800" fill="#344130">${escapeXml(card.total)}</text>
          <text x="${x + 118}" y="${cardY + 49}" font-size="18" font-weight="800" fill="#344130">${escapeXml(card.ratio)}</text>
          <text x="${x + 14}" y="${cardY + 70}" font-size="17" font-weight="700" fill="#5b6756">${escapeXml(card.doubles)}</text>
        `;
      })
      .join("")}
    <text x="${margin}" y="${validationY}" font-size="22" font-weight="900" fill="#1f2a1e">검증</text>
    ${validationCards
      .map((card, index) => {
        const x = margin + index * (validationCardWidth + gap);
        const cardY = validationY + 14;
        const toneFill = card.tone === "ok" ? "#e7f1df" : "#fff4d7";
        const toneStroke = card.tone === "ok" ? "#b7c8ad" : "#dac176";
        const lines = wrapText(card.value, 24);
        return `
          <rect x="${x}" y="${cardY}" width="${validationCardWidth}" height="${validationCardHeight}" rx="8" fill="#ffffff" stroke="#cdd8c6"/>
          <rect x="${x + 12}" y="${cardY + 12}" width="26" height="26" rx="13" fill="${toneFill}" stroke="${toneStroke}"/>
          <text x="${x + 50}" y="${cardY + 32}" font-size="19" font-weight="900" fill="#172019">${escapeXml(card.label)}</text>
          <text x="${x + 14}" y="${cardY + 62}" font-size="18" font-weight="800" fill="#344130">
            ${lines.map((line, lineIndex) => `<tspan x="${x + 14}" dy="${lineIndex === 0 ? 0 : 23}">${escapeXml(line)}</tspan>`).join("")}
          </text>
        `;
      })
      .join("")}
  `;
}

function buildRepeatedPairsText(result: ScheduleResult): string {
  if (result.repeatedTeamPairs.length === 0) return "없음";
  return result.repeatedTeamPairs.map((pair) => `${pair.names.join("/")} ${pair.count}회`).join(", ");
}

function buildTwoSlotWaitText(result: ScheduleResult): string {
  return result.playersWithTwoSlotWait.length > 0 ? result.playersWithTwoSlotWait.join(", ") : "없음";
}

function buildRequiredPairsText(result: ScheduleResult, requiredPairs: RequiredPair[]): string {
  if (requiredPairs.length === 0) return "설정 없음";
  const unmetPairKeys = new Set(result.unmetRequiredPairs.map((pair) => pairKey(pair.player1Id, pair.player2Id)));
  const playersById = new Map(result.players.map((player: Player) => [player.playerId, player.name]));
  const unmetPairs = requiredPairs.filter((pair) => unmetPairKeys.has(pairKey(pair.player1Id, pair.player2Id)));
  const metCount = requiredPairs.length - unmetPairs.length;
  if (unmetPairs.length === 0) return `충족 ${metCount}/${requiredPairs.length}`;
  return `미충족 ${unmetPairs.length}/${requiredPairs.length}: ${unmetPairs.map((pair) => pairNames(pair, playersById)).join(", ")}`;
}

function pairNames(pair: RequiredPair, playersById: Map<string, string>): string {
  return `${playersById.get(pair.player1Id) ?? pair.player1Id}/${playersById.get(pair.player2Id) ?? pair.player2Id}`;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function wrapText(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) return [value];
  const lines: string[] = [];
  let current = "";
  for (const token of value.split(/(\s+|,\s*|·\s*)/).filter(Boolean)) {
    const next = current + token;
    if (current && next.length > maxLength) {
      lines.push(current.trim());
      current = token.trimStart();
    } else {
      current = next;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.length > 0 ? lines : [value];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
