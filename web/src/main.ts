import "./styles.css";
import { nextHistoryName } from "./domain/history";
import { displayMatchTypeLabel, filledPlayers, scheduleMatches } from "./domain/scheduler";
import { comparePlayerSummaries } from "./domain/sorting";
import { buildCurrentWeekLabel, formatLocalDate, formatMinutes, parseLocalDate, parseTimeToMinutes } from "./domain/time";
import type { AppSettings, AppState, ClubState, Player, PlayerSummary, RequiredPair, ScheduledMatch, ScheduleHistoryEntry, ScheduleResult } from "./domain/types";
import { validateSchedule } from "./domain/validation";
import { createSharePngBlob } from "./shareImage";
import { createBackup, defaultClub, loadState, restoreBackup, saveState } from "./storage";

type DragPayload = { kind: "schedule"; matchIndex: number; side: "team1" | "team2"; position: 0 | 1 };

let state: AppState = loadState();
let activeTab: "schedule" | "participants" | "pairs" | "history" = "schedule";
let rosterOpen = false;
let clubOpen = false;
let dataOpen = false;
let calendarOpen = false;
let calendarMonth = parseLocalDate(activeClub().currentWeek.weekLabel);
let selectedHistoryId: string | null = null;
let sharingImage = false;
let dragPayload: DragPayload | null = null;
let ghost: HTMLElement | null = null;
let dragMoved = false;
let suppressNextScheduleClick = false;
let emptySlotPicker: Extract<DragPayload, { kind: "schedule" }> | null = null;

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("App root not found.");
const app = appElement;
const TIME_OPTION_START = parseTimeToMinutes("06:00");
const TIME_OPTION_END = parseTimeToMinutes("23:30");
const TIME_OPTION_STEP = 30;
const TOUCH_DRAG_DELAY_MS = 500;
const DRAG_MOVE_THRESHOLD_PX = 5;
const TOUCH_SCROLL_THRESHOLD_PX = 12;

render();

function commit(nextState = state): void {
  state = nextState;
  saveState(state);
  render();
}

function render(): void {
  const club = activeClub();
  app.innerHTML = `
    <main class="app-shell">
      <section class="topbar">
        <div>
          <h1>테니스 대진표</h1>
          <p>${escapeHtml(club.name)} · ${club.currentWeek.weekLabel} · ${formatMinutes(club.settings.startTime)}-${formatMinutes(club.settings.endTime)} · ${club.settings.courts}코트 · ${club.settings.slotMinutes}분</p>
        </div>
        <div class="topbar__actions">
          ${renderClubSelect()}
          <button class="text-button" data-action="open-clubs">클럽 관리</button>
          <button class="text-button" data-action="open-roster">클럽원</button>
          <button class="text-button" data-action="share-image">공유 이미지</button>
          <button class="text-button" data-action="toggle-data">데이터</button>
        </div>
      </section>

      <section class="settings-band">
        <div class="date-field">
          <span>날짜</span>
          <div class="date-picker">
            <button class="date-picker__button" type="button" data-action="toggle-calendar">${escapeHtml(activeClub().currentWeek.weekLabel)}</button>
            ${calendarOpen ? renderCalendar() : ""}
          </div>
        </div>
        <label>시작 ${renderTimeSelect("startTime", activeClub().settings.startTime, "data-field=\"startTime\"")}</label>
        <label>종료 ${renderTimeSelect("endTime", activeClub().settings.endTime, "data-field=\"endTime\"")}</label>
        <label>코트 <input data-field="courts" type="number" min="1" max="8" value="${activeClub().settings.courts}" /></label>
        <label>간격 <input data-field="slotMinutes" type="number" min="10" step="5" value="${activeClub().settings.slotMinutes}" /></label>
        <button class="secondary-action" data-action="new-week">새 주차</button>
        <button class="primary-action" data-action="generate">대진 생성</button>
      </section>

      ${dataOpen ? renderDataPanel() : ""}
      <nav class="tabs" aria-label="작업 탭">
        ${renderTabButton("schedule", "대진표", `${activeClub().currentWeek.lastSchedule?.matches.length ?? 0}경기`)}
        ${renderTabButton("participants", "참가", `${activeClub().currentWeek.participantIds.length}명`)}
        ${renderTabButton("pairs", "필수페어", `${activeClub().currentWeek.requiredPairs.length}개`)}
        ${renderTabButton("history", "기록", `${activeClub().scheduleHistory.length}개`)}
      </nav>

      ${renderActiveTab()}
      ${rosterOpen ? renderRosterDrawer() : ""}
      ${clubOpen ? renderClubDrawer() : ""}
    </main>
  `;

  bindEvents();
}

function renderClubSelect(): string {
  return `
    <select class="club-select" data-club-select aria-label="클럽 선택">
      ${state.clubs.map((club) => `<option value="${club.clubId}" ${club.clubId === state.activeClubId ? "selected" : ""}>${escapeHtml(club.name)}</option>`).join("")}
    </select>
  `;
}

function renderDataPanel(): string {
  return `
    <section class="data-panel">
      <button data-action="export">백업 저장(JSON)</button>
      <label class="data-upload">백업 불러오기(JSON)<input type="file" accept="application/json" data-action="import" /></label>
    </section>
  `;
}

function renderTabButton(tab: typeof activeTab, label: string, meta: string): string {
  return `
    <button class="tab ${activeTab === tab ? "tab--active" : ""}" data-action="switch-tab" data-tab="${tab}">
      <strong>${label}</strong><span>${meta}</span>
    </button>
  `;
}

function renderActiveTab(): string {
  if (activeTab === "participants") return renderParticipantsPanel();
  if (activeTab === "pairs") return renderPairsPanel();
  if (activeTab === "history") return renderHistoryPanel();
  const historyEntry = selectedHistoryId ? activeClub().scheduleHistory.find((entry) => entry.historyId === selectedHistoryId) : null;
  const title = historyEntry ? historyEntry.name : "대진표";
  const result = historyEntry?.schedule ?? activeClub().currentWeek.lastSchedule;
  const requiredPairs = historyEntry?.requiredPairs ?? activeClub().currentWeek.requiredPairs;
  const readonly = Boolean(historyEntry);
  return `
    <section class="panel schedule-panel">
      <div class="panel__header panel__header--compact">
        <h2>${escapeHtml(title)}</h2>
        <span>${result?.matches.length ?? 0}경기${historyEntry ? ` · ${escapeHtml(historyEntry.dateLabel)}` : ""}</span>
      </div>
      ${renderSchedule(result, requiredPairs, readonly)}
    </section>
  `;
}

