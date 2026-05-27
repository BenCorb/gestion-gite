import { calculateNights, escapeHtml, formatCurrency, showToast } from "./js/utils.js";
import { icon } from "./js/icons.js";

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
};

const HERO_FALLBACK_GRADIENTS = [
  "linear-gradient(135deg, #b8a87a 0%, #94864f 100%)",
  "linear-gradient(135deg, #d7c8a8 0%, #b9a47d 100%)",
  "linear-gradient(135deg, #d4b59a 0%, #a87a52 100%)",
  "linear-gradient(135deg, #e6cfa3 0%, #b6986f 100%)",
  "linear-gradient(135deg, #c9a880 0%, #8c6a48 100%)",
];

const state = {
  site: null,
  rooms: [],
  availability: null,
  roomPhotoIndexes: {},
  gitePhotoIndex: 0,
  lightboxPhotos: [],
  lightboxIndex: 0,
  filterState: "before",
  pendingRequest: null,
};

const elements = {
  hero: document.getElementById("public-hero"),
  heroImage: document.getElementById("public-hero-image"),
  heroEyebrow: document.getElementById("public-hero-eyebrow"),
  logo: document.getElementById("public-logo"),
  propertyName: document.getElementById("public-property-name"),
  headline: document.getElementById("public-headline"),
  subtitle: document.getElementById("public-subtitle"),
  intro: document.getElementById("public-intro"),
  roomsTitle: document.getElementById("public-rooms-title"),
  availabilityForm: document.getElementById("availability-form"),
  arrival: document.getElementById("availability-arrival"),
  arrivalDisplay: document.getElementById("availability-arrival-display"),
  departure: document.getElementById("availability-departure"),
  departureDisplay: document.getElementById("availability-departure-display"),
  availabilityStatus: document.getElementById("availability-status"),
  topnav: document.getElementById("public-topnav"),
  topnavBrand: document.getElementById("public-topnav-brand"),
  footerBrand: document.getElementById("public-footer-brand"),
  footerYear: document.getElementById("public-footer-year"),
  rooms: document.getElementById("public-rooms"),
  giteSection: document.getElementById("public-gite-section"),
  giteTitle: document.getElementById("public-gite-title"),
  giteDescription: document.getElementById("public-gite-description"),
  giteCarousel: document.getElementById("public-gite-carousel"),
  contact: document.getElementById("public-contact"),
  modal: document.getElementById("request-modal"),
  requestForm: document.getElementById("booking-request-form"),
  requestRoomId: document.getElementById("request-room-id"),
  requestRoomLabel: document.getElementById("request-room-label"),
  requestSummary: document.getElementById("request-summary"),
  requestArrivalDate: document.getElementById("request-arrival-date"),
  requestDepartureDate: document.getElementById("request-departure-date"),
  closeModal: document.getElementById("close-request-modal"),
  guestName: document.getElementById("request-guest-name"),
  guestContact: document.getElementById("request-guest-contact"),
  guestCount: document.getElementById("request-guest-count"),
  guestCountDisplay: document.getElementById("request-guest-count-display"),
  capacityHint: document.getElementById("request-capacity-hint"),
  stepper: document.getElementById("request-stepper"),
  requestMessage: document.getElementById("request-message"),
  nightsMeta: document.getElementById("request-nights-meta"),
  totalAmount: document.getElementById("request-total-amount"),
  confirmation: document.getElementById("request-confirmation"),
  confirmationMeta: document.getElementById("confirmation-meta"),
  confirmationRoomPhoto: document.getElementById("confirmation-room-photo"),
  confirmationRoomName: document.getElementById("confirmation-room-name"),
  confirmationGuestCount: document.getElementById("confirmation-guest-count"),
  confirmationArrival: document.getElementById("confirmation-arrival"),
  confirmationDeparture: document.getElementById("confirmation-departure"),
  confirmationTotal: document.getElementById("confirmation-total"),
  confirmationBack: document.getElementById("confirmation-back"),
  amenitiesModal: document.getElementById("amenities-modal"),
  amenitiesTitle: document.getElementById("amenities-title"),
  amenitiesRoomLabel: document.getElementById("amenities-room-label"),
  amenitiesContent: document.getElementById("amenities-content"),
  closeAmenitiesModal: document.getElementById("close-amenities-modal"),
  toast: document.getElementById("toast"),
};

document.addEventListener("DOMContentLoaded", async () => {
  buildLightbox();
  await loadPublicSite();
  bindEvents();
});

