/* Corpus overview: the figures a reader needs before they trust anything else,
   plus the distributions that say whether the corpus is varied or repetitive. */
import { api } from "../api.js";
import { esc, histogram, langName, num, pretty, table } from "../ui.js";

function crosstabTable(ct) {
  const rows = Object.keys(ct.grid).sort();
  const cols = [...new Set(rows.flatMap(r => Object.keys(ct.grid[r])))].sort();
  const head = [pretty(ct.rows), ...cols.map(c => ct.cols === "lang" ? langName(c) : pretty(c)), "total"];
  const body = rows.map(r => {
    const cells = cols.map(c => ({ cls: "num", text: ct.grid[r][c] || "·" }));
    const total = cols.reduce((a, c) => a + (ct.grid[r][c] || 0), 0);
    return [pretty(r), ...cells, { cls: "num", html: `<b>${num(total)}</b>` }];
  });
  return table(head, body);
}

export default {
  async render() {
    const app = document.getElementById("app");
    app.innerHTML = `<div class="empty"><span class="spinner"></span>Loading corpus</div>`;
    const [s, ct, channel] = await Promise.all([
      api.summary(), api.crosstab("domain", "lang"), api.channel()]);

    const figures = [
      [num(s.accepted), "accepted traces"],
      [num(s.traces - s.accepted), "rejected, kept as evidence"],
      [num(s.domains), "domains"],
      [num(s.languages), "languages"],
      [num(s.workflows), "workflows"],
      [s.mean_depth.toFixed(2), "mean tool depth"],
      [s.mean_turns.toFixed(1), "mean turns"],
      [num(s.stt_turns), "misheard turns"],
      [num(s.calls), "model calls"],
    ].map(([b, l]) => `<div class="fig"><b>${b}</b><span>${esc(l)}</span></div>`).join("");

    const profiles = (channel.profiles || []).map(p => [
      { html: `<span class="mono">${esc(p.name)}</span>` },
      `${(p.rate[0] * 100).toFixed(0)}-${(p.rate[1] * 100).toFixed(0)}%`,
      { cls: "num", text: p.types.length },
      { cls: "w", text: p.construction },
    ]);

    app.innerHTML = `
      <h2 class="sec">Corpus</h2>
      <p class="note">Every trace here was generated against a versioned domain package,
      cleared deterministic validation, and was judged by an independent verifier that
      had to cite the events supporting its judgement. Rejected traces are kept: a
      rejection is evidence about the generator, not waste.</p>
      <div class="figures">${figures}</div>

      <h2 class="sec">Coverage</h2>
      <p class="note">Accepted traces by domain and language. Every conversation is
      written in its language's own script, with English and domain terms left in Roman
      as people actually speak; script conformance is checked deterministically rather
      than left to a model's judgement.</p>
      ${crosstabTable(ct)}

      <h2 class="sec">Conversation shape</h2>
      <p class="note">Turn count and tool depth are scheduled per request, not left to
      the generator's preference, so the corpus spans short informational calls and long
      multi-step ones instead of clustering.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
        <div><h4 class="blk">spoken turns</h4>${histogram(s.turn_hist, { label: "turns" })}</div>
        <div><h4 class="blk">tool calls</h4>${histogram(s.depth_hist, { label: "calls" })}</div>
        <div><h4 class="blk">repairs before acceptance</h4>
          ${histogram(s.repair_hist, { label: "repairs" })}</div>
      </div>

      <h2 class="sec">Recognition channel</h2>
      <p class="note">Errors are defined by what they do to a turn, never by vendor: the
      agent never observes the recogniser, only its effect on the text. Roughly
      ${((channel.expected_rate || 0) * 100).toFixed(0)}% of customer turns carry a
      recognition error across the corpus, which leaves most turns clean so a model
      learns when to doubt rather than to doubt always.</p>
      ${table(["archetype", "turns affected", "error types", "how it is built"], profiles)}
      <h4 class="blk">mechanisms</h4>
      ${table(["mechanism", "error types"],
        Object.entries(channel.mechanisms || {}).map(([m, t]) =>
          [{ html: `<span class="mono">${esc(m)}</span>` },
           { cls: "w", html: t.map(x => `<code>${esc(x)}</code>`).join(" ") }]))}`;
  },
};
