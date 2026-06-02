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

export function renderReports(state, elements) {
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
