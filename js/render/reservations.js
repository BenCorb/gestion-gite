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
  matchesQuickFilters,
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
  const reservationSort = getReservationSortValue(state.reservationSort);
  state.reservationSort = reservationSort;
  elements.reservationSort.value = reservationSort;
  const quickFilters = getQuickFilters(state.quickFilters);
  state.quickFilters = quickFilters;
  const allReservationIds = new Set(state.reservations.map((reservation) => String(reservation.id)));
  state.expandedReservationIds = (state.expandedReservationIds || []).filter((id) => allReservationIds.has(String(id)));

  elements.quickFilters.forEach((button) => {
    const isActive = button.dataset.filter === "all" ? !quickFilters.length : quickFilters.includes(button.dataset.filter);
    button.classList.toggle("active", isActive);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const filtered = [...state.reservations]
    .filter((reservation) => !roomFilter || reservation.roomId === roomFilter)
    .filter((reservation) => matchesQuickFilters(quickFilters, reservation))
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
    .sort((a, b) => compareReservations(a, b, reservationSort));

  if (!filtered.length) {
    elements.reservationsList.innerHTML = document.getElementById("empty-state-template").innerHTML;
    return;
  }

  elements.reservationsList.innerHTML = filtered
    .map((reservation) => {
      const reservationId = String(reservation.id);
      const roomName = getRoomName(state, reservation.roomId);
      const detailsId = `reservation-details-${escapeHtml(reservation.id)}`;
      const cardTitle = getReservationCardTitle(reservation);
      const isExpanded = state.expandedReservationIds.includes(reservationId);
      return `
        <article
          class="reservation-card ${isExpanded ? "is-expanded" : "is-collapsed"}"
          role="button"
          tabindex="0"
          aria-expanded="${String(isExpanded)}"
          aria-controls="${detailsId}"
          data-action="toggle-details"
          data-id="${escapeHtml(reservationId)}"
        >
          <header class="reservation-card-summary">
            <div class="reservation-summary-main">
              <h3>${escapeHtml(cardTitle)}</h3>
              <div class="reservation-meta">
                <span class="room-tag custom-color" ${getRoomStyle(state, reservation.roomId)}>${escapeHtml(roomName)}</span>
                <span class="type-tag ${getEntryType(reservation) === "block" ? "block" : ""}">${getEntryTypeLabel(reservation)}</span>
                <span class="status-tag status-${escapeHtml(reservation.status || "confirmed")}">${getStatusLabel(reservation.status)}</span>
                <span class="platform-tag">${escapeHtml(getDisplayPlatform(reservation))}</span>
              </div>
              <div class="reservation-summary-facts">
                <span>${formatDate(reservation.arrivalDate)} au ${formatDate(reservation.departureDate)}</span>
                <span>${calculateNights(reservation.arrivalDate, reservation.departureDate)} nuit(s)</span>
              </div>
            </div>
            <div class="reservation-summary-end">
              ${
                getEntryType(reservation) === "reservation"
                  ? `<strong class="reservation-summary-amount">${formatCurrency(state, Number(reservation.amount || 0))}</strong>`
                  : `<strong class="reservation-summary-amount">Blocage</strong>`
              }
              <span class="reservation-toggle-text">Détails</span>
              <span class="reservation-toggle-indicator" aria-hidden="true">${icon("chevronDown", 18)}</span>
            </div>
          </header>
          <div class="reservation-collapsible ${isExpanded ? "" : "is-hidden"}" id="${detailsId}">
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
      const reservationId = String(card.dataset.id || "");
      const isExpanded = card.getAttribute("aria-expanded") === "true";
      if (reservationId) {
        if (isExpanded) {
          state.expandedReservationIds = (state.expandedReservationIds || []).filter((id) => String(id) !== reservationId);
        } else if (!state.expandedReservationIds.includes(reservationId)) {
          state.expandedReservationIds = [...(state.expandedReservationIds || []), reservationId];
        }
      }
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

function getReservationSortValue(value) {
  return ["arrival-asc", "arrival-desc", "created-asc", "created-desc"].includes(value) ? value : "created-desc";
}

function getQuickFilters(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((filter) => filter && filter !== "all");
}

function compareReservations(a, b, sortValue) {
  const [sortKey, direction] = sortValue.split("-");
  const primaryA = sortKey === "arrival" ? getArrivalTime(a) : getCreatedTime(a);
  const primaryB = sortKey === "arrival" ? getArrivalTime(b) : getCreatedTime(b);
  const primaryResult = primaryA - primaryB;

  if (primaryResult !== 0) {
    return direction === "asc" ? primaryResult : -primaryResult;
  }

  const arrivalResult = getArrivalTime(a) - getArrivalTime(b);
  const labelResult = getReservationSortLabel(a).localeCompare(getReservationSortLabel(b), "fr");

  return arrivalResult || labelResult || String(a.id || "").localeCompare(String(b.id || ""), "fr");
}

function getArrivalTime(reservation) {
  return parseIsoDate(reservation.arrivalDate).getTime();
}

function getCreatedTime(reservation) {
  return new Date(reservation.createdAt || reservation.updatedAt || reservation.arrivalDate).getTime();
}

function getReservationSortLabel(reservation) {
  return getReservationCardTitle(reservation) || "";
}
