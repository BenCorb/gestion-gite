import { calculateNights, escapeHtml, formatCurrency, showToast } from "./js/utils.js";

const state = {
  site: null,
  rooms: [],
  availability: null,
  roomPhotoIndexes: {},
  gitePhotoIndex: 0,
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
  giteSection: document.getElementById("public-gite-section"),
  giteTitle: document.getElementById("public-gite-title"),
  giteDescription: document.getElementById("public-gite-description"),
  giteCarousel: document.getElementById("public-gite-carousel"),
  gallerySection: document.getElementById("public-gallery-section"),
  gallery: document.getElementById("public-gallery"),
  contact: document.getElementById("public-contact"),
  modal: document.getElementById("request-modal"),
  requestForm: document.getElementById("booking-request-form"),
  requestRoomId: document.getElementById("request-room-id"),
  requestRoomLabel: document.getElementById("request-room-label"),
  requestArrivalDate: document.getElementById("request-arrival-date"),
  requestDepartureDate: document.getElementById("request-departure-date"),
  closeModal: document.getElementById("close-request-modal"),
  guestName: document.getElementById("request-guest-name"),
  guestContact: document.getElementById("request-guest-contact"),
  guestCount: document.getElementById("request-guest-count"),
  requestMessage: document.getElementById("request-message"),
  amenitiesModal: document.getElementById("amenities-modal"),
  amenitiesTitle: document.getElementById("amenities-title"),
  amenitiesRoomLabel: document.getElementById("amenities-room-label"),
  amenitiesContent: document.getElementById("amenities-content"),
  closeAmenitiesModal: document.getElementById("close-amenities-modal"),
  toast: document.getElementById("toast"),
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadPublicSite();
  elements.availabilityForm.addEventListener("submit", searchAvailability);
  elements.requestForm.addEventListener("submit", submitBookingRequest);
  elements.closeModal.addEventListener("click", closeModal);
  elements.closeAmenitiesModal.addEventListener("click", closeAmenitiesModal);
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
  renderGiteSection(site);
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
      const photos = room.photos?.length ? room.photos : (state.site.site?.heroImageUrl ? [{ url: state.site.site.heroImageUrl, alt: room.name }] : []);
      const selectedPhotoIndex = Math.min(state.roomPhotoIndexes[room.id] || 0, Math.max(photos.length - 1, 0));
      const image = photos[selectedPhotoIndex]?.url || "";
      return `
        <article class="public-room-card">
          ${
            image
              ? `<div class="room-carousel">
                  <img src="${escapeHtml(image)}" alt="${escapeHtml(photos[selectedPhotoIndex]?.alt || room.name)}" />
                  ${
                    photos.length > 1
                      ? `<button class="icon-button carousel-button prev" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="-1">‹</button>
                         <button class="icon-button carousel-button next" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="1">›</button>
                         <span class="carousel-count">${selectedPhotoIndex + 1}/${photos.length}</span>`
                      : ""
                  }
                </div>`
              : ""
          }
          <div>
            <h3>${escapeHtml(room.name)}</h3>
            <p>${escapeHtml(room.summary || room.description || "Chambre confortable du gîte.")}</p>
            <div class="reservation-meta">
              <span>${room.capacity} voyageur(s)</span>
            ${room.price ? `<span>${escapeHtml(room.price)}</span>` : ""}
            </div>
            <div class="public-room-actions">
              ${getAmenityGroups(room).length ? `<button class="secondary-button" type="button" data-amenities-room="${escapeHtml(room.id)}">Voir les équipements</button>` : ""}
              <button class="primary-button" type="button" data-request-room="${escapeHtml(room.id)}">Demander cette chambre</button>
              ${(room.bookingLinks || [])
                .map(
                  (link) =>
                    `<a class="secondary-button" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || "Réserver")}</a>`,
                )
                .join("")}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  elements.rooms.querySelectorAll("[data-request-room]").forEach((button) => {
    button.addEventListener("click", () => openRequestModal(button.dataset.requestRoom));
  });
  elements.rooms.querySelectorAll("[data-carousel-room]").forEach((button) => {
    button.addEventListener("click", () => changeRoomPhoto(button.dataset.carouselRoom, Number(button.dataset.carouselDirection)));
  });
  elements.rooms.querySelectorAll("[data-amenities-room]").forEach((button) => {
    button.addEventListener("click", () => openAmenitiesModal(button.dataset.amenitiesRoom));
  });
}

function renderGallery(gallery) {
  elements.gallerySection.classList.toggle("is-hidden", !gallery.length);
  elements.gallery.innerHTML = gallery
    .map((photo) => `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || state.site.propertyName)}" />`)
    .join("");
}

