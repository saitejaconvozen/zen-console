/* Application shell: mounts the views, wires the router and the token box. */
import { api, token } from "./api.js";
import { num, toast } from "./ui.js";
import { register, render } from "./router.js";
import explore from "./views/explore.js";
import overview from "./views/overview.js";
import domains from "./views/domains.js";
import runs from "./views/runs.js";
import capabilities from "./views/capabilities.js";
import architecture from "./views/architecture.js";

register("explore", explore);
register("overview", overview);
register("domains", domains);
register("runs", runs);
register("capabilities", capabilities);
register("architecture", architecture);

const box = document.getElementById("token");
box.value = token.get();
box.addEventListener("change", e => {
  token.set(e.target.value);
  toast("Token stored in this browser", "ok");
});

document.getElementById("reindex").addEventListener("click", async () => {
  try {
    const r = await api.reindex(false);
    toast(`Index rebuilt: ${num(r.total)} traces (+${r.added} ~${r.updated} -${r.removed}) `
          + `in ${r.seconds}s`, "ok");
    render();
  } catch (e) { toast(`Reindex failed: ${e.detail || e.message}`, "bad"); }
});

api.health().then(h => {
  document.getElementById("status").textContent =
    `${num(h.traces)} traces · ${h.auth_required ? "writes need a token" : "writes open"}`;
}).catch(() => {
  document.getElementById("status").textContent = "server unreachable";
});

render();
