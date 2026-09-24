/* Static data layer.

   This is a read-only, serverless build of the console. There is no backend:
   the whole synthetic corpus is shipped as JSON under ./data/ and every query
   the live server answered in SQL is reproduced here in the browser over the
   in-memory index. It mirrors app/index.py (_where, facets, search, SORTS,
   capability_tree, crosstab) so the views need no changes.

   Writes (review, saveAsset, runs, reindex) have nowhere to go and reject with
   a friendly READ_ONLY error the existing catch sites already surface. */

const TOKEN_KEY = "harness.token";
export const token = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
  set: v => { try { localStorage.setItem(TOKEN_KEY, (v || "").trim()); } catch {} },
};

export class ApiError extends Error {
  constructor(status, code, detail) {
    super(detail || code || `HTTP ${status}`);
    this.status = status; this.code = code; this.detail = detail;
  }
}

// Resolve ./data/ against the document, so it works whether the site is served
// at a domain root or under /<repo>/ on GitHub Pages.
const BASE = new URL(".", document.baseURI).href;
const cache = new Map();
async function load(rel) {
  if (!cache.has(rel)) {
    cache.set(rel, fetch(BASE + rel).then(r => {
      if (!r.ok) throw new ApiError(r.status, "NOT_FOUND", `missing ${rel}`);
      return r.json();
    }).catch(e => { cache.delete(rel); throw e; }));
  }
  return cache.get(rel);
}

const readOnly = () => Promise.reject(
  new ApiError(405, "READ_ONLY", "This is a static, read-only copy of the console."));

/* ---- the query engine, ported from app/index.py -------------------------- */

const FACETS = ["source", "domain", "lang", "workflow", "scenario", "persona",
                "call_direction", "difficulty", "stt_profile", "run", "verdict"];

function tokenize(raw) {
  return (raw || "").toLowerCase().match(/[\w.]+/gu) || [];
}

// Mirror of _where: does one row satisfy the filter set?
function matches(row, f) {
  for (const key of FACETS) if (f[key] && row[key] !== f[key]) return false;
  if (f.accepted === "0" || f.accepted === "1" || f.accepted === 0 || f.accepted === 1)
    if (row.accepted !== Number(f.accepted)) return false;
  const ge = (key, col) => {
    if (f[key] !== undefined && f[key] !== null && f[key] !== "")
      return (row[col] || 0) >= Number(f[key]);
    return true;
  };
  if (!ge("min_turns", "turns")) return false;
  if (!ge("min_depth", "tool_depth")) return false;
  if (!ge("min_stt", "stt_errors")) return false;
  if (f.axis && !(row.caps || []).some(c => c.axis_id === f.axis)) return false;
  if (f.subaxis && !(row.caps || []).some(c => c.subaxis_id === f.subaxis)) return false;
  if (f.variant && !(row.caps || []).some(c => c.variant_id === f.variant)) return false;
  if (f.review && row.review_verdict !== f.review) return false;
  if (f.q) { const t = row.text || ""; if (!tokenize(f.q).every(w => t.includes(w))) return false; }
  return true;
}

const SORTS = {
  mixed:   (a, b) => a.shuffle - b.shuffle,
  id:      (a, b) => String(a.id).localeCompare(String(b.id)),
  turns:   (a, b) => b.turns - a.turns,
  depth:   (a, b) => b.tool_depth - a.tool_depth,
  calls:   (a, b) => b.calls - a.calls,
  repairs: (a, b) => b.repairs - a.repairs,
  stt:     (a, b) => b.stt_errors - a.stt_errors,
};

let INDEX = null;
async function index() {
  if (!INDEX) INDEX = await load("data/traces.json");
  return INDEX;
}

// The row the list view reads: the index row minus the fields only the engine
// needs (caps and the search blob).
function listRow(row) {
  const { caps, text, ...rest } = row;
  return rest;
}

async function search(f, _signal) {
  const rows = (await index()).filter(r => matches(r, f));
  const limit = Number(f.limit || 50), offset = Number(f.offset || 0);
  rows.sort(SORTS[f.sort] || SORTS.mixed);
  return { total: rows.length, limit, offset,
           traces: rows.slice(offset, offset + limit).map(listRow) };
}

