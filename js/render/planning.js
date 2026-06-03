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

export function renderPlanning(state, elements) {
  const baseDate = new Date(state.planningDate.getFullYear(), state.planningDate.getMonth(), 1);
  const todayIso = dateToIso(new Date());
  elements.planningMonthLabel.textContent = baseDate.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
  elements.planningGrid.style.setProperty("--planning-days", String(daysInMonth));
  elements.planningGrid.style.setProperty("--planning-min-width", `${164 + daysInMonth * 38}px`);

  const header = [
    `<div class="planning-cell planning-room-header sticky-column">Chambre</div>`,
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), index + 1);
      const isToday = dateToIso(dayDate) === todayIso;
      return `<div class="planning-cell planning-day-header ${isToday ? "today" : ""}">${index + 1}</div>`;
    }),
  ].join("");

  const rows = state.settings.rooms
    .map((room) => {
      const cells = [`<div class="planning-cell planning-room-name sticky-column">${escapeHtml(room.name)}</div>`];
      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
        const iso = dateToIso(date);
        const isToday = iso === todayIso;
        const reservation = state.reservations.find(
          (item) => item.roomId === room.id && isDateInStay(iso, item.arrivalDate, item.departureDate) && item.status !== "cancelled",
        );
        const statusClass = reservation ? `planning-${getEntryType(reservation)}` : "";
        const todayClass = isToday ? "today" : "";
        const label = reservation ? getCalendarLabel(reservation) : "";
        cells.push(
          `<div class="planning-cell planning-slot ${statusClass} ${todayClass}" ${reservation ? getRoomStyle(state, room.id) : ""} title="${escapeHtml(label)}">${reservation ? "&bull;" : ""}</div>`,
        );
      }
      return cells.join("");
    })
    .join("");

  elements.planningGrid.innerHTML = header + rows;
}
