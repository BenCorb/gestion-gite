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
} from "./utils.js";

export function initializeReportControls(state, elements) {
  const today = new Date();
  const currentMonthValue = elements.reportMonth.value;
  const currentYearValue = elements.reportYear.value;
  const fallbackMonthValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const years = new Set([
    today.getFullYear(),
    ...state.reservations.map((reservation) => parseIsoDate(reservation.arrivalDate).getFullYear()),
  ]);

  const monthOptions = [...years]
    .sort((a, b) => b - a)
    .flatMap((year) =>
      Array.from({ length: 12 }, (_, index) => {
        const monthNumber = 12 - index;
        const value = `${year}-${String(monthNumber).padStart(2, "0")}`;
        const label = new Date(year, monthNumber - 1, 1).toLocaleDateString("fr-FR", {
          month: "long",
          year: "numeric",
        });
        return `<option value="${value}">${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</option>`;
      }),
    );
  elements.reportMonth.innerHTML = monthOptions.join("");

  elements.reportYear.innerHTML = [...years]
    .sort((a, b) => b - a)
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");

  elements.reportMonth.value = [...elements.reportMonth.options].some((option) => option.value === currentMonthValue)
    ? currentMonthValue
    : fallbackMonthValue;
  elements.reportYear.value = [...years].includes(Number(currentYearValue))
    ? currentYearValue
    : String(today.getFullYear());
}

export function renderApp(ctx) {
  renderHeader(ctx.state, ctx.elements);
  renderTopStats(ctx.state, ctx.elements);
  renderAlerts(ctx.state, ctx.elements);
  renderReservationFormOptions(ctx);
  ctx.actions.applyBookingTypeFormState(ctx.elements.bookingType.value || "reservation");
  renderReservationsList(ctx);
  renderCalendar(ctx.state, ctx.elements);
  renderPlanning(ctx.state, ctx.elements);
  renderReports(ctx.state, ctx.elements);
  renderSettingsForm(ctx);
}

function renderHeader(state, elements) {
  elements.propertyTitle.textContent = state.settings.propertyName;
  document.title = "SUIVI DE RÉSERVATIONS";
  if (state.lastSyncedAt) {
    elements.syncStatus.textContent = `Synchronisé à ${state.lastSyncedAt.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
}

function renderTopStats(state, elements) {
  const today = new Date();
  const reservationsOnly = getReservationsByType(state, "reservation").filter(
    (reservation) => reservation.status !== "cancelled",
  );
  const upcoming = reservationsOnly.filter(
    (reservation) => parseIsoDate(reservation.departureDate) >= today,
  );
  const currentMonthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
  const thisMonth = reservationsOnly.filter((reservation) => {
    const date = parseIsoDate(reservation.arrivalDate);
    return `${date.getFullYear()}-${date.getMonth() + 1}` === currentMonthKey;
  });
  const totalRevenue = sumAmounts(reservationsOnly.filter((reservation) => reservation.status !== "cancelled"));
  const currentGuests = state.reservations.filter((reservation) =>
    (getEntryType(reservation) === "block" || reservation.status !== "cancelled") &&
    isDateInStay(today, reservation.arrivalDate, reservation.departureDate),
  ).length;

  const stats = [
    { label: "Séjours à venir", value: upcoming.length },
    { label: "Occupations aujourd'hui", value: currentGuests },
    { label: "Réservations du mois", value: thisMonth.length },
    { label: "CA prévu", value: formatCurrency(state, totalRevenue) },
  ];

  elements.topStats.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <span class="label">${stat.label}</span>
          <strong>${stat.value}</strong>
        </article>
      `,
    )
    .join("");
}

