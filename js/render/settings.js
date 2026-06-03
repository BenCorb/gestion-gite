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

export function renderSettingsForm(ctx) {
  const { actions, elements, state } = ctx;
  elements.propertyNameInput.value = state.settings.propertyName;
  elements.currencyInput.value = state.settings.currency || "EUR";
  elements.siteHeadlineInput.value = state.settings.site?.headline || "";
  elements.siteSubtitleInput.value = state.settings.site?.subtitle || "";
  elements.siteIntroInput.value = state.settings.site?.intro || "";
  elements.siteGiteTitleInput.value = state.settings.site?.giteTitle || "Le gîte";
  elements.siteGiteDescriptionInput.value = state.settings.site?.giteDescription || "";
  elements.siteAddressInput.value = state.settings.site?.address || "";
  elements.sitePhoneInput.value = state.settings.site?.phone || "";
  elements.siteEmailInput.value = state.settings.site?.email || "";
  elements.notifyEmailInput.value  = state.settings.notifications?.notifyEmail  || "";
  elements.smtpHostInput.value     = state.settings.notifications?.smtpHost     || "";
  elements.smtpPortInput.value     = state.settings.notifications?.smtpPort     || "587";
  elements.smtpUserInput.value     = state.settings.notifications?.smtpUser     || "";
  elements.smtpPasswordInput.value = state.settings.notifications?.smtpPassword || "";
  elements.siteBodyFontSelect.value = state.settings.site?.bodyFont || "lato";
  elements.siteHeadingFontSelect.value = state.settings.site?.headingFont || "playfair";
  elements.siteLogoUrl.value = state.settings.site?.logoUrl || "";
  elements.siteHeroUrl.value = state.settings.site?.heroImageUrl || "";
  elements.siteMediaPreview.innerHTML = [
    state.settings.site?.logoUrl ? `<img src="${escapeHtml(state.settings.site.logoUrl)}" alt="Logo" />` : "",
    state.settings.site?.heroImageUrl ? `<img src="${escapeHtml(state.settings.site.heroImageUrl)}" alt="Photo principale" />` : "",
  ].join("");
  elements.siteGitePhotosPreview.innerHTML = (state.settings.site?.gitePhotos || [])
    .map(
      (photo, index) => `
        <figure draggable="true" data-drag-index="${index}">
          <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || "Le gîte")}" />
          <button class="danger-button" type="button" data-remove-gite-photo="${index}">Retirer</button>
        </figure>
      `,
    )
    .join("");
  attachPhotoDragHandlers(elements.siteGitePhotosPreview, "gite", actions);

  elements.roomsEditor.innerHTML = state.settings.rooms
    .map(
      (room) => `
        <div class="room-editor">
          <div class="inline-editor">
            <input type="text" data-room-name="${room.id}" value="${escapeHtml(room.name)}" />
            <select class="color-select" data-room-color="${room.id}">
              ${getRoomColorOptions(room.color)}
            </select>
            <label class="checkbox-card compact-checkbox">
              <input type="checkbox" data-room-visible="${room.id}" ${room.publicVisible !== false ? "checked" : ""} />
              <span>Visible vitrine</span>
            </label>
            <label class="checkbox-card compact-checkbox">
              <input type="checkbox" data-room-booking-requests="${room.id}" ${room.bookingRequestsEnabled !== false ? "checked" : ""} />
              <span>Demandes directes</span>
            </label>
            <button class="danger-button" type="button" data-delete-room="${room.id}">Supprimer</button>
          </div>
          <div class="form-grid">
            <label>
              <span>Résumé vitrine</span>
              <input type="text" data-room-summary="${room.id}" value="${escapeHtml(room.summary || "")}" />
            </label>
            <label>
              <span>Capacité</span>
              <input type="number" min="1" data-room-capacity="${room.id}" value="${escapeHtml(room.capacity || 2)}" />
            </label>
            <label>
              <span>Prix indicatif par nuit</span>
              <input type="text" data-room-price="${room.id}" value="${escapeHtml(room.price || "")}" />
            </label>
            <div class="full-width settings-section nested-settings-section">
              <div class="section-header">
                <h3>Équipements</h3>
                <button class="secondary-button" type="button" data-add-amenity-group="${room.id}">Ajouter une catégorie</button>
              </div>
              <div class="stack-list">
                ${(room.amenityGroups || [])
                  .map(
                    (group, index) => `
                      <div class="inline-editor amenity-group-row" data-amenity-group-room="${room.id}">
                        <input type="text" data-amenity-group-name value="${escapeHtml(group.name || "")}" placeholder="Salle de bain, Cuisine..." />
                        <input type="text" data-amenity-group-items value="${escapeHtml((group.items || []).join(", "))}" placeholder="Douche, Serviettes..." />
                        <button class="danger-button" type="button" data-remove-amenity-group="${room.id}" data-amenity-group-index="${index}">Retirer</button>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>
            <div class="full-width settings-section nested-settings-section">
              <div class="section-header">
                <h3>Liens de réservation</h3>
                <button class="secondary-button" type="button" data-add-booking-link="${room.id}">Ajouter un lien</button>
              </div>
              <div class="stack-list">
                ${(room.bookingLinks || [])
                  .map(
                    (link, index) => `
                      <div class="inline-editor booking-link-row" data-booking-link-room="${room.id}">
                        <input type="text" data-booking-link-label value="${escapeHtml(link.label || "")}" placeholder="Airbnb, Booking..." />
                        <input type="url" data-booking-link-url value="${escapeHtml(link.url || "")}" placeholder="https://..." />
                        <button class="danger-button" type="button" data-remove-booking-link="${room.id}" data-booking-link-index="${index}">Retirer</button>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </div>
            <label class="full-width">
              <span>Description vitrine</span>
              <textarea rows="3" data-room-description="${room.id}">${escapeHtml(room.description || "")}</textarea>
            </label>
            <label>
              <span>Ajouter une photo</span>
              <input type="file" accept="image/*" data-room-photo-upload="${room.id}" />
            </label>
            <input type="hidden" data-room-photos="${room.id}" value="${escapeHtml(JSON.stringify(room.photos || []))}" />
            <div class="media-preview full-width">
              ${(room.photos || [])
                .map(
                  (photo, index) => `
                    <figure draggable="true" data-drag-room="${room.id}" data-drag-index="${index}">
                      <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || room.name)}" />
                      <button class="danger-button" type="button" data-remove-room-photo="${room.id}" data-photo-index="${index}">Retirer</button>
                    </figure>
                  `,
                )
                .join("")}
            </div>
          </div>
        </div>
      `,
    )
    .join("");

  elements.platformsEditor.innerHTML = state.settings.platforms
    .map(
      (platform, index) => `
        <div class="inline-editor">
          <input type="text" data-platform-index="${index}" value="${escapeHtml(platform)}" />
          <button class="danger-button" type="button" data-delete-platform="${index}">Supprimer</button>
        </div>
      `,
    )
    .join("");

  elements.roomsEditor.querySelectorAll("[data-delete-room]").forEach((button) => {
    button.addEventListener("click", () => actions.removeRoom(button.dataset.deleteRoom));
  });
  elements.siteGitePhotosPreview.querySelectorAll("[data-remove-gite-photo]").forEach((button) => {
    button.addEventListener("click", () => actions.removeGitePhoto(Number(button.dataset.removeGitePhoto)));
  });
  elements.roomsEditor.querySelectorAll("[data-room-photo-upload]").forEach((input) => {
    input.addEventListener("change", () => actions.uploadRoomPhoto(input.dataset.roomPhotoUpload, input.files?.[0]));
  });
  elements.roomsEditor.querySelectorAll("[data-add-booking-link]").forEach((button) => {
    button.addEventListener("click", () => actions.addRoomBookingLink(button.dataset.addBookingLink));
  });
  elements.roomsEditor.querySelectorAll("[data-add-amenity-group]").forEach((button) => {
    button.addEventListener("click", () => actions.addRoomAmenityGroup(button.dataset.addAmenityGroup));
  });
  elements.roomsEditor.querySelectorAll("[data-remove-amenity-group]").forEach((button) => {
    button.addEventListener("click", () =>
      actions.removeRoomAmenityGroup(button.dataset.removeAmenityGroup, Number(button.dataset.amenityGroupIndex)),
    );
  });
  elements.roomsEditor.querySelectorAll("[data-remove-booking-link]").forEach((button) => {
    button.addEventListener("click", () =>
      actions.removeRoomBookingLink(button.dataset.removeBookingLink, Number(button.dataset.bookingLinkIndex)),
    );
  });
  elements.roomsEditor.querySelectorAll("[data-remove-room-photo]").forEach((button) => {
    button.addEventListener("click", () => actions.removeRoomPhoto(button.dataset.removeRoomPhoto, Number(button.dataset.photoIndex)));
  });
  attachPhotoDragHandlers(elements.roomsEditor, "room", actions);
  elements.platformsEditor.querySelectorAll("[data-delete-platform]").forEach((button) => {
    button.addEventListener("click", () => actions.removePlatform(Number(button.dataset.deletePlatform)));
  });
}
