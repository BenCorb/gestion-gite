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
  sumRecognizedRevenue,
} from "../utils.js";
import { icon } from "../icons.js";

export function getBookingRequestStatusLabel(status) {
  return {
    new: "Nouvelle",
    accepted: "Acceptée",
    rejected: "Refusée",
  }[status] || "Nouvelle";
}

export function getReservationsForDate(state, isoDate) {
  return state.reservations.filter((reservation) => {
    if (getEntryType(reservation) === "reservation" && reservation.status === "cancelled") {
      return false;
    }
    return isDateInStay(isoDate, reservation.arrivalDate, reservation.departureDate);
  });
}

export function sameDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

export function getReservationsForMonth(state, year, monthIndex) {
  return getReservationsByType(state, "reservation").filter((reservation) => {
    const date = parseIsoDate(reservation.arrivalDate);
    return date.getFullYear() === year && date.getMonth() === monthIndex;
  });
}

export function getReservationsForYear(state, year) {
  return getReservationsByType(state, "reservation").filter(
    (reservation) => parseIsoDate(reservation.arrivalDate).getFullYear() === year,
  );
}

export function getActiveReservations(reservations) {
  return reservations.filter((reservation) => reservation.status !== "cancelled");
}

export function getTotalNights(reservations) {
  return reservations.reduce(
    (sum, reservation) => sum + calculateNights(reservation.arrivalDate, reservation.departureDate),
    0,
  );
}

export function buildPlatformBreakdown(state, reservations, totalRevenue) {
  return state.settings.platforms
    .map((platform) => {
      const platformReservations = reservations.filter((reservation) => reservation.platform === platform);
      const activePlatformReservations = getActiveReservations(platformReservations);
      const revenue = sumRecognizedRevenue(platformReservations);
      const share = totalRevenue ? (revenue / totalRevenue) * 100 : 0;
      return {
        platform,
        reservations: activePlatformReservations.length,
        revenue,
        share,
      };
    })
    .filter((item) => item.reservations > 0 || item.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

export function attachPhotoDragHandlers(container, type, actions) {
  let draggedIndex = null;
  let draggedRoomId = null;

  container.querySelectorAll("figure[draggable]").forEach((figure) => {
    figure.addEventListener("dragstart", (e) => {
      draggedIndex = Number(figure.dataset.dragIndex);
      draggedRoomId = figure.dataset.dragRoom || null;
      e.dataTransfer.effectAllowed = "move";
      // setTimeout lets the browser capture the drag image before opacity changes
      setTimeout(() => figure.classList.add("dragging"), 0);
    });
    figure.addEventListener("dragend", () => figure.classList.remove("dragging"));
    figure.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      figure.classList.add("drag-over");
    });
    figure.addEventListener("dragleave", () => figure.classList.remove("drag-over"));
    figure.addEventListener("drop", (e) => {
      e.preventDefault();
      figure.classList.remove("drag-over");
      if (draggedIndex === null) return;
      const toIndex = Number(figure.dataset.dragIndex);
      if (type === "gite") {
        actions.reorderGitePhoto(draggedIndex, toIndex);
      } else if (type === "room" && figure.dataset.dragRoom === draggedRoomId) {
        actions.reorderRoomPhoto(draggedRoomId, draggedIndex, toIndex);
      }
      draggedIndex = null;
    });
  });
}

export function createComparisonCard(label, currentValue, previousValue, unitOrCurrency, isCurrency = false, state = null) {
  const delta = currentValue - previousValue;
  const direction = delta > 0 ? "en hausse" : delta < 0 ? "en baisse" : "stable";
  const formattedCurrent =
    isCurrency && state ? formatCurrency(state, currentValue) : `${currentValue} ${unitOrCurrency}`.trim();
  const formattedPrevious =
    isCurrency && state ? formatCurrency(state, previousValue) : `${previousValue} ${unitOrCurrency}`.trim();
  const formattedDelta =
    isCurrency && state ? formatCurrency(state, Math.abs(delta)) : `${Math.abs(delta)} ${unitOrCurrency}`.trim();
  return {
    label,
    value: formattedCurrent,
    detail:
      previousValue === 0 && currentValue === 0
        ? "Stable par rapport à la période précédente"
        : direction === "stable"
          ? `Stable vs ${formattedPrevious}`
          : `${direction} de ${formattedDelta} vs ${formattedPrevious}`,
  };
}

export function renderBreakdownCard({ label, value, detail }) {
  return `
    <article class="breakdown-card">
      <span class="label">${escapeHtml(label)}</span>
      <h3>${escapeHtml(value)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

export function renderPlatformCard(state, { platform, reservations, revenue, share }) {
  return `
    <article class="breakdown-card">
      <h3>${escapeHtml(platform)}</h3>
      <p>${reservations} réservation(s)</p>
      <p>${share.toFixed(1).replace(".", ",")} % du CA</p>
      <strong>${formatCurrency(state, revenue)}</strong>
    </article>
  `;
}

export function renderEmptyBreakdown(message) {
  return `<article class="breakdown-card"><p>${escapeHtml(message)}</p></article>`;
}

export function renderSimpleMetricCard(label, title, detail) {
  return `
    <article class="breakdown-card">
      <span class="label">${escapeHtml(label)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

export function buildTopRooms(state, reservations) {
  const roomMetrics = state.settings.rooms.map((room) => {
    const roomReservations = reservations.filter((reservation) => reservation.roomId === room.id);
    const activeRoomReservations = getActiveReservations(roomReservations);
    return {
      room,
      count: activeRoomReservations.length,
      nights: getTotalNights(activeRoomReservations),
      revenue: sumRecognizedRevenue(roomReservations),
    };
  });

  return {
    mostBooked: [...roomMetrics].sort((a, b) => b.count - a.count || b.nights - a.nights)[0],
    mostProfitable: [...roomMetrics].sort((a, b) => b.revenue - a.revenue || b.count - a.count)[0],
    leastOccupied: [...roomMetrics].sort((a, b) => a.nights - b.nights || a.count - b.count)[0],
  };
}

export function formatAverageNights(value) {
  return `${value.toFixed(1).replace(".", ",")} nuit(s)`;
}
