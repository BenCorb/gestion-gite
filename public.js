import { calculateNights, escapeHtml, formatCurrency, showToast } from "./js/utils.js";

const CHEVRON_LEFT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8L10 13"/></svg>`;
const CHEVRON_RIGHT = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3L11 8L6 13"/></svg>`;

const BODY_FONTS = {
  lato:          { stack: '"Lato",sans-serif',           googleFonts: 'Lato:wght@400;700' },
  raleway:       { stack: '"Raleway",sans-serif',        googleFonts: 'Raleway:wght@400;700' },
  opensans:      { stack: '"Open Sans",sans-serif',      googleFonts: 'Open+Sans:wght@400;700' },
  nunito:        { stack: '"Nunito",sans-serif',         googleFonts: 'Nunito:wght@400;700' },
  librefranklin: { stack: '"Libre Franklin",sans-serif', googleFonts: 'Libre+Franklin:wght@400;700' },
};

const HEADING_FONTS = {
  playfair:      { stack: '"Playfair Display",serif',   googleFonts: 'Playfair+Display:wght@700' },
  cormorant:     { stack: '"Cormorant Garamond",serif', googleFonts: 'Cormorant+Garamond:wght@600;700' },
  montserrat:    { stack: '"Montserrat",sans-serif',    googleFonts: 'Montserrat:wght@700' },
  baskerville:   { stack: '"Libre Baskerville",serif',  googleFonts: 'Libre+Baskerville:wght@700' },
  satisfy:       { stack: '"Satisfy",cursive',          googleFonts: 'Satisfy' },
  patrickhand:   { stack: '"Patrick Hand SC",cursive',  googleFonts: 'Patrick+Hand+SC' },
  librefranklin: { stack: '"Libre Franklin",sans-serif', googleFonts: 'Libre+Franklin:wght@700' },
};

