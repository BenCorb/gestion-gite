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

export function renderAlerts(state, elements) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const alerts = [];
  const pendingRequests = (state.bookingRequests || []).filter((r) => r.status === "new");

  if (pendingRequests.length > 0) {
    const firstNames = pendingRequests.slice(0, 2).map((r) => r.guestName || "Anonyme").join(" · ");
    alerts.push({
      tone: "accent",
      icon: "mail",
      title: `${pendingRequests.length} nouvelle${pendingRequests.length > 1 ? "s" : ""} demande${pendingRequests.length > 1 ? "s" : ""}`,
      body: firstNames,
      meta: pendingRequests.length > 2 ? `+ ${pendingRequests.length - 2} autre${pendingRequests.length - 2 > 1 ? "s" : ""}` : "",
      action: { label: "Voir les demandes", target: "requests" },
    });
  }

  const arrivalsToday = [];
  const arrivalsTomorrow = [];
  const departuresToday = [];
  const pendingReservations = [];
  const overduePayments = [];
  const missingContact = [];

  state.reservations.forEach((reservation) => {
    const type = getEntryType(reservation);
    if (type !== "reservation") return;
    if (reservation.status === "cancelled") return;
    const arrival = parseIsoDate(reservation.arrivalDate);
    const departure = parseIsoDate(reservation.departureDate);
    if (sameDay(arrival, today)) arrivalsToday.push(reservation);
    else if (sameDay(arrival, tomorrow)) arrivalsTomorrow.push(reservation);
    if (sameDay(departure, today)) departuresToday.push(reservation);
    if (reservation.status === "pending") pendingReservations.push(reservation);
    if (reservation.status === "confirmed" && arrival < today) overduePayments.push(reservation);
    if (!reservation.clientContact) missingContact.push(reservation);
  });

  if (arrivalsToday.length) {
    alerts.push({
      tone: "positive",
      icon: "users",
      title: `${arrivalsToday.length} arrivée${arrivalsToday.length > 1 ? "s" : ""} aujourd'hui`,
      body: arrivalsToday.map((r) => `${escapeHtml(r.clientName || "")} · ${escapeHtml(getRoomName(state, r.roomId))}`).join(" — "),
      action: { label: "Voir les réservations", target: "reservations" },
    });
  }
  if (arrivalsTomorrow.length) {
    alerts.push({
      tone: "neutral",
      icon: "calendar",
      title: `${arrivalsTomorrow.length} arrivée${arrivalsTomorrow.length > 1 ? "s" : ""} demain`,
      body: arrivalsTomorrow.map((r) => `${escapeHtml(r.clientName || "")} · ${escapeHtml(getRoomName(state, r.roomId))}`).join(" — "),
      action: { label: "Voir les réservations", target: "reservations" },
    });
  }
  if (departuresToday.length) {
    alerts.push({
      tone: "neutral",
      icon: "home",
      title: `${departuresToday.length} départ${departuresToday.length > 1 ? "s" : ""} aujourd'hui`,
      body: departuresToday.map((r) => `${escapeHtml(r.clientName || "")} · ${escapeHtml(getRoomName(state, r.roomId))}`).join(" — "),
    });
  }
  if (overduePayments.length) {
    alerts.push({
      tone: "urgent",
      icon: "creditCard",
      title: `${overduePayments.length} paiement${overduePayments.length > 1 ? "s" : ""} en retard`,
      body: overduePayments.slice(0, 2).map((r) => `${escapeHtml(r.clientName || "")}`).join(" · "),
      action: { label: "Voir les réservations", target: "reservations" },
    });
  }
  if (pendingReservations.length) {
    alerts.push({
      tone: "pending",
      icon: "bell",
      title: `${pendingReservations.length} réservation${pendingReservations.length > 1 ? "s" : ""} en attente`,
      body: pendingReservations.slice(0, 2).map((r) => `${escapeHtml(r.clientName || "")}`).join(" · "),
      action: { label: "Voir les réservations", target: "reservations" },
    });
  }
  if (missingContact.length) {
    alerts.push({
      tone: "neutral",
      icon: "user",
      title: `${missingContact.length} contact${missingContact.length > 1 ? "s" : ""} manquant${missingContact.length > 1 ? "s" : ""}`,
      body: missingContact.slice(0, 2).map((r) => escapeHtml(r.bookingName || r.clientName || "")).join(" · "),
    });
  }

  const greetingEl = document.getElementById("alerts-greeting");
  if (greetingEl) {
    const hour = today.getHours();
    const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bel après-midi" : "Bonsoir";
    greetingEl.innerHTML = `
      <span class="alerts-greeting-script">${greeting}</span>
      <span class="alerts-greeting-meta">voici votre journée du ${today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}.</span>
    `;
  }

  if (!alerts.length) {
    elements.alertsList.innerHTML = `<div class="alert-card alert-card-empty">
      <div class="alert-card-body">
        <div class="alert-card-icon tone-positive">${icon("check", 20)}</div>
        <div class="alert-card-content">
          <div class="alert-card-title">Tout est sous contrôle</div>
          <div class="alert-card-body-text">Aucune alerte urgente, profitez de votre journée.</div>
        </div>
      </div>
    </div>`;
    return;
  }

  elements.alertsList.innerHTML = alerts
    .map((alert) => `
      <div class="alert-card${alert.tone === "accent" ? " is-accent" : ""}">
        <div class="alert-card-body">
          <div class="alert-card-icon tone-${alert.tone}">${icon(alert.icon, 20)}</div>
          <div class="alert-card-content">
            <div class="alert-card-title">${alert.title}</div>
            ${alert.body ? `<div class="alert-card-body-text">${alert.body}</div>` : ""}
            ${alert.meta ? `<div class="alert-card-meta">${alert.meta}</div>` : ""}
          </div>
        </div>
        ${alert.action ? `<div class="alert-actions">
          <button class="alert-action is-primary" type="button" data-alert-target="${escapeHtml(alert.action.target)}">${escapeHtml(alert.action.label)}</button>
        </div>` : ""}
      </div>
    `)
    .join("");

  elements.alertsList.querySelectorAll("[data-alert-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.alertTarget;
      document.querySelectorAll(`.tab-button[data-tab="${tab}"]`).forEach((btn) => btn.click());
    });
  });
}
