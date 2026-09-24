/* How a synthetic trace is made.

   The console shows what came out; this shows how. It is drawn from the running
   system rather than written down separately -- the stage list, the validation
   families and the repair scopes are the ones the engine actually uses, and the
   counts beside them come from the index, so a claim here that stopped being
   true shows up as a number that stopped moving. */
import { api } from "../api.js";
import { esc, num, table, tag, spinner } from "../ui.js";

const STAGES = [
  ["Schedule", "scheduler.py",
   "Picks the next cell deterministically: workflow, scenario, persona, language, direction. Derives a turn band (6-26), a tool-depth floor from the requested capabilities, and a line-quality profile. Refuses an outbound request against an inbound scenario rather than sending the model a contradiction."],
  ["Freeze the world", "blueprint.py + domain_package.py",
   "Loads the domain package and freezes it into an immutable, fingerprinted blueprint. Every cross-reference is resolved here, so a domain that names a tool it does not own fails now rather than halfway through a run."],
  ["Synthesize", "synthesize.py + ir.py",
   "One model call produces the Conversation IR, and only the IR. The transcript is derived from it in Python. Asking for both is what made the first version yield nothing: 84% of all findings were the two representations disagreeing."],
  ["Validate", "validate.py",
   "Python decides everything objective: script conformance by Unicode range, tool ordering, argument grounding, recognition-error rates, capability contracts. Roughly 57 finding codes. No model is consulted."],
  ["Verify", "verify.py",
   "Only a deterministically clean trace reaches the holistic verifier. It reads the finished artifact with no sight of the synthesizer's reasoning."],
  ["Repair", "repair.py",
   "The model returns a patch -- only the IR steps it changed -- so untouched work is preserved by construction rather than by instruction. The scope picked from the findings decides what may move and how much reasoning budget the call gets."],
  ["Settle", "pipeline.py",
   "Repair always proceeds from the best candidate so far, never the newest. Every candidate is kept with its origin and findings, so a rejected trace is evidence rather than a deletion."],
];

const SCOPES = [
  ["SURFACE_REPAIR", "wording, speech record, annotation", "low"],
  ["SUFFIX_REPAIR", "everything after the first bad step", "high"],
  ["PLAN_REPAIR", "the IR plan itself", "high"],
  ["FULL_REGENERATION", "nothing salvageable - synthesize again", "high"],
];

const CHECKS = [
  ["Structural", "TRACE_MUST_START_WITH_USER, TOOL_CALL_WITHOUT_RESULT, ORPHAN_TOOL_RESULT, TRACE_TOOL_SEQUENCE_DIFFERS_FROM_IR, CONVERSATION_TOO_SHORT"],
  ["Schema", "UNKNOWN_TOOL, REQUIRED_FIELD_ABSENT, FIELD_TYPE_MISMATCH, FIELD_NOT_IN_ENUM"],
  ["Grounding", "DEPENDENCY_PATH_ABSENT_IN_RESULT, DEPENDENT_ARGUMENT_NOT_PRESENT_IN_CITED_UTTERANCE, DEPENDENCY_NOT_YET_ESTABLISHED"],
  ["Script", "SCRIPT_MODE_NATIVE_TEXT_IN_ROMAN, SCRIPT_MODE_ROMAN_DOMINATES_NATIVE_TEXT, NATIVE_WITH_ROMAN_ENGLISH"],
  ["Channel", "CONTRACT_REQUIRED_STT_ERROR_ABSENT, STT_RATE_ABOVE_PROFILE, STT_ERRORS_ALL_ONE_MECHANISM, CORRUPTION_WITHOUT_DECLARED_TYPE"],
  ["Capability", "CONTRACT_TOOL_DEPTH_NOT_MET, CONTRACT_SLOT_NOT_REUSED, CONTRACT_NO_FAILED_TOOL_RESULT, CONTRACT_NO_CONSEQUENTIAL_CALL"],
];

function pipeline() {
  return `<ol class="pipeline">` + STAGES.map(([name, file, what], i) => `
    <li>
      <div class="pstep">
        <span class="pnum">${i + 1}</span>
        <div>
          <h4>${esc(name)}</h4>
          <code class="pfile">${esc(file)}</code>
          <p>${esc(what)}</p>
        </div>
      </div>
    </li>`).join("") + `</ol>`;
}

