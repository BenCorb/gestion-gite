export const state = {
  settings: null,
  reservations: [],
  versions: {
    settingsVersion: "",
    reservationsVersion: "",
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

export function setVersions(versions) {
  state.versions = {
    settingsVersion: versions?.settingsVersion || "",
    reservationsVersion: versions?.reservationsVersion || "",
  };
  state.lastSyncedAt = new Date();
}
