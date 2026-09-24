/* Domain packages: browse and edit. A save is validated in a scratch copy by the
   real domain loader before it touches the file, so a change that would orphan a
   reference fails with the loader's own message and nothing is written. */
import { api } from "../api.js";
import { esc, num, pretty, table, tag, toast } from "../ui.js";
import { patch } from "../router.js";

let dirty = false;

async function openAsset(domain, kind, ident) {
  const el = document.getElementById("editor");
  const body = await api.asset(domain, kind, ident);
  el.innerHTML = `
    <h4 class="blk">${esc(kind)} / ${esc(ident)}</h4>
    <textarea class="code" id="ed" spellcheck="false"
      aria-label="${esc(kind)} ${esc(ident)}">${esc(JSON.stringify(body, null, 2))}</textarea>
    <div class="editbar">
      <button class="btn primary" id="save">Validate and save</button>
      <button class="btn" id="revert">Revert</button>
      <span class="hint">Saving runs the domain loader against a scratch copy first.
        A change that breaks a reference is rejected and the file is left untouched.</span>
    </div>`;
  dirty = false;
  document.getElementById("ed").addEventListener("input", () => { dirty = true; });
  document.getElementById("revert").onclick = () => openAsset(domain, kind, ident);
  document.getElementById("save").onclick = async () => {
    let parsed;
    try { parsed = JSON.parse(document.getElementById("ed").value); }
    catch (e) { return toast(`Not valid JSON: ${e.message}`, "bad"); }
    try {
      const r = await api.saveAsset(domain, kind, ident, parsed);
      dirty = false;
      toast(`Saved. Domain fingerprint is now ${r.fingerprint}`, "ok");
      render({ domain, asset: `${kind}/${ident}` });
    } catch (e) { toast(`Rejected: ${e.detail || e.message}`, "bad"); }
  };
}

async function render(params) {
  const { domains } = await api.domains();
  const domain = params.domain || domains[0]?.domain;
  // The count is scenarios, not traces. The Corpus rail uses the same shape for
  // trace counts, so this one says what it is rather than leaving the reader to
  // infer it from a number that means something else two tabs away.
  document.getElementById("drail").innerHTML = `<section><h4>Domains</h4>
    <p class="hint" style="margin:0 0 6px">scenarios defined per package</p>` +
    domains.map(d => `<button class="opt" data-domain="${esc(d.domain)}"
      aria-pressed="${d.domain === domain}">${esc(pretty(d.domain))}
      <span class="n" title="${num(d.scenarios || 0)} scenarios defined">${
        num(d.scenarios || 0)}</span></button>`).join("") + `</section>`;
  if (!domain) return;

  const pkg = await api.domain(domain);
  const meta = domains.find(d => d.domain === domain) || {};
  document.getElementById("dlist").innerHTML = Object.keys(pkg.assets).sort()
    .map(kind => `<div class="kindblk"><h4>${esc(kind)}</h4>` +
      Object.keys(pkg.assets[kind]).sort().map(id =>
        `<button class="opt" data-asset="${esc(kind)}/${esc(id)}"
          aria-pressed="${params.asset === kind + "/" + id}">${esc(id)}</button>`).join("") +
      `</div>`).join("");

  document.getElementById("dmeta").innerHTML = `
    <h2 style="font-family:var(--display);font-size:22px;margin-bottom:4px">
      ${esc(pretty(domain))}</h2>
    <p class="note">${esc(pkg.meta.description || "")}</p>
    ${table(["property", "value"], [
      ["version", pkg.meta.version],
      ["fingerprint", { html: `<span class="mono">${esc(meta.fingerprint || "")}</span>` }],
      ["workflows", (meta.workflows || []).join(", ")],
      ["tools", { cls: "num", text: meta.tools }],
      ["scenarios", { cls: "num", text: meta.scenarios }],
      ["outbound scenarios", { cls: "num", text: meta.outbound }],
      ["personas", (meta.personas || []).join(", ")],
      ["realizable contracts", { cls: "num", text: meta.contracts }],
      ["languages", (pkg.meta.supported_languages || []).join(", ")],
    ])}`;

  if (params.asset) {
    const [kind, ident] = params.asset.split("/");
    await openAsset(domain, kind, ident);
  } else {
    document.getElementById("editor").innerHTML =
      `<div class="empty">Pick an asset to view or edit it.</div>`;
  }
}

export default {
  async render(params) {
    document.getElementById("app").innerHTML = `
      <div class="editor">
        <div class="rail" id="drail"></div>
        <div class="rail" id="dlist"></div>
        <div class="card pad"><div id="dmeta"></div><div id="editor"></div></div>
      </div>`;
    document.getElementById("app").addEventListener("click", ev => {
      const d = ev.target.closest("[data-domain]");
      if (d) {
        if (dirty && !confirm("Discard unsaved edits?")) return;
        return patch({ domain: d.dataset.domain, asset: "" });
      }
      const a = ev.target.closest("[data-asset]");
      if (a) {
        if (dirty && !confirm("Discard unsaved edits?")) return;
        return patch({ asset: a.dataset.asset });
      }
    });
    await render(params);
  },
  teardown() { dirty = false; },
};
