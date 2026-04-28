export const PASTEL_ROOM_COLORS = [
  { value: "#98c7a3", label: "Vert sauge" },
  { value: "#e6c28b", label: "Miel doux" },
  { value: "#9dbdd7", label: "Bleu brume" },
  { value: "#d8a7a7", label: "Rose poudré" },
  { value: "#b8abd8", label: "Lavande" },
  { value: "#95c8c0", label: "Vert d'eau" },
];

export function sumAmounts(reservations) {
  return reservations.reduce((sum, reservation) => sum + Number(reservation.amount || 0), 0);
}

export function countBy(items, getKey) {
  return items.reduce((accumulator, item) => {
    const key = getKey(item);
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

export function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

export function formatCurrency(state, amount) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: state.settings?.currency || "EUR",
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatDate(dateString) {
  return parseIsoDate(dateString).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(dateString) {
  if (!dateString) {
    return "-";
  }

  return new Date(dateString).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateToIso(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function parseIsoDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

let toastTimeoutId = null;

export function showToast(elements, message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.style.background = isError ? "rgba(138, 78, 67, 0.96)" : "rgba(59, 51, 41, 0.95)";
  elements.toast.classList.add("visible");
  window.clearTimeout(toastTimeoutId);
  toastTimeoutId = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3200);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function isDateInStay(dateValue, arrivalDate, departureDate) {
  const date = typeof dateValue === "string" ? parseIsoDate(dateValue) : stripTime(dateValue);
  const arrival = parseIsoDate(arrivalDate);
  const departure = parseIsoDate(departureDate);
  return date >= arrival && date < departure;
}

export function calculateNights(arrivalDate, departureDate) {
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.round((parseIsoDate(departureDate) - parseIsoDate(arrivalDate)) / oneDay);
}

export function getRoom(state, roomId) {
  return state.settings.rooms.find((room) => room.id === roomId) || null;
}

export function getRoomName(state, roomId) {
  return getRoom(state, roomId)?.name || "Chambre inconnue";
}

export function getRoomColor(state, roomId) {
  return getRoom(state, roomId)?.color || "#98c7a3";
}

export function getRoomStyle(state, roomId) {
  return `style="--room-color: ${escapeHtml(getRoomColor(state, roomId))}"`;
}

export function getEntryType(entry) {
  return entry.bookingType || "reservation";
}

export function getEntryTypeLabel(entry) {
  return getEntryType(entry) === "block" ? "Blocage" : "Réservation";
}

export function getDisplayPlatform(entry) {
  return getEntryType(entry) === "block" ? "Indisponible" : entry.platform;
}

export function getStatusLabel(status) {
  return {
    pending: "En attente",
    confirmed: "Confirmée",
    paid: "Payée",
    cancelled: "Annulée",
    blocked: "Bloquée",
  }[status] || "Confirmée";
}

export function getReservationsByType(state, type) {
  return state.reservations.filter((reservation) => getEntryType(reservation) === type);
}

export function getCalendarLabel(entry) {
  if (getEntryType(entry) === "block") {
    return "Blocage";
  }
  return entry.clientName || entry.bookingName;
}

export function matchesQuickFilter(filter, reservation, today = new Date()) {
  const arrival = parseIsoDate(reservation.arrivalDate);
  const departure = parseIsoDate(reservation.departureDate);
  const type = getEntryType(reservation);
  const currentMonthKey = `${today.getFullYear()}-${today.getMonth()}`;

  if (filter === "all") {
    return true;
  }
  if (filter === "blocks") {
    return type === "block";
  }
  if (type !== "reservation") {
    return false;
  }
  if (filter === "today") {
    return isDateInStay(today, reservation.arrivalDate, reservation.departureDate);
  }
  if (filter === "upcoming") {
    return arrival >= stripTime(today);
  }
  if (filter === "month") {
    return `${arrival.getFullYear()}-${arrival.getMonth()}` === currentMonthKey;
  }
  if (filter === "pending") {
    return reservation.status === "pending";
  }
  if (filter === "to-pay") {
    return reservation.status === "confirmed";
  }
  if (filter === "paid") {
    return reservation.status === "paid";
  }
  return true;
}

export function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

export function getDefaultRoomColor(index) {
  const palette = PASTEL_ROOM_COLORS.map((color) => color.value);
  return palette[index % palette.length];
}

export function getRoomColorOptions(selectedColor) {
  return PASTEL_ROOM_COLORS.map(
    (color) =>
      `<option value="${color.value}" ${color.value === selectedColor ? "selected" : ""}>${escapeHtml(color.label)}</option>`,
  ).join("");
}
