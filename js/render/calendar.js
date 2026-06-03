import {
  calculateNights,
  countBy,
  dateToIso,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatDateTime,
  getCalendarLabel,
  getDisplayPlatform,
  getEntryType,
  getEntryTypeLabel,
  getReservationsByType,
  getRoomColorOptions,
  getRoomName,
  getRoomStyle,
  getStatusLabel,
  isDateInStay,
  matchesQuickFilter,
  parseIsoDate,
  sumAmounts,
} from "../utils.js";
import { icon } from "../icons.js";
import { getBookingRequestStatusLabel, getReservationsForDate, sameDay, getReservationsForMonth, getReservationsForYear, getActiveReservations, getTotalNights, buildPlatformBreakdown, attachPhotoDragHandlers, createComparisonCard, renderBreakdownCard, renderPlatformCard, renderEmptyBreakdown, renderSimpleMetricCard, buildTopRooms, formatAverageNights } from "./report-utils.js";

export function renderCalendar(state, elements) {
  const baseDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
  elements.calendarMonthLabel.textContent = baseDate.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const selectedDate = getSelectedCalendarDate(state, baseDate);

  const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const cells = weekdays.map((weekday) => `<div class="calendar-weekday">${weekday}</div>`).join("");

  const start = new Date(baseDate);
  const startOffset = (baseDate.getDay() + 6) % 7;
  start.setDate(baseDate.getDate() - startOffset);

  const todayIso = dateToIso(new Date());
  let html = cells;

  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const iso = dateToIso(current);
    const inMonth = current.getMonth() === baseDate.getMonth();
    const reservations = getReservationsForDate(state, iso).sort((a, b) =>
      getRoomName(state, a.roomId).localeCompare(getRoomName(state, b.roomId), "fr"),
    );
    const classes = ["calendar-cell"];

    if (!inMonth) {
      classes.push("muted");
    }
    if (iso === todayIso) {
      classes.push("today");
    }
    if (iso === state.calendarSelectedDate) {
      classes.push("selected");
    }

    const visibleReservations = reservations.slice(0, 3);
    const hiddenCount = reservations.length - visibleReservations.length;

    html += `
      <button
        class="${classes.join(" ")}"
        type="button"
        data-calendar-date="${iso}"
        aria-pressed="${iso === state.calendarSelectedDate ? "true" : "false"}"
        aria-label="${current.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}, ${reservations.length} séjour${reservations.length > 1 ? "s" : ""}"
      >
        <span class="calendar-day">${current.getDate()}</span>
        <span class="calendar-day-entries">
          ${visibleReservations.map((reservation) => renderCalendarCellEntry(state, reservation)).join("")}
          ${hiddenCount > 0 ? `<span class="calendar-chip calendar-chip-more">+${hiddenCount}</span>` : ""}
        </span>
      </button>
    `;
  }

  elements.calendarGrid.innerHTML = html;
  elements.calendarGrid.querySelectorAll("[data-calendar-date]").forEach((button) => {
    button.addEventListener("click", () => {
      const clickedDate = parseIsoDate(button.dataset.calendarDate);
      state.calendarSelectedDate = button.dataset.calendarDate;
      state.calendarDate = new Date(clickedDate.getFullYear(), clickedDate.getMonth(), 1);
      renderCalendar(state, elements);
    });
  });
  if (elements.calendarAgenda) {
    elements.calendarAgenda.innerHTML = renderCalendarAgenda(state, selectedDate);
  }
}

function renderCalendarCellEntry(state, reservation) {
  return `
    <span
      class="calendar-chip custom-color ${getEntryType(reservation) === "block" ? "block" : ""}"
      ${getRoomStyle(state, reservation.roomId)}
      title="${escapeHtml(getRoomName(state, reservation.roomId))} - ${escapeHtml(getCalendarLabel(reservation))}"
    >
      <span>${escapeHtml(getRoomName(state, reservation.roomId))}</span>
      <strong>${escapeHtml(getCalendarLabel(reservation))}</strong>
    </span>
  `;
}

function getSelectedCalendarDate(state, baseDate) {
  const selected = state.calendarSelectedDate ? parseIsoDate(state.calendarSelectedDate) : null;
  if (
    !selected ||
    Number.isNaN(selected.getTime()) ||
    selected.getFullYear() !== baseDate.getFullYear() ||
    selected.getMonth() !== baseDate.getMonth()
  ) {
    state.calendarSelectedDate = dateToIso(baseDate);
    return baseDate;
  }
  return selected;
}

function renderCalendarAgenda(state, selectedDate) {
  const selectedIso = dateToIso(selectedDate);
  const selectedEntries = getReservationsForDate(state, selectedIso);

  return `
    <section class="calendar-agenda-section calendar-day-detail">
      <div class="calendar-agenda-heading">
        <h3>${selectedDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</h3>
        <span>${selectedEntries.length} séjour(s)</span>
      </div>
      <div class="calendar-agenda-list">
        ${
          selectedEntries.length
            ? selectedEntries.map((reservation) => renderAgendaItem(state, reservation)).join("")
            : `<p class="calendar-agenda-empty">Aucun séjour ce jour-là.</p>`
        }
      </div>
    </section>
  `;
}

function renderAgendaItem(state, reservation) {
  const isBlock = getEntryType(reservation) === "block";
  return `
    <article class="calendar-agenda-item">
      <span class="calendar-agenda-dot custom-color" ${getRoomStyle(state, reservation.roomId)}></span>
      <div class="calendar-agenda-main">
        <strong>${escapeHtml(getCalendarLabel(reservation))}</strong>
        <span>${escapeHtml(getRoomName(state, reservation.roomId))}</span>
      </div>
      <dl class="calendar-agenda-meta">
        <div>
          <dt>Dates</dt>
          <dd>${formatDate(reservation.arrivalDate)} au ${formatDate(reservation.departureDate)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>${escapeHtml(getEntryTypeLabel(reservation))}</dd>
        </div>
        ${
          isBlock
            ? ""
            : `
              <div>
                <dt>Statut</dt>
                <dd>${escapeHtml(getStatusLabel(reservation.status))}</dd>
              </div>
              <div>
                <dt>Plateforme</dt>
                <dd>${escapeHtml(getDisplayPlatform(reservation))}</dd>
              </div>
            `
        }
      </dl>
    </article>
  `;
}