function renderCalendar(): string {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const blanks = Array.from({ length: firstDay.getDay() }, () => `<span class="calendar__blank"></span>`).join("");
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month, index + 1);
    const dateLabel = formatLocalDate(date);
    return `
      <button type="button" class="calendar__day ${dateLabel === activeClub().currentWeek.weekLabel ? "calendar__day--selected" : ""}"
        data-action="select-date"
        data-date="${dateLabel}">${index + 1}</button>
    `;
  }).join("");
  return `
    <div class="calendar" role="dialog" aria-label="날짜 선택">
      <div class="calendar__header">
        <button type="button" class="icon-button icon-button--small" data-action="calendar-prev" aria-label="이전 달">‹</button>
        <strong>${year}.${(month + 1).toString().padStart(2, "0")}</strong>
        <button type="button" class="icon-button icon-button--small" data-action="calendar-next" aria-label="다음 달">›</button>
      </div>
      <div class="calendar__weekdays">
        ${["일", "월", "화", "수", "목", "금", "토"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="calendar__grid">${blanks}${days}</div>
    </div>
  `;
}

function renderParticipantsPanel(): string {
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>이번주 참가</h2>
        <span>${activeClub().currentWeek.participantIds.length}명</span>
      </div>
      <div class="columns">
        <div class="drop-zone" data-participant-zone="active">
          <h3>참가</h3>
          <div class="participant-list">
            ${participants(true).map(renderParticipantRow).join("")}
          </div>
        </div>
        <div class="drop-zone" data-participant-zone="inactive">
          <h3>불참</h3>
          ${participants(false).map(renderInactiveParticipantRow).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderPairsPanel(): string {
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>필수 페어</h2>
        <button data-action="add-pair">추가</button>
      </div>
      <div class="required-pairs required-pairs--standalone">
        ${renderRequiredPairs()}
      </div>
    </section>
  `;
}

function renderHistoryPanel(): string {
  const entries = [...activeClub().scheduleHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `
    <section class="panel">
      <div class="panel__header">
        <h2>대진표 기록</h2>
        <span>${entries.length}개</span>
      </div>
      <div class="history-list">
        ${
          entries.length === 0
            ? `<p class="empty">아직 저장된 대진표가 없습니다.</p>`
            : entries.map(renderHistoryRow).join("")
        }
      </div>
    </section>
  `;
}

function renderHistoryRow(entry: ScheduleHistoryEntry): string {
  return `
    <div class="history-row ${selectedHistoryId === entry.historyId ? "history-row--active" : ""}" data-history-id="${entry.historyId}">
      <button type="button" class="history-row__open" data-action="view-history" data-history-id="${entry.historyId}">
        <strong>${escapeHtml(entry.name)}</strong>
        <span>${escapeHtml(entry.dateLabel)} · ${entry.schedule.matches.length}경기 · ${entry.participantIds.length}명</span>
      </button>
      <input data-history-name="${entry.historyId}" value="${escapeHtml(entry.name)}" aria-label="기록 이름" />
      <button type="button" data-action="delete-history" data-history-id="${entry.historyId}">삭제</button>
    </div>
  `;
}

function renderRosterDrawer(): string {
  return `
    <div class="drawer-backdrop" data-action="close-roster"></div>
    <aside class="roster-drawer" aria-label="클럽원 관리">
      <div class="panel__header">
        <h2>클럽원</h2>
        <div class="drawer-actions">
          <button data-action="add-player">추가</button>
          <button class="icon-button icon-button--small" data-action="close-roster">×</button>
        </div>
      </div>
      <div class="roster-list">
        ${activeClub().roster.map(renderRosterRow).join("")}
      </div>
    </aside>
  `;
}

function renderClubDrawer(): string {
  return `
    <div class="drawer-backdrop" data-action="close-clubs"></div>
    <aside class="roster-drawer" aria-label="클럽 관리">
      <div class="panel__header">
        <h2>클럽 관리</h2>
        <div class="drawer-actions">
          <button data-action="add-club">추가</button>
          <button class="icon-button icon-button--small" data-action="close-clubs">×</button>
        </div>
      </div>
      <div class="club-list">
        ${state.clubs.map(renderClubRow).join("")}
      </div>
    </aside>
  `;
}

function renderClubRow(club: ClubState): string {
  return `
    <form class="club-row ${club.clubId === state.activeClubId ? "club-row--active" : ""}" data-club-form="${club.clubId}">
      <input name="name" value="${escapeHtml(club.name)}" aria-label="클럽 이름" />
      <button type="button" data-action="switch-club" data-club-id="${club.clubId}">선택</button>
      <button type="button" data-action="delete-club" data-club-id="${club.clubId}" ${state.clubs.length <= 1 ? "disabled" : ""}>삭제</button>
      <span>${club.roster.length}명 · ${club.scheduleHistory.length}기록</span>
    </form>
  `;
}

function renderRequiredPairs(): string {
  const activePlayers = participants(true);
  if (activePlayers.length < 2) return `<p class="helper">참가자가 2명 이상일 때 설정할 수 있습니다.</p>`;
  if (activeClub().currentWeek.requiredPairs.length === 0) return `<p class="helper">필요한 페어가 있으면 추가하세요.</p>`;
  return activeClub().currentWeek.requiredPairs
    .map(
      (pair, index) => `
        <div class="pair-row" data-pair-index="${index}">
          ${renderPlayerSelect("player1", pair.player1Id, activePlayers)}
          ${renderPlayerSelect("player2", pair.player2Id, activePlayers)}
          <button data-action="delete-pair" data-pair-index="${index}">×</button>
        </div>
      `,
    )
    .join("");
}

function renderPlayerSelect(name: string, selectedId: string, players: Player[]): string {
  return `
    <select name="${name}">
      ${players.map((player) => `<option value="${player.playerId}" ${player.playerId === selectedId ? "selected" : ""}>${escapeHtml(player.name)}</option>`).join("")}
    </select>
  `;
}

function renderRosterRow(player: Player): string {
  return `
    <form class="roster-row" data-player-form="${player.playerId}">
      <input name="name" value="${escapeHtml(player.name)}" aria-label="이름" />
      <select name="gender" aria-label="성별">
        <option value="M" ${player.gender === "M" ? "selected" : ""}>남</option>
        <option value="F" ${player.gender === "F" ? "selected" : ""}>여</option>
      </select>
      <button type="button" data-action="delete-player" data-player-id="${player.playerId}">×</button>
    </form>
  `;
}

function renderParticipantRow(player: Player): string {
  const invalid = player.availableEnd <= player.availableStart;
  return `
    <div class="participant-row ${invalid ? "participant-row--invalid" : ""}">
      ${renderPlayerChip(player)}
      <div class="participant-row__times" aria-label="참가 가능 시간">
        ${renderTimeSelect("start", player.availableStart, `data-player-time="${player.playerId}" data-time-field="start" aria-label="${escapeHtml(`${player.name} 시작 시간`)}"`)}
        <span aria-hidden="true">-</span>
        ${renderTimeSelect("end", player.availableEnd, `data-player-time="${player.playerId}" data-time-field="end" aria-label="${escapeHtml(`${player.name} 종료 시간`)}"`)}
      </div>
      <button type="button" data-action="remove-participant" data-player-id="${player.playerId}">불참</button>
      ${invalid ? `<small>끝 시간이 시작보다 늦어야 합니다.</small>` : ""}
    </div>
  `;
}

function renderInactiveParticipantRow(player: Player): string {
  return `
    <div class="inactive-participant-row">
      ${renderPlayerChip(player)}
      <button type="button" data-action="add-participant" data-player-id="${player.playerId}">참가</button>
    </div>
  `;
}

function renderTimeSelect(name: string, selectedMinutes: number, attributes: string): string {
  return `
    <select name="${name}" class="time-text" ${attributes}>
      ${timeOptions(selectedMinutes)
        .map((minutes) => `<option value="${formatMinutes(minutes)}" ${minutes === selectedMinutes ? "selected" : ""}>${formatMinutes(minutes)}</option>`)
        .join("")}
    </select>
  `;
}

function timeOptions(selectedMinutes: number): number[] {
  const options: number[] = [];
  for (let minutes = TIME_OPTION_START; minutes <= TIME_OPTION_END; minutes += TIME_OPTION_STEP) {
    options.push(minutes);
  }
  if (!options.includes(selectedMinutes)) {
    options.push(selectedMinutes);
    options.sort((a, b) => a - b);
  }
  return options;
}

function renderPlayerChip(player: Player): string {
  return `
    <div class="player-chip ${player.gender === "F" ? "player-chip--female" : ""}" data-player-id="${player.playerId}">
      <strong>${escapeHtml(player.name)}</strong><span>${player.gender === "M" ? "남" : "여"}</span>
    </div>
  `;
}

function renderSchedule(result: ScheduleResult | null, requiredPairs: RequiredPair[], readonly: boolean): string {
  if (!result) {
    return `<div class="empty">참가자를 정리한 뒤 대진 생성을 누르세요.</div>`;
  }
  const validation = validateSchedule(result.matches, result.players, requiredPairs);
  const grouped = groupMatches(result.matches);
  return `
    ${renderStatus(validation.errors, validation.warnings)}
    <div class="schedule-grid">
      ${grouped
        .map(
          ([slot, matches]) => `
        <section class="slot">
          <h3>${formatMinutes(slot)}-${formatMinutes(matches[0].slotEnd)}</h3>
          ${matches.map((match) => renderMatchCard(match, result.matches.indexOf(match), readonly)).join("")}
          ${renderWaitingLine(slot, matches, result.players)}
        </section>
      `,
        )
        .join("")}
    </div>
    ${renderScheduleAnalysis(validation.summary, requiredPairs)}
  `;
}

function renderStatus(errors: string[], warnings: string[]): string {
  if (errors.length === 0 && warnings.length === 0) return "";
  return `
    <div class="status ${errors.length > 0 ? "status--error" : ""}">
      ${errors.length > 0 ? errors.map(escapeHtml).join("<br />") : ""}
      ${warnings.length > 0 ? `<small>${warnings.map(escapeHtml).join(" · ")}</small>` : ""}
    </div>
  `;
}

function renderScheduleAnalysis(summary: ScheduleResult, requiredPairs: RequiredPair[]): string {
  return `
    <section class="analysis-section">
      <div class="analysis-block">
        <h3>인원별 통계</h3>
        <div class="player-stats">
          <div class="player-stat-row player-stat-row--header">
            <strong>이름</strong>
            <span>성별</span>
            <span>총</span>
            <span>동성</span>
            <span>혼성</span>
            <span>동성비율</span>
          </div>
          ${[...summary.playerSummaries].sort(comparePlayerSummaries).map(renderPlayerSummaryRow).join("")}
        </div>
      </div>
      <div class="analysis-block">
        <h3>검증항목</h3>
        <div class="validation-checks">
          ${renderValidationCheck("동일 페어 반복", renderRepeatedPairCheck(summary))}
          ${renderValidationCheck("2타임 이상 대기자", summary.playersWithTwoSlotWait.length > 0 ? summary.playersWithTwoSlotWait.map(escapeHtml).join(", ") : "없음")}
          ${renderValidationCheck("필수 페어 충족 여부", renderRequiredPairCheck(summary, requiredPairs))}
        </div>
      </div>
    </section>
  `;
}

function renderPlayerSummaryRow(summary: PlayerSummary): string {
  return `
    <div class="player-stat-row">
      <strong>${escapeHtml(summary.name)}</strong>
      <span>${summary.gender === "M" ? "남" : "여"}</span>
      <span>${summary.totalMatches}경기</span>
      <span>${summary.sameGenderDoublesMatches}</span>
      <span>${summary.mixedDoublesMatches}</span>
      <span>${Math.round(summary.sameGenderRatio * 100)}%</span>
    </div>
  `;
}

function renderValidationCheck(label: string, value: string): string {
  return `
    <div class="validation-check">
      <strong>${escapeHtml(label)}</strong>
      <span>${value}</span>
    </div>
  `;
}

function renderRepeatedPairCheck(summary: ScheduleResult): string {
  if (summary.repeatedTeamPairs.length === 0) return "없음";
  return summary.repeatedTeamPairs
    .map((pair) => `${pair.names.map(escapeHtml).join("/")} ${pair.count}회`)
    .join(", ");
}

function renderRequiredPairCheck(summary: ScheduleResult, requiredPairs: RequiredPair[]): string {
  if (requiredPairs.length === 0) return "설정 없음";
  const unmetPairKeys = new Set(summary.unmetRequiredPairs.map((pair) => `${pair.player1Id}|${pair.player2Id}`));
  const unmetPairs = requiredPairs.filter((pair) => unmetPairKeys.has(`${pair.player1Id}|${pair.player2Id}`));
  const metCount = requiredPairs.length - unmetPairs.length;
  if (unmetPairs.length === 0) return `충족 ${metCount}/${requiredPairs.length}`;
  return `미충족 ${unmetPairs.length}/${requiredPairs.length}: ${unmetPairs.map((pair) => renderRequiredPairNames(pair, summary.players)).join(", ")}`;
}

function renderRequiredPairNames(pair: RequiredPair, players: Player[]): string {
  const playersById = new Map(players.map((player) => [player.playerId, player.name]));
  return `${escapeHtml(playersById.get(pair.player1Id) ?? pair.player1Id)}/${escapeHtml(playersById.get(pair.player2Id) ?? pair.player2Id)}`;
}

function renderMatchCard(match: ScheduledMatch, matchIndex: number, readonly: boolean): string {
  const label = displayMatchTypeLabel(match);
  return `
    <article class="match-card">
      <div class="match-card__meta">${match.court}코트${label ? ` · ${label}` : ""}</div>
      <div class="teams">
        ${renderSchedulePlayer(match.team1[0], matchIndex, "team1", 0, readonly)}
        ${renderSchedulePlayer(match.team1[1], matchIndex, "team1", 1, readonly)}
        <span class="versus">vs</span>
        ${renderSchedulePlayer(match.team2[0], matchIndex, "team2", 0, readonly)}
        ${renderSchedulePlayer(match.team2[1], matchIndex, "team2", 1, readonly)}
      </div>
      ${renderEmptySlotPicker(match, matchIndex, readonly)}
    </article>
  `;
}

function renderSchedulePlayer(player: Player | null, matchIndex: number, side: "team1" | "team2", position: 0 | 1, readonly: boolean): string {
  if (!player) {
    return `
      <button class="player-chip player-chip--schedule player-chip--empty"
        ${readonly ? "" : `data-draggable="schedule"`}
        ${readonly ? "" : `data-action="open-empty-slot"`}
        data-match-index="${matchIndex}"
        data-side="${side}"
        data-position="${position}"
        type="button"
        aria-label="빈칸">빈칸</button>
    `;
  }
  return `
    <button class="player-chip player-chip--schedule ${player.gender === "F" ? "player-chip--female" : ""}"
      ${readonly ? "" : `data-draggable="schedule"`}
      ${readonly ? "" : `data-action="bench-schedule-player"`}
      data-match-index="${matchIndex}"
      data-side="${side}"
      data-position="${position}"
      type="button">${escapeHtml(player.name)}</button>
  `;
}

function renderEmptySlotPicker(match: ScheduledMatch, matchIndex: number, readonly: boolean): string {
  if (readonly || !emptySlotPicker || emptySlotPicker.matchIndex !== matchIndex) return "";
  if (match[emptySlotPicker.side][emptySlotPicker.position]) return "";
  const waiting = waitingPlayersForSlot(match);
  return `
    <div class="empty-slot-picker">
      ${
        waiting.length === 0
          ? `<span>선택 가능한 대기 인원이 없습니다.</span>`
          : waiting
              .map(
                (player) => `
                  <button type="button"
                    class="empty-slot-picker__player ${player.gender === "F" ? "empty-slot-picker__player--female" : "empty-slot-picker__player--male"}"
                    data-action="fill-empty-slot"
                    data-match-index="${matchIndex}"
                    data-side="${emptySlotPicker?.side}"
                    data-position="${emptySlotPicker?.position}"
                    data-player-id="${player.playerId}">
                    ${escapeHtml(player.name)}
                  </button>
                `,
              )
              .join("")
      }
      <button type="button" class="empty-slot-picker__close" data-action="close-empty-slot">닫기</button>
    </div>
  `;
}

function renderWaitingLine(slotStart: number, matches: ScheduledMatch[], players: Player[]): string {
  const slotMinutes = matches[0].slotEnd - matches[0].slotStart;
  const playedIds = new Set(matches.flatMap((match) => filledPlayers(match).map((player) => player.playerId)));
  const waiting = players
    .filter((player) => !playedIds.has(player.playerId))
    .filter((player) => isWaitingVisible(player, slotStart, slotMinutes))
    .map((player) => player.name);
  return `<p class="waiting">대기: ${waiting.length > 0 ? waiting.map(escapeHtml).join(", ") : "없음"}</p>`;
}

function bindEvents(): void {
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.dataset.field === "courts") {
        activeClub().settings.courts = Math.max(1, Number(input.value) || 1);
        activeClub().currentWeek.lastSchedule = null;
        activeClub().currentWeek.activeHistoryId = null;
      }
      if (input.dataset.field === "slotMinutes") {
        activeClub().settings.slotMinutes = Math.max(5, Number(input.value) || 30);
        activeClub().currentWeek.lastSchedule = null;
        activeClub().currentWeek.activeHistoryId = null;
      }
      if (input.dataset.field === "startTime") updateSettingsTime("startTime", String(input.value));
      if (input.dataset.field === "endTime") updateSettingsTime("endTime", String(input.value));
      commit();
    });
  });

  app.querySelectorAll<HTMLFormElement>("[data-player-form]").forEach((form) => {
    form.addEventListener("change", () => updatePlayerFromForm(form));
  });
  app.querySelectorAll<HTMLElement>("[data-pair-index]").forEach((row) => {
    row.addEventListener("change", () => updatePairFromRow(row));
  });
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-player-time]").forEach((input) => {
    input.addEventListener("change", () => updateParticipantTime(input));
  });
  app.querySelectorAll<HTMLInputElement>("[data-history-name]").forEach((input) => {
    input.addEventListener("change", () => renameHistoryEntry(input));
  });
  app.querySelector<HTMLSelectElement>("[data-club-select]")?.addEventListener("change", (event) => {
    switchClub((event.target as HTMLSelectElement).value);
  });
  app.querySelectorAll<HTMLFormElement>("[data-club-form]").forEach((form) => {
    form.addEventListener("change", () => updateClubFromForm(form));
  });

  app.querySelectorAll<HTMLElement>("[data-draggable]").forEach((element) => {
    element.addEventListener("pointerdown", startDrag);
  });

  app.removeEventListener("click", handleClick);
  app.addEventListener("click", handleClick);
  app.querySelector<HTMLInputElement>("[data-action='import']")?.addEventListener("change", handleImport);
}

function handleClick(event: Event): void {
  const target = event.target as HTMLElement;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  if (action === "switch-tab") switchTab(actionTarget.dataset.tab);
  if (action === "open-clubs") openClubs();
  if (action === "close-clubs") closeClubs();
  if (action === "add-club") addClub();
  if (action === "switch-club") switchClub(actionTarget.dataset.clubId ?? "");
  if (action === "delete-club") deleteClub(actionTarget.dataset.clubId ?? "");
  if (action === "open-roster") openRoster();
  if (action === "close-roster") closeRoster();
  if (action === "toggle-data") toggleDataPanel();
  if (action === "toggle-calendar") toggleCalendar();
  if (action === "calendar-prev") moveCalendarMonth(-1);
  if (action === "calendar-next") moveCalendarMonth(1);
  if (action === "select-date") selectDate(actionTarget.dataset.date ?? "");
  if (action === "add-player") addPlayer();
  if (action === "delete-player") deletePlayer(actionTarget.dataset.playerId ?? "");
  if (action === "add-participant") addParticipant(actionTarget.dataset.playerId ?? "");
  if (action === "remove-participant") removeParticipant(actionTarget.dataset.playerId ?? "");
  if (action === "open-empty-slot") openEmptySlotPicker(actionTarget);
  if (action === "close-empty-slot") closeEmptySlotPicker();
  if (action === "fill-empty-slot") fillEmptySlot(actionTarget);
  if (action === "bench-schedule-player") benchSchedulePlayer(actionTarget);
  if (action === "generate") generateSchedule();
  if (action === "new-week") newWeek();
  if (action === "export") exportBackup();
  if (action === "share-image") void shareImage();
  if (action === "add-pair") addPair();
  if (action === "delete-pair") deletePair(Number(actionTarget.dataset.pairIndex));
  if (action === "view-history") viewHistory(actionTarget.dataset.historyId ?? "");
  if (action === "delete-history") deleteHistory(actionTarget.dataset.historyId ?? "");
}

function switchTab(tab: string | undefined): void {
  if (tab === "schedule" || tab === "participants" || tab === "pairs" || tab === "history") {
    activeTab = tab;
    if (tab !== "schedule") selectedHistoryId = null;
    render();
  }
}

function openClubs(): void {
  clubOpen = true;
  render();
}

function closeClubs(): void {
  clubOpen = false;
  render();
}

function openRoster(): void {
  rosterOpen = true;
  render();
}

function closeRoster(): void {
  rosterOpen = false;
  render();
}

function addClub(): void {
  const club = defaultClub(createClubId(), `새 클럽 ${state.clubs.length + 1}`);
  state.clubs.push(club);
  switchClub(club.clubId);
}

function switchClub(clubId: string): void {
  if (!state.clubs.some((club) => club.clubId === clubId)) return;
  state.activeClubId = clubId;
  clubOpen = false;
  selectedHistoryId = null;
  calendarOpen = false;
  calendarMonth = parseLocalDate(activeClub().currentWeek.weekLabel);
  commit();
}

function deleteClub(clubId: string): void {
  if (state.clubs.length <= 1) return;
  const index = state.clubs.findIndex((club) => club.clubId === clubId);
  if (index < 0) return;
  state.clubs.splice(index, 1);
  if (state.activeClubId === clubId) {
    state.activeClubId = state.clubs[Math.max(0, index - 1)].clubId;
    selectedHistoryId = null;
    calendarMonth = parseLocalDate(activeClub().currentWeek.weekLabel);
  }
  commit();
}

function updateClubFromForm(form: HTMLFormElement): void {
  const club = state.clubs.find((item) => item.clubId === form.dataset.clubForm);
  if (!club) return;
  const data = new FormData(form);
  club.name = String(data.get("name") || club.name).trim() || club.name;
  commit();
}

function toggleDataPanel(): void {
  dataOpen = !dataOpen;
  render();
}

function toggleCalendar(): void {
  calendarOpen = !calendarOpen;
  calendarMonth = parseLocalDate(activeClub().currentWeek.weekLabel);
  render();
}

function moveCalendarMonth(delta: number): void {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1);
  render();
}

function selectDate(dateLabel: string): void {
  try {
    calendarMonth = parseLocalDate(dateLabel);
  } catch {
    return;
  }
  activeClub().currentWeek.weekLabel = dateLabel;
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  selectedHistoryId = null;
  calendarOpen = false;
  commit();
}

function startDrag(event: PointerEvent): void {
  const element = event.currentTarget as HTMLElement;
  if (element.dataset.draggable !== "schedule") return;

  const startX = event.clientX;
  const startY = event.clientY;
  if (event.pointerType === "touch") {
    startDelayedTouchDrag(element, event, startX, startY);
    return;
  }

  beginScheduleDrag(element, event.pointerId, event.clientX, event.clientY);
  bindActiveDragListeners(element, event.pointerId, startX, startY);
}

function startDelayedTouchDrag(element: HTMLElement, event: PointerEvent, startX: number, startY: number): void {
  let active = false;
  let cancelled = false;
  const pointerId = event.pointerId;
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    active = true;
    beginScheduleDrag(element, pointerId, startX, startY);
  }, TOUCH_DRAG_DELAY_MS);

  const cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
  };
  const cancel = () => {
    cancelled = true;
    cleanup();
  };
  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    const distanceX = Math.abs(moveEvent.clientX - startX);
    const distanceY = Math.abs(moveEvent.clientY - startY);
    if (!active && distanceY > TOUCH_SCROLL_THRESHOLD_PX && distanceY > distanceX * 1.2) {
      cancel();
      return;
    }
    if (active) {
      moveEvent.preventDefault();
      if (Math.hypot(distanceX, distanceY) > DRAG_MOVE_THRESHOLD_PX) dragMoved = true;
      moveGhost(moveEvent.clientX, moveEvent.clientY);
    }
  };
  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    cleanup();
    if (!active) return;
    releasePointerCapture(element, pointerId);
    finishDrag(upEvent.clientX, upEvent.clientY);
    suppressNextScheduleClick = true;
  };
  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    cleanup();
    if (!active) return;
    releasePointerCapture(element, pointerId);
    cancelDrag();
    suppressNextScheduleClick = true;
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
}

function beginScheduleDrag(element: HTMLElement, pointerId: number, clientX: number, clientY: number): void {
  dragMoved = false;
  setPointerCapture(element, pointerId);
  const rect = element.getBoundingClientRect();
  ghost = element.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  document.body.appendChild(ghost);
  moveGhost(clientX, clientY);
  dragPayload = {
    kind: "schedule",
    matchIndex: Number(element.dataset.matchIndex),
    side: element.dataset.side === "team1" ? "team1" : "team2",
    position: Number(element.dataset.position) === 0 ? 0 : 1,
  };
}

function bindActiveDragListeners(element: HTMLElement, pointerId: number, startX: number, startY: number): void {
  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > DRAG_MOVE_THRESHOLD_PX) dragMoved = true;
    moveGhost(moveEvent.clientX, moveEvent.clientY);
  };
  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return;
    releasePointerCapture(element, pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    finishDrag(upEvent.clientX, upEvent.clientY);
    suppressNextScheduleClick = dragMoved;
  };
  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return;
    releasePointerCapture(element, pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    cancelDrag();
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onCancel);
}

function finishDrag(clientX: number, clientY: number): void {
  ghost?.remove();
  ghost = null;
  const payload = dragPayload;
  dragPayload = null;
  if (!payload) return;
  if (!dragMoved) return;
  const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-draggable='schedule']");
  if (!target) return;

  swapSchedulePlayers(payload, {
    kind: "schedule",
    matchIndex: Number(target.dataset.matchIndex),
    side: target.dataset.side === "team1" ? "team1" : "team2",
    position: Number(target.dataset.position) === 0 ? 0 : 1,
  });
}

function cancelDrag(): void {
  ghost?.remove();
  ghost = null;
  dragPayload = null;
}

function setPointerCapture(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture can fail if the long-press pointer was cancelled by the browser.
  }
}

function releasePointerCapture(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Ignore stale pointer capture state after browser-level cancellation.
  }
}

function moveGhost(clientX: number, clientY: number): void {
  if (!ghost) return;
  ghost.style.left = `${clientX + 8}px`;
  ghost.style.top = `${clientY + 8}px`;
}

function updatePlayerFromForm(form: HTMLFormElement): void {
  const id = form.dataset.playerForm;
  const player = activeClub().roster.find((item) => item.playerId === id);
  if (!player) return;
  const data = new FormData(form);
  player.name = String(data.get("name") || player.name).trim() || player.name;
  player.gender = String(data.get("gender")) === "F" ? "F" : "M";
  player.canFillMaleSlot = false;
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function updateSettingsTime(field: "startTime" | "endTime", value: string): void {
  const minutes = parseTimeToMinutes(value);
  activeClub().settings[field] = minutes;
  for (const playerId of activeClub().currentWeek.participantIds) {
    const player = activeClub().roster.find((item) => item.playerId === playerId);
    if (!player) continue;
    if (field === "startTime") player.availableStart = minutes;
    if (field === "endTime") player.availableEnd = minutes;
  }
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
}

function updateParticipantTime(input: HTMLInputElement | HTMLSelectElement): void {
  const player = activeClub().roster.find((item) => item.playerId === input.dataset.playerTime);
  if (!player) return;
  const minutes = parseTimeToMinutes(input.value);
  if (input.dataset.timeField === "start") player.availableStart = minutes;
  if (input.dataset.timeField === "end") player.availableEnd = minutes;
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function addPlayer(): void {
  const nextNumber = activeClub().roster.length + 1;
  const player: Player = {
    playerId: `p${Date.now()}`,
    name: `새 회원 ${nextNumber}`,
    gender: "M",
    availableStart: activeClub().settings.startTime,
    availableEnd: activeClub().settings.endTime,
    canFillMaleSlot: false,
    showLateJoin: false,
    showEarlyLeave: false,
  };
  activeClub().roster.push(player);
  activeClub().currentWeek.participantIds.push(player.playerId);
  commit();
}

function deletePlayer(playerId: string): void {
  activeClub().roster = activeClub().roster.filter((player) => player.playerId !== playerId);
  activeClub().currentWeek.participantIds = activeClub().currentWeek.participantIds.filter((id) => id !== playerId);
  activeClub().currentWeek.requiredPairs = activeClub().currentWeek.requiredPairs.filter((pair) => pair.player1Id !== playerId && pair.player2Id !== playerId);
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function addParticipant(playerId: string): void {
  if (!activeClub().currentWeek.participantIds.includes(playerId)) {
    const player = activeClub().roster.find((item) => item.playerId === playerId);
    if (player) {
      player.availableStart = activeClub().settings.startTime;
      player.availableEnd = activeClub().settings.endTime;
    }
    activeClub().currentWeek.participantIds.push(playerId);
    activeClub().currentWeek.lastSchedule = null;
    activeClub().currentWeek.activeHistoryId = null;
    commit();
  }
}

function removeParticipant(playerId: string): void {
  activeClub().currentWeek.participantIds = activeClub().currentWeek.participantIds.filter((id) => id !== playerId);
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function generateSchedule(): void {
  const players = participants(true);
  if (players.length < 4) {
    alert("최소 4명의 참가자가 필요합니다.");
    return;
  }
  if (activeClub().settings.endTime <= activeClub().settings.startTime) {
    alert("전체 끝 시간이 시작보다 늦어야 합니다.");
    return;
  }
  const invalidPlayer = players.find((player) => player.availableEnd <= player.availableStart);
  if (invalidPlayer) {
    alert(`${invalidPlayer.name}의 끝 시간이 시작보다 늦어야 합니다.`);
    activeTab = "participants";
    render();
    return;
  }
  const schedulePlayers = players.map((player) => ({ ...player, canFillMaleSlot: false }));
  const schedule = scheduleMatches(schedulePlayers, activeClub().currentWeek.requiredPairs, activeClub().settings.slotMinutes, activeClub().settings.courts);
  const historyEntry = createHistoryEntry(schedule);
  activeClub().currentWeek.lastSchedule = schedule;
  activeClub().currentWeek.activeHistoryId = historyEntry.historyId;
  activeClub().scheduleHistory.push(historyEntry);
  selectedHistoryId = null;
  activeTab = "schedule";
  commit();
}

function newWeek(): void {
  for (const playerId of activeClub().currentWeek.participantIds) {
    const player = activeClub().roster.find((item) => item.playerId === playerId);
    if (!player) continue;
    player.availableStart = activeClub().settings.startTime;
    player.availableEnd = activeClub().settings.endTime;
  }
  activeClub().currentWeek = {
    weekLabel: buildCurrentWeekLabel(),
    participantIds: [...activeClub().currentWeek.participantIds],
    requiredPairs: [],
    lastSchedule: null,
    activeHistoryId: null,
  };
  selectedHistoryId = null;
  commit();
}

function addPair(): void {
  const players = participants(true);
  if (players.length < 2) return;
  const existingPairKeys = new Set(activeClub().currentWeek.requiredPairs.map((pair) => pairKey(pair.player1Id, pair.player2Id)));
  const nextPair = findFirstAvailablePair(players, existingPairKeys);
  if (!nextPair) return;
  activeClub().currentWeek.requiredPairs.push(nextPair);
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function deletePair(index: number): void {
  activeClub().currentWeek.requiredPairs.splice(index, 1);
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function updatePairFromRow(row: HTMLElement): void {
  const index = Number(row.dataset.pairIndex);
  const pair = activeClub().currentWeek.requiredPairs[index];
  if (!pair) return;
  const selects = row.querySelectorAll<HTMLSelectElement>("select");
  pair.player1Id = selects[0]?.value ?? pair.player1Id;
  pair.player2Id = selects[1]?.value ?? pair.player2Id;
  if (pair.player1Id === pair.player2Id) {
    const fallback = participants(true).find((player) => player.playerId !== pair.player1Id);
    if (fallback) pair.player2Id = fallback.playerId;
  }
  const existingPairKeys = new Set(
    activeClub().currentWeek.requiredPairs
      .filter((_, pairIndex) => pairIndex !== index)
      .map((item) => pairKey(item.player1Id, item.player2Id)),
  );
  if (existingPairKeys.has(pairKey(pair.player1Id, pair.player2Id))) {
    const replacement = findFirstAvailablePair(participants(true), existingPairKeys);
    if (!replacement) {
      activeClub().currentWeek.requiredPairs.splice(index, 1);
    } else {
      pair.player1Id = replacement.player1Id;
      pair.player2Id = replacement.player2Id;
    }
  }
  activeClub().currentWeek.lastSchedule = null;
  activeClub().currentWeek.activeHistoryId = null;
  commit();
}

function swapSchedulePlayers(source: DragPayload, target: DragPayload): void {
  const schedule = activeClub().currentWeek.lastSchedule;
  if (!schedule) return;
  const sourceMatch = schedule.matches[source.matchIndex];
  const targetMatch = schedule.matches[target.matchIndex];
  if (!sourceMatch || !targetMatch) return;
  const sourcePlayer = sourceMatch[source.side][source.position];
  sourceMatch[source.side][source.position] = targetMatch[target.side][target.position];
  targetMatch[target.side][target.position] = sourcePlayer;
  const validation = validateSchedule(schedule.matches, schedule.players, activeClub().currentWeek.requiredPairs);
  activeClub().currentWeek.lastSchedule = validation.summary;
  syncActiveHistory(validation.summary);
  emptySlotPicker = null;
  commit();
}

function benchSchedulePlayer(target: HTMLElement): void {
  if (suppressNextScheduleClick) {
    suppressNextScheduleClick = false;
    return;
  }
  const schedule = activeClub().currentWeek.lastSchedule;
  if (!schedule) return;
  const match = schedule.matches[Number(target.dataset.matchIndex)];
  if (!match) return;
  const side = target.dataset.side === "team1" ? "team1" : "team2";
  const position = Number(target.dataset.position) === 0 ? 0 : 1;
  if (!match[side][position]) return;
  match[side][position] = null;
  const validation = validateSchedule(schedule.matches, schedule.players, activeClub().currentWeek.requiredPairs);
  activeClub().currentWeek.lastSchedule = validation.summary;
  syncActiveHistory(validation.summary);
  emptySlotPicker = { kind: "schedule", matchIndex: Number(target.dataset.matchIndex), side, position };
  commit();
}

function openEmptySlotPicker(target: HTMLElement): void {
  if (suppressNextScheduleClick) {
    suppressNextScheduleClick = false;
    return;
  }
  const schedule = activeClub().currentWeek.lastSchedule;
  if (!schedule) return;
  const matchIndex = Number(target.dataset.matchIndex);
  const side = target.dataset.side === "team1" ? "team1" : "team2";
  const position = Number(target.dataset.position) === 0 ? 0 : 1;
  const match = schedule.matches[matchIndex];
  if (!match || match[side][position]) return;
  emptySlotPicker = { kind: "schedule", matchIndex, side, position };
  render();
}

function closeEmptySlotPicker(): void {
  emptySlotPicker = null;
  render();
}

function fillEmptySlot(target: HTMLElement): void {
  const schedule = activeClub().currentWeek.lastSchedule;
  if (!schedule) return;
  const matchIndex = Number(target.dataset.matchIndex);
  const side = target.dataset.side === "team1" ? "team1" : "team2";
  const position = Number(target.dataset.position) === 0 ? 0 : 1;
  const match = schedule.matches[matchIndex];
  const player = schedule.players.find((item) => item.playerId === target.dataset.playerId);
  if (!match || !player || match[side][position]) return;
  if (!waitingPlayersForSlot(match).some((item) => item.playerId === player.playerId)) return;
  match[side][position] = player;
  const validation = validateSchedule(schedule.matches, schedule.players, activeClub().currentWeek.requiredPairs);
  activeClub().currentWeek.lastSchedule = validation.summary;
  syncActiveHistory(validation.summary);
  emptySlotPicker = null;
  commit();
}

function waitingPlayersForSlot(match: ScheduledMatch): Player[] {
  const schedule = activeClub().currentWeek.lastSchedule;
  if (!schedule) return [];
  const slotMatches = schedule.matches.filter((item) => item.slotStart === match.slotStart);
  const slotMinutes = match.slotEnd - match.slotStart;
  const playedIds = new Set(slotMatches.flatMap((item) => filledPlayers(item).map((player) => player.playerId)));
  return schedule.players.filter((player) => !playedIds.has(player.playerId)).filter((player) => isWaitingVisible(player, match.slotStart, slotMinutes));
}

function createHistoryEntry(schedule: ScheduleResult): ScheduleHistoryEntry {
  const dateLabel = activeClub().currentWeek.weekLabel;
  return {
    historyId: createHistoryId(),
    name: nextHistoryName(dateLabel, activeClub().scheduleHistory),
    dateLabel,
    createdAt: new Date().toISOString(),
    settings: cloneSettings(activeClub().settings),
    participantIds: [...activeClub().currentWeek.participantIds],
    requiredPairs: cloneRequiredPairs(activeClub().currentWeek.requiredPairs),
    schedule: cloneScheduleResult(schedule),
  };
}

function syncActiveHistory(schedule: ScheduleResult): void {
  const historyId = activeClub().currentWeek.activeHistoryId;
  if (!historyId) return;
  const entry = activeClub().scheduleHistory.find((item) => item.historyId === historyId);
  if (!entry) return;
  entry.schedule = cloneScheduleResult(schedule);
}

function renameHistoryEntry(input: HTMLInputElement): void {
  const entry = activeClub().scheduleHistory.find((item) => item.historyId === input.dataset.historyName);
  if (!entry) return;
  const nextName = input.value.trim();
  if (!nextName) {
    input.value = entry.name;
    return;
  }
  entry.name = nextName;
  commit();
}

function viewHistory(historyId: string): void {
  if (!activeClub().scheduleHistory.some((entry) => entry.historyId === historyId)) return;
  selectedHistoryId = historyId;
  activeTab = "schedule";
  render();
}

function deleteHistory(historyId: string): void {
  activeClub().scheduleHistory = activeClub().scheduleHistory.filter((entry) => entry.historyId !== historyId);
  if (selectedHistoryId === historyId) {
    selectedHistoryId = null;
    activeTab = "history";
  }
  if (activeClub().currentWeek.activeHistoryId === historyId) {
    activeClub().currentWeek.activeHistoryId = null;
  }
  commit();
}

function exportBackup(): void {
  const blob = new Blob([JSON.stringify(createBackup(state), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tennis-draw-${activeClub().currentWeek.weekLabel}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function shareImage(): Promise<void> {
  if (sharingImage) return;
  const historyEntry = selectedHistoryId ? activeClub().scheduleHistory.find((entry) => entry.historyId === selectedHistoryId) : null;
  const result = historyEntry?.schedule ?? activeClub().currentWeek.lastSchedule;
  const requiredPairs = historyEntry?.requiredPairs ?? activeClub().currentWeek.requiredPairs;
  if (!result) {
    alert("먼저 대진표를 생성하세요.");
    return;
  }
  sharingImage = true;
  try {
    const title = historyEntry ? historyEntry.name : `테니스 대진표 ${activeClub().currentWeek.weekLabel}`;
    const filenameLabel = historyEntry?.dateLabel ?? activeClub().currentWeek.weekLabel;
    const blob = await createSharePngBlob(result, title, requiredPairs);
    const file = new File([blob], `tennis-draw-${filenameLabel}.png`, { type: "image/png" });
    const navigatorWithShare = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (navigatorWithShare.canShare?.({ files: [file] }) && navigatorWithShare.share) {
      await navigatorWithShare.share({
        files: [file],
      });
      return;
    }
    downloadBlob(blob, file.name);
  } finally {
    sharingImage = false;
  }
}

function handleImport(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  file
    .text()
    .then((text) => {
      state = restoreBackup(text);
      selectedHistoryId = null;
      calendarMonth = parseLocalDate(activeClub().currentWeek.weekLabel);
      commit();
    })
    .catch((error) => {
      alert(error instanceof Error ? error.message : "백업 파일을 읽지 못했습니다.");
    });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function participants(active: boolean): Player[] {
  const activeIds = new Set(activeClub().currentWeek.participantIds);
  const rosterById = new Map(activeClub().roster.map((player) => [player.playerId, player]));
  if (active) {
    return activeClub().currentWeek.participantIds.map((id) => rosterById.get(id)).filter((player): player is Player => Boolean(player));
  }
  return activeClub().roster.filter((player) => !activeIds.has(player.playerId));
}

function activeClub(): ClubState {
  return state.clubs.find((club) => club.clubId === state.activeClubId) ?? state.clubs[0];
}

function cloneSettings(settings: AppSettings): AppSettings {
  return { ...settings };
}

function cloneRequiredPairs(requiredPairs: RequiredPair[]): RequiredPair[] {
  return requiredPairs.map((pair) => ({ ...pair }));
}

function cloneScheduleResult(schedule: ScheduleResult): ScheduleResult {
  return JSON.parse(JSON.stringify(schedule)) as ScheduleResult;
}

function findFirstAvailablePair(players: Player[], existingPairKeys: Set<string>): RequiredPair | null {
  for (let firstIndex = 0; firstIndex < players.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < players.length; secondIndex += 1) {
      const player1Id = players[firstIndex].playerId;
      const player2Id = players[secondIndex].playerId;
      if (!existingPairKeys.has(pairKey(player1Id, player2Id))) return { player1Id, player2Id };
    }
  }
  return null;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function createHistoryId(): string {
  return crypto.randomUUID?.() ?? `h${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createClubId(): string {
  return crypto.randomUUID?.() ?? `club-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function groupMatches(matches: ScheduledMatch[]): Array<[number, ScheduledMatch[]]> {
  const groups = new Map<number, ScheduledMatch[]>();
  for (const match of matches) {
    groups.set(match.slotStart, [...(groups.get(match.slotStart) ?? []), match]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a - b);
}

function isWaitingVisible(player: Player, slotStart: number, slotMinutes: number): boolean {
  if (slotStart < player.availableStart) return true;
  if (slotStart + slotMinutes > player.availableEnd) return true;
  return player.availableStart <= slotStart && slotStart + slotMinutes <= player.availableEnd;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