const CLOSE_ICON = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="4" x2="14" y2="14"/><line x1="14" y1="4" x2="4" y2="14"/></svg>`;

const state = {
  site: null,
  rooms: [],
  availability: null,
  roomPhotoIndexes: {},
  gitePhotoIndex: 0,
  lightboxPhotos: [],
  lightboxIndex: 0,
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
  const lb = document.createElement("div");
  lb.id = "lightbox";
  lb.className = "lightbox-backdrop is-hidden";
  lb.setAttribute("role", "dialog");
  lb.setAttribute("aria-modal", "true");
  lb.innerHTML = `
    <button class="lightbox-close" id="lightbox-close" aria-label="Fermer">${CLOSE_ICON}</button>
    <button class="lightbox-nav lightbox-prev" id="lightbox-prev" aria-label="Photo précédente">${CHEVRON_LEFT}</button>
    <img id="lightbox-img" src="" alt="" />
    <button class="lightbox-nav lightbox-next" id="lightbox-next" aria-label="Photo suivante">${CHEVRON_RIGHT}</button>
    <span class="lightbox-count" id="lightbox-count"></span>
  `;
  document.body.appendChild(lb);
  elements.lightbox = lb;
  elements.lightboxImg = document.getElementById("lightbox-img");
  elements.lightboxCount = document.getElementById("lightbox-count");
  elements.lightboxClose = document.getElementById("lightbox-close");
  elements.lightboxPrev = document.getElementById("lightbox-prev");
  elements.lightboxNext = document.getElementById("lightbox-next");

  elements.lightboxClose.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });
  elements.lightboxPrev.addEventListener("click", (e) => { e.stopPropagation(); changeLightboxPhoto(-1); });
  elements.lightboxNext.addEventListener("click", (e) => { e.stopPropagation(); changeLightboxPhoto(1); });
  elements.lightbox.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (elements.lightbox.classList.contains("is-hidden")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") changeLightboxPhoto(-1);
    if (e.key === "ArrowRight") changeLightboxPhoto(1);
  });

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
  applyFontPair(site.bodyFont, site.headingFont);
}

function applyFontPair(bodyKey, headingKey) {
  const body = BODY_FONTS[bodyKey] || BODY_FONTS.lato;
  const heading = HEADING_FONTS[headingKey] || HEADING_FONTS.playfair;
  const families = [body.googleFonts];
  if (heading.googleFonts !== body.googleFonts) families.push(heading.googleFonts);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${families.join("&family=")}&display=swap`;
  document.head.appendChild(link);
  const style = document.createElement("style");
  style.textContent = `body{font-family:${body.stack}}h1,h2,h3,#public-property-name{font-family:${heading.stack}}`;
  document.head.appendChild(style);
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
              ? `<div class="room-carousel" data-room-id="${escapeHtml(room.id)}">
                  <img src="${escapeHtml(image)}" alt="${escapeHtml(photos[selectedPhotoIndex]?.alt || room.name)}" loading="lazy" />
                  ${
                    photos.length > 1
                      ? `<button class="icon-button carousel-button prev" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="-1" aria-label="Photo précédente">${CHEVRON_LEFT}</button>
                         <button class="icon-button carousel-button next" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="1" aria-label="Photo suivante">${CHEVRON_RIGHT}</button>
                         <span class="carousel-count">${selectedPhotoIndex + 1}/${photos.length}</span>`
                      : ""
                  }
                  <div class="room-image-overlay"><h3>${escapeHtml(room.name)}</h3></div>
                </div>`
              : ""
          }
          <div class="room-card-body">
            ${!image ? `<h3>${escapeHtml(room.name)}</h3>` : ""}
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
  elements.rooms.querySelectorAll(".room-carousel img").forEach((img) => {
    img.addEventListener("click", () => {
      const roomId = img.closest(".room-carousel")?.dataset.roomId;
      if (!roomId) return;
      const room = [...state.rooms, ...(state.availability?.rooms || [])].find((r) => r.id === roomId);
      const photos = room?.photos?.length
        ? room.photos
        : state.site.site?.heroImageUrl ? [{ url: state.site.site.heroImageUrl, alt: room?.name || "" }] : [];
      if (photos.length) openLightbox(photos, state.roomPhotoIndexes[roomId] || 0);
    });
  });
}

function renderGallery(gallery) {
  elements.gallerySection.classList.toggle("is-hidden", !gallery.length);
  elements.gallery.innerHTML = gallery
    .map((photo) => `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || state.site.propertyName)}" loading="lazy" />`)
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
  const giteImg = elements.giteCarousel.querySelector("img");
  if (giteImg) {
    giteImg.addEventListener("click", () => {
      const photos = state.site?.site?.gitePhotos || [];
      if (photos.length) openLightbox(photos, state.gitePhotoIndex);
    });
  }
}

