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

export function renderBookingRequests(ctx) {
  const { actions, elements, state } = ctx;
  if (!elements.bookingRequestsList) {
    return;
  }
  const requests = (state.bookingRequests || []).filter((request) => request.status === "new");
  if (!requests.length) {
    elements.bookingRequestsList.innerHTML = `<div class="empty-state"><h3>Aucune demande</h3><p>Les demandes envoyées depuis la vitrine apparaîtront ici.</p></div>`;
    return;
  }
  elements.bookingRequestsList.innerHTML = requests
    .map(
      (request) => `
        <article class="reservation-card">
          <header>
            <div>
              <h3>${escapeHtml(request.guestName)}</h3>
              <div class="reservation-meta">
                <span class="room-tag custom-color" ${getRoomStyle(state, request.roomId)}>${escapeHtml(getRoomName(state, request.roomId))}</span>
                <span class="status-tag status-${escapeHtml(request.status)}">${getBookingRequestStatusLabel(request.status)}</span>
                <span>${formatDate(request.arrivalDate)} au ${formatDate(request.departureDate)}</span>
              </div>
            </div>
            <span class="platform-tag">${request.guestCount} voyageur(s)</span>
          </header>
          <div class="reservation-details">
            <div>
              <strong>Arrivée</strong>
              <span>${formatDate(request.arrivalDate)}</span>
            </div>
            <div>
              <strong>Départ</strong>
              <span>${formatDate(request.departureDate)}</span>
            </div>
            <div>
              <strong>Contact</strong>
              <span>${escapeHtml(request.guestContact)}</span>
            </div>
            <div>
              <strong>Créée</strong>
              <span>${formatDateTime(request.createdAt)}</span>
            </div>
            <div class="full-width">
              <strong>Message</strong>
              <span>${escapeHtml(request.message || "Aucun message")}</span>
            </div>
          </div>
          ${
            request.status === "new"
              ? `<div class="request-edit-form" data-request-edit-form="${request.id}">
                  <div class="form-grid">
                    <label>
                      <span>Chambre</span>
                      <select data-request-room-id>
                        ${state.settings.rooms
                          .map(
                            (room) =>
                              `<option value="${room.id}" ${room.id === request.roomId ? "selected" : ""}>${escapeHtml(room.name)}</option>`,
                          )
                          .join("")}
                      </select>
                    </label>
                    <label>
                      <span>Arrivée</span>
                      <input data-request-arrival-date type="date" value="${escapeHtml(request.arrivalDate)}" />
                    </label>
                    <label>
                      <span>Départ</span>
                      <input data-request-departure-date type="date" value="${escapeHtml(request.departureDate)}" />
                    </label>
                    <label>
                      <span>Client</span>
                      <input data-request-client-name type="text" value="${escapeHtml(request.guestName)}" />
                    </label>
                    <label>
                      <span>Contact</span>
                      <input data-request-client-contact type="text" value="${escapeHtml(request.guestContact)}" />
                    </label>
                    <label>
                      <span>Montant</span>
                      <input data-request-amount type="number" min="0" step="0.01" value="0" />
                    </label>
                    <label class="full-width">
                      <span>Commentaire réservation</span>
                      <textarea data-request-comment rows="3">${escapeHtml(request.message || "")}</textarea>
                    </label>
                  </div>
                </div>
                <div class="form-actions">
                  <button class="primary-button" type="button" data-request-action="accept" data-request-id="${request.id}">Accepter</button>
                  <button class="danger-button" type="button" data-request-action="reject" data-request-id="${request.id}">Refuser</button>
                </div>`
              : ""
          }
        </article>
      `,
    )
    .join("");
  elements.bookingRequestsList.querySelectorAll("[data-request-action]").forEach((button) => {
    button.addEventListener("click", () => actions.handleBookingRequestAction(button.dataset.requestId, button.dataset.requestAction));
  });
}
