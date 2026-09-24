/* Rendering helpers shared by every view. Small on purpose: enough to build
   markup safely and consistently, not a framework. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const LANG = { hi: "Hindi", ta: "Tamil", te: "Telugu", kn: "Kannada",
                      bn: "Bengali", mr: "Marathi", ml: "Malayalam",
                      gu: "Gujarati", en: "English" };
export const langName = c => LANG[c] || c || "—";
export const pretty = s => String(s ?? "").replace(/_/g, " ");
export const num = n => (n ?? 0).toLocaleString();

export const tag = (text, kind = "mute") =>
  `<span class="tag t-${kind}">${esc(text)}</span>`;

export function table(cols, rows, { empty = "" } = {}) {
  if (!rows.length) return empty ? `<div class="empty">${esc(empty)}</div>` : "";
  const head = cols.map(c => `<th>${esc(c)}</th>`).join("");
  const body = rows.map(r => `<tr>${r.map(cell => {
    const c = cell && typeof cell === "object" ? cell : { text: cell };
    return `<td class="${c.cls || ""}">${c.html ?? esc(c.text)}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody></table></div>`;
}

export function histogram(rows, { label = "value", max } = {}) {
  if (!rows.length) return "";
  const peak = max ?? Math.max(...rows.map(r => r.n));
  return table([label, "traces", ""], rows.map(r => [
    { cls: "num", text: r.v },
    { cls: "num", text: num(r.n) },
    { html: `<span class="bar" style="width:${Math.round(r.n / peak * 200)}px"></span>` },
  ]));
}

let toastTimer;
export function toast(message, kind = "") {
  const el = document.getElementById("toast");
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5600);
}

export const spinner = text => `<div class="empty"><span class="spinner"></span>${esc(text)}</div>`;

/** Character-level diff of what was said against what the recogniser produced. */
export function sttDiff(clean, heard, cleanSpan, badSpan) {
  if (cleanSpan && badSpan && clean.includes(cleanSpan)) {
    return `${esc(clean.split(cleanSpan)[0])}<del>${esc(cleanSpan)}</del>` +
           `<ins>${esc(badSpan)}</ins>${esc(clean.split(cleanSpan).slice(1).join(cleanSpan))}`;
  }
  return `<del>${esc(clean)}</del> <ins>${esc(heard)}</ins>`;
}