function renderAlerts(state, elements) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const alerts = [];

  state.reservations.forEach((reservation) => {
    const type = getEntryType(reservation);
    if (type === "reservation") {
      if (reservation.status === "cancelled") {
        return;
      }
      const arrival = parseIsoDate(reservation.arrivalDate);
      const departure = parseIsoDate(reservation.departureDate);
      if (sameDay(arrival, today)) {
        alerts.push(`Arrivée aujourd'hui: ${reservation.clientName} - ${getRoomName(state, reservation.roomId)}`);
      } else if (sameDay(arrival, tomorrow)) {
        alerts.push(`Arrivée demain: ${reservation.clientName} - ${getRoomName(state, reservation.roomId)}`);
      }
      if (sameDay(departure, today)) {
        alerts.push(`Départ aujourd'hui: ${reservation.clientName} - ${getRoomName(state, reservation.roomId)}`);
      }
      if (reservation.status === "pending") {
        alerts.push(`Réservation en attente: ${reservation.clientName} - ${getRoomName(state, reservation.roomId)}`);
      }
      if (!reservation.clientContact) {
        alerts.push(`Contact manquant: ${reservation.bookingName}`);
      }
    }
  });

  const uniqueAlerts = [...new Set(alerts)].slice(0, 8);
  if (!uniqueAlerts.length) {
    elements.alertsList.innerHTML = `<div class="empty-state"><h3>Tout est sous contrôle</h3><p>Aucune alerte urgente.</p></div>`;
    return;
  }

  elements.alertsList.innerHTML = uniqueAlerts
    .map((alert) => `<div class="alert-item">${escapeHtml(alert)}</div>`)
    .join("");
}

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

