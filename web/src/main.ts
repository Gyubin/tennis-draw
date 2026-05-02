import "./styles.css";
import { nextHistoryName } from "./domain/history";
import { MATCH_TYPE_LABELS, scheduleMatches } from "./domain/scheduler";
import { buildCurrentWeekLabel, formatLocalDate, formatMinutes, parseLocalDate, parseTimeToMinutes } from "./domain/time";
import type { AppSettings, AppState, Player, RequiredPair, ScheduledMatch, ScheduleHistoryEntry, ScheduleResult } from "./domain/types";
import { validateSchedule } from "./domain/validation";
import { createSharePngBlob } from "./shareImage";
import { createBackup, loadState, restoreBackup, saveState } from "./storage";

type DragPayload =
  | { kind: "participant"; playerId: string; from: "active" | "inactive" }
  | { kind: "schedule"; matchIndex: number; side: "team1" | "team2"; position: 0 | 1 };

let state: AppState = loadState();
let activeTab: "schedule" | "participants" | "pairs" | "history" = "schedule";
let rosterOpen = false;
let dataOpen = false;
let calendarOpen = false;
let calendarMonth = parseLocalDate(state.currentWeek.weekLabel);
let selectedHistoryId: string | null = null;
let sharingImage = false;
let dragPayload: DragPayload | null = null;
let ghost: HTMLElement | null = null;

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("App root not found.");
const app = appElement;
const TIME_OPTION_START = parseTimeToMinutes("06:00");
const TIME_OPTION_END = parseTimeToMinutes("23:30");
const TIME_OPTION_STEP = 30;

render();

function commit(nextState = state): void {
  state = nextState;
  saveState(state);
  render();
}

function render(): void {
  app.innerHTML = `
    <main class="app-shell">
      <section class="topbar">
        <div>
          <h1>테니스 대진표</h1>
          <p>${state.currentWeek.weekLabel} · ${formatMinutes(state.settings.startTime)}-${formatMinutes(state.settings.endTime)} · ${state.settings.courts}코트 · ${state.settings.slotMinutes}분</p>
        </div>
        <div class="topbar__actions">
          <button class="text-button" data-action="open-roster">클럽원</button>
          <button class="text-button" data-action="share-image">공유 이미지</button>
          <button class="text-button" data-action="toggle-data">데이터</button>
        </div>
      </section>

      <section class="settings-band">
        <div class="date-field">
          <span>날짜</span>
          <div class="date-picker">
            <button class="date-picker__button" type="button" data-action="toggle-calendar">${escapeHtml(state.currentWeek.weekLabel)}</button>
            ${calendarOpen ? renderCalendar() : ""}
          </div>
        </div>
        <label>시작 ${renderTimeSelect("startTime", state.settings.startTime, "data-field=\"startTime\"")}</label>
        <label>종료 ${renderTimeSelect("endTime", state.settings.endTime, "data-field=\"endTime\"")}</label>
        <label>코트 <input data-field="courts" type="number" min="1" max="8" value="${state.settings.courts}" /></label>
        <label>간격 <input data-field="slotMinutes" type="number" min="10" step="5" value="${state.settings.slotMinutes}" /></label>
        <button class="secondary-action" data-action="new-week">새 주차</button>
        <button class="primary-action" data-action="generate">대진 생성</button>
      </section>

      ${dataOpen ? renderDataPanel() : ""}
      <nav class="tabs" aria-label="작업 탭">
        ${renderTabButton("schedule", "대진표", `${state.currentWeek.lastSchedule?.matches.length ?? 0}경기`)}
        ${renderTabButton("participants", "참가", `${state.currentWeek.participantIds.length}명`)}
        ${renderTabButton("pairs", "필수페어", `${state.currentWeek.requiredPairs.length}개`)}
        ${renderTabButton("history", "기록", `${state.scheduleHistory.length}개`)}
      </nav>

      ${renderActiveTab()}
      ${rosterOpen ? renderRosterDrawer() : ""}
    </main>
  `;

  bindEvents();
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
  const historyEntry = selectedHistoryId ? state.scheduleHistory.find((entry) => entry.historyId === selectedHistoryId) : null;
  const title = historyEntry ? historyEntry.name : "대진표";
  const result = historyEntry?.schedule ?? state.currentWeek.lastSchedule;
  const requiredPairs = historyEntry?.requiredPairs ?? state.currentWeek.requiredPairs;
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
      <button type="button" class="calendar__day ${dateLabel === state.currentWeek.weekLabel ? "calendar__day--selected" : ""}"
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
        <span>${state.currentWeek.participantIds.length}명</span>
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
          ${participants(false).map((player) => renderPlayerChip(player, { zone: "inactive" })).join("")}
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
  const entries = [...state.scheduleHistory].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
        ${state.roster.map(renderRosterRow).join("")}
      </div>
    </aside>
  `;
}

function renderRequiredPairs(): string {
  const activePlayers = participants(true);
  if (activePlayers.length < 2) return `<p class="helper">참가자가 2명 이상일 때 설정할 수 있습니다.</p>`;
  if (state.currentWeek.requiredPairs.length === 0) return `<p class="helper">필요한 페어가 있으면 추가하세요.</p>`;
  return state.currentWeek.requiredPairs
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
      <label class="check"><input name="fill" type="checkbox" ${player.canFillMaleSlot ? "checked" : ""} />대체</label>
      <button type="button" data-action="delete-player" data-player-id="${player.playerId}">×</button>
    </form>
  `;
}