async function facets(f, _signal) {
  const all = await index();
  const out = {};
  for (const facet of FACETS) {
    const others = { ...f }; delete others[facet];
    const counts = new Map();
    for (const r of all) {
      if (!matches(r, others)) continue;
      const v = r[facet];
      if (v === "" || v === undefined || v === null) continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    out[facet] = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }
  return out;
}

async function capabilityTree(f) {
  const rows = (await index()).filter(r => matches(r, f || {}));
  const axes = new Map();
  const axisTraces = new Map(), subTraces = new Map();
  // (axis|sub|variant|role) -> {traces:Set, accepted:Set}
  const cell = new Map();
  for (const r of rows) {
    const seenA = new Set(), seenS = new Set();
    for (const c of r.caps || []) {
      const kA = c.axis_id, kS = c.subaxis_id;
      if (!seenA.has(kA)) { seenA.add(kA); axisTraces.set(kA, (axisTraces.get(kA) || new Set())); axisTraces.get(kA).add(r.id); }
      if (!seenS.has(kS)) { seenS.add(kS); subTraces.set(kS, (subTraces.get(kS) || new Set())); subTraces.get(kS).add(r.id); }
      const key = `${c.axis_id}|${c.subaxis_id}|${c.variant_id}|${c.role}`;
      let e = cell.get(key);
      if (!e) { e = { traces: new Set(), accepted: new Set() }; cell.set(key, e); }
      e.traces.add(r.id);
      if (r.accepted) e.accepted.add(r.id);
    }
  }
  for (const [key, e] of cell) {
    const [axis_id, subaxis_id, variant_id, role] = key.split("|");
    const axis = axes.get(axis_id) || (axes.set(axis_id, { axis_id, traces: 0, subaxes: new Map() }), axes.get(axis_id));
    const sub = axis.subaxes.get(subaxis_id) || (axis.subaxes.set(subaxis_id, { subaxis_id, traces: 0, variants: new Map() }), axis.subaxes.get(subaxis_id));
    const v = sub.variants.get(variant_id) || (sub.variants.set(variant_id, { variant_id, traces: 0, accepted: 0, roles: {} }), sub.variants.get(variant_id));
    v.traces += e.traces.size;
    v.accepted += e.accepted.size;
    v.roles[role] = (v.roles[role] || 0) + e.traces.size;
  }
  const out = [...axes.values()].sort((a, b) => a.axis_id.localeCompare(b.axis_id)).map(axis => ({
    axis_id: axis.axis_id,
    traces: (axisTraces.get(axis.axis_id) || new Set()).size,
    subaxes: [...axis.subaxes.values()].sort((a, b) => a.subaxis_id.localeCompare(b.subaxis_id)).map(sub => ({
      subaxis_id: sub.subaxis_id,
      traces: (subTraces.get(sub.subaxis_id) || new Set()).size,
      variants: [...sub.variants.values()].sort((a, b) => a.variant_id.localeCompare(b.variant_id)),
    })),
  }));
  return { axes: out };
}

async function crosstab(rows, cols) {
  if (!FACETS.includes(rows) || !FACETS.includes(cols))
    throw new ApiError(400, "UNKNOWN_FACET", `${rows}/${cols}`);
  const grid = {};
  for (const r of await index()) {
    if (!r.accepted) continue;
    (grid[r[rows]] = grid[r[rows]] || {});
    grid[r[rows]][r[cols]] = (grid[r[rows]][r[cols]] || 0) + 1;
  }
  return { rows, cols, grid };
}

const domainPkgs = new Map();
async function domain(d) {
  if (!domainPkgs.has(d)) domainPkgs.set(d, await load(`data/domains/${d}.json`));
  return domainPkgs.get(d);
}

export const api = {
  health:    ()            => load("data/health.json"),
  summary:   ()            => load("data/summary.json"),
  traces:    (f, signal)   => search(f || {}, signal),
  facets:    (f, signal)   => facets(f || {}, signal),
  trace:     id            => load(`data/trace/${encodeURIComponent(id)}.json`),
  crosstab:  (rows, cols)  => crosstab(rows, cols),
  domains:   ()            => load("data/domains.json"),
  domain:    d             => domain(d),
  asset:     async (d, k, i) => {
    const pkg = await domain(d);
    const v = ((pkg.assets || {})[k] || {})[i];
    if (v === undefined) throw new ApiError(404, "NO_ASSET", `${k}/${i}`);
    return v;
  },
  saveAsset: readOnly,
  contracts: ()            => load("data/contracts.json"),
  channel:   ()            => load("data/channel.json"),
  runs:      ()            => Promise.resolve({ runs: [] }),
  startRun:  readOnly,
  stopRun:   readOnly,
  reindex:   readOnly,
  review:    readOnly,
  reviews:   ()            => Promise.resolve({ reviews: [] }),
  capabilityTree: (f)      => capabilityTree(f),
  // The server's export is the filtered summary rows as JSONL. INDEX is already
  // loaded by the time the explorer wires the export button, so build the file
  // in the browser as a blob rather than shipping a 90 MB duplicate.
  exportUrl: f => {
    if (!INDEX) return "#";
    const jsonl = INDEX.filter(r => matches(r, f || {}))
      .map(r => JSON.stringify(listRow(r))).join("\n");
    return URL.createObjectURL(new Blob([jsonl], { type: "application/x-ndjson" }));
  },
};
