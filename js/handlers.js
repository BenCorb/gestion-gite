import {
  changeAdminPassword,
  deleteReservationRequest,
  fetchBackup,
  fetchState,
  logoutAdmin,
  restoreBackup,
  saveReservationPayload,
  saveSettingsPayload,
  setApiVersions,
  updateBookingRequest,
  uploadImage,
} from "./api.js";
import { initializeReportControls, renderApp, renderReservationFormOptions } from "./render.js";
import {
  downloadTextFile,
  formatCurrency,
  formatDate,
  getDefaultRoomColor,
  getEntryType,
  getReservationsByType,
  getRoomName,
  getStatusLabel,
  hasDuplicates,
  matchesQuickFilter,
  parseIsoDate,
  readJsonFile,
  showToast,
} from "./utils.js";

export function createActions(ctx) {
  const { elements, setBookingRequests, setReservations, setSettings, setVersions, state } = ctx;
  let autoRefreshIntervalId = null;
  let settingsDirty = false;
  let reservationModalTrigger = null;

  function rerender() {
    initializeReportControls(state, elements);
    renderApp({ ...ctx, actions });
  }

  async function loadState(syncFeedbackMode = "silent") {
    try {
      const previousReservationsVersion = state.versions.reservationsVersion;
      const previousSettingsVersion = state.versions.settingsVersion;
      const payload = await fetchState();
      const changed =
        (previousReservationsVersion && previousReservationsVersion !== payload.versions.reservationsVersion) ||
        (previousSettingsVersion && previousSettingsVersion !== payload.versions.settingsVersion);
      setSettings(payload.settings);
      setReservations(payload.reservations);
      setBookingRequests(payload.bookingRequests);
      setVersions(payload.versions);
      setApiVersions(payload.versions);
      rerender();
      setActiveTab(state.activeTab);
      if (syncFeedbackMode === "manual") {
        showToast(
          elements,
          changed ? "Les données ont été synchronisées avec un autre appareil." : "Les données sont déjà à jour.",
        );
      } else if (syncFeedbackMode === "auto" && changed) {
        showToast(elements, "Les données ont été synchronisées avec un autre appareil.");
      }
    } catch (error) {
      showToast(elements, error.message, true);
    }
  }

  function bindEvents() {
    elements.tabButtons.forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });

    elements.quickFilters.forEach((button) => {
      button.addEventListener("click", () => {
        state.quickFilter = button.dataset.filter;
        rerender();
      });
    });

    elements.refreshButton.addEventListener("click", () => loadState("manual"));
    elements.headerLogoutButton.addEventListener("click", handleLogout);
    elements.openReservationModalButton.addEventListener("click", (event) => {
      openReservationModal({ resetForm: true, trigger: event.currentTarget });
    });
    elements.closeReservationModalButton.addEventListener("click", () => closeReservationModal());
    elements.reservationModal.addEventListener("click", (event) => {
      if (event.target === elements.reservationModal) {
        closeReservationModal();
      }
    });
    document.addEventListener("keydown", handleReservationModalKeydown);
    elements.bookingType.addEventListener("change", handleBookingTypeChange);
    elements.reservationForm.addEventListener("submit", handleReservationSubmit);
    elements.resetFormButton.addEventListener("click", resetReservationForm);
    elements.reservationSearch.addEventListener("input", rerender);
    elements.reservationFilterRoom.addEventListener("change", rerender);
    elements.calendarPrev.addEventListener("click", () => changeCalendarMonth(-1));
    elements.calendarToday.addEventListener("click", goToCurrentMonth);
    elements.calendarNext.addEventListener("click", () => changeCalendarMonth(1));
    elements.planningPrev.addEventListener("click", () => changePlanningMonth(-1));
    elements.planningToday.addEventListener("click", goToCurrentPlanningMonth);
    elements.planningNext.addEventListener("click", () => changePlanningMonth(1));
    elements.reportMonth.addEventListener("change", rerender);
    elements.reportYear.addEventListener("change", rerender);
    elements.exportCsvButton.addEventListener("click", exportCsv);
    elements.settingsForm.addEventListener("submit", handleSettingsSubmit);
    elements.settingsForm.addEventListener("input", () => {
      settingsDirty = true;
    });
    elements.settingsForm.addEventListener("change", () => {
      settingsDirty = true;
    });
    elements.siteLogoUpload.addEventListener("change", (event) => handleMediaUpload(event, elements.siteLogoUrl));
    elements.siteHeroUpload.addEventListener("change", (event) => handleMediaUpload(event, elements.siteHeroUrl));
    elements.siteGitePhotoUpload.addEventListener("change", handleGitePhotoUpload);
    elements.addRoomButton.addEventListener("click", () => addInlineItem("room"));
    elements.addPlatformButton.addEventListener("click", () => addInlineItem("platform"));
    elements.exportBackupButton.addEventListener("click", exportBackup);
    elements.importBackupInput.addEventListener("change", importBackup);
    elements.changePasswordButton.addEventListener("click", handlePasswordChange);
    elements.logoutButton.addEventListener("click", handleLogout);
    startAutoRefresh();
  }

  async function handleReservationSubmit(event) {
    event.preventDefault();
    const bookingType = elements.bookingType.value;
    const isBlock = bookingType === "block";
    const blockRoomIds = isBlock ? getSelectedBlockRoomIds() : [];
    const payload = {
      id: elements.reservationId.value || undefined,
      groupId: elements.reservationGroupId.value || undefined,
      bookingType,
      status: isBlock ? "blocked" : elements.reservationStatus.value,
      roomId: elements.roomId.value,
      roomIds: blockRoomIds,
      arrivalDate: elements.arrivalDate.value,
      departureDate: elements.departureDate.value,
      clientName: isBlock ? "" : elements.clientName.value.trim(),
      clientContact: isBlock ? "" : elements.clientContact.value.trim(),
      platform: isBlock ? "" : elements.platform.value,
      amount: isBlock ? 0 : Number(elements.amount.value),
      comment: elements.comment.value.trim(),
      _versions: state.versions,
    };

    if (parseIsoDate(payload.departureDate) <= parseIsoDate(payload.arrivalDate)) {
      showToast(elements, "La date de départ doit être après la date d'arrivée.", true);
      return;
    }

    if (isBlock && !blockRoomIds.length) {
      showToast(elements, "Sélectionne au moins une chambre à bloquer.", true);
      return;
    }

    const targetRoomIds = isBlock ? blockRoomIds : [payload.roomId];
    const ignoredGroupId = payload.groupId || "";
    const conflictingReservation = state.reservations.find((reservation) => {
      if (!targetRoomIds.includes(reservation.roomId)) {
        return false;
      }
      if (getEntryType(reservation) === "reservation" && reservation.status === "cancelled") {
        return false;
      }
      if (payload.id && reservation.id === payload.id) {
        return false;
      }
      if (ignoredGroupId && reservation.groupId === ignoredGroupId) {
        return false;
      }
      return (
        parseIsoDate(payload.arrivalDate) < parseIsoDate(reservation.departureDate) &&
        parseIsoDate(payload.departureDate) > parseIsoDate(reservation.arrivalDate)
      );
    });

    if (conflictingReservation) {
      showToast(
        elements,
        `Chevauchement détecté avec "${conflictingReservation.bookingName}" dans ${getRoomName(state, conflictingReservation.roomId)}.`,
        true,
      );
      return;
    }

    try {
      const data = await saveReservationPayload(payload);
      setReservations(data.reservations);
      setVersions(data.versions);
      setApiVersions(data.versions);
      rerender();
      closeReservationModal();
      showToast(elements, isBlock ? "Blocage enregistré." : "Réservation enregistrée.");
    } catch (error) {
      if (await handleConflict(error)) {
        return;
      }
      showToast(elements, error.message, true);
    }
  }

  function resetReservationForm() {
    elements.reservationForm.reset();
    elements.reservationId.value = "";
    elements.reservationGroupId.value = "";
    elements.formModeBadge.textContent = "Nouveau";
    elements.bookingType.value = "reservation";
    elements.reservationStatus.value = "pending";
    renderReservationFormOptions({ ...ctx, actions });
    applyBookingTypeFormState("reservation");
  }

  function openReservationModal({ resetForm = false, trigger = null } = {}) {
    reservationModalTrigger = trigger || document.activeElement;
    if (resetForm) {
      resetReservationForm();
    }
    elements.reservationModal.classList.remove("is-hidden");
    elements.reservationModal.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("modal-open");
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      elements.bookingType.focus();
    });
  }

  function closeReservationModal() {
    if (elements.reservationModal.classList.contains("is-hidden")) {
      return;
    }
    elements.reservationModal.classList.add("is-hidden");
    elements.reservationModal.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("modal-open");
    document.body.classList.remove("modal-open");
    resetReservationForm();
    if (reservationModalTrigger && document.contains(reservationModalTrigger)) {
      reservationModalTrigger.focus();
    }
    reservationModalTrigger = null;
  }

  function handleReservationModalKeydown(event) {
    if (elements.reservationModal.classList.contains("is-hidden")) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeReservationModal();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = [
      ...elements.reservationModal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.disabled && element.offsetParent !== null);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!firstElement || !lastElement) {
      return;
    }
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function editReservation(id, trigger = null) {
    const reservation = state.reservations.find((item) => item.id === id);
    if (!reservation) {
      return;
    }

    setActiveTab("reservations");
    elements.reservationId.value = reservation.id;
    elements.reservationGroupId.value = reservation.groupId || "";
    elements.bookingType.value = getEntryType(reservation);
    renderReservationFormOptions({ ...ctx, actions });
    elements.roomId.value = reservation.roomId;

    if (getEntryType(reservation) === "block") {
      const groupReservations = reservation.groupId
        ? state.reservations.filter((item) => item.groupId === reservation.groupId)
        : [reservation];
      groupReservations.forEach((groupReservation) => {
        const checkbox = elements.blockRoomsSelector.querySelector(`input[value="${groupReservation.roomId}"]`);
        if (checkbox) {
          checkbox.checked = true;
        }
      });
    }

    elements.arrivalDate.value = reservation.arrivalDate;
    elements.departureDate.value = reservation.departureDate;
    elements.clientName.value = reservation.clientName;
    elements.clientContact.value = reservation.clientContact;
    elements.platform.value = reservation.platform;
    elements.reservationStatus.value = reservation.status || "confirmed";
    elements.amount.value = reservation.amount;
    elements.comment.value = reservation.comment || "";
    elements.formModeBadge.textContent = "Édition";
    applyBookingTypeFormState(elements.bookingType.value);
    openReservationModal({ trigger });
  }

  async function deleteReservation(id) {
    const reservation = state.reservations.find((item) => item.id === id);
    if (!reservation) {
      return;
    }

    const groupReservationCount = reservation.groupId
      ? state.reservations.filter((item) => item.groupId === reservation.groupId).length
      : 1;
    const message =
      groupReservationCount > 1
        ? `Supprimer le blocage groupe (${groupReservationCount} chambres) ?`
        : `Supprimer la réservation "${reservation.bookingName}" ?`;
    if (!window.confirm(message)) {
      return;
    }

    try {
      const data = await deleteReservationRequest(id);
      setReservations(data.reservations);
      setVersions(data.versions);
      setApiVersions(data.versions);
      rerender();
      showToast(elements, groupReservationCount > 1 ? "Blocage groupe supprimé." : "Réservation supprimée.");
    } catch (error) {
      if (await handleConflict(error)) {
        return;
      }
      showToast(elements, error.message, true);
    }
  }

  async function handleSettingsSubmit(event) {
    event.preventDefault();

    const rooms = [...elements.roomsEditor.querySelectorAll("[data-room-name]")]
      .map((input) => ({
        id: input.dataset.roomName,
        name: input.value.trim(),
        color:
          elements.roomsEditor.querySelector(`[data-room-color="${input.dataset.roomName}"]`)?.value || "#98c7a3",
        publicVisible: elements.roomsEditor.querySelector(`[data-room-visible="${input.dataset.roomName}"]`)?.checked ?? true,
        summary: elements.roomsEditor.querySelector(`[data-room-summary="${input.dataset.roomName}"]`)?.value.trim() || "",
        description: elements.roomsEditor.querySelector(`[data-room-description="${input.dataset.roomName}"]`)?.value.trim() || "",
        capacity: Number(elements.roomsEditor.querySelector(`[data-room-capacity="${input.dataset.roomName}"]`)?.value || 2),
        price: elements.roomsEditor.querySelector(`[data-room-price="${input.dataset.roomName}"]`)?.value.trim() || "",
        amenityGroups: getRoomAmenityGroups(input.dataset.roomName),
        amenities: getRoomAmenityGroups(input.dataset.roomName).flatMap((group) => group.items),
        bookingLinks: getRoomBookingLinks(input.dataset.roomName),
        photos: JSON.parse(elements.roomsEditor.querySelector(`[data-room-photos="${input.dataset.roomName}"]`)?.value || "[]"),
      }))
      .filter((room) => room.name);

    const platforms = [...elements.platformsEditor.querySelectorAll("[data-platform-index]")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    if (!rooms.length) {
      showToast(elements, "Ajoutez au moins une chambre.", true);
      return;
    }
    if (!platforms.length) {
      showToast(elements, "Ajoutez au moins une plateforme.", true);
      return;
    }
    if (hasDuplicates(rooms.map((room) => room.name.toLowerCase()))) {
      showToast(elements, "Chaque chambre doit avoir un nom unique.", true);
      return;
    }
    if (hasDuplicates(platforms.map((platform) => platform.toLowerCase()))) {
      showToast(elements, "Chaque plateforme doit être unique.", true);
      return;
    }

    const payload = {
      propertyName: elements.propertyNameInput.value.trim(),
      description: state.settings.description || "",
      currency: elements.currencyInput.value.trim().toUpperCase(),
      site: {
        ...state.settings.site,
        logoUrl: elements.siteLogoUrl.value,
        heroImageUrl: elements.siteHeroUrl.value,
        headline: elements.siteHeadlineInput.value.trim(),
        subtitle: elements.siteSubtitleInput.value.trim(),
        intro: elements.siteIntroInput.value.trim(),
        giteTitle: elements.siteGiteTitleInput.value.trim(),
        giteDescription: elements.siteGiteDescriptionInput.value.trim(),
        gitePhotos: state.settings.site.gitePhotos || [],
        address: elements.siteAddressInput.value.trim(),
        phone: elements.sitePhoneInput.value.trim(),
        email: elements.siteEmailInput.value.trim(),
        bodyFont: elements.siteBodyFontSelect.value || "lato",
        headingFont: elements.siteHeadingFontSelect.value || "playfair",
      },
      rooms,
      platforms,
      notifications: {
        notifyEmail:  elements.notifyEmailInput.value.trim(),
        smtpHost:     elements.smtpHostInput.value.trim(),
        smtpPort:     elements.smtpPortInput.value.trim() || "587",
        smtpUser:     elements.smtpUserInput.value.trim(),
        smtpPassword: elements.smtpPasswordInput.value,
      },
      _versions: state.versions,
    };

    try {
      const data = await saveSettingsPayload(payload);
      setSettings(data.settings);
      setVersions(data.versions);
      setApiVersions(data.versions);
      settingsDirty = false;
      rerender();
      resetReservationForm();
      showToast(elements, "Paramètres sauvegardés.");
    } catch (error) {
      if (await handleConflict(error)) {
        return;
      }
      showToast(elements, error.message, true);
    }
  }

  async function exportBackup() {
    try {
      const backup = await fetchBackup();
      downloadTextFile(
        `sauvegarde-reservations-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(backup, null, 2),
        "application/json;charset=utf-8",
      );
      showToast(elements, "Sauvegarde exportée.");
    } catch (error) {
      showToast(elements, error.message, true);
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const payload = await readJsonFile(file);
      const data = await restoreBackup(payload);
      setSettings(data.settings);
      setReservations(data.reservations);
      setBookingRequests(data.bookingRequests || state.bookingRequests);
      setVersions(data.versions);
      setApiVersions(data.versions);
      rerender();
      showToast(elements, "Sauvegarde restaurée.");
    } catch (error) {
      showToast(elements, error.message, true);
    } finally {
      event.target.value = "";
    }
  }

  function exportCsv() {
    const year = Number(elements.reportYear.value);
    const reservations = getReservationsByType(state, "reservation").filter(
      (reservation) => parseIsoDate(reservation.arrivalDate).getFullYear() === year,
    );
    const header = [
      "Numéro",
      "Statut",
      "Chambre",
      "Arrivée",
      "Départ",
      "Client",
      "Contact",
      "Plateforme",
      "Montant",
      "Commentaire",
    ];
    const rows = reservations.map((reservation) => [
      reservation.bookingName,
      getStatusLabel(reservation.status),
      getRoomName(state, reservation.roomId),
      reservation.arrivalDate,
      reservation.departureDate,
      reservation.clientName,
      reservation.clientContact,
      reservation.platform,
      String(reservation.amount ?? 0),
      reservation.comment || "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    downloadTextFile(`bilans-${year}.csv`, csv, "text/csv;charset=utf-8");
    showToast(elements, "Export CSV créé.");
  }

  async function handleConflict(error) {
    if (error?.status !== 409) {
      return false;
    }
    showToast(elements, "Les données ont changé sur un autre appareil. Rechargement...", true);
    await loadState("auto");
    return true;
  }

  function addInlineItem(type) {
    if (type === "room") {
      state.settings.rooms.push({
        id: `room-${Date.now()}`,
        name: `Nouvelle chambre ${state.settings.rooms.length + 1}`,
        color: getDefaultRoomColor(state.settings.rooms.length),
        publicVisible: true,
        summary: "",
        description: "",
        capacity: 2,
        price: "",
        amenities: [],
        amenityGroups: [],
        bookingLinks: [],
        photos: [],
      });
    } else {
      state.settings.platforms.push(`Nouvelle plateforme ${state.settings.platforms.length + 1}`);
    }
    settingsDirty = true;
    renderApp({ ...ctx, actions });
  }

  async function handleMediaUpload(event, targetInput) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = await uploadImage(file);
      targetInput.value = data.url;
      if (targetInput === elements.siteLogoUrl) {
        state.settings.site.logoUrl = data.url;
      }
      if (targetInput === elements.siteHeroUrl) {
        state.settings.site.heroImageUrl = data.url;
      }
      settingsDirty = true;
      rerender();
      showToast(elements, "Image ajoutée.");
    } catch (error) {
      showToast(elements, error.message, true);
    } finally {
      event.target.value = "";
    }
  }

  async function uploadRoomPhoto(roomId, file) {
    if (!file) {
      return;
    }
    try {
      const data = await uploadImage(file);
      const room = state.settings.rooms.find((item) => item.id === roomId);
      if (room) {
        room.photos = [...(room.photos || []), { url: data.url, alt: room.name }];
      }
      settingsDirty = true;
      rerender();
      showToast(elements, "Photo de chambre ajoutée.");
    } catch (error) {
      showToast(elements, error.message, true);
    }
  }

  async function handleGitePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const data = await uploadImage(file);
      state.settings.site.gitePhotos = [
        ...(state.settings.site.gitePhotos || []),
        { url: data.url, alt: state.settings.propertyName || "Le gîte" },
      ];
      settingsDirty = true;
      rerender();
      showToast(elements, "Photo du gîte ajoutée.");
    } catch (error) {
      showToast(elements, error.message, true);
    } finally {
      event.target.value = "";
    }
  }

  function removeGitePhoto(photoIndex) {
    state.settings.site.gitePhotos = (state.settings.site.gitePhotos || []).filter((_, index) => index !== photoIndex);
    settingsDirty = true;
    rerender();
  }

  function removeRoomPhoto(roomId, photoIndex) {
    const room = state.settings.rooms.find((item) => item.id === roomId);
    if (!room) {
      return;
    }
    room.photos = (room.photos || []).filter((_, index) => index !== photoIndex);
    settingsDirty = true;
    rerender();
  }

  function reorderRoomPhoto(roomId, fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const room = state.settings.rooms.find((item) => item.id === roomId);
    if (!room) return;
    const photos = [...(room.photos || [])];
    const [moved] = photos.splice(fromIndex, 1);
    photos.splice(toIndex, 0, moved);
    room.photos = photos;
    settingsDirty = true;
    rerender();
  }

  function reorderGitePhoto(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const photos = [...(state.settings.site.gitePhotos || [])];
    const [moved] = photos.splice(fromIndex, 1);
    photos.splice(toIndex, 0, moved);
    state.settings.site.gitePhotos = photos;
    settingsDirty = true;
    rerender();
  }

  function getRoomBookingLinks(roomId) {
    return [...elements.roomsEditor.querySelectorAll(`[data-booking-link-room="${roomId}"]`)]
      .map((row) => ({
        label: row.querySelector("[data-booking-link-label]")?.value.trim() || "Réserver",
        url: row.querySelector("[data-booking-link-url]")?.value.trim() || "",
      }))
      .filter((link) => link.url);
  }

  function getRoomAmenityGroups(roomId) {
    return [...elements.roomsEditor.querySelectorAll(`[data-amenity-group-room="${roomId}"]`)]
      .map((row) => ({
        name: row.querySelector("[data-amenity-group-name]")?.value.trim() || "",
        items: (row.querySelector("[data-amenity-group-items]")?.value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }))
      .filter((group) => group.name && group.items.length);
  }

  function addRoomAmenityGroup(roomId) {
    const room = state.settings.rooms.find((item) => item.id === roomId);
    if (!room) {
      return;
    }
    room.amenityGroups = getRoomAmenityGroups(roomId);
    room.amenityGroups.push({ name: "Équipements", items: [] });
    settingsDirty = true;
    rerender();
  }

  function removeRoomAmenityGroup(roomId, indexToRemove) {
    const room = state.settings.rooms.find((item) => item.id === roomId);
    if (!room) {
      return;
    }
    room.amenityGroups = getRoomAmenityGroups(roomId).filter((_, index) => index !== indexToRemove);
    settingsDirty = true;
    rerender();
  }

  function addRoomBookingLink(roomId) {
    const room = state.settings.rooms.find((item) => item.id === roomId);
    if (!room) {
      return;
    }
    room.bookingLinks = getRoomBookingLinks(roomId);
    room.bookingLinks.push({ label: "Réserver", url: "" });
    settingsDirty = true;
    rerender();
  }

  function removeRoomBookingLink(roomId, indexToRemove) {
    const room = state.settings.rooms.find((item) => item.id === roomId);
    if (!room) {
      return;
    }
    room.bookingLinks = getRoomBookingLinks(roomId).filter((_, index) => index !== indexToRemove);
    settingsDirty = true;
    rerender();
  }

  async function handleBookingRequestAction(id, action) {
    try {
      const data = await updateBookingRequest(id, action, action === "accept" ? getEditedRequestReservation(id) : undefined);
      if (data.reservations) {
        setReservations(data.reservations);
      }
      setBookingRequests(data.bookingRequests);
      setVersions(data.versions);
      setApiVersions(data.versions);
      rerender();
      showToast(elements, action === "accept" ? "Demande acceptée." : "Demande refusée.");
    } catch (error) {
      showToast(elements, error.message, true);
    }
  }

  function getEditedRequestReservation(id) {
    const form = elements.bookingRequestsList.querySelector(`[data-request-edit-form="${id}"]`);
    if (!form) {
      return undefined;
    }
    return {
      roomId: form.querySelector("[data-request-room-id]")?.value || "",
      arrivalDate: form.querySelector("[data-request-arrival-date]")?.value || "",
      departureDate: form.querySelector("[data-request-departure-date]")?.value || "",
      clientName: form.querySelector("[data-request-client-name]")?.value.trim() || "",
      clientContact: form.querySelector("[data-request-client-contact]")?.value.trim() || "",
      amount: Number(form.querySelector("[data-request-amount]")?.value || 0),
      comment: form.querySelector("[data-request-comment]")?.value.trim() || "",
    };
  }

  async function handlePasswordChange() {
    try {
      await changeAdminPassword({
        currentPassword: elements.currentPasswordInput.value,
        newPassword: elements.newPasswordInput.value,
      });
      showToast(elements, "Mot de passe modifié. Reconnecte-toi.");
      window.setTimeout(() => {
        window.location.href = "/gestion/";
      }, 900);
    } catch (error) {
      showToast(elements, error.message, true);
    }
  }

  async function handleLogout() {
    await logoutAdmin();
    window.location.href = "/gestion/";
  }

  function removeRoom(roomId) {
    const linkedReservations = state.reservations.filter((reservation) => reservation.roomId === roomId).length;
    if (linkedReservations > 0) {
      showToast(elements, "Supprimez ou réattribuez d'abord les réservations de cette chambre.", true);
      return;
    }
    state.settings.rooms = state.settings.rooms.filter((room) => room.id !== roomId);
    settingsDirty = true;
    renderApp({ ...ctx, actions });
  }

  function removePlatform(index) {
    const platform = state.settings.platforms[index];
    const linkedReservations = getReservationsByType(state, "reservation").filter(
      (reservation) => reservation.platform === platform,
    ).length;
    if (linkedReservations > 0) {
      showToast(elements, "Cette plateforme est utilisée dans des réservations existantes.", true);
      return;
    }
    state.settings.platforms.splice(index, 1);
    settingsDirty = true;
    renderApp({ ...ctx, actions });
  }

  function setActiveTab(tabName) {
    state.activeTab = tabName;
    elements.tabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    elements.tabPanels.forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${tabName}`);
    });
  }

  function handleBookingTypeChange() {
    applyBookingTypeFormState(elements.bookingType.value);
  }

  function applyBookingTypeFormState(type) {
    const isBlock = type === "block";
    elements.reservationOnlyFields.forEach((field) => {
      field.classList.toggle("is-hidden", isBlock);
    });
    elements.blockOnlyFields.forEach((field) => {
      field.classList.toggle("is-hidden", !isBlock);
    });

    elements.clientName.required = !isBlock;
    elements.clientContact.required = !isBlock;
    elements.platform.required = !isBlock;
    elements.amount.required = !isBlock;
    elements.roomId.required = !isBlock;
    elements.roomId.closest("label").classList.toggle("is-hidden", isBlock);

    if (isBlock) {
      elements.clientName.value = "";
      elements.clientContact.value = "";
      elements.amount.value = "";
      elements.platform.value = "";
    } else if (!elements.platform.value && state.settings?.platforms?.[0]) {
      elements.platform.value = state.settings.platforms[0];
    }
  }

  function getSelectedBlockRoomIds() {
    return [...elements.blockRoomsSelector.querySelectorAll("input:checked")].map((input) => input.value);
  }

  function changeCalendarMonth(delta) {
    state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + delta, 1);
    rerender();
  }

  function goToCurrentMonth() {
    const today = new Date();
    state.calendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
    rerender();
  }

  function changePlanningMonth(delta) {
    state.planningDate = new Date(state.planningDate.getFullYear(), state.planningDate.getMonth() + delta, 1);
    rerender();
  }

  function goToCurrentPlanningMonth() {
    const today = new Date();
    state.planningDate = new Date(today.getFullYear(), today.getMonth(), 1);
    rerender();
  }

  function startAutoRefresh() {
    window.clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = window.setInterval(() => {
      if (shouldPauseAutoRefresh()) {
        return;
      }
      loadState("auto");
    }, 30000);
  }

  function shouldPauseAutoRefresh() {
    return state.activeTab === "settings" || settingsDirty;
  }

  const actions = {
    addInlineItem,
    addRoomAmenityGroup,
    addRoomBookingLink,
    applyBookingTypeFormState,
    bindEvents,
    changeCalendarMonth,
    changePlanningMonth,
    deleteReservation,
    editReservation,
    exportBackup,
    exportCsv,
    getSelectedBlockRoomIds,
    goToCurrentMonth,
    goToCurrentPlanningMonth,
    handleBookingTypeChange,
    handleReservationSubmit,
    handleSettingsSubmit,
    openReservationModal,
    importBackup,
    handleBookingRequestAction,
    removeRoomPhoto,
    reorderRoomPhoto,
    reorderGitePhoto,
    uploadRoomPhoto,
    loadState,
    removePlatform,
    removeGitePhoto,
    removeRoom,
    removeRoomAmenityGroup,
    removeRoomBookingLink,
    rerender,
    resetReservationForm,
    setActiveTab,
  };

  return actions;
}
