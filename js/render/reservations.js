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

export function renderReservationFormOptions(ctx) {
  const { actions, elements, state } = ctx;
  const selectedRoomId = elements.roomId.value;
  const selectedPlatform = elements.platform.value;
  const selectedFilterRoom = elements.reservationFilterRoom.value;
  const selectedBlockRoomIds = actions.getSelectedBlockRoomIds();

  elements.roomId.innerHTML = state.settings.rooms
    .map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`)
    .join("");

  elements.platform.innerHTML = state.settings.platforms
    .map((platform) => `<option value="${escapeHtml(platform)}">${escapeHtml(platform)}</option>`)
    .join("");

  const roomFilterOptions = [
    `<option value="">Toutes les chambres</option>`,
    ...state.settings.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`),
  ];
  elements.reservationFilterRoom.innerHTML = roomFilterOptions.join("");

  elements.blockRoomsSelector.innerHTML = state.settings.rooms
    .map(
      (room) => `
        <label class="checkbox-card">
          <input type="checkbox" value="${room.id}" ${selectedBlockRoomIds.includes(room.id) ? "checked" : ""} />
          <span>${escapeHtml(room.name)}</span>
        </label>
      `,
    )
    .join("");

  if (selectedRoomId && state.settings.rooms.some((room) => room.id === selectedRoomId)) {
    elements.roomId.value = selectedRoomId;
  } else if (state.settings.rooms[0]) {
    elements.roomId.value = state.settings.rooms[0].id;
  }

  if (selectedPlatform && state.settings.platforms.includes(selectedPlatform)) {
    elements.platform.value = selectedPlatform;
  } else if (state.settings.platforms[0]) {
    elements.platform.value = state.settings.platforms[0];
  }

  if (selectedFilterRoom && state.settings.rooms.some((room) => room.id === selectedFilterRoom)) {
    elements.reservationFilterRoom.value = selectedFilterRoom;
  }
}

export function renderReservationsList(ctx) {
  const { actions, elements, state } = ctx;
  const roomFilter = elements.reservationFilterRoom.value;
  const search = elements.reservationSearch.value.trim().toLowerCase();

  elements.quickFilters.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.quickFilter);
  });

  const filtered = [...state.reservations]
    .filter((reservation) => !roomFilter || reservation.roomId === roomFilter)
    .filter((reservation) => matchesQuickFilter(state.quickFilter, reservation))
    .filter((reservation) => {
      if (!search) {
        return true;
      }
      const haystack = [
        reservation.bookingName,
        reservation.clientName,
        reservation.clientContact,
        reservation.comment,
        reservation.status,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => {
      const dateA = new Date(a.createdAt || a.updatedAt || a.arrivalDate);
      const dateB = new Date(b.createdAt || b.updatedAt || b.arrivalDate);
      return dateB - dateA;
    });

  if (!filtered.length) {
    elements.reservationsList.innerHTML = document.getElementById("empty-state-template").innerHTML;
    return;
  }

  elements.reservationsList.innerHTML = filtered
    .map((reservation) => {
      const roomName = getRoomName(state, reservation.roomId);
      const detailsId = `reservation-details-${escapeHtml(reservation.id)}`;
      const cardTitle = getReservationCardTitle(reservation);
      return `
        <article
          class="reservation-card is-collapsed"
          role="button"
          tabindex="0"
          aria-expanded="false"
          aria-controls="${detailsId}"
          data-action="toggle-details"
        >
          <header>
            <div>
              <h3>${escapeHtml(cardTitle)}</h3>
              <div class="reservation-meta">
                <span class="room-tag custom-color" ${getRoomStyle(state, reservation.roomId)}>${escapeHtml(roomName)}</span>
                <span class="type-tag ${getEntryType(reservation) === "block" ? "block" : ""}">${getEntryTypeLabel(reservation)}</span>
                <span class="status-tag status-${escapeHtml(reservation.status || "confirmed")}">${getStatusLabel(reservation.status)}</span>
                <span class="platform-tag">${escapeHtml(getDisplayPlatform(reservation))}</span>
              </div>
              <span class="reservation-date-range">${formatDate(reservation.arrivalDate)} au ${formatDate(reservation.departureDate)}</span>
            </div>
            <div class="reservation-summary-end">
              <span class="reservation-toggle-indicator" aria-hidden="true">⌄</span>
            </div>
          </header>
          <div class="reservation-collapsible is-hidden" id="${detailsId}">
            <div class="reservation-details">
              <div>
                <strong>Client</strong>
                <span>${escapeHtml(reservation.clientName || "Indisponibilité manuelle")}</span>
              </div>
              <div>
                <strong>Contact</strong>
                <span>${escapeHtml(reservation.clientContact || "-")}</span>
              </div>
              <div>
                <strong>Montant</strong>
                <span>${formatCurrency(state, Number(reservation.amount || 0))}</span>
              </div>
              <div>
                <strong>Nuits</strong>
                <span>${calculateNights(reservation.arrivalDate, reservation.departureDate)}</span>
              </div>
              <div class="full-width">
                <strong>Commentaire</strong>
                <span>${escapeHtml(reservation.comment || "Aucun commentaire")}</span>
              </div>
            </div>
            <div class="reservation-footer">
              <span>Mise à jour : ${formatDateTime(reservation.updatedAt || reservation.createdAt)}</span>
              <div class="form-actions">
                <button class="secondary-button" type="button" data-action="edit" data-id="${escapeHtml(reservation.id)}">
                  Modifier
                </button>
                <button class="danger-button" type="button" data-action="delete" data-id="${escapeHtml(reservation.id)}">
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.reservationsList.querySelectorAll("[data-action='toggle-details']").forEach((card) => {
    const toggleDetails = () => {
      const details = card.querySelector(".reservation-collapsible");
      const isExpanded = card.getAttribute("aria-expanded") === "true";
      card.classList.toggle("is-collapsed", isExpanded);
      card.classList.toggle("is-expanded", !isExpanded);
      card.setAttribute("aria-expanded", String(!isExpanded));
      details.classList.toggle("is-hidden", isExpanded);
    };

    card.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, textarea, a")) {
        return;
      }
      toggleDetails();
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest("button, input, select, textarea, a")) {
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      toggleDetails();
    });
  });

  elements.reservationsList.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.editReservation(button.dataset.id, button);
    });
  });

  elements.reservationsList.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.deleteReservation(button.dataset.id);
    });
  });
}

function getReservationCardTitle(reservation) {
  if (getEntryType(reservation) === "block") {
    return reservation.bookingName || "Blocage";
  }
  return reservation.clientName || reservation.bookingName;
}
