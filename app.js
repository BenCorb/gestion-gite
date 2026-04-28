import { cacheElements } from "./js/dom.js";
import { createActions } from "./js/handlers.js";
import { elements, setReservations, setSettings, setVersions, state } from "./js/state.js";

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements(elements);

  const ctx = {
    elements,
    setReservations,
    setSettings,
    setVersions,
    state,
  };

  const actions = createActions(ctx);
  ctx.actions = actions;

  actions.bindEvents();
  await actions.loadState();
});
