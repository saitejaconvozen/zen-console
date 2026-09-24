/* Corpus explorer: faceted filtering, search, pagination, and the trace reader.
   Filter state lives in the URL, so any view of the corpus can be shared. */
import { api, ApiError } from "../api.js";
import { esc, langName, num, pretty, sttDiff, table, tag, toast, spinner } from "../ui.js";
import { patch, parse } from "../router.js";

const FACETS = [
  ["source", "Corpus"], ["domain", "Domain"], ["lang", "Language"], ["workflow", "Workflow"],
  ["call_direction", "Direction"], ["stt_profile", "Line quality"],
  ["persona", "Persona"], ["difficulty", "Difficulty"], ["verdict", "Verifier"],
  ["run", "Run"],
];
let inflight = null;

/* The capability tree, fetched once and reused by the three selects. It is a
   few hundred rows and does not change between renders, so refetching it on
   every filter change would be a request per keystroke for no new information. */
let CAPS = null;

async function capTree() {
  if (!CAPS) {
    try { CAPS = (await api.capabilityTree({})).axes || []; }
    catch { CAPS = []; }
  }
  return CAPS;
}


function filtersFrom(params) {
  const out = {};
  for (const [k] of FACETS) if (params[k]) out[k] = params[k];
  for (const k of ["accepted", "q", "min_turns", "min_depth", "min_stt",
                   "review", "axis", "subaxis", "variant", "source"])
    if (params[k]) out[k] = params[k];
  return out;
}

