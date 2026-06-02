import { renderAlerts } from "./alerts.js";
import { renderCalendar } from "./calendar.js";
import { renderHeader, renderTabBadges, renderTopStats } from "./header.js";
import { renderPlanning } from "./planning.js";
import { renderReports, initializeReportControls } from "./reports.js";
import { renderBookingRequests } from "./requests.js";
import { renderReservationFormOptions, renderReservationsList } from "./reservations.js";
import { renderSettingsForm } from "./settings.js";

export { initializeReportControls } from "./reports.js";
export { renderReservationFormOptions } from "./reservations.js";

export function renderApp(ctx) {
  renderHeader(ctx.state, ctx.elements);
  renderTabBadges(ctx.state);
  renderTopStats(ctx.state, ctx.elements);
  renderAlerts(ctx.state, ctx.elements);
  renderReservationFormOptions(ctx);
  ctx.actions.applyBookingTypeFormState(ctx.elements.bookingType.value || "reservation");
  renderReservationsList(ctx);
  renderCalendar(ctx.state, ctx.elements);
  renderPlanning(ctx.state, ctx.elements);
  renderReports(ctx.state, ctx.elements);
  renderBookingRequests(ctx);
  renderSettingsForm(ctx);
}
