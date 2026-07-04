function getLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const state = {
  settings: null,
  reservations: [],
  bookingRequests: [],
  versions: {
    settingsVersion: "",
    reservationsVersion: "",
    bookingRequestsVersion: "",
  },
  quickFilters: [],
  reservationSort: "created-desc",
  lastSyncedAt: null,
  activeTab: "alerts",
  calendarDate: new Date(),
  calendarSelectedDate: getLocalIsoDate(new Date()),
  expandedReservationIds: [],
  planningDate: new Date(),
  requestDraftId: "",
  requestDraftMode: "quick",
};

export const elements = {};

export function setSettings(settings) {
  state.settings = settings;
}

export function setReservations(reservations) {
  state.reservations = reservations || [];
}

export function setBookingRequests(bookingRequests) {
  state.bookingRequests = bookingRequests || [];
}

export function setVersions(versions) {
  state.versions = {
    settingsVersion: versions?.settingsVersion || "",
    reservationsVersion: versions?.reservationsVersion || "",
    bookingRequestsVersion: versions?.bookingRequestsVersion || "",
  };
  state.lastSyncedAt = new Date();
}