function bindEvents() {
  elements.availabilityForm.addEventListener("submit", handleAvailabilitySubmit);
  elements.arrival.addEventListener("change", handleDateChange);
  elements.departure.addEventListener("change", handleDateChange);
  elements.requestForm.addEventListener("submit", submitBookingRequest);
  elements.closeModal.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeModal();
  });
  elements.closeAmenitiesModal.addEventListener("click", closeAmenitiesModal);
  elements.amenitiesModal.addEventListener("click", (event) => {
    if (event.target === elements.amenitiesModal) closeAmenitiesModal();
  });
  // Topnav scroll listener kept to add subtle elevation shadow once scrolled
  if (elements.topnav) {
    const onScroll = () => {
      elements.topnav.classList.toggle("is-scrolled", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  elements.confirmationBack.addEventListener("click", hideConfirmation);
  bindStepper();
  // Render footer year + initial date display
  if (elements.footerYear) elements.footerYear.textContent = String(new Date().getFullYear());
  syncAvailabilityDisplay();

  ["change", "input"].forEach((evt) => {
    elements.requestArrivalDate.addEventListener(evt, updateRequestTotals);
    elements.requestDepartureDate.addEventListener(evt, updateRequestTotals);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.modal.classList.contains("is-open")) {
      } else {
        closeModal();
      }
      if (elements.amenitiesModal.classList.contains("is-open")) closeAmenitiesModal();
    }
  });
}

function buildLightbox() {
  const lb = document.createElement("div");
  lb.id = "lightbox";
  lb.className = "lightbox-backdrop is-hidden";
  lb.setAttribute("role", "dialog");
  lb.setAttribute("aria-modal", "true");
  lb.innerHTML = `
    <button class="lightbox-close" id="lightbox-close" aria-label="Fermer">${icon("close", 20)}</button>
    <button class="lightbox-nav lightbox-prev" id="lightbox-prev" aria-label="Photo précédente">${icon("chevronLeft", 18)}</button>
    <img id="lightbox-img" src="" alt="" />
    <button class="lightbox-nav lightbox-next" id="lightbox-next" aria-label="Photo suivante">${icon("chevronRight", 18)}</button>
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
}

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
  if (elements.topnavBrand) elements.topnavBrand.textContent = state.site.propertyName;
  if (elements.footerBrand) elements.footerBrand.textContent = state.site.propertyName;
  elements.headline.textContent = site.headline || state.site.propertyName;
  elements.subtitle.textContent = site.subtitle || "";
  elements.intro.textContent = site.intro || state.site.description || "";
  if (site.subtitle) {
    elements.heroEyebrow.textContent = "Chambres d'hôtes";
  }
  elements.logo.classList.toggle("is-hidden", !site.logoUrl);
  if (site.logoUrl) {
    elements.logo.src = site.logoUrl;
    elements.logo.alt = `Logo ${state.site.propertyName}`;
  }
  if (site.heroImageUrl) {
    elements.heroImage.style.backgroundImage = `url("${site.heroImageUrl}")`;
  }
  renderRooms();
  renderGiteSection(site);
  renderContact(site);
  applyFontPair(site.bodyFont, site.headingFont);
}

function applyFontPair(bodyKey, headingKey) {
  const body = BODY_FONTS[bodyKey];
  const heading = HEADING_FONTS[headingKey];
  if (!body && !heading) return;

  const families = [];
  if (body) families.push(body.googleFonts);
  if (heading && heading.googleFonts !== body?.googleFonts) families.push(heading.googleFonts);
  if (families.length) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${families.join("&family=")}&display=swap`;
    document.head.appendChild(link);
  }
  if (body) document.documentElement.style.setProperty("--font-body", body.stack);
  if (heading) document.documentElement.style.setProperty("--font-heading", heading.stack);
}

function pickDefaultRoomId() {
  if (state.availability?.rooms?.length) return state.availability.rooms[0].id;
  return state.rooms[0]?.id || null;
}

function findRoom(roomId) {
  const all = [...(state.rooms || []), ...((state.availability && state.availability.rooms) || [])];
  return all.find((r) => r.id === roomId);
}

function roomStatus(roomId) {
  if (!state.availability) return null;
  const available = state.availability.rooms.some((r) => r.id === roomId);
  return available ? "avail" : "full";
}

