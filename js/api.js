export async function fetchState() {
  const response = await fetch("/api/state");
  const payload = await response.json();

  if (!response.ok) {
    throw buildApiError(response, payload.error || "Impossible de charger les données.");
  }

  return payload;
}

export async function saveReservationPayload(payload) {
  const response = await fetch("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    throw buildApiError(response, data.error || "Impossible d'enregistrer la réservation.");
  }

  return data;
}

export async function deleteReservationRequest(id) {
  const response = await fetch(`/api/reservations/${id}`, {
    method: "DELETE",
    headers: {
      "X-Settings-Version": payloadVersions.settingsVersion,
      "X-Reservations-Version": payloadVersions.reservationsVersion,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw buildApiError(response, data.error || "Suppression impossible.");
  }

  return data;
}

let payloadVersions = {
  settingsVersion: "",
  reservationsVersion: "",
  bookingRequestsVersion: "",
};

export function setApiVersions(versions) {
  payloadVersions = {
    settingsVersion: versions?.settingsVersion || "",
    reservationsVersion: versions?.reservationsVersion || "",
    bookingRequestsVersion: versions?.bookingRequestsVersion || "",
  };
}

export async function saveSettingsPayload(payload) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    throw buildApiError(response, data.error || "Impossible de sauvegarder les paramètres.");
  }

  return data;
}

function buildApiError(response, message) {
  const error = new Error(message);
  error.status = response.status;
  return error;
}

export async function fetchBackup() {
  const response = await fetch("/api/backup");
  const data = await response.json();
  if (!response.ok) {
    throw buildApiError(response, data.error || "Impossible d'exporter la sauvegarde.");
  }
  return data;
}

export async function restoreBackup(payload) {
  const response = await fetch("/api/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw buildApiError(response, data.error || "Impossible de restaurer la sauvegarde.");
  }
  return data;
}

export async function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw buildApiError(response, data.error || "Upload impossible.");
  }
  return data;
}

export async function updateBookingRequest(id, action) {
  const response = await fetch(`/api/booking-requests/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw buildApiError(response, data.error || "Action impossible sur la demande.");
  }
  return data;
}

export async function changeAdminPassword(payload) {
  const response = await fetch("/api/admin/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw buildApiError(response, data.error || "Changement de mot de passe impossible.");
  }
  return data;
}

export async function logoutAdmin() {
  const response = await fetch("/api/logout", { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    throw buildApiError(response, data.error || "Déconnexion impossible.");
  }
  return data;
}
