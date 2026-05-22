import { calculateNights, escapeHtml, formatCurrency, showToast } from "./js/utils.js";

const state = {
  site: null,
  rooms: [],
  availability: null,
};

const elements = {
  hero: document.getElementById("public-hero"),
  logo: document.getElementById("public-logo"),
  propertyName: document.getElementById("public-property-name"),
  headline: document.getElementById("public-headline"),
  subtitle: document.getElementById("public-subtitle"),
  intro: document.getElementById("public-intro"),
  availabilityForm: document.getElementById("availability-form"),
  arrival: document.getElementById("availability-arrival"),
  departure: document.getElementById("availability-departure"),
  availabilityStatus: document.getElementById("availability-status"),
  rooms: document.getElementById("public-rooms"),
  gallerySection: document.getElementById("public-gallery-section"),
  gallery: document.getElementById("public-gallery"),
  contact: document.getElementById("public-contact"),
  modal: document.getElementById("request-modal"),
  requestForm: document.getElementById("booking-request-form"),
  requestRoomId: document.getElementById("request-room-id"),
  requestRoomLabel: document.getElementById("request-room-label"),
  closeModal: document.getElementById("close-request-modal"),
  guestName: document.getElementById("request-guest-name"),
  guestContact: document.getElementById("request-guest-contact"),
  guestCount: document.getElementById("request-guest-count"),
  requestMessage: document.getElementById("request-message"),
  toast: document.getElementById("toast"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadPublicSite();
  elements.availabilityForm.addEventListener("submit", searchAvailability);
  elements.requestForm.addEventListener("submit", submitBookingRequest);
  elements.closeModal.addEventListener("click", closeModal);
});

async function loadPublicSite() {
  const response = await fetch("/api/public-site");
  const data = await response.json();
  if (!response.ok) {
    showToast(elements, data.error || "Impossible de charger la vitrine.", true);
    return;
  }
  state.site = data;
  state.rooms = data.rooms || [];
  renderPublicSite();
}

function renderPublicSite() {
  const site = state.site.site || {};
  document.title = state.site.propertyName;
  elements.propertyName.textContent = state.site.propertyName;
  elements.headline.textContent = site.headline || state.site.propertyName;
  elements.subtitle.textContent = site.subtitle || "";
  elements.intro.textContent = site.intro || state.site.description || "";
  elements.logo.classList.toggle("is-hidden", !site.logoUrl);
  if (site.logoUrl) {
    elements.logo.src = site.logoUrl;
    elements.logo.alt = `Logo ${state.site.propertyName}`;
  }
  if (site.heroImageUrl) {
    elements.hero.style.backgroundImage = `linear-gradient(90deg, rgba(33, 27, 20, 0.62), rgba(33, 27, 20, 0.22)), url("${site.heroImageUrl}")`;
  }
  renderRooms(state.rooms);
  renderGallery(site.gallery || []);
  renderContact(site);
}

function renderRooms(rooms) {
  if (!rooms.length) {
    elements.rooms.innerHTML = `<div class="empty-state"><h3>Aucune chambre disponible</h3><p>Revenez bientôt pour découvrir nos hébergements.</p></div>`;
    return;
  }
  elements.rooms.innerHTML = rooms
    .map((room) => {
      const image = room.photos?.[0]?.url || state.site.site?.heroImageUrl || "";
      return `
        <article class="public-room-card">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(room.photos?.[0]?.alt || room.name)}" />` : ""}
          <div>
            <h3>${escapeHtml(room.name)}</h3>
            <p>${escapeHtml(room.summary || room.description || "Chambre confortable du gîte.")}</p>
            <div class="reservation-meta">
              <span>${room.capacity} voyageur(s)</span>
              ${room.price ? `<span>${escapeHtml(room.price)}</span>` : ""}
            </div>
            ${room.amenities?.length ? `<p class="amenities">${room.amenities.map(escapeHtml).join(" · ")}</p>` : ""}
            <button class="primary-button" type="button" data-request-room="${escapeHtml(room.id)}">Demander cette chambre</button>
          </div>
        </article>
      `;
    })
    .join("");
  elements.rooms.querySelectorAll("[data-request-room]").forEach((button) => {
    button.addEventListener("click", () => openRequestModal(button.dataset.requestRoom));
  });
}

function renderGallery(gallery) {
  elements.gallerySection.classList.toggle("is-hidden", !gallery.length);
  elements.gallery.innerHTML = gallery
    .map((photo) => `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || state.site.propertyName)}" />`)
    .join("");
}

function renderContact(site) {
  const details = [
    site.address ? `<p>${escapeHtml(site.address)}</p>` : "",
    site.phone ? `<p>${escapeHtml(site.phone)}</p>` : "",
    site.email ? `<p><a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></p>` : "",
  ].filter(Boolean);
  elements.contact.innerHTML = details.length ? details.join("") : "<p>Contactez-nous via une demande de réservation.</p>";
}

async function searchAvailability(event) {
  event.preventDefault();
  const params = new URLSearchParams({
    arrivalDate: elements.arrival.value,
    departureDate: elements.departure.value,
  });
  const response = await fetch(`/api/availability?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) {
    showToast(elements, data.error || "Recherche impossible.", true);
    return;
  }
  state.availability = data;
  const nights = calculateNights(data.arrivalDate, data.departureDate);
  elements.availabilityStatus.textContent = `${data.rooms.length} chambre(s) libre(s), ${nights} nuit(s)`;
  renderRooms(data.rooms);
}

function openRequestModal(roomId) {
  const room = [...state.rooms, ...(state.availability?.rooms || [])].find((item) => item.id === roomId);
  elements.requestRoomId.value = roomId;
  elements.requestRoomLabel.textContent = room ? room.name : "Chambre sélectionnée";
  elements.modal.classList.remove("is-hidden");
}

function closeModal() {
  elements.modal.classList.add("is-hidden");
}

async function submitBookingRequest(event) {
  event.preventDefault();
  const payload = {
    roomId: elements.requestRoomId.value,
    arrivalDate: elements.arrival.value,
    departureDate: elements.departure.value,
    guestName: elements.guestName.value.trim(),
    guestContact: elements.guestContact.value.trim(),
    guestCount: Number(elements.guestCount.value),
    message: elements.requestMessage.value.trim(),
  };
  if (!payload.arrivalDate || !payload.departureDate) {
    showToast(elements, "Choisissez vos dates avant d'envoyer une demande.", true);
    return;
  }
  const response = await fetch("/api/booking-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    showToast(elements, data.error || "Demande impossible.", true);
    return;
  }
  elements.requestForm.reset();
  elements.guestCount.value = "2";
  closeModal();
  showToast(elements, "Demande envoyée. Nous vous répondrons rapidement.");
}