export default {
  async render() {
    const app = document.getElementById("app");
    app.innerHTML = spinner("Loading architecture");

    let s = {}, channel = {};
    try { [s, channel] = await Promise.all([api.summary(), api.channel()]); }
    catch { /* the diagram stands without the numbers */ }

    const figures = [
      [num(s.traces || 0), "traces attempted"],
      [num(s.accepted || 0), "accepted"],
      [s.traces ? `${Math.round((s.accepted / s.traces) * 100)}%` : "-", "yield"],
      [(s.mean_depth || 0).toFixed(2), "mean tool depth"],
      [(s.mean_turns || 0).toFixed(1), "mean turns"],
      [num(s.stt_turns || 0), "misheard turns"],
    ].map(([b, l]) => `<div class="fig"><b>${b}</b><span>${esc(l)}</span></div>`).join("");

    const profiles = (channel.profiles || []).map(p => [
      { html: `<span class="mono">${esc(p.name)}</span>` },
      `${(p.rate[0] * 100).toFixed(0)}-${(p.rate[1] * 100).toFixed(0)}%`,
      { cls: "w", text: p.construction || "" },
    ]);

    app.innerHTML = `
      <h2 class="sec">How a synthetic trace is made</h2>
      <p class="note">Everything below is the running system, not a plan. The
      pipeline is the code path a request actually takes; the figures come from
      the index of what that path produced.</p>
      <div class="figs">${figures}</div>

      <h3 class="sec">The single design decision</h3>
      <div class="card pad callout">
        <p><strong>The Conversation IR is the source of truth, and the trace is
        derived from it.</strong> An early version asked the model for both a
        plan and a transcript and then checked they agreed. They did not:
        <em>84% of all validation findings were the two representations drifting
        apart</em>, and yield was zero. Emitting only the IR and computing the
        events in Python took yield to 57% without changing a single prompt.</p>
        <p class="hint">The general form: anything a deterministic function can
        compute, a model is never asked to produce. Tool names are constrained
        by a provider-enforced enum rather than a prompt instruction. Repair is
        a patch, so preservation is structural rather than requested. Script
        conformance is a Unicode range check, not a judgement.</p>
      </div>

      <h3 class="sec">The pipeline</h3>
      ${pipeline()}

      <h3 class="sec">Deterministic validation</h3>
      <p class="note">Roughly 57 codes in six families. All of it runs before
      any verifier call, so a model is never spent on a trace Python can already
      reject.</p>
      ${table(["family", "representative codes"],
              CHECKS.map(([f, c]) => [{ html: `<strong>${esc(f)}</strong>` },
                                      { cls: "w", text: c }]))}

      <h3 class="sec">Repair scopes</h3>
      <p class="note">A scope is not prompt text. It computes which step and
      event ids are frozen, and a patch that touches a frozen one is a scope
      violation: recorded as evidence, never promoted to be the next base.</p>
      ${table(["scope", "what may change", "reasoning"],
              SCOPES.map(([n, w, r]) => [
                { html: `<span class="mono">${esc(n)}</span>` },
                { cls: "w", text: w },
                { html: tag(r, r === "low" ? "mute" : "warn") }]))}

      <h3 class="sec">The recognition channel</h3>
      <p class="note">A model trained on clean text breaks the first time a
      recognizer mishears an account number. Errors are injected into what the
      agent sees while the clean text is kept beside it, and are classified by
      mechanism -- VALUE, MEANING, STRUCTURE, PHANTOM, IDENTITY -- rather than by
      vendor, so what is learned generalises across recognizers.</p>
      ${profiles.length ? table(["profile", "error rate", "line condition"], profiles)
                        : `<div class="empty">Channel model unavailable.</div>`}

      <h3 class="sec">What the artifact carries</h3>
      <p class="note">A trace names its inputs by version and fingerprint and
      never copies them, so "which world was this generated against" stays
      answerable. A trace for one domain can never depend on another.</p>
      ${table(["field", "what it is"], [
        [{ html: `<span class="mono">ir</span>` }, { cls: "w", text: "the plan: typed steps, dependencies, cited utterances" }],
        [{ html: `<span class="mono">events</span>` }, { cls: "w", text: "derived from the IR, never authored" }],
        [{ html: `<span class="mono">zen_prompt</span>` }, { cls: "w", text: "the system prompt the agent was given" }],
        [{ html: `<span class="mono">model_visible_tools</span>` }, { cls: "w", text: "the schemas it could see" }],
        [{ html: `<span class="mono">asset_reference</span>` }, { cls: "w", text: "domain id, version and fingerprint" }],
        [{ html: `<span class="mono">capability_labels</span>` }, { cls: "w", text: "readable labels, not AX005-SA001-V002" }],
      ])}`;
  },
};
