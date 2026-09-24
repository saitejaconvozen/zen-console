/* Hash routing, so every view is linkable and the back button works.
   A research console whose state cannot be shared in a URL is a demo. */
const routes = new Map();
let current = null;

export const register = (name, view) => routes.set(name, view);

export function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [name, query] = raw.split("?");
  return { name: name || "explore", params: Object.fromEntries(new URLSearchParams(query || "")) };
}

export function go(name, params = {}, { replace = false } = {}) {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
  const hash = `#/${name}${q ? "?" + q : ""}`;
  if (replace) history.replaceState(null, "", hash);
  else location.hash = hash;
  if (replace) render();
}

export function patch(params) {
  const { name, params: existing } = parse();
  go(name, { ...existing, ...params }, { replace: true });
}

export async function render() {
  const { name, params } = parse();
  const view = routes.get(name) || routes.get("explore");
  document.querySelectorAll("nav.tabs a").forEach(a =>
    a.setAttribute("aria-current", a.dataset.route === name ? "page" : "false"));
  if (current?.teardown) current.teardown();
  current = view;
  // Replace the mount point with an empty clone before every render. Views
  // delegate clicks by binding to it, and it otherwise outlives them, so the
  // listeners pile up one copy per navigation -- which made a facet click set
  // the filter and then immediately clear it again.
  const mount = document.getElementById("app");
  mount.replaceWith(mount.cloneNode(false));
  await view.render(params);
}

window.addEventListener("hashchange", render);