function renderPhotoCarousel(photos, selectedIndex, name, fallbackAlt) {
  if (!photos.length) {
    return "";
  }
  const safeIndex = Math.min(selectedIndex, Math.max(photos.length - 1, 0));
  const image = photos[safeIndex];
  return `
    <div class="room-carousel">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || fallbackAlt)}" loading="lazy" />
      ${
        photos.length > 1
          ? `<button class="icon-button carousel-button prev" type="button" data-${name}-carousel-direction="-1" aria-label="Photo précédente">${CHEVRON_LEFT}</button>
             <button class="icon-button carousel-button next" type="button" data-${name}-carousel-direction="1" aria-label="Photo suivante">${CHEVRON_RIGHT}</button>
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
    ? `<div class="map-embed"><iframe title="Carte ${escapeHtml(state.site.propertyName)}" loading="lazy" src="https://www.google.com/maps?q=${encodeURIComponent(site.address)}&z=10&output=embed"></iframe></div>`
    : "";
  const detailsHtml = details.length ? details.join("") : "<p>Contactez-nous via une demande de réservation.</p>";
  elements.contact.innerHTML = map
    ? `<div class="contact-layout"><div class="contact-details">${detailsHtml}</div>${map}</div>`
    : `<div class="contact-details">${detailsHtml}</div>`;
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

function lockScroll() {
  document.documentElement.classList.add("modal-open");
  document.body.classList.add("modal-open");
}

function unlockScroll() {
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
}

function openRequestModal(roomId) {
  const room = [...state.rooms, ...(state.availability?.rooms || [])].find((item) => item.id === roomId);
  elements.requestRoomId.value = roomId;
  elements.requestRoomLabel.textContent = room ? room.name : "Chambre sélectionnée";
  elements.requestArrivalDate.value = elements.arrival.value || state.availability?.arrivalDate || "";
  elements.requestDepartureDate.value = elements.departure.value || state.availability?.departureDate || "";
  elements.modal.classList.remove("is-hidden");
  lockScroll();
}

function closeModal() {
  elements.modal.classList.add("is-hidden");
  unlockScroll();
}

function changeRoomPhoto(roomId, direction) {
  const room = [...state.rooms, ...(state.availability?.rooms || [])].find((item) => item.id === roomId);
  const photos = room?.photos || [];
  if (photos.length < 2) return;

  const currentIndex = state.roomPhotoIndexes[roomId] || 0;
  const newIndex = (currentIndex + direction + photos.length) % photos.length;
  state.roomPhotoIndexes[roomId] = newIndex;

  const button = elements.rooms.querySelector(`[data-carousel-room="${CSS.escape(roomId)}"]`);
  if (!button) return;
  const carousel = button.closest(".room-carousel");
  if (!carousel) return;
  const img = carousel.querySelector("img");
  if (img) {
    img.src = photos[newIndex].url;
    img.alt = photos[newIndex].alt || room.name;
  }
  const counter = carousel.querySelector(".carousel-count");
  if (counter) counter.textContent = `${newIndex + 1}/${photos.length}`;
}

function changeGitePhoto(direction) {
  const photos = state.site?.site?.gitePhotos || [];
  if (photos.length < 2) return;

  state.gitePhotoIndex = (state.gitePhotoIndex + direction + photos.length) % photos.length;
  const newIndex = state.gitePhotoIndex;

  const img = elements.giteCarousel.querySelector("img");
  if (img) {
    img.src = photos[newIndex].url;
    img.alt = photos[newIndex].alt || (state.site?.site?.giteTitle || "Le gîte");
  }
  const counter = elements.giteCarousel.querySelector(".carousel-count");
  if (counter) counter.textContent = `${newIndex + 1}/${photos.length}`;
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
  lockScroll();
}

function closeAmenitiesModal() {
  elements.amenitiesModal.classList.add("is-hidden");
  unlockScroll();
}

function openLightbox(photos, index) {
  state.lightboxPhotos = photos;
  state.lightboxIndex = index;
  updateLightboxImage();
  elements.lightbox.classList.remove("is-hidden");
  lockScroll();
}

function closeLightbox() {
  elements.lightbox.classList.add("is-hidden");
  unlockScroll();
}

function changeLightboxPhoto(direction) {
  const { lightboxPhotos: photos } = state;
  if (photos.length < 2) return;
  state.lightboxIndex = (state.lightboxIndex + direction + photos.length) % photos.length;
  updateLightboxImage();
}

function updateLightboxImage() {
  const photo = state.lightboxPhotos[state.lightboxIndex];
  elements.lightboxImg.src = photo.url;
  elements.lightboxImg.alt = photo.alt || "";
  const total = state.lightboxPhotos.length;
  elements.lightboxCount.textContent = total > 1 ? `${state.lightboxIndex + 1} / ${total}` : "";
  elements.lightboxPrev.classList.toggle("is-hidden", total < 2);
  elements.lightboxNext.classList.toggle("is-hidden", total < 2);
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
