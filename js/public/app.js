import { calculateNights, escapeHtml, formatCurrency, showToast } from "../utils.js";
import { icon } from "../icons.js";
import { BODY_FONTS, HEADING_FONTS, HERO_FALLBACK_GRADIENTS } from "./config.js";
import { elements } from "./elements.js";
import { fetchJson } from "./api.js";
import { loadedFontKeys, state } from "./state.js";

export async function initPublicApp() {
  buildLightbox();
  await loadPublicSite();
  bindEvents();
}

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
    if (event.key !== "Escape") return;
    if (elements.lightbox && !elements.lightbox.classList.contains("is-hidden")) return closeLightbox();
    if (elements.confirmation.classList.contains("is-visible")) return hideConfirmation();
    if (elements.amenitiesModal.classList.contains("is-open")) return closeAmenitiesModal();
    if (elements.modal.classList.contains("is-open")) closeModal();
  });
}

export function buildLightbox() {
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
  try {
    const data = await fetchJson("/api/public-site", {}, "Impossible de charger la vitrine.");
    state.site = data;
    state.rooms = data.rooms || [];
    renderPublicSite();
  } catch (error) {
    showToast(elements, error.message, true);
  }
}

export function renderPublicSite() {
  const site = state.site.site || {};
  document.title = state.site.propertyName;
  if (elements.topnavBrandText) elements.topnavBrandText.textContent = state.site.propertyName;
  if (elements.footerBrandText) elements.footerBrandText.textContent = state.site.propertyName;
  elements.headline.textContent = site.headline || state.site.propertyName;
  elements.subtitle.textContent = site.subtitle || "";
  elements.intro.textContent = site.intro || state.site.description || "";
  if (site.subtitle) {
    elements.heroEyebrow.textContent = "Chambres d'hôtes";
  }
  if (elements.footerLogo) {
    elements.footerLogo.classList.toggle("is-hidden", !site.logoUrl);
    if (elements.footerBrandText) elements.footerBrandText.classList.toggle("is-hidden", Boolean(site.logoUrl));
    if (site.logoUrl) {
      elements.footerLogo.src = site.logoUrl;
      elements.footerLogo.alt = `Logo ${state.site.propertyName}`;
    } else {
      elements.footerLogo.removeAttribute("src");
      elements.footerLogo.alt = "";
    }
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
  const key = families.join("|");
  if (families.length && !loadedFontKeys.has(key) && !document.querySelector(`link[data-public-font-key="${CSS.escape(key)}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.publicFontKey = key;
    link.href = `https://fonts.googleapis.com/css2?family=${families.join("&family=")}&display=swap`;
    document.head.appendChild(link);
    loadedFontKeys.add(key);
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

function parseNightlyPrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const numericText = raw.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!/\d/.test(numericText) || numericText.includes("-")) return null;

  const hasComma = numericText.includes(",");
  const hasDot = numericText.includes(".");
  let normalized = numericText;

  if (hasComma && hasDot) {
    const decimalSeparator = numericText.lastIndexOf(",") > numericText.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = numericText.replaceAll(thousandsSeparator, "").replace(decimalSeparator, ".");
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";
    const parts = numericText.split(separator);
    if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
      normalized = parts.join("");
    } else {
      const decimals = parts.pop();
      normalized = `${parts.join("")}.${decimals}`;
    }
  }

  const price = Number(normalized);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function renderRooms() {
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
    wireDateScrollActions(grid);
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
      <button class="btn btn-secondary btn-md public-no-avail-action" type="button" data-scroll-dates>Modifier les dates</button>
    </div>
  `;
}

function renderRoomCard(room) {
  const photos = room.photos?.length ? room.photos : [];
  const selectedIndex = Math.min(state.roomPhotoIndexes[room.id] || 0, Math.max(photos.length - 1, 0));
  const photo = photos[selectedIndex];
  const nightlyPrice = parseNightlyPrice(room.price);
  const status = roomStatus(room.id);
  const showStatus = status !== null;
  const isAvail = status === "avail";
  const isUnavail = status === "full";
  const canRequestDirectly = room.bookingRequestsEnabled !== false;

  const dots = photos.length > 1
    ? `<div class="public-room-card-dots" aria-label="Photo ${selectedIndex + 1} sur ${photos.length}">${photos.map((_, i) => `<span class="public-room-card-dot${i === selectedIndex ? " is-active" : ""}" aria-hidden="true"></span>`).join("")}</div>`
    : "";

  const arrows = photos.length > 1
    ? `<button class="public-room-card-carousel-prev" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="-1" aria-label="Photo précédente">${icon("chevronLeft", 16)}</button>
       <button class="public-room-card-carousel-next" type="button" data-carousel-room="${escapeHtml(room.id)}" data-carousel-direction="1" aria-label="Photo suivante">${icon("chevronRight", 16)}</button>`
    : "";

  const statusPill = showStatus
    ? `<div class="public-room-card-status"><span class="pill ${isAvail ? "pill-positive" : "pill-danger"} pill-md">${isAvail ? "Disponible" : "Complet"}</span></div>`
    : "";

  const amenities = (room.amenities || []).slice(0, 3)
    .map((a) => `<span class="pill pill-outline">${escapeHtml(a)}</span>`)
    .join("");
  const extra = (room.amenities || []).length > 3
    ? `<span class="pill pill-outline">+${(room.amenities || []).length - 3}</span>`
    : "";

  const ctaLabel = isUnavail ? "Voir d'autres dates" : "Demander cette chambre";
  const ctaVariant = isUnavail ? "btn-secondary" : "btn-primary";
  const ctaAction = isUnavail ? "scroll-dates" : "request";
  const directRequestButton = canRequestDirectly
    ? `<button class="btn ${ctaVariant} btn-md btn-full" type="button" data-action="${ctaAction}" data-request-room="${escapeHtml(room.id)}">${ctaLabel}</button>`
    : "";

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
          ${nightlyPrice !== null ? `<div class="public-room-card-price">
            <div class="public-room-card-price-amount">${escapeHtml(formatPrice(nightlyPrice))}</div>
            <div class="public-room-card-price-unit">la nuit</div>
          </div>` : ""}
        </div>
        ${amenities || extra ? `<div class="public-room-card-amenities">${amenities}${extra}</div>` : ""}
        <div class="public-room-card-actions">
          ${directRequestButton}
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
        scrollToDates();
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

function wireDateScrollActions(scope) {
  scope.querySelectorAll("[data-scroll-dates]").forEach((button) => {
    button.addEventListener("click", scrollToDates);
  });
}

function scrollToDates() {
  elements.arrival.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
      <div class="public-room-card-dots" aria-label="Photo ${safeIndex + 1} sur ${photos.length}">
        ${photos.map((_, i) => `<span class="public-room-card-dot${i === safeIndex ? " is-active" : ""}" aria-hidden="true"></span>`).join("")}
      </div>
    ` : ""}
  `;
}

export function renderContact(site) {
  const rows = [];
  if (site.address) rows.push(`<div class="public-contact-row">${icon("map", 18)}<span>${escapeHtml(site.address)}</span></div>`);
  if (site.phone) rows.push(`<div class="public-contact-row">${icon("phone", 18)}<a href="tel:${escapeHtml(site.phone.replace(/\s/g, ""))}">${escapeHtml(site.phone)}</a></div>`);
  if (site.email) rows.push(`<div class="public-contact-row">${icon("mail", 18)}<a href="mailto:${escapeHtml(site.email)}">${escapeHtml(site.email)}</a></div>`);
  const list = rows.length ? `<div class="public-contact-list">${rows.join("")}</div>` : `<p class="public-section-intro">Contactez-nous via une demande de réservation.</p>`;
  const map = site.address
    ? `<div class="public-contact-map">
        <iframe title="Carte ${escapeHtml(state.site.propertyName)}" loading="lazy" src="https://www.google.com/maps?q=${encodeURIComponent(site.address)}&z=10&output=embed"></iframe>
      </div>`
    : "";
  elements.contact.innerHTML = list;
  if (elements.contactMapRegion) {
    elements.contactMapRegion.innerHTML = map;
    elements.contactMapRegion.classList.toggle("is-hidden", !map);
    elements.contactMapRegion.closest(".public-contact-section")?.classList.toggle("has-map", Boolean(map));
  }
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
      display.textContent = formatCompactDate(v);
    }
  };
  if (elements.arrival && elements.arrivalDisplay) updateCell(elements.arrival, elements.arrivalDisplay);
  if (elements.departure && elements.departureDisplay) updateCell(elements.departure, elements.departureDisplay);
}

function formatCompactDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export async function handleAvailabilitySubmit(event) {
  event.preventDefault();
  await fetchAvailability();
}

async function fetchAvailability() {
  if (!elements.arrival.value || !elements.departure.value) return;
  const params = new URLSearchParams({
    arrivalDate: elements.arrival.value,
    departureDate: elements.departure.value,
  });
  let data;
  try {
    data = await fetchJson(`/api/availability?${params.toString()}`, {}, "Recherche impossible.");
  } catch (error) {
    showToast(elements, error.message, true);
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
  if (hasOpenOverlay()) return;
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
}

function hasOpenOverlay() {
  return Boolean(
    elements.modal?.classList.contains("is-open")
    || elements.amenitiesModal?.classList.contains("is-open")
    || elements.confirmation?.classList.contains("is-visible")
    || (elements.lightbox && !elements.lightbox.classList.contains("is-hidden"))
  );
}

export function openRequestModal(roomId) {
  const room = findRoom(roomId);
  if (!room || room.bookingRequestsEnabled === false) return;
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

export function closeModal() {
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
  const nightlyPrice = parseNightlyPrice(room?.price);
  const priceMeta = nightlyPrice !== null ? ` · ${formatPrice(nightlyPrice)} × ${nights}` : "";
  const total = nights > 0 && nightlyPrice !== null ? nights * nightlyPrice : null;
  syncRequestDatePlaceholders();
  elements.nightsMeta.textContent = nights > 0
    ? `${nights} nuit${nights > 1 ? "s" : ""}${priceMeta}`
    : "—";
  elements.totalAmount.textContent = total !== null ? formatPrice(total) : "—";
  if (nights > 0 && room) {
    elements.requestSummary.textContent = `${nights} nuit${nights > 1 ? "s" : ""}`;
  } else {
    elements.requestSummary.textContent = "";
  }
}

function syncRequestDatePlaceholders() {
  [elements.requestArrivalDate, elements.requestDepartureDate].forEach((input) => {
    input?.closest(".booking-date-cell")?.toggleAttribute("data-empty", !input.value);
  });
}

function formatPrice(value) {
  const currency = state.site?.currency || "EUR";
  return formatCurrency({ settings: { currency } }, value);
}

export function changeRoomPhoto(roomId, direction) {
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

export function openAmenitiesModal(roomId) {
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

export function closeAmenitiesModal() {
  elements.amenitiesModal.classList.remove("is-open");
  elements.amenitiesModal.querySelectorAll(".modal-sheet").forEach((s) => s.classList.remove("is-open"));
  unlockScroll();
}

export function openLightbox(photos, index) {
  state.lightboxPhotos = photos;
  state.lightboxIndex = index;
  updateLightboxImage();
  elements.lightbox.classList.remove("is-hidden");
  lockScroll();
}

export function closeLightbox() {
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
  elements.confirmationTotal.textContent = total !== null ? formatPrice(total) : "—";
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

export async function submitBookingRequest(event) {
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
  try {
    await fetchJson(
      "/api/booking-requests",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      "Demande impossible.",
    );
  } catch (error) {
    showToast(elements, error.message, true);
    return;
  }
  const room = findRoom(payload.roomId);
  const nights = calculateNights(payload.arrivalDate, payload.departureDate);
  const nightlyPrice = parseNightlyPrice(room?.price);
  const total = nights > 0 && nightlyPrice !== null ? nightlyPrice * nights : null;
  elements.requestForm.reset();
  setStepperValue(2);
  closeModal();
  showConfirmation(payload, room, total);
}
