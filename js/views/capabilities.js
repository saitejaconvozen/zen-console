/* The capability taxonomy, and what in the corpus demonstrates each part of it.

   The taxonomy is a triplet -- axis, sub-axis, variant -- and which level you
   want depends on the question. "Do we cover error resolution at all?" is an
   axis question; "which traces demonstrate a clarification request?" is a
   variant one. The toggle picks the level, and selecting a row filters the
   corpus to exactly the traces carrying that part of the triplet.

   Both engines feed this. The synthetic engine requests variants up front, so
   its rows are primary/secondary. The refinement engine's auditor observes them
   on real turns, so its rows are observed and carry a verdict. One table, one
   filter, because the taxonomy is global rather than per-corpus. */
import { api } from "../api.js";
import { esc, num, pretty, table, tag, toast, spinner } from "../ui.js";
import { go, parse, patch } from "../router.js";

const LEVELS = [
  ["axis", "Axis", "axis_id"],
  ["subaxis", "Sub-axis", "subaxis_id"],
  ["variant", "Variant", "variant_id"],
];

/* Contract text, keyed by variant id, so a row can say what it means rather
   than only what it is called. */
let CONTRACTS = null;

async function contracts() {
  if (CONTRACTS) return CONTRACTS;
  try {
    const list = (await api.contracts()).contracts || [];
    CONTRACTS = {};
    list.forEach(c => { CONTRACTS[c.variant_id] = c; });
  } catch { CONTRACTS = {}; }
  return CONTRACTS;
}

/* Flatten the tree to whichever level is selected. Counts at a level are
   distinct traces, so a trace demonstrating three variants of one axis counts
   once against that axis and three times across variants. */
function rowsFor(tree, level) {
  const out = [];
  for (const axis of tree.axes || []) {
    if (level === "axis") {
      out.push({
        id: axis.axis_id, label: axis.axis_id, traces: axis.traces,
        detail: `${axis.subaxes.length} sub-${axis.subaxes.length === 1 ? "axis" : "axes"}, ` +
                `${axis.subaxes.reduce((n, s) => n + s.variants.length, 0)} variants`,
        accepted: axis.subaxes.reduce((n, s) =>
          n + s.variants.reduce((m, v) => m + v.accepted, 0), 0),
        roles: {},
      });
      continue;
    }
    for (const sub of axis.subaxes) {
      if (level === "subaxis") {
        out.push({
          id: sub.subaxis_id, label: sub.subaxis_id, traces: sub.traces,
          detail: `${sub.variants.length} variant${sub.variants.length === 1 ? "" : "s"}`,
          accepted: sub.variants.reduce((m, v) => m + v.accepted, 0),
          roles: {},
        });
        continue;
      }
      for (const v of sub.variants) {
        out.push({
          id: v.variant_id, label: v.variant_id, traces: v.traces,
          accepted: v.accepted, roles: v.roles, detail: "",
        });
      }
    }
  }
  return out.sort((a, b) => b.traces - a.traces || a.id.localeCompare(b.id));
}

function roleChips(roles) {
  const order = ["primary", "secondary", "observed"];
  return order.filter(r => roles[r]).map(r =>
    `<span class="chip">${esc(r)} ${num(roles[r])}</span>`).join("") || "";
}

async function draw(params) {
  const app = document.getElementById("app");
  const level = params.level || "variant";
  const filters = {};
  for (const k of ["source", "domain", "lang", "accepted"])
    if (params[k]) filters[k] = params[k];

  const [tree, book] = await Promise.all([api.capabilityTree(filters), contracts()]);
  const rows = rowsFor(tree, level);
  const covered = rows.filter(r => r.traces > 0).length;

  const toggle = LEVELS.map(([key, label]) => `
    <button class="btn sm ${key === level ? "primary" : ""}" data-level="${key}"
            aria-pressed="${key === level}">${label}</button>`).join("");

  const body = rows.map(r => {
    const contract = book[r.id];
    const share = r.traces ? Math.round((r.accepted / r.traces) * 100) : 0;
    return [
      { html: `<a class="tagname" href="#/explore?${level}=${encodeURIComponent(r.id)}"
                  title="Show the traces demonstrating this">${esc(r.label)}</a>` },
      { html: contract
          ? `<span>${esc(contract.name)}</span>`
          : `<span class="hint">${esc(r.detail || "")}</span>` },
      { cls: "num", text: num(r.traces) },
      { cls: "num", text: num(r.accepted) },
      { html: `<div class="bar"><i style="width:${share}%"></i></div>
               <span class="pct">${share}%</span>` },
      { html: roleChips(r.roles) },
    ];
  });

  app.innerHTML = `
    <h2 class="sec">Capability coverage</h2>
    <p class="note">The taxonomy is a triplet. Pick the level you want to reason
    at, then select a row to see exactly the traces that demonstrate it. Counts
    are distinct traces: a trace demonstrating three variants of one axis counts
    once against that axis.</p>
    <div class="rowform" style="margin-bottom:10px">
      <span class="hint" style="margin-right:4px">show</span>${toggle}
      <span style="flex:1"></span>
      <select id="capsource" aria-label="corpus">
        <option value="">both corpora</option>
        <option value="synthetic" ${params.source === "synthetic" ? "selected" : ""}>synthetic only</option>
        <option value="real" ${params.source === "real" ? "selected" : ""}>real calls only</option>
      </select>
      <select id="capaccepted" aria-label="status">
        <option value="">any status</option>
        <option value="1" ${params.accepted === "1" ? "selected" : ""}>accepted only</option>
      </select>
    </div>
    <p class="hint">${num(covered)} of ${num(rows.length)}
      ${level === "axis" ? "axes" : level === "subaxis" ? "sub-axes" : "variants"}
      have at least one trace.</p>
    ${table([LEVELS.find(l => l[0] === level)[1], "meaning", "traces",
             "accepted", "acceptance", "how it got there"], body,
            { empty: "Nothing indexed carries a capability annotation yet." })}`;

  app.querySelectorAll("[data-level]").forEach(b =>
    b.addEventListener("click", () => patch({ level: b.dataset.level })));
  document.getElementById("capsource").addEventListener("change",
    e => patch({ source: e.target.value }));
  document.getElementById("capaccepted").addEventListener("change",
    e => patch({ accepted: e.target.value }));
}

export default {
  async render(params) {
    document.getElementById("app").innerHTML = spinner("Loading capability coverage");
    try { await draw(params || parse().params); }
    catch (e) {
      document.getElementById("app").innerHTML =
        `<div class="empty">${esc(e.detail || e.message)}</div>`;
    }
  },
};
