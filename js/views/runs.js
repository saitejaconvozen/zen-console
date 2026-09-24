/* Generation runs: configure, launch, watch, stop. Runs are child processes of
   the server writing into `generated/`; their logs survive a server restart even
   though the supervision record does not. */
import { api } from "../api.js";
import { esc, num, pretty, tag, toast } from "../ui.js";

const LANGS = [["hi-IN", "Hindi"], ["ta-IN", "Tamil"], ["te-IN", "Telugu"],
               ["kn-IN", "Kannada"], ["bn-IN", "Bengali"], ["mr-IN", "Marathi"]];
let timer = null;

const picked = name => [...document.querySelectorAll(`input[name=${name}]:checked`)]
  .map(i => i.value);

async function refresh() {
  const { runs } = await api.runs();
  document.getElementById("runlist").innerHTML = runs.length ? runs.map(r => `
    <div class="card pad runcard">
      <h3><span class="mono">${esc(r.id)}</span>
        ${tag(r.alive ? "running" : `finished (${r.returncode})`, r.alive ? "ok" : "mute")}
        <em>${esc((r.spec.domains || []).join(", "))} &middot;
          ${esc((r.spec.languages || []).join(", "))} &middot;
          ${num(r.spec.per_cell)} per cell &middot; ${num(r.spec.workers)} workers</em></h3>
      <pre class="log">${esc(r.tail || "(no output yet)")}</pre>
      ${r.alive ? `<div style="margin-top:9px">
        <button class="btn sm danger" data-stop="${esc(r.id)}">Stop this run</button></div>` : ""}
    </div>`).join("") : `<div class="empty">No runs started from this console yet.</div>`;
}

export default {
  async render() {
    const { domains } = await api.domains();
    document.getElementById("app").innerHTML = `
      <h2 class="sec">Start a generation run</h2>
      <p class="note">A run generates until it reaches the target for each
      domain-and-language cell. Every trace still clears deterministic validation and
      the holistic verifier before it counts, so raising the target raises
      wall-clock time, never the acceptance bar.</p>
      <div class="card pad">
        <div class="formgrid">
          <div><h4 class="blk" style="margin-top:0;border:0;padding:0">Domains</h4>
            ${domains.map(d => `<label class="check"><input type="checkbox" name="rd"
              value="${esc(d.domain)}"> ${esc(pretty(d.domain))}</label>`).join("")}</div>
          <div><h4 class="blk" style="margin-top:0;border:0;padding:0">Languages</h4>
            ${LANGS.map(([v, l]) => `<label class="check"><input type="checkbox" name="rl"
              value="${v}" ${v === "hi-IN" ? "checked" : ""}> ${l}</label>`).join("")}</div>
          <div><h4 class="blk" style="margin-top:0;border:0;padding:0">Settings</h4>
            <label class="field"><span>accepted per domain and language</span>
              <input type="number" id="percell" value="10" min="1" max="200"></label>
            <label class="field"><span>concurrent workers</span>
              <input type="number" id="workers" value="12" min="1" max="32"></label>
            <button class="btn primary" id="start">Start run</button></div>
        </div>
      </div>
      <h2 class="sec">Runs</h2>
      <div id="runlist"></div>`;

    document.getElementById("start").onclick = async () => {
      const spec = { domains: picked("rd"), languages: picked("rl"),
                     per_cell: +document.getElementById("percell").value,
                     workers: +document.getElementById("workers").value };
      if (!spec.domains.length) return toast("Pick at least one domain", "bad");
      if (!spec.languages.length) return toast("Pick at least one language", "bad");
      try {
        const r = await api.startRun(spec);
        toast(`Started ${r.id} (pid ${r.pid})`, "ok");
        refresh();
      } catch (e) { toast(`Could not start: ${e.detail || e.message}`, "bad"); }
    };
    document.getElementById("app").addEventListener("click", async ev => {
      const b = ev.target.closest("[data-stop]");
      if (!b) return;
      try { await api.stopRun(b.dataset.stop); toast("Stop signalled", "ok");
            setTimeout(refresh, 900); }
      catch (e) { toast(`Could not stop: ${e.detail || e.message}`, "bad"); }
    });
    await refresh();
    timer = setInterval(refresh, 6000);
  },
  teardown() { clearInterval(timer); },
};
