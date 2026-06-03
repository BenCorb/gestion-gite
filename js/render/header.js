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

export function renderHeader(state, elements) {
  const name = state.settings.propertyName;
  elements.propertyTitle.textContent = name;
  const sidebarBrand = document.getElementById("property-title-sidebar");
  if (sidebarBrand) sidebarBrand.textContent = name;
  document.title = `${name} — Gestion`;
  if (state.lastSyncedAt) {
    const syncText = `Synchronisé à ${state.lastSyncedAt.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
    elements.syncStatus.textContent = syncText;
    const sidebarSync = document.getElementById("sync-status-sidebar");
    if (sidebarSync) sidebarSync.textContent = syncText;
  }
}

export function renderTabBadges(state) {
  const pendingRequests = (state.bookingRequests || []).filter((r) => r.status === "new").length;
  const updateBadge = (selector, count) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = count;
      el.classList.toggle("is-hidden", count <= 0);
    });
  };
  updateBadge('[data-tab-badge="requests"]', pendingRequests);
  updateBadge('[data-tab-badge-mobile="requests"]', pendingRequests);
}

export function renderTopStats(state, elements) {
  const today = new Date();
  const reservationsOnly = getReservationsByType(state, "reservation").filter(
    (reservation) => reservation.status !== "cancelled",
  );
  const arrivalsToday = reservationsOnly.filter((r) => sameDay(parseIsoDate(r.arrivalDate), today));
  const pendingRequests = (state.bookingRequests || []).filter((r) => r.status === "new").length;
  const currentMonthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
  const thisMonth = reservationsOnly.filter((reservation) => {
    const date = parseIsoDate(reservation.arrivalDate);
    return `${date.getFullYear()}-${date.getMonth() + 1}` === currentMonthKey;
  });
  const monthRevenue = sumAmounts(thisMonth);
  const stats = [
    {
      label: "Arrivées aujourd'hui",
      value: arrivalsToday.length,
      meta: arrivalsToday.length
        ? arrivalsToday.map((r) => escapeHtml(r.clientName || "")).filter(Boolean).slice(0, 2).join(" · ")
        : "Aucune arrivée",
    },
    {
      label: "Demandes à traiter",
      value: pendingRequests,
      meta: pendingRequests ? `Voir l'onglet Demandes` : "Aucune en attente",
      tone: pendingRequests > 0 ? "accent" : null,
    },
    {
      label: "CA du mois",
      value: formatCurrency(state, monthRevenue),
      meta: `${thisMonth.length} réservation${thisMonth.length > 1 ? "s" : ""}`,
      tone: "positive",
    },
  ];

  elements.topStats.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card${stat.tone ? " stat-card--" + stat.tone : ""}">
          <div class="stat-card-label">${escapeHtml(stat.label)}</div>
          <div class="stat-card-value">${stat.value}</div>
          ${stat.meta ? `<div class="stat-card-meta">${stat.meta}</div>` : ""}
        </article>
      `,
    )
    .join("");
}