function gradientForRoom(roomId) {
  let h = 0;
  for (const c of String(roomId)) h = (h * 31 + c.charCodeAt(0)) % HERO_FALLBACK_GRADIENTS.length;
  return HERO_FALLBACK_GRADIENTS[h];
}

function nightsForRequest() {
  const a = elements.requestArrivalDate.value;
  const d = elements.requestDepartureDate.value;
  if (!a || !d) return 0;
  return calculateNights(a, d);
}

function renderRooms() {
  const rooms = state.rooms || [];
  const grid = elements.rooms;

  if (!rooms.length) {
    grid.dataset.state = "empty";
    grid.innerHTML = `<div class="public-no-avail">
      <div class="public-no-avail-icon">${icon("home", 26)}</div>
      <h3 class="public-no-avail-title">Aucune chambre disponible</h3>
      <p class="public-no-avail-meta">Revenez bientôt pour découvrir nos hébergements.</p>
    </div>`;
    return;
  }

  if (state.filterState === "no-avail") {
    grid.dataset.state = "no-avail";
    grid.innerHTML = renderNoAvailState();
    return;
  }

  grid.dataset.state = state.filterState;
  grid.innerHTML = rooms.map((room) => renderRoomCard(room)).join("");
  wireRoomCardEvents();
}

function renderNoAvailState() {
  return `
    <div class="public-no-avail">
      <div class="public-no-avail-icon">${icon("calendar", 26)}</div>
      <h3 class="public-no-avail-title">Tout est complet sur ces dates</h3>
      <p class="public-no-avail-meta">Essayez d'autres dates ou contactez-nous directement.</p>
    </div>
  `;
}

function renderRoomCard(room) {
  const photos = room.photos?.length ? room.photos : [];
  const selectedIndex = Math.min(state.roomPhotoIndexes[room.id] || 0, Math.max(photos.length - 1, 0));
  const photo = photos[selectedIndex];
  const status = roomStatus(room.id);
  const showStatus = status !== null;
  const isAvail = status === "avail";
  const isUnavail = status === "full";

  const dots = photos.length > 1
    ? `<div class="public-room-card-dots">${photos.map((_, i) => `<span class="public-room-card-dot${i === selectedIndex ? " is-active" : ""}"></span>`).join("")}</div>`
    : "";

  const arrows = photos.length > 1
    ? `<button class="public-room-card-carousel-prev" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="-1" aria-label="Photo précédente">${icon("chevronLeft", 16)}</button>
       <button class="public-room-card-carousel-next" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="1" aria-label="Photo suivante">${icon("chevronRight", 16)}</button>`
    : "";

  const statusPill = showStatus
    ? `<div class="public-room-card-status"><span class="pill ${isAvail ? "pill-positive" : "pill-outline"} pill-md">${isAvail ? "Disponible" : "Complet"}</span></div>`
    : "";

  const amenities = (room.amenities || []).slice(0, 3)
    .map((a) => `<span class="pill pill-outline">${escapeHtml(a)}</span>`)
    .join("");
  const extra = (room.amenities || []).length > 3
    ? `<span class="pill pill-outline">+${(room.amenities || []).length - 3}</span>`
    : "";

  const ctaLabel = isUnavail ? "Voir d'autres dates" : (state.filterState === "before" ? "Demander cette chambre" : "Demander cette chambre");
  const ctaVariant = isUnavail ? "btn-secondary" : "btn-primary";
  const ctaAction = isUnavail ? "scroll-dates" : "request";

  const photoBg = photo?.url
    ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || room.name)}" loading="lazy" />`
    : "";

  const photoStyle = !photo?.url
    ? ` style="background:${gradientForRoom(room.id)}"`
    : "";

  const amenityButton = (room.amenityGroups?.length || (room.amenities || []).length > 3)
    ? `<button class="btn btn-secondary btn-md btn-full" type="button" data-amenities-room="${escapeHtml(room.id)}">Voir les équipements</button>`
    : "";

  const externalLinks = (room.bookingLinks || []).length
    ? `<div class="public-room-card-external">
        <div class="public-room-card-external-label">Aussi disponible sur</div>
        ${(room.bookingLinks || []).map((link) => `
          <a class="btn btn-secondary btn-md btn-full public-room-card-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || "Réserver")}</a>
        `).join("")}
      </div>`
    : "";

  return `
    <article class="public-room-card" data-room-id="${escapeHtml(room.id)}">
      <div class="public-room-card-photo"${photoStyle}>
        ${photoBg}
        ${statusPill}
        ${arrows}
        ${dots}
      </div>
      <div class="public-room-card-body">
        <div class="public-room-card-header">
          <div>
            <h3 class="public-room-card-name">${escapeHtml(room.name)}</h3>
            <p class="public-room-card-meta">${room.summary ? escapeHtml(room.summary) + " · " : ""}jusqu'à ${room.capacity || 2} pers</p>
          </div>
          ${room.price ? `<div class="public-room-card-price">
            <div class="public-room-card-price-amount">${escapeHtml(String(room.price))}${typeof room.price === "number" ? "€" : ""}</div>
            <div class="public-room-card-price-unit">la nuit</div>
          </div>` : ""}
        </div>
        ${amenities || extra ? `<div class="public-room-card-amenities">${amenities}${extra}</div>` : ""}
        <div class="public-room-card-actions">
          <button class="btn ${ctaVariant} btn-md btn-full" type="button" data-action="${ctaAction}" data-request-room="${escapeHtml(room.id)}">${ctaLabel}</button>
          ${amenityButton}
          ${externalLinks}
        </div>
      </div>
    </article>
  `;
}

