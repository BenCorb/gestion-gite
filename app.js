import { cacheElements } from "./js/dom.js";
import { createActions } from "./js/handlers.js";
import { elements, setBookingRequests, setReservations, setSettings, setVersions, state } from "./js/state.js";

function bindPaletteSwatches() {
  const swatches = document.querySelectorAll(".palette-swatch[data-palette-value]");
  if (!swatches.length) return;
  const current = document.documentElement.dataset.palette || "vignes";
  swatches.forEach((sw) => {
    sw.setAttribute("aria-checked", String(sw.dataset.paletteValue === current));
    sw.addEventListener("click", () => {
      const value = sw.dataset.paletteValue;
      document.documentElement.setAttribute("data-palette", value);
      try { localStorage.setItem("lcdv.palette", value); } catch {}
      swatches.forEach((s) =>
        s.setAttribute("aria-checked", String(s.dataset.paletteValue === value)),
      );
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements(elements);

  const ctx = {
    elements,
    setBookingRequests,
    setReservations,
    setSettings,
    setVersions,
    state,
  };

  const actions = createActions(ctx);
  ctx.actions = actions;

  actions.bindEvents();
  bindPaletteSwatches();
  await actions.loadState();
});