function renderReservationsList(ctx) {
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
      return `
        <article class="reservation-card">
          <header>
            <div>
              <h3>${escapeHtml(reservation.bookingName)}</h3>
              <div class="reservation-meta">
                <span class="room-tag custom-color" ${getRoomStyle(state, reservation.roomId)}>${escapeHtml(roomName)}</span>
                <span class="type-tag ${getEntryType(reservation) === "block" ? "block" : ""}">${getEntryTypeLabel(reservation)}</span>
                <span class="status-tag status-${escapeHtml(reservation.status || "confirmed")}">${getStatusLabel(reservation.status)}</span>
                <span>${formatDate(reservation.arrivalDate)} au ${formatDate(reservation.departureDate)}</span>
              </div>
            </div>
            <span class="platform-tag">${escapeHtml(getDisplayPlatform(reservation))}</span>
          </header>
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
              <button class="secondary-button" type="button" data-action="edit" data-id="${reservation.id}">
                Modifier
              </button>
              <button class="danger-button" type="button" data-action="delete" data-id="${reservation.id}">
                Supprimer
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  elements.reservationsList.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => actions.editReservation(button.dataset.id));
  });

  elements.reservationsList.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => actions.deleteReservation(button.dataset.id));
  });
}

function renderCalendar(state, elements) {
  const baseDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
  elements.calendarMonthLabel.textContent = baseDate.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const cells = weekdays.map((weekday) => `<div class="calendar-weekday">${weekday}</div>`).join("");

  const start = new Date(baseDate);
  const startOffset = (baseDate.getDay() + 6) % 7;
  start.setDate(baseDate.getDate() - startOffset);

  const todayIso = dateToIso(new Date());
  let html = cells;

  for (let index = 0; index < 42; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const iso = dateToIso(current);
    const inMonth = current.getMonth() === baseDate.getMonth();
    const reservations = getReservationsForDate(state, iso);
    const classes = ["calendar-cell"];

    if (!inMonth) {
      classes.push("muted");
    }
    if (iso === todayIso) {
      classes.push("today");
    }

    html += `
      <div class="${classes.join(" ")}">
        <div class="calendar-day">${current.getDate()}</div>
        ${reservations
          .map(
            (reservation) => `
              <div class="calendar-chip custom-color ${getEntryType(reservation) === "block" ? "block" : ""}" ${getRoomStyle(state, reservation.roomId)} title="${escapeHtml(getCalendarLabel(reservation))}">
                <span>${escapeHtml(getRoomName(state, reservation.roomId))}</span>
                <strong>${escapeHtml(getCalendarLabel(reservation))}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  elements.calendarGrid.innerHTML = html;
}

function renderPlanning(state, elements) {
  const baseDate = new Date(state.planningDate.getFullYear(), state.planningDate.getMonth(), 1);
  const todayIso = dateToIso(new Date());
  elements.planningMonthLabel.textContent = baseDate.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0).getDate();
  elements.planningGrid.style.setProperty("--planning-days", String(daysInMonth));
  elements.planningGrid.style.setProperty("--planning-min-width", `${164 + daysInMonth * 38}px`);

  const header = [
    `<div class="planning-cell planning-room-header sticky-column">Chambre</div>`,
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), index + 1);
      const isToday = dateToIso(dayDate) === todayIso;
      return `<div class="planning-cell planning-day-header ${isToday ? "today" : ""}">${index + 1}</div>`;
    }),
  ].join("");

  const rows = state.settings.rooms
    .map((room) => {
      const cells = [`<div class="planning-cell planning-room-name sticky-column">${escapeHtml(room.name)}</div>`];
      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
        const iso = dateToIso(date);
        const isToday = iso === todayIso;
        const reservation = state.reservations.find(
          (item) => item.roomId === room.id && isDateInStay(iso, item.arrivalDate, item.departureDate),
        );
        const statusClass = reservation ? `planning-${getEntryType(reservation)}` : "";
        const todayClass = isToday ? "today" : "";
        const label = reservation ? getCalendarLabel(reservation) : "";
        cells.push(
          `<div class="planning-cell planning-slot ${statusClass} ${todayClass}" ${reservation ? getRoomStyle(state, room.id) : ""} title="${escapeHtml(label)}">${reservation ? "&bull;" : ""}</div>`,
        );
      }
      return cells.join("");
    })
    .join("");

  elements.planningGrid.innerHTML = header + rows;
}

function renderReports(state, elements) {
  renderMonthlyReport(state, elements);
  renderYearlyReport(state, elements);
}

function renderMonthlyReport(state, elements) {
  const monthValue = elements.reportMonth.value;
  const [year, month] = monthValue.split("-").map(Number);
  const reservations = getReservationsForMonth(state, year, month - 1);
  const activeReservations = getActiveReservations(reservations);
  const previousDate = new Date(year, month - 2, 1);
  const previousReservations = getReservationsForMonth(state, previousDate.getFullYear(), previousDate.getMonth());
  const previousActiveReservations = getActiveReservations(previousReservations);

  const totalRevenue = sumAmounts(activeReservations);
  const collectedRevenue = sumAmounts(activeReservations.filter((reservation) => reservation.status === "paid"));
  const totalNights = getTotalNights(activeReservations);
  const averageRevenuePerReservation = activeReservations.length ? totalRevenue / activeReservations.length : 0;
  const averageRevenuePerNight = totalNights ? totalRevenue / totalNights : 0;
  const averageStayLength = activeReservations.length ? totalNights / activeReservations.length : 0;

  const platformCounts = countBy(activeReservations, (reservation) => reservation.platform);
  const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Aucune";

  const stats = [
    { label: "Réservations", value: activeReservations.length },
    { label: "Nuits réservées", value: totalNights },
    { label: "CA prévu", value: formatCurrency(state, totalRevenue) },
    { label: "CA encaissé", value: formatCurrency(state, collectedRevenue) },
    { label: "Revenu moyen / réservation", value: formatCurrency(state, averageRevenuePerReservation) },
    { label: "Revenu moyen / nuit", value: formatCurrency(state, averageRevenuePerNight) },
    { label: "Durée moyenne", value: formatAverageNights(averageStayLength) },
    { label: "Plateforme dominante", value: topPlatform },
  ];

  elements.monthlyStats.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <span class="label">${stat.label}</span>
          <strong>${stat.value}</strong>
        </article>
      `,
    )
    .join("");

  const breakdown = state.settings.rooms.map((room) => {
    const roomReservations = activeReservations.filter((reservation) => reservation.roomId === room.id);
    return {
      room,
      count: roomReservations.length,
      revenue: sumAmounts(roomReservations),
      nights: getTotalNights(roomReservations),
    };
  });

  const platformBreakdown = buildPlatformBreakdown(state, activeReservations, totalRevenue);
  const monthlyComparisons = [
    createComparisonCard(
      "Réservations",
      activeReservations.length,
      previousActiveReservations.length,
      "réservation(s)",
    ),
    createComparisonCard(
      "Nuits",
      totalNights,
      getTotalNights(previousActiveReservations),
      "nuit(s)",
    ),
    createComparisonCard(
      "CA prévu",
      totalRevenue,
      sumAmounts(previousActiveReservations),
      state.settings.currency,
      true,
      state,
    ),
  ];

  elements.monthlyComparison.innerHTML = monthlyComparisons.map(renderBreakdownCard).join("");
  elements.monthlyPlatformBreakdown.innerHTML = platformBreakdown.length
    ? platformBreakdown.map((item) => renderPlatformCard(state, item)).join("")
    : renderEmptyBreakdown("Aucune plateforme active ce mois-ci.");
  elements.monthlyRoomBreakdown.innerHTML = breakdown
    .map(
      ({ room, count, revenue, nights }) => `
        <article class="breakdown-card">
          <h3>${escapeHtml(room.name)}</h3>
          <p>${count} réservation(s)</p>
          <p>${nights} nuit(s)</p>
          <strong>${formatCurrency(state, revenue)}</strong>
        </article>
      `,
    )
    .join("");
}

function renderYearlyReport(state, elements) {
  const year = Number(elements.reportYear.value);
  const reservations = getReservationsForYear(state, year);
  const activeReservations = getActiveReservations(reservations);
  const paidReservations = activeReservations.filter((reservation) => reservation.status === "paid");
  const totalRevenue = sumAmounts(activeReservations);
  const collectedRevenue = sumAmounts(paidReservations);
  const totalNights = getTotalNights(activeReservations);
  const averageRevenuePerReservation = activeReservations.length ? totalRevenue / activeReservations.length : 0;
  const averageRevenuePerNight = totalNights ? totalRevenue / totalNights : 0;
  const averageStayLength = activeReservations.length ? totalNights / activeReservations.length : 0;
  const topRooms = buildTopRooms(state, activeReservations);

  const stats = [
    { label: "Réservations annuelles", value: activeReservations.length },
    { label: "Nuits annuelles", value: totalNights },
    { label: "CA prévu annuel", value: formatCurrency(state, totalRevenue) },
    { label: "CA encaissé annuel", value: formatCurrency(state, collectedRevenue) },
    { label: "Revenu moyen / réservation", value: formatCurrency(state, averageRevenuePerReservation) },
    { label: "Revenu moyen / nuit", value: formatCurrency(state, averageRevenuePerNight) },
    { label: "Durée moyenne", value: formatAverageNights(averageStayLength) },
    { label: "Réservations payées", value: paidReservations.length },
  ];

  elements.yearlyStats.innerHTML = stats
    .map(
      (stat) => `
        <article class="stat-card">
          <span class="label">${stat.label}</span>
          <strong>${stat.value}</strong>
        </article>
      `,
    )
    .join("");

  elements.yearlyRoomInsights.innerHTML = [
    renderSimpleMetricCard("Plus réservée", topRooms.mostBooked?.room.name || "Aucune", `${topRooms.mostBooked?.count || 0} réservation(s)`),
    renderSimpleMetricCard("Plus rentable", topRooms.mostProfitable?.room.name || "Aucune", formatCurrency(state, topRooms.mostProfitable?.revenue || 0)),
    renderSimpleMetricCard("Moins occupée", topRooms.leastOccupied?.room.name || "Aucune", `${topRooms.leastOccupied?.nights || 0} nuit(s)`),
  ].join("");

  const rows = [];
  for (let month = 0; month < 12; month += 1) {
    const monthlyReservations = activeReservations.filter((reservation) => parseIsoDate(reservation.arrivalDate).getMonth() === month);
    rows.push(`
      <tr>
        <td>${new Date(year, month, 1).toLocaleDateString("fr-FR", { month: "long" })}</td>
        <td>${monthlyReservations.length}</td>
        <td>${getTotalNights(monthlyReservations)}</td>
        <td>${formatCurrency(state, sumAmounts(monthlyReservations))}</td>
      </tr>
    `);
  }
  elements.yearlyTableBody.innerHTML = rows.join("");
}

function renderSettingsForm(ctx) {
  const { actions, elements, state } = ctx;
  elements.propertyNameInput.value = state.settings.propertyName;
  elements.currencyInput.value = state.settings.currency || "EUR";

  elements.roomsEditor.innerHTML = state.settings.rooms
    .map(
      (room) => `
        <div class="inline-editor">
          <input type="text" data-room-name="${room.id}" value="${escapeHtml(room.name)}" />
          <select class="color-select" data-room-color="${room.id}">
            ${getRoomColorOptions(room.color)}
          </select>
          <button class="danger-button" type="button" data-delete-room="${room.id}">Supprimer</button>
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
  elements.platformsEditor.querySelectorAll("[data-delete-platform]").forEach((button) => {
    button.addEventListener("click", () => actions.removePlatform(Number(button.dataset.deletePlatform)));
  });
}

function getReservationsForDate(state, isoDate) {
  return state.reservations.filter((reservation) => {
    if (getEntryType(reservation) === "reservation" && reservation.status === "cancelled") {
      return false;
    }
    return isDateInStay(isoDate, reservation.arrivalDate, reservation.departureDate);
  });
}

function sameDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function getReservationsForMonth(state, year, monthIndex) {
  return getReservationsByType(state, "reservation").filter((reservation) => {
    const date = parseIsoDate(reservation.arrivalDate);
    return date.getFullYear() === year && date.getMonth() === monthIndex;
  });
}

function getReservationsForYear(state, year) {
  return getReservationsByType(state, "reservation").filter(
    (reservation) => parseIsoDate(reservation.arrivalDate).getFullYear() === year,
  );
}

function getActiveReservations(reservations) {
  return reservations.filter((reservation) => reservation.status !== "cancelled");
}

function getTotalNights(reservations) {
  return reservations.reduce(
    (sum, reservation) => sum + calculateNights(reservation.arrivalDate, reservation.departureDate),
    0,
  );
}

function buildPlatformBreakdown(state, reservations, totalRevenue) {
  return state.settings.platforms
    .map((platform) => {
      const platformReservations = reservations.filter((reservation) => reservation.platform === platform);
      const revenue = sumAmounts(platformReservations);
      const share = totalRevenue ? (revenue / totalRevenue) * 100 : 0;
      return {
        platform,
        reservations: platformReservations.length,
        revenue,
        share,
      };
    })
    .filter((item) => item.reservations > 0 || item.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);
}

function createComparisonCard(label, currentValue, previousValue, unitOrCurrency, isCurrency = false, state = null) {
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

function renderBreakdownCard({ label, value, detail }) {
  return `
    <article class="breakdown-card">
      <span class="label">${escapeHtml(label)}</span>
      <h3>${escapeHtml(value)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderPlatformCard(state, { platform, reservations, revenue, share }) {
  return `
    <article class="breakdown-card">
      <h3>${escapeHtml(platform)}</h3>
      <p>${reservations} réservation(s)</p>
      <p>${share.toFixed(1).replace(".", ",")} % du CA</p>
      <strong>${formatCurrency(state, revenue)}</strong>
    </article>
  `;
}

function renderEmptyBreakdown(message) {
  return `<article class="breakdown-card"><p>${escapeHtml(message)}</p></article>`;
}

function renderSimpleMetricCard(label, title, detail) {
  return `
    <article class="breakdown-card">
      <span class="label">${escapeHtml(label)}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function buildTopRooms(state, reservations) {
  const roomMetrics = state.settings.rooms.map((room) => {
    const roomReservations = reservations.filter((reservation) => reservation.roomId === room.id);
    return {
      room,
      count: roomReservations.length,
      nights: getTotalNights(roomReservations),
      revenue: sumAmounts(roomReservations),
    };
  });

  return {
    mostBooked: [...roomMetrics].sort((a, b) => b.count - a.count || b.nights - a.nights)[0],
    mostProfitable: [...roomMetrics].sort((a, b) => b.revenue - a.revenue || b.count - a.count)[0],
    leastOccupied: [...roomMetrics].sort((a, b) => a.nights - b.nights || a.count - b.count)[0],
  };
}

function formatAverageNights(value) {
  return `${value.toFixed(1).replace(".", ",")} nuit(s)`;
}
