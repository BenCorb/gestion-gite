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
      (request) => {
        const isDraftOpen = state.requestDraftId === request.id;
        return `
          <article class="request-card">
            <header class="request-card-header">
              <div class="request-card-title">
                <h3>${escapeHtml(request.guestName)}</h3>
                <div class="request-card-meta">
                  <span class="room-tag custom-color" ${getRoomStyle(state, request.roomId)}>${escapeHtml(getRoomName(state, request.roomId))}</span>
                  <span class="status-tag status-${escapeHtml(request.status)}">${getBookingRequestStatusLabel(request.status)}</span>
                  <span>${formatDate(request.arrivalDate)} au ${formatDate(request.departureDate)}</span>
                </div>
              </div>
              <span class="request-guest-count">${request.guestCount} voyageur(s)</span>
            </header>
            <div class="request-summary-grid">
              <div>
                <strong>Séjour</strong>
                <span>${calculateNights(request.arrivalDate, request.departureDate)} nuit(s)</span>
              </div>
              <div>
                <strong>Contact</strong>
                <span>${escapeHtml(request.guestContact)}</span>
              </div>
              <div>
                <strong>Créée</strong>
                <span>${formatDateTime(request.createdAt)}</span>
              </div>
              <div>
                <strong>Message</strong>
                <span>${escapeHtml(request.message || "Aucun message")}</span>
              </div>
            </div>
            ${
              isDraftOpen
                ? renderRequestDraftPanel(state, request)
                : `<div class="request-action-row">
                    <button class="btn btn-positive btn-md" type="button" data-request-action="prepare-accept" data-request-id="${escapeHtml(request.id)}">Accepter</button>
                    <button class="btn btn-secondary btn-md" type="button" data-request-action="prepare-edit" data-request-id="${escapeHtml(request.id)}">Modifier avant d'accepter</button>
                    <button class="btn btn-danger btn-md" type="button" data-request-action="reject" data-request-id="${escapeHtml(request.id)}">Refuser</button>
                  </div>`
            }
          </article>
        `;
      },
    )
    .join("");
  elements.bookingRequestsList.querySelectorAll("[data-request-action]").forEach((button) => {
    button.addEventListener("click", () => actions.handleBookingRequestAction(button.dataset.requestId, button.dataset.requestAction));
  });
}

function renderRequestDraftPanel(state, request) {
  const isEditMode = state.requestDraftMode === "edit";
  const roomOptions = state.settings.rooms
    .map(
      (room) =>
        `<option value="${room.id}" ${room.id === request.roomId ? "selected" : ""}>${escapeHtml(room.name)}</option>`,
    )
    .join("");

  return `
    <div class="request-decision-panel" data-request-edit-form="${escapeHtml(request.id)}">
      <div class="request-decision-header">
        <div>
          <h4>Créer la réservation</h4>
          <p>${escapeHtml(getRoomName(state, request.roomId))}, ${formatDate(request.arrivalDate)} au ${formatDate(request.departureDate)}</p>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-request-action="${isEditMode ? "prepare-accept" : "prepare-edit"}" data-request-id="${escapeHtml(request.id)}">
          ${isEditMode ? "Mode simple" : "Modifier les détails"}
        </button>
      </div>
      <div class="request-draft-grid ${isEditMode ? "is-edit-mode" : ""}">
        ${
          isEditMode
            ? `<label>
                <span>Chambre</span>
                <select data-request-room-id>${roomOptions}</select>
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
              </label>`
            : ""
        }
        <label>
          <span>Montant</span>
          <input data-request-amount type="number" min="0" step="0.01" value="0" />
        </label>
        <label class="full-width">
          <span>Commentaire réservation</span>
          <textarea data-request-comment rows="2">${escapeHtml(request.message || "")}</textarea>
        </label>
      </div>
      <div class="request-action-row request-action-row-final">
        <button class="btn btn-positive btn-md" type="button" data-request-action="accept" data-request-id="${escapeHtml(request.id)}">Créer la réservation</button>
        <button class="btn btn-secondary btn-md" type="button" data-request-action="cancel-draft" data-request-id="${escapeHtml(request.id)}">Annuler</button>
        <button class="btn btn-danger btn-md" type="button" data-request-action="reject" data-request-id="${escapeHtml(request.id)}">Refuser</button>
      </div>
    </div>
  `;
}