function wireRoomCardEvents() {
  elements.rooms.querySelectorAll("[data-request-room]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.action === "scroll-dates") {
        elements.arrival.focus();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        openRequestModal(button.dataset.requestRoom);
      }
    });
  });
  elements.rooms.querySelectorAll("[data-carousel-room]").forEach((button) => {
    button.addEventListener("click", () => changeRoomPhoto(button.dataset.carouselRoom, Number(button.dataset.carouselDirection)));
  });
  elements.rooms.querySelectorAll("[data-amenities-room]").forEach((button) => {
    button.addEventListener("click", () => openAmenitiesModal(button.dataset.amenitiesRoom));
  });
  elements.rooms.querySelectorAll(".public-room-card-photo img").forEach((img) => {
    img.addEventListener("click", () => {
      const roomId = img.closest(".public-room-card")?.dataset.roomId;
      if (!roomId) return;
      const room = findRoom(roomId);
      const photos = room?.photos || [];
      if (photos.length) openLightbox(photos, state.roomPhotoIndexes[roomId] || 0);
    });
  });
}

function renderGiteSection(site) {
  const photos = site.gitePhotos || [];
  const hasContent = Boolean((site.giteDescription || "").trim()) || photos.length > 0;
  elements.giteSection.classList.toggle("is-hidden", !hasContent);
  if (!hasContent) return;

  elements.giteTitle.textContent = site.giteTitle || "Le gîte";
  elements.giteDescription.textContent = site.giteDescription || "";
  elements.giteCarousel.innerHTML = renderGiteCarousel(photos, site.giteTitle || "Le gîte");
  elements.giteCarousel.querySelectorAll("[data-gite-direction]").forEach((button) => {
    button.addEventListener("click", () => changeGitePhoto(Number(button.dataset.giteDirection)));
  });
  const giteImg = elements.giteCarousel.querySelector("img");
  if (giteImg) {
    giteImg.addEventListener("click", () => {
      if (photos.length) openLightbox(photos, state.gitePhotoIndex);
    });
  }
}

function renderGiteCarousel(photos, fallbackAlt) {
  if (!photos.length) return "";
  const safeIndex = Math.min(state.gitePhotoIndex, Math.max(photos.length - 1, 0));
  const image = photos[safeIndex];
  return `
    <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || fallbackAlt)}" loading="lazy" />
    ${photos.length > 1 ? `
      <button class="public-room-card-carousel-prev" type="button" data-gite-direction="-1" aria-label="Photo précédente">${icon("chevronLeft", 16)}</button>
      <button class="public-room-card-carousel-next" type="button" data-gite-direction="1" aria-label="Photo suivante">${icon("chevronRight", 16)}</button>
      <div class="public-room-card-dots">
        ${photos.map((_, i) => `<span class="public-room-card-dot${i === safeIndex ? " is-active" : ""}"></span>`).join("")}
      </div>
    ` : ""}
  `;
}

