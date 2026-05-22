export const state = {
  settings: null,
  reservations: [],
  bookingRequests: [],
  versions: {
    settingsVersion: "",
    reservationsVersion: "",
    bookingRequestsVersion: "",
  },
  quickFilter: "all",
  lastSyncedAt: null,
  activeTab: "alerts",
  calendarDate: new Date(),
  planningDate: new Date(),
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