function renderParticipantRow(player: Player): string {
  const invalid = player.availableEnd <= player.availableStart;
  return `
    <div class="participant-row ${invalid ? "participant-row--invalid" : ""}">
      ${renderPlayerChip(player, { zone: "active" })}
      <label>시작 ${renderTimeSelect("start", player.availableStart, `data-player-time="${player.playerId}" data-time-field="start"`)}</label>
      <label>종료 ${renderTimeSelect("end", player.availableEnd, `data-player-time="${player.playerId}" data-time-field="end"`)}</label>
      <button type="button" data-action="remove-participant" data-player-id="${player.playerId}">불참</button>
      ${invalid ? `<small>끝 시간이 시작보다 늦어야 합니다.</small>` : ""}
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

function renderPlayerChip(player: Player, options: { zone: "active" | "inactive" }): string {
  return `
    <button class="player-chip ${player.gender === "F" ? "player-chip--female" : ""}"
      data-draggable="participant"
      data-player-id="${player.playerId}"
      data-zone="${options.zone}"
      type="button">
      <strong>${escapeHtml(player.name)}</strong><span>${player.gender === "M" ? "남" : "여"}</span>
    </button>
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
    <div class="summary-table">
      ${validation.summary.playerSummaries
        .map(
          (summary) => `
        <div>
          <strong>${escapeHtml(summary.name)}</strong>
          <span>${summary.totalMatches}경기 · 동성 ${summary.sameGenderDoublesMatches} · 혼복 ${summary.mixedDoublesMatches}</span>
        </div>
      `,
        )
        .join("")}
    </div>
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

function renderMatchCard(match: ScheduledMatch, matchIndex: number, readonly: boolean): string {
  return `
    <article class="match-card">
      <div class="match-card__meta">${match.court}코트 · ${MATCH_TYPE_LABELS[match.matchType]}</div>
      <div class="teams">
        ${renderSchedulePlayer(match.team1[0], matchIndex, "team1", 0, readonly)}
        ${renderSchedulePlayer(match.team1[1], matchIndex, "team1", 1, readonly)}
        <span class="versus">vs</span>
        ${renderSchedulePlayer(match.team2[0], matchIndex, "team2", 0, readonly)}
        ${renderSchedulePlayer(match.team2[1], matchIndex, "team2", 1, readonly)}
      </div>
    </article>
  `;
}

function renderSchedulePlayer(player: Player, matchIndex: number, side: "team1" | "team2", position: 0 | 1, readonly: boolean): string {
  return `
    <button class="player-chip player-chip--schedule ${player.gender === "F" ? "player-chip--female" : ""}"
      ${readonly ? "" : `data-draggable="schedule"`}
      data-match-index="${matchIndex}"
      data-side="${side}"
      data-position="${position}"
      type="button">${escapeHtml(player.name)}</button>
  `;
}

function renderWaitingLine(slotStart: number, matches: ScheduledMatch[], players: Player[]): string {
  const slotMinutes = matches[0].slotEnd - matches[0].slotStart;
  const playedIds = new Set(matches.flatMap((match) => [...match.team1, ...match.team2].map((player) => player.playerId)));
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
        state.settings.courts = Math.max(1, Number(input.value) || 1);
        state.currentWeek.lastSchedule = null;
        state.currentWeek.activeHistoryId = null;
      }
      if (input.dataset.field === "slotMinutes") {
        state.settings.slotMinutes = Math.max(5, Number(input.value) || 30);
        state.currentWeek.lastSchedule = null;
        state.currentWeek.activeHistoryId = null;
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
  if (action === "open-roster") openRoster();
  if (action === "close-roster") closeRoster();
  if (action === "toggle-data") toggleDataPanel();
  if (action === "toggle-calendar") toggleCalendar();
  if (action === "calendar-prev") moveCalendarMonth(-1);
  if (action === "calendar-next") moveCalendarMonth(1);
  if (action === "select-date") selectDate(actionTarget.dataset.date ?? "");
  if (action === "add-player") addPlayer();
  if (action === "delete-player") deletePlayer(actionTarget.dataset.playerId ?? "");
  if (action === "remove-participant") removeParticipant(actionTarget.dataset.playerId ?? "");
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

function openRoster(): void {
  rosterOpen = true;
  render();
}

function closeRoster(): void {
  rosterOpen = false;
  render();
}

function toggleDataPanel(): void {
  dataOpen = !dataOpen;
  render();
}

function toggleCalendar(): void {
  calendarOpen = !calendarOpen;
  calendarMonth = parseLocalDate(state.currentWeek.weekLabel);
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
  state.currentWeek.weekLabel = dateLabel;
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  selectedHistoryId = null;
  calendarOpen = false;
  commit();
}

function startDrag(event: PointerEvent): void {
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  const rect = element.getBoundingClientRect();
  ghost = element.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  document.body.appendChild(ghost);
  moveGhost(event.clientX, event.clientY);

  if (element.dataset.draggable === "participant") {
    dragPayload = {
      kind: "participant",
      playerId: element.dataset.playerId ?? "",
      from: element.dataset.zone === "active" ? "active" : "inactive",
    };
  } else {
    dragPayload = {
      kind: "schedule",
      matchIndex: Number(element.dataset.matchIndex),
      side: element.dataset.side === "team1" ? "team1" : "team2",
      position: Number(element.dataset.position) === 0 ? 0 : 1,
    };
  }

  const onMove = (moveEvent: PointerEvent) => moveGhost(moveEvent.clientX, moveEvent.clientY);
  const onUp = (upEvent: PointerEvent) => {
    element.releasePointerCapture(event.pointerId);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    finishDrag(upEvent.clientX, upEvent.clientY);
  };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

function finishDrag(clientX: number, clientY: number): void {
  ghost?.remove();
  ghost = null;
  const payload = dragPayload;
  dragPayload = null;
  if (!payload) return;
  const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-participant-zone], [data-draggable='schedule']");
  if (!target) return;

  if (payload.kind === "participant") {
    const zone = target.dataset.participantZone ?? target.closest<HTMLElement>("[data-participant-zone]")?.dataset.participantZone;
    if (zone === "active") addParticipant(payload.playerId);
    if (zone === "inactive") removeParticipant(payload.playerId);
  }

  if (payload.kind === "schedule" && target.dataset.draggable === "schedule") {
    swapSchedulePlayers(payload, {
      kind: "schedule",
      matchIndex: Number(target.dataset.matchIndex),
      side: target.dataset.side === "team1" ? "team1" : "team2",
      position: Number(target.dataset.position) === 0 ? 0 : 1,
    });
  }
}

function moveGhost(clientX: number, clientY: number): void {
  if (!ghost) return;
  ghost.style.left = `${clientX + 8}px`;
  ghost.style.top = `${clientY + 8}px`;
}

function updatePlayerFromForm(form: HTMLFormElement): void {
  const id = form.dataset.playerForm;
  const player = state.roster.find((item) => item.playerId === id);
  if (!player) return;
  const data = new FormData(form);
  player.name = String(data.get("name") || player.name).trim() || player.name;
  player.gender = String(data.get("gender")) === "F" ? "F" : "M";
  player.canFillMaleSlot = data.get("fill") === "on";
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function updateSettingsTime(field: "startTime" | "endTime", value: string): void {
  const minutes = parseTimeToMinutes(value);
  state.settings[field] = minutes;
  for (const playerId of state.currentWeek.participantIds) {
    const player = state.roster.find((item) => item.playerId === playerId);
    if (!player) continue;
    if (field === "startTime") player.availableStart = minutes;
    if (field === "endTime") player.availableEnd = minutes;
  }
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
}

function updateParticipantTime(input: HTMLInputElement | HTMLSelectElement): void {
  const player = state.roster.find((item) => item.playerId === input.dataset.playerTime);
  if (!player) return;
  const minutes = parseTimeToMinutes(input.value);
  if (input.dataset.timeField === "start") player.availableStart = minutes;
  if (input.dataset.timeField === "end") player.availableEnd = minutes;
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function addPlayer(): void {
  const nextNumber = state.roster.length + 1;
  const player: Player = {
    playerId: `p${Date.now()}`,
    name: `새 회원 ${nextNumber}`,
    gender: "M",
    availableStart: state.settings.startTime,
    availableEnd: state.settings.endTime,
    canFillMaleSlot: false,
    showLateJoin: false,
    showEarlyLeave: false,
  };
  state.roster.push(player);
  state.currentWeek.participantIds.push(player.playerId);
  commit();
}

function deletePlayer(playerId: string): void {
  state.roster = state.roster.filter((player) => player.playerId !== playerId);
  state.currentWeek.participantIds = state.currentWeek.participantIds.filter((id) => id !== playerId);
  state.currentWeek.requiredPairs = state.currentWeek.requiredPairs.filter((pair) => pair.player1Id !== playerId && pair.player2Id !== playerId);
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function addParticipant(playerId: string): void {
  if (!state.currentWeek.participantIds.includes(playerId)) {
    const player = state.roster.find((item) => item.playerId === playerId);
    if (player) {
      player.availableStart = state.settings.startTime;
      player.availableEnd = state.settings.endTime;
    }
    state.currentWeek.participantIds.push(playerId);
    state.currentWeek.lastSchedule = null;
    state.currentWeek.activeHistoryId = null;
    commit();
  }
}

function removeParticipant(playerId: string): void {
  state.currentWeek.participantIds = state.currentWeek.participantIds.filter((id) => id !== playerId);
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function generateSchedule(): void {
  const players = participants(true);
  if (players.length < 4) {
    alert("최소 4명의 참가자가 필요합니다.");
    return;
  }
  if (state.settings.endTime <= state.settings.startTime) {
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
  const schedule = scheduleMatches(players, state.currentWeek.requiredPairs, state.settings.slotMinutes, state.settings.courts);
  const historyEntry = createHistoryEntry(schedule);
  state.currentWeek.lastSchedule = schedule;
  state.currentWeek.activeHistoryId = historyEntry.historyId;
  state.scheduleHistory.push(historyEntry);
  selectedHistoryId = null;
  activeTab = "schedule";
  commit();
}

function newWeek(): void {
  for (const playerId of state.currentWeek.participantIds) {
    const player = state.roster.find((item) => item.playerId === playerId);
    if (!player) continue;
    player.availableStart = state.settings.startTime;
    player.availableEnd = state.settings.endTime;
  }
  state.currentWeek = {
    weekLabel: buildCurrentWeekLabel(),
    participantIds: [...state.currentWeek.participantIds],
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
  state.currentWeek.requiredPairs.push({ player1Id: players[0].playerId, player2Id: players[1].playerId });
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function deletePair(index: number): void {
  state.currentWeek.requiredPairs.splice(index, 1);
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function updatePairFromRow(row: HTMLElement): void {
  const index = Number(row.dataset.pairIndex);
  const pair = state.currentWeek.requiredPairs[index];
  if (!pair) return;
  const selects = row.querySelectorAll<HTMLSelectElement>("select");
  pair.player1Id = selects[0]?.value ?? pair.player1Id;
  pair.player2Id = selects[1]?.value ?? pair.player2Id;
  if (pair.player1Id === pair.player2Id) {
    const fallback = participants(true).find((player) => player.playerId !== pair.player1Id);
    if (fallback) pair.player2Id = fallback.playerId;
  }
  state.currentWeek.lastSchedule = null;
  state.currentWeek.activeHistoryId = null;
  commit();
}

function swapSchedulePlayers(source: Extract<DragPayload, { kind: "schedule" }>, target: Extract<DragPayload, { kind: "schedule" }>): void {
  const schedule = state.currentWeek.lastSchedule;
  if (!schedule) return;
  const sourceMatch = schedule.matches[source.matchIndex];
  const targetMatch = schedule.matches[target.matchIndex];
  if (!sourceMatch || !targetMatch) return;
  const sourcePlayer = sourceMatch[source.side][source.position];
  sourceMatch[source.side][source.position] = targetMatch[target.side][target.position];
  targetMatch[target.side][target.position] = sourcePlayer;
  const validation = validateSchedule(schedule.matches, schedule.players, state.currentWeek.requiredPairs);
  state.currentWeek.lastSchedule = validation.summary;
  syncActiveHistory(validation.summary);
  commit();
}

function createHistoryEntry(schedule: ScheduleResult): ScheduleHistoryEntry {
  const dateLabel = state.currentWeek.weekLabel;
  return {
    historyId: createHistoryId(),
    name: nextHistoryName(dateLabel, state.scheduleHistory),
    dateLabel,
    createdAt: new Date().toISOString(),
    settings: cloneSettings(state.settings),
    participantIds: [...state.currentWeek.participantIds],
    requiredPairs: cloneRequiredPairs(state.currentWeek.requiredPairs),
    schedule: cloneScheduleResult(schedule),
  };
}

function syncActiveHistory(schedule: ScheduleResult): void {
  const historyId = state.currentWeek.activeHistoryId;
  if (!historyId) return;
  const entry = state.scheduleHistory.find((item) => item.historyId === historyId);
  if (!entry) return;
  entry.schedule = cloneScheduleResult(schedule);
}

function renameHistoryEntry(input: HTMLInputElement): void {
  const entry = state.scheduleHistory.find((item) => item.historyId === input.dataset.historyName);
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
  if (!state.scheduleHistory.some((entry) => entry.historyId === historyId)) return;
  selectedHistoryId = historyId;
  activeTab = "schedule";
  render();
}

function deleteHistory(historyId: string): void {
  state.scheduleHistory = state.scheduleHistory.filter((entry) => entry.historyId !== historyId);
  if (selectedHistoryId === historyId) {
    selectedHistoryId = null;
    activeTab = "history";
  }
  if (state.currentWeek.activeHistoryId === historyId) {
    state.currentWeek.activeHistoryId = null;
  }
  commit();
}

function exportBackup(): void {
  const blob = new Blob([JSON.stringify(createBackup(state), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tennis-draw-${state.currentWeek.weekLabel}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function shareImage(): Promise<void> {
  if (sharingImage) return;
  const historyEntry = selectedHistoryId ? state.scheduleHistory.find((entry) => entry.historyId === selectedHistoryId) : null;
  const result = historyEntry?.schedule ?? state.currentWeek.lastSchedule;
  if (!result) {
    alert("먼저 대진표를 생성하세요.");
    return;
  }
  sharingImage = true;
  try {
    const title = historyEntry ? historyEntry.name : `테니스 대진표 ${state.currentWeek.weekLabel}`;
    const filenameLabel = historyEntry?.dateLabel ?? state.currentWeek.weekLabel;
    const blob = await createSharePngBlob(result, title);
    const file = new File([blob], `tennis-draw-${filenameLabel}.png`, { type: "image/png" });
    const navigatorWithShare = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (navigatorWithShare.canShare?.({ files: [file] }) && navigatorWithShare.share) {
      await navigatorWithShare.share({
        files: [file],
        title: "테니스 대진표",
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
      calendarMonth = parseLocalDate(state.currentWeek.weekLabel);
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
  const activeIds = new Set(state.currentWeek.participantIds);
  const rosterById = new Map(state.roster.map((player) => [player.playerId, player]));
  if (active) {
    return state.currentWeek.participantIds.map((id) => rosterById.get(id)).filter((player): player is Player => Boolean(player));
  }
  return state.roster.filter((player) => !activeIds.has(player.playerId));
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

function createHistoryId(): string {
  return crypto.randomUUID?.() ?? `h${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
