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
    const reservations = getReservationsForDate(state, iso);
    const classes = ["calendar-cell"];

    if (!inMonth) {
      classes.push("muted");
    }
    if (iso === todayIso) {
      classes.push("today");
    }

    html += `
      <div class="${classes.join(" ")}">
        <div class="calendar-day">${current.getDate()}</div>
        ${reservations
          .map(
            (reservation) => `
              <div class="calendar-chip custom-color ${getEntryType(reservation) === "block" ? "block" : ""}" ${getRoomStyle(state, reservation.roomId)} title="${escapeHtml(getCalendarLabel(reservation))}">
                <span>${escapeHtml(getRoomName(state, reservation.roomId))}</span>
                <strong>${escapeHtml(getCalendarLabel(reservation))}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  elements.calendarGrid.innerHTML = html;
}