function renderContact(site) {
  const rows = [];
  if (site.address) rows.push(`<div class="public-contact-row">${icon("map", 18)}<span>${escapeHtml(site.address)}</span></div>`);
  if (site.phone) rows.push(`<div class="public-contact-row">${icon("phone", 18)}<a href="tel:${escapeHtml(site.phone.replace(/\s/g, ""))}">${escapeHtml(site.phone)}</a></div>`);
  if (site.email) rows.push(`<div class="public-contact-row">${icon("mail", 18)}<a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></div>`);
  const list = rows.length ? `<div class="public-contact-list">${rows.join("")}</div>` : `<p class="public-section-intro">Contactez-nous via une demande de réservation.</p>`;
  const map = site.address
    ? `<div class="public-contact-map">
        <iframe title="Carte ${escapeHtml(state.site.propertyName)}" loading="lazy" src="https://www.google.com/maps?q=${encodeURIComponent(site.address)}&z=10&output=embed"></iframe>
        <a class="public-contact-map-link" href="https://www.google.com/maps?q=${encodeURIComponent(site.address)}" target="_blank" rel="noopener noreferrer">
          <span>Ouvrir dans Google Maps</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>
        </a>
      </div>`
    : "";
  elements.contact.innerHTML = `${list}${map}`;
}

function handleDateChange() {
  if (elements.arrival.value && elements.departure.value) {
    if (new Date(elements.departure.value) <= new Date(elements.arrival.value)) {
      const next = new Date(elements.arrival.value);
      next.setDate(next.getDate() + 1);
      elements.departure.value = next.toISOString().slice(0, 10);
    }
  }
  syncAvailabilityDisplay();
}

function syncAvailabilityDisplay() {
  const updateCell = (input, display) => {
    if (!display) return;
    const cell = display.closest(".availability-cell");
    const v = input.value;
    if (!v) {
      if (cell) {
        cell.dataset.empty = "true";
        display.textContent = cell.dataset.placeholder || "Choisir une date";
      } else {
        display.textContent = "Choisir une date";
      }
    } else {
      if (cell) cell.dataset.empty = "false";
      display.textContent = formatHumanDate(v);
    }
  };
  if (elements.arrival && elements.arrivalDisplay) updateCell(elements.arrival, elements.arrivalDisplay);
  if (elements.departure && elements.departureDisplay) updateCell(elements.departure, elements.departureDisplay);
}

async function handleAvailabilitySubmit(event) {
  event.preventDefault();
  await fetchAvailability();
}

async function fetchAvailability() {
  if (!elements.arrival.value || !elements.departure.value) return;
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
  const availCount = data.rooms.length;
  const total = state.rooms.length;
  state.filterState = availCount === 0 ? "no-avail" : "with-dates";
  elements.availabilityStatus.hidden = false;
  elements.availabilityStatus.innerHTML = `<strong>${nights} nuit${nights > 1 ? "s" : ""}</strong> · ${availCount}/${total} chambre${total > 1 ? "s" : ""} disponible${availCount > 1 ? "s" : ""}`;
  renderRooms();
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
  const room = findRoom(roomId);
  if (!room) return;
  state.pendingRequest = { room };
  elements.requestRoomId.value = roomId;
  elements.requestRoomLabel.textContent = room.name;
  const max = Math.max(1, Number(room.capacity) || 2);
  elements.stepper.dataset.max = String(max);
  elements.capacityHint.textContent = `capacité max : ${max}`;
  setStepperValue(Math.min(2, max));
  elements.requestArrivalDate.value = elements.arrival.value || state.availability?.arrivalDate || "";
  elements.requestDepartureDate.value = elements.departure.value || state.availability?.departureDate || "";
  updateRequestTotals();
  elements.modal.classList.add("is-open");
  document.querySelector(".modal-sheet")?.classList.add("is-open");
  elements.modal.querySelectorAll(".modal-sheet").forEach((s) => s.classList.add("is-open"));
  lockScroll();
}

function closeModal() {
  elements.modal.classList.remove("is-open");
  elements.modal.querySelectorAll(".modal-sheet").forEach((s) => s.classList.remove("is-open"));
  unlockScroll();
}

function bindStepper() {
  elements.stepper.querySelectorAll(".stepper-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.step) || 0;
      const current = Number(elements.guestCount.value) || 1;
      setStepperValue(current + step);
    });
  });
}

function setStepperValue(value) {
  const min = Number(elements.stepper.dataset.min) || 1;
  const max = Number(elements.stepper.dataset.max) || 2;
  const clamped = Math.max(min, Math.min(max, value));
  elements.guestCount.value = String(clamped);
  elements.guestCountDisplay.textContent = String(clamped);
  const buttons = elements.stepper.querySelectorAll(".stepper-btn");
  if (buttons[0]) buttons[0].disabled = clamped <= min;
  if (buttons[1]) buttons[1].disabled = clamped >= max;
}