function renderRail(facets, params) {
  const active = filtersFrom(params);
  const any = Object.keys(active).length;

  // The three selects cascade: sub-axes are those of the chosen axis, variants
  // those of the chosen sub-axis. Choosing a narrower level implies the wider
  // ones, so selecting a variant sets its axis and sub-axis too and the reader
  // can always see where in the taxonomy they are.
  const anyCap = ["axis", "subaxis", "variant"].some(k => params[k]);
  const axis = (CAPS || []).find(a => a.axis_id === params.axis);
  const subOptions = axis ? axis.subaxes : [];
  const sub = subOptions.find(sa => sa.subaxis_id === params.subaxis);
  const varOptions = sub ? sub.variants : [];
  const groups = FACETS.map(([key, label]) => {
    const values = (facets[key] || []).filter(v => v.value);
    if (!values.length) return "";
    return `<section><h4>${esc(label)}</h4>` + values.slice(0, 12).map(v => `
      <button class="opt" data-facet="${esc(key)}" data-value="${esc(v.value)}"
              aria-pressed="${params[key] === v.value}">
        ${esc(key === "lang" ? langName(v.value) : pretty(v.value))}
        <span class="n">${num(v.count)}</span></button>`).join("") + `</section>`;
  }).join("");

  document.getElementById("rail").innerHTML = `
    <section>
      <h4>Search${any ? `<button id="clear">clear all</button>` : ""}</h4>
      <label class="field"><span>free text</span>
        <input id="q" value="${esc(params.q || "")}" placeholder="id, tool, utterance"></label>
      <label class="field"><span>status</span>
        <select id="accepted">
          <option value="">any</option>
          <option value="1" ${params.accepted === "1" ? "selected" : ""}>accepted</option>
          <option value="0" ${params.accepted === "0" ? "selected" : ""}>rejected</option>
        </select></label>
      <label class="field"><span>human review</span>
        <select id="review">
          <option value="">any</option>
          ${["accept", "reject", "flag"].map(v =>
            `<option value="${v}" ${params.review === v ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
      <label class="field"><span>min STT errors</span>
        <input id="min_stt" type="number" min="0" value="${esc(params.min_stt || "")}"></label>
      <label class="field"><span>min tool depth</span>
        <input id="min_depth" type="number" min="0" value="${esc(params.min_depth || "")}"></label>
    </section>
    <section>
      <h4>Capability${anyCap ? `<button id="clearcap">clear</button>` : ""}</h4>
      <p class="hint">Filter to traces demonstrating a part of the taxonomy.
        Pick an axis to widen, a variant to narrow.</p>
      <label class="field"><span>axis</span>
        <select id="capaxis">
          <option value="">any axis</option>
          ${(CAPS || []).map(a => `<option value="${esc(a.axis_id)}"
            ${params.axis === a.axis_id ? "selected" : ""}>${esc(a.axis_id)}
            (${num(a.traces)})</option>`).join("")}
        </select></label>
      <label class="field"><span>sub-axis</span>
        <select id="capsub" ${subOptions.length ? "" : "disabled"}>
          <option value="">${subOptions.length ? "any sub-axis" : "pick an axis first"}</option>
          ${subOptions.map(sa => `<option value="${esc(sa.subaxis_id)}"
            ${params.subaxis === sa.subaxis_id ? "selected" : ""}>${esc(sa.subaxis_id)}
            (${num(sa.traces)})</option>`).join("")}
        </select></label>
      <label class="field"><span>variant</span>
        <select id="capvar" ${varOptions.length ? "" : "disabled"}>
          <option value="">${varOptions.length ? "any variant" : "pick a sub-axis first"}</option>
          ${varOptions.map(v => `<option value="${esc(v.variant_id)}"
            ${params.variant === v.variant_id ? "selected" : ""}>${esc(v.variant_id)}
            (${num(v.traces)})</option>`).join("")}
        </select></label>
    </section>${groups}`;

  document.getElementById("capaxis").addEventListener("change", e =>
    patch({ axis: e.target.value, subaxis: "", variant: "", offset: 0 }));
  document.getElementById("capsub").addEventListener("change", e =>
    patch({ subaxis: e.target.value, variant: "", offset: 0 }));
  document.getElementById("capvar").addEventListener("change", e => {
    const id = e.target.value;
    const parts = id.split("-");
    patch(id ? { variant: id, subaxis: `${parts[0]}-${parts[1]}`, axis: parts[0], offset: 0 }
             : { variant: "", offset: 0 });
  });
  document.getElementById("clearcap")?.addEventListener("click", () =>
    patch({ axis: "", subaxis: "", variant: "", offset: 0 }));

  const capKeys = ["axis", "subaxis", "variant"].filter(k => params[k]);
  if (capKeys.length) {
    const rail = document.getElementById("rail");
    const box = document.createElement("section");
    box.innerHTML = `<h4>Capability</h4>` + capKeys.map(k => `
      <button class="opt" data-clearcap="${k}" aria-pressed="true">
        ${esc(k)}: ${esc(params[k])}<span class="n">clear</span></button>`).join("");
    rail.prepend(box);
    box.querySelectorAll("[data-clearcap]").forEach(b =>
      b.addEventListener("click", () => patch({ [b.dataset.clearcap]: "", offset: 0 })));
  }
  document.getElementById("q").addEventListener("change",
    e => patch({ q: e.target.value.trim(), offset: 0 }));
  ["accepted", "review", "min_stt", "min_depth"].forEach(id =>
    document.getElementById(id).addEventListener("change",
      e => patch({ [id]: e.target.value, offset: 0 })));
  document.getElementById("clear")?.addEventListener("click", () => {
    const cleared = {}; Object.keys(active).forEach(k => { cleared[k] = ""; });
    patch({ ...cleared, offset: 0 });
  });
}

function renderList(result, params) {
  const { total, limit, offset, traces } = result;
  document.getElementById("count").textContent =
    total ? `${num(offset + 1)}-${num(Math.min(offset + limit, total))} of ${num(total)}`
          : "no matches";
  document.getElementById("list").innerHTML = traces.length ? traces.map(t => `
    <div class="row" data-id="${esc(t.id)}" role="option"
         aria-selected="${t.id === params.trace}">
      <div class="l1"><span class="dot ${t.review_verdict === "flag" ? "flag"
          : t.accepted ? "ok" : "bad"}"></span>${esc(t.id)}</div>
      <div class="l2">${esc(t.domain)} &middot; ${esc(langName(t.lang))} &middot;
        ${esc(t.call_direction)} &middot; ${esc(t.stt_profile || "-")}</div>
      <div class="l3">${esc(pretty(t.scenario))} - ${t.tool_depth} tools,
        ${t.turns} turns${t.stt_errors ? `, ${t.stt_errors} STT` : ""}</div>
    </div>`).join("") : `<div class="empty">Nothing matches these filters.</div>`;

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  document.getElementById("pager").innerHTML = `
    page ${page} of ${num(pages)}
    <span class="end">
      <button class="btn sm" id="prev" ${offset === 0 ? "disabled" : ""}>previous</button>
      <button class="btn sm" id="next" ${offset + limit >= total ? "disabled" : ""}>next</button>
    </span>`;
  document.getElementById("prev")?.addEventListener("click",
    () => patch({ offset: Math.max(0, offset - limit) }));
  document.getElementById("next")?.addEventListener("click",
    () => patch({ offset: offset + limit }));
}

function turnHtml(e) {
  const sp = e.speech || {}, an = e.annotation || null;
  const labels = (an && (an.targeted_variant_labels || an.targeted_variants)) || [];
  const ann = labels.length ? `<span class="ann"><b>${esc(labels.join(" &middot; "))}</b><br>
    ${esc(an.expected_behavior || "")}${(an.supporting_context_event_ids || []).length
      ? ` <em>(rests on ${esc(an.supporting_context_event_ids.join(", "))})</em>` : ""}</span>` : "";
  if (e.role === "assistant" && e.tool_name)
    return `<div class="turn call"><span class="eid">${esc(e.event_id)}</span>
      <span class="who">&rarr; TOOL</span><span class="txt">${esc(e.tool_name)}(${
      esc(JSON.stringify(e.arguments || {}))})${ann}</span></div>`;
  if (e.role === "tool") {
    const bad = /error|reject|fail|not_the_account/i.test(e.content || "");
    return `<div class="turn res ${bad ? "fail" : ""}"><span class="eid">${esc(e.event_id)}</span>
      <span class="who">&larr; RESULT</span><span class="txt">${esc(e.content)}</span></div>`;
  }
  const corrupted = sp.clean_text && sp.model_visible_text &&
                    sp.clean_text !== sp.model_visible_text;
  const stt = corrupted ? `<span class="stt">${esc(sp.stt_error_type || "recognition error")}
    &mdash; ${sttDiff(sp.clean_text, sp.model_visible_text, sp.clean_span, sp.corrupted_span)}</span>` : "";
  return `<div class="turn ${e.role === "user" ? "user" : ""}">
    <span class="eid">${esc(e.event_id)}</span>
    <span class="who">${e.role === "user" ? "CUSTOMER" : "AGENT"}</span>
    <span class="txt">${esc(e.content)}${stt}${ann}</span></div>`;
}

function renderDetail(payload) {
  const el = document.getElementById("detail");

  // Real-corpus traces are recorded customer calls: the server withholds the
  // conversation text and returns a summary, verifier verdict and capability
  // list instead (see api.py _real_detail). They carry no `trace`/`detail`, so
  // the full reader below would throw on `payload.trace.ir`. Render what is
  // served.
  if (payload.withheld) {
    const s = payload.summary || {}, vf = payload.verifier || {}, r = payload.review;
    const fmt = val => Array.isArray(val) ? (val.join(", ") || "-")
      : (val && typeof val === "object") ? JSON.stringify(val)
      : (val === null || val === undefined || val === "") ? "-" : String(val);
    const kv = Object.entries(s)
      .map(([k, val]) => `<dt>${esc(pretty(k))}</dt><dd>${esc(fmt(val))}</dd>`).join("");
    const caps = (payload.capabilities || []).length
      ? `<h4 class="blk">Capabilities</h4>` + table(
          ["variant", "role", "verdict", "severity"],
          payload.capabilities.map(c => [
            { html: `<span class="mono">${esc(c.variant_id)}</span>` },
            c.role || "-",
            { html: tag(c.verdict || "-", c.verdict === "PASS" ? "ok" : "bad") },
            c.severity || "-",
          ]))
      : "";
    el.innerHTML = `
      <h2>${esc(payload.id)}
        ${tag(vf.decision || "withheld", vf.decision === "PASS" ? "ok" : "bad")}
        ${tag("text withheld", "mute")}</h2>
      <p class="hint">${esc(payload.why || "Conversation text is not served for this corpus.")}</p>
      <dl class="kv">${kv}</dl>
      <div class="kv" style="margin-top:6px">
        <dt>user turns unchanged</dt><dd>${esc(fmt(vf.user_turns_unchanged))}</dd>
        <dt>assistant turns acceptable</dt><dd>${esc(fmt(vf.assistant_turns_all_acceptable))}</dd>
        <dt>annotations complete</dt><dd>${esc(fmt(vf.annotations_complete))}</dd>
        <dt>findings</dt><dd>${esc(fmt(vf.findings))}</dd>
      </div>
      ${caps}
      ${r ? `<p class="hint">Human review: ${tag(r.verdict,
        r.verdict === "accept" ? "ok" : r.verdict === "reject" ? "bad" : "warn")}
        ${esc(r.note || "")}</p>` : ""}`;
    return;
  }

  const t = payload.trace, ir = t.ir, d = payload.detail || {};
  const v = (d.verifications || []).slice(-1)[0];
  const accepted = !!d.accepted;
  const tools = (ir.steps || []).filter(s => s.kind === "tool_call").map(s => s.tool_name);
  // deterministic_findings is one entry per attempt. The verdict is passed on
  // the best candidate, which is often not the last one, so showing the last
  // attempt's findings can display "none open" on a trace rejected for having
  // some. Follow best_candidate when it is recorded.
  const attempts = d.deterministic_findings || [];
  const bestIdx = Number.isInteger(d.best_candidate) ? d.best_candidate : attempts.length - 1;
  const findings = attempts[bestIdx] || attempts.slice(-1)[0] || [];

  const kv = [
    ["domain", ir.domain], ["workflow", ir.workflow_id],
    ["scenario", pretty(ir.scenario_family)], ["persona", ir.persona_id],
    ["call direction", ir.call_direction || "inbound"],
    ["line quality", ir.stt_profile],
    ["language", `${ir.language} / ${ir.script_mode}`],
    ["difficulty", ir.difficulty], ["resolution", ir.resolution_kind],
    ["primary capability", (ir.primary_variant_labels || ir.primary_variants || []).join(" / ")],
    ["secondary", (ir.secondary_variant_labels || ir.secondary_variants || []).join(" / ") || "-"],
    ["domain version", [t.asset_reference?.domain_id, t.asset_reference?.domain_version,
                        t.asset_reference?.domain_fingerprint].filter(Boolean).join(" ")],
  ].map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join("");

  const irTable = table(
    ["step", "actor", "kind", "tool", "status", "arguments / result", "depends on"],
    (ir.steps || []).map(s => [
      { html: `<span class="mono">${esc(s.step_id)}</span>` }, s.actor, s.kind,
      { html: `<span class="mono">${esc(s.tool_name || "-")}</span>` },
      { html: s.result_status ? tag(s.result_status, s.result_status === "ok" ? "ok" : "bad") : "-" },
      { cls: "w", html: `<span class="mono">${esc(JSON.stringify(
          s.kind === "tool_result" ? (s.result || {}) : (s.arguments || {})).slice(0, 180))}</span>` },
      { html: `<span class="mono">${esc((s.depends_on || [])
          .map(x => `${x.from_step}.${x.from_path}`).join(", ") || "-")}</span>` },
    ]));

  const findingsTable = findings.length ? `<h4 class="blk">Open deterministic findings</h4>` +
    table(["code", "scope", "where", "detail"], findings.map(f => [
      { html: `<span class="mono">${esc(f.code)}</span>` },
      { html: `<span class="mono">${esc(f.scope)}</span>` },
      { html: `<span class="mono">${esc(f.where)}</span>` },
      { cls: "w", text: (f.detail || "").slice(0, 160) }])) : "";

  const repairs = (d.repair_trajectory || []).length ? `<h4 class="blk">Repair trajectory</h4>` +
    table(["#", "scope", "source", "before", "after", "verdict", "changed", "frozen"],
      d.repair_trajectory.map(r => [
        { cls: "num", text: r.attempt },
        { html: `<span class="mono">${esc(r.scope)}</span>` }, r.source,
        { cls: "num", text: r.findings_before }, { cls: "num", text: r.findings_after },
        { html: tag(r.verdict, r.verdict === "IMPROVED" ? "ok"
                  : r.verdict === "UNCHANGED" ? "mute" : "bad") },
        { html: `<span class="mono">${esc((r.changed_event_ids || []).join(",") || "-")}</span>` },
        { html: `<span class="mono">${(r.immutable_event_ids || []).length}ev/${
                  (r.immutable_step_ids || []).length}st</span>` }])) : "";

  const verifier = v ? `<h4 class="blk">Holistic verifier</h4>
    <p style="margin:0 0 9px;font-size:13.5px">${tag(v.verdict, v.verdict === "PASS" ? "ok" : "bad")}
      ${esc(v.summary || "")}</p>` +
    table(["capability", "realized", "evidence", "reason"],
      (v.variant_findings || []).map(f => [
        { cls: "w", text: f.label || f.variant_id },
        { html: tag(f.realized, f.realized === "YES" ? "ok" : "warn") },
        { html: `<span class="mono">${esc((f.evidence_event_ids || []).join(", "))}</span>` },
        { cls: "w", text: (f.reason || "").slice(0, 150) }])) : "";

  const prompt = t.zen_prompt ? `<h4 class="blk">Zen system prompt - what the agent was given</h4>
    <details class="disc" open><summary>${num(t.zen_prompt.length)} characters</summary>
      <pre class="body">${esc(t.zen_prompt)}</pre></details>` : "";
  const schemas = (t.model_visible_tools || []).length ?
    `<h4 class="blk">Tools visible to the agent</h4>` + t.model_visible_tools.map(tool =>
      `<details class="disc"><summary><span class="mono">${esc(tool.name)}</span>
        ${tag(tool.consequential ? "consequential" : "read-only",
              tool.consequential ? "warn" : "mute")}</summary>
        <p style="margin:6px 0 8px;font-size:12.5px;color:var(--muted)">${esc(tool.description || "")}</p>
        <pre class="body">${esc(JSON.stringify({ input_schema: tool.input_schema,
          output_schema: tool.output_schema }, null, 2))}</pre></details>`).join("") : "";

  const r = payload.review;
  const reviewBar = `<div class="reviewbar">
    <strong style="font-size:12.5px">Human review</strong>
    ${r ? tag(r.verdict, r.verdict === "accept" ? "ok" : r.verdict === "reject" ? "bad" : "warn") : ""}
    <input id="rnote" placeholder="note (optional)" value="${esc(r?.note || "")}">
    <button class="btn sm" data-review="accept">accept</button>
    <button class="btn sm" data-review="flag">flag</button>
    <button class="btn sm" data-review="reject">reject</button>
    ${r ? `<button class="btn sm" data-review="clear">clear</button>` : ""}</div>`;

  el.innerHTML = `
    <h2>${esc(payload.id)} ${tag(accepted ? "ACCEPTED" : "REJECTED", accepted ? "ok" : "bad")}
      ${!accepted && d.reject_reason ? tag(d.reject_reason, "mute") : ""}</h2>
    <div class="chain">${tools.map(x => `<span class="step">${esc(x)}</span>`)
      .join('<span class="arrow">&rarr;</span>')}</div>
    <dl class="kv">${kv}</dl>${reviewBar}
    <h4 class="blk">Conversation</h4>${(t.events || []).map(turnHtml).join("")}
    <h4 class="blk">Conversation IR - what logically happens</h4>${irTable}
    ${findingsTable}${repairs}${verifier}${prompt}${schemas}`;

  el.querySelectorAll("[data-review]").forEach(b => b.addEventListener("click", async () => {
    try {
      await api.review(payload.id, { verdict: b.dataset.review,
                                     note: document.getElementById("rnote").value });
      toast(`Recorded: ${b.dataset.review}`, "ok");
      load(parse().params);
    } catch (e) { toast(`Could not record: ${e.message}`, "bad"); }
  }));
}

async function load(params) {
  const filters = filtersFrom(params);
  const query = { ...filters, limit: params.limit || 50,
                  offset: +(params.offset || 0), sort: params.sort || "mixed" };
  inflight?.abort();
  inflight = new AbortController();
  try {
    const [result, facets] = await Promise.all([
      api.traces(query, inflight.signal), api.facets(filters, inflight.signal)]);
    await capTree();
    renderRail(facets, params);
    renderList(result, params);
    document.getElementById("exportbtn").href = api.exportUrl(filters);
    const selected = params.trace || result.traces[0]?.id;
    if (!selected) {
      document.getElementById("detail").innerHTML = `<div class="empty">No trace selected.</div>`;
      return;
    }
    document.getElementById("detail").innerHTML = spinner(`Loading ${selected}`);
    renderDetail(await api.trace(selected));
  } catch (e) {
    if (e.name === "AbortError") return;
    document.getElementById("detail").innerHTML =
      `<div class="empty">${esc(e instanceof ApiError ? (e.detail || e.code) : e.message)}</div>`;
  }
}

export default {
  async render(params) {
    document.getElementById("app").innerHTML = `
      <div class="explorer">
        <div class="rail" id="rail"></div>
        <div>
          <div class="listhead"><span id="count"></span>
            <span class="end"><a class="btn sm" id="exportbtn" download>export JSONL</a></span>
          </div>
          <div class="list" id="list" role="listbox"></div>
          <div class="pager" id="pager"></div>
        </div>
        <div class="card detail" id="detail"></div>
      </div>`;
    // Bound to the freshly-built subtree, not to #app. #app outlives every
    // render, so a listener attached there accumulates one copy per navigation
    // and a facet click ends up toggling itself off again: the first copy sets
    // the filter, the second sees it already set and clears it.
    document.querySelector(".explorer").addEventListener("click", ev => {
      const opt = ev.target.closest("[data-facet]");
      if (opt) {
        const k = opt.dataset.facet;
        return patch({ [k]: parse().params[k] === opt.dataset.value ? "" : opt.dataset.value,
                       offset: 0 });
      }
      const row = ev.target.closest(".row");
      if (row) patch({ trace: row.dataset.id });
    });
    await load(params);
  },
  teardown() { inflight?.abort(); },
};
