import {
  deleteReservationRequest,
  fetchBackup,
  fetchState,
  restoreBackup,
  saveReservationPayload,
  saveSettingsPayload,
  setApiVersions,
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
  const { elements, setReservations, setSettings, setVersions, state } = ctx;
  let autoRefreshIntervalId = null;

  function rerender() {
    initializeReportControls(state, elements);
    renderApp({ ...ctx, actions });
  }

  async function loadState(showSyncedMessage = false) {
    try {
      const previousReservationsVersion = state.versions.reservationsVersion;
      const previousSettingsVersion = state.versions.settingsVersion;
      const payload = await fetchState();
      const changed =
        (previousReservationsVersion && previousReservationsVersion !== payload.versions.reservationsVersion) ||
        (previousSettingsVersion && previousSettingsVersion !== payload.versions.settingsVersion);
      setSettings(payload.settings);
      setReservations(payload.reservations);
      setVersions(payload.versions);
      setApiVersions(payload.versions);
      rerender();
      setActiveTab(state.activeTab);
      if (showSyncedMessage && changed) {
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

    elements.refreshButton.addEventListener("click", () => loadState(true));
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
    elements.addRoomButton.addEventListener("click", () => addInlineItem("room"));
    elements.addPlatformButton.addEventListener("click", () => addInlineItem("platform"));
    elements.exportBackupButton.addEventListener("click", exportBackup);
    elements.importBackupInput.addEventListener("change", importBackup);
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
      resetReservationForm();
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

  function editReservation(id) {
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
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      rooms,
      platforms,
      _versions: state.versions,
    };

    try {
      const data = await saveSettingsPayload(payload);
      setSettings(data.settings);
      setVersions(data.versions);
      setApiVersions(data.versions);
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
    await loadState(true);
    return true;
  }

  function addInlineItem(type) {
    if (type === "room") {
      state.settings.rooms.push({
        id: `room-${Date.now()}`,
        name: `Nouvelle chambre ${state.settings.rooms.length + 1}`,
        color: getDefaultRoomColor(state.settings.rooms.length),
      });
    } else {
      state.settings.platforms.push(`Nouvelle plateforme ${state.settings.platforms.length + 1}`);
    }
    renderApp({ ...ctx, actions });
  }

  function removeRoom(roomId) {
    const linkedReservations = state.reservations.filter((reservation) => reservation.roomId === roomId).length;
    if (linkedReservations > 0) {
      showToast(elements, "Supprimez ou réattribuez d'abord les réservations de cette chambre.", true);
      return;
    }
    state.settings.rooms = state.settings.rooms.filter((room) => room.id !== roomId);
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
      loadState(true);
    }, 30000);
  }

  const actions = {
    addInlineItem,
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
    importBackup,
    loadState,
    removePlatform,
    removeRoom,
    rerender,
    resetReservationForm,
    setActiveTab,
  };

  return actions;
}