function updateRequestTotals() {
  const nights = nightsForRequest();
  const room = state.pendingRequest?.room;
  const price = Number(room?.price) || 0;
  const total = nights > 0 && price > 0 ? nights * price : null;
  elements.nightsMeta.textContent = nights > 0
    ? `${nights} nuit${nights > 1 ? "s" : ""}${price ? ` · ${formatPrice(price)} × ${nights}` : ""}`
    : "—";
  elements.totalAmount.textContent = total !== null ? formatPrice(total) : "—";
  if (nights > 0 && room) {
    elements.requestSummary.textContent = `${nights} nuit${nights > 1 ? "s" : ""}${price ? ` · ${formatPrice(price)} × ${nights}` : ""}`;
  } else {
    elements.requestSummary.textContent = "";
  }
}

function formatPrice(value) {
  const currency = state.site?.currency || "EUR";
  return formatCurrency({ settings: { currency } }, value);
}

function changeRoomPhoto(roomId, direction) {
  const room = findRoom(roomId);
  const photos = room?.photos || [];
  if (photos.length < 2) return;

  const currentIndex = state.roomPhotoIndexes[roomId] || 0;
  const newIndex = (currentIndex + direction + photos.length) % photos.length;
  state.roomPhotoIndexes[roomId] = newIndex;

  const card = elements.rooms.querySelector(`[data-room-id="${CSS.escape(roomId)}"]`);
  if (!card) return;
  const img = card.querySelector(".public-room-card-photo img");
  if (img) {
    img.src = photos[newIndex].url;
    img.alt = photos[newIndex].alt || room.name;
  }
  card.querySelectorAll(".public-room-card-dot").forEach((dot, i) => {
    dot.classList.toggle("is-active", i === newIndex);
  });
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
  elements.giteCarousel.querySelectorAll(".public-room-card-dot").forEach((dot, i) => {
    dot.classList.toggle("is-active", i === newIndex);
  });
}

function getAmenityGroups(room) {
  if (room.amenityGroups?.length) return room.amenityGroups;
  if (room.amenities?.length) return [{ name: "Équipements", items: room.amenities }];
  return [];
}

function openAmenitiesModal(roomId) {
  const room = findRoom(roomId);
  if (!room) return;
  elements.amenitiesTitle.textContent = "Équipements";
  elements.amenitiesRoomLabel.textContent = room.name;
  elements.amenitiesContent.innerHTML = getAmenityGroups(room)
    .map((group) => `
      <section>
        <h3>${escapeHtml(group.name)}</h3>
        <ul>${(group.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>
    `)
    .join("");
  elements.amenitiesModal.classList.add("is-open");
  elements.amenitiesModal.querySelectorAll(".modal-sheet").forEach((s) => s.classList.add("is-open"));
  lockScroll();
}

function closeAmenitiesModal() {
  elements.amenitiesModal.classList.remove("is-open");
  elements.amenitiesModal.querySelectorAll(".modal-sheet").forEach((s) => s.classList.remove("is-open"));
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

function showConfirmation(payload, room, total) {
  elements.confirmationRoomName.textContent = room?.name || "";
  elements.confirmationGuestCount.textContent = `${payload.guestCount} voyageur${payload.guestCount > 1 ? "s" : ""}`;
  elements.confirmationArrival.textContent = formatHumanDate(payload.arrivalDate);
  elements.confirmationDeparture.textContent = formatHumanDate(payload.departureDate);
  elements.confirmationTotal.textContent = total ? formatPrice(total) : "—";
  if (room?.photos?.[0]?.url) {
    elements.confirmationRoomPhoto.style.backgroundImage = `url("${room.photos[0].url}")`;
  } else {
    elements.confirmationRoomPhoto.style.background = gradientForRoom(room?.id || "");
  }
  elements.confirmation.classList.add("is-visible");
  elements.confirmation.setAttribute("aria-hidden", "false");
  lockScroll();
}

function hideConfirmation() {
  elements.confirmation.classList.remove("is-visible");
  elements.confirmation.setAttribute("aria-hidden", "true");
  unlockScroll();
}

function formatHumanDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
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
  const room = findRoom(payload.roomId);
  const nights = calculateNights(payload.arrivalDate, payload.departureDate);
  const total = (Number(room?.price) || 0) * nights;
  elements.requestForm.reset();
  setStepperValue(2);
  closeModal();
  showConfirmation(payload, room, total);
}