function renderGiteSection(site) {
  const photos = site.gitePhotos || [];
  const hasContent = Boolean((site.giteDescription || "").trim()) || photos.length > 0;
  elements.giteSection.classList.toggle("is-hidden", !hasContent);
  if (!hasContent) {
    return;
  }
  elements.giteTitle.textContent = site.giteTitle || "Le gîte";
  elements.giteDescription.textContent = site.giteDescription || "";
  elements.giteCarousel.innerHTML = renderPhotoCarousel(
    photos,
    state.gitePhotoIndex,
    "gite",
    site.giteTitle || "Le gîte",
  );
  elements.giteCarousel.querySelectorAll("[data-gite-carousel-direction]").forEach((button) => {
    button.addEventListener("click", () => changeGitePhoto(Number(button.dataset.giteCarouselDirection)));
  });
}

function renderPhotoCarousel(photos, selectedIndex, name, fallbackAlt) {
  if (!photos.length) {
    return "";
  }
  const safeIndex = Math.min(selectedIndex, Math.max(photos.length - 1, 0));
  const image = photos[safeIndex];
  return `
    <div class="room-carousel">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || fallbackAlt)}" />
      ${
        photos.length > 1
          ? `<button class="icon-button carousel-button prev" type="button" data-${name}-carousel-direction="-1">‹</button>
             <button class="icon-button carousel-button next" type="button" data-${name}-carousel-direction="1">›</button>
             <span class="carousel-count">${safeIndex + 1}/${photos.length}</span>`
          : ""
      }
    </div>
  `;
}

function renderContact(site) {
  const details = [
    site.address ? `<p>${escapeHtml(site.address)}</p>` : "",
    site.phone ? `<p>${escapeHtml(site.phone)}</p>` : "",
    site.email ? `<p><a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></p>` : "",
  ].filter(Boolean);
  const map = site.address
    ? `<div class="map-embed"><iframe title="Carte ${escapeHtml(state.site.propertyName)}" loading="lazy" src="https://www.google.com/maps?q=${encodeURIComponent(site.address)}&output=embed"></iframe></div>`
    : "";
  elements.contact.innerHTML = `${details.length ? details.join("") : "<p>Contactez-nous via une demande de réservation.</p>"}${map}`;
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
  elements.requestArrivalDate.value = elements.arrival.value || state.availability?.arrivalDate || "";
  elements.requestDepartureDate.value = elements.departure.value || state.availability?.departureDate || "";
  elements.modal.classList.remove("is-hidden");
}

function closeModal() {
  elements.modal.classList.add("is-hidden");
}

function changeRoomPhoto(roomId, direction) {
  const room = [...state.rooms, ...(state.availability?.rooms || [])].find((item) => item.id === roomId);
  const photos = room?.photos || [];
  if (photos.length < 2) {
    return;
  }
  const currentIndex = state.roomPhotoIndexes[roomId] || 0;
  state.roomPhotoIndexes[roomId] = (currentIndex + direction + photos.length) % photos.length;
  renderRooms(state.availability?.rooms || state.rooms);
}

function changeGitePhoto(direction) {
  const photos = state.site?.site?.gitePhotos || [];
  if (photos.length < 2) {
    return;
  }
  state.gitePhotoIndex = (state.gitePhotoIndex + direction + photos.length) % photos.length;
  renderGiteSection(state.site.site || {});
}

function getAmenityGroups(room) {
  if (room.amenityGroups?.length) {
    return room.amenityGroups;
  }
  if (room.amenities?.length) {
    return [{ name: "Équipements", items: room.amenities }];
  }
  return [];
}

function openAmenitiesModal(roomId) {
  const room = [...state.rooms, ...(state.availability?.rooms || [])].find((item) => item.id === roomId);
  if (!room) {
    return;
  }
  elements.amenitiesTitle.textContent = "Équipements";
  elements.amenitiesRoomLabel.textContent = room.name;
  elements.amenitiesContent.innerHTML = getAmenityGroups(room)
    .map(
      (group) => `
        <section>
          <h3>${escapeHtml(group.name)}</h3>
          <ul>${(group.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
      `,
    )
    .join("");
  elements.amenitiesModal.classList.remove("is-hidden");
}

function closeAmenitiesModal() {
  elements.amenitiesModal.classList.add("is-hidden");
}

async function submitBookingRequest(event) {
  event.preventDefault();
  const payload = {
    roomId: elements.requestRoomId.value,
    arrivalDate: elements.requestArrivalDate.value,
    departureDate: elements.requestDepartureDate.value,
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
