"use strict";

// ---------------------------------------------------------------- utils
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fold = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d);
const route = key => "#/p/" + encodeURIComponent(key);
// decodeURIComponent throws on a malformed "%" sequence (a mistyped or cut-off link): keep such a part as typed
const decodePart = x => { try { return decodeURIComponent(x); } catch (e) { return x; } };
const stars = ability => {
  const n = Math.max(0, Math.min(5, Math.round(ability / 40)));
  return `<span class="stars" title="Scout-report stars ≈ round(ability / 40)">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span>`;
};
const ordinal = n => n == null ? "–" : n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

function hexToRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
function mix(a, b, t) { return a.map((x, i) => Math.round(x + (b[i] - x) * t)); }
/* Diverging percentile colour: red (low) -> neutral grey (50) -> blue (high). */
function pctColor(p) {
  if (p == null) return { bg: css("--surface-2"), fg: css("--muted") };
  const neg = hexToRgb(css("--neg")), mid = hexToRgb(css("--mid")), pos = hexToRgb(css("--pos"));
  const t = Math.abs(p - 50) / 50;
  const rgb = p >= 50 ? mix(mid, pos, t) : mix(mid, neg, t);
  // ink with the better WCAG contrast against the fill (relative luminance of sRGB)
  const L = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  return { bg: `rgb(${rgb})`, fg: 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0545 ? "#ffffff" : "#0b0b0b" };
}

function addMonths(iso, m) {
  const d = new Date(iso + "T00:00:00");
  const whole = Math.floor(m);
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round((m - whole) * 30.44));
  return d;
}
const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5 / 30.44;
// one formatter for every date (toLocaleDateString with options builds a new one per call: ~1 s on How it works)
const DATE_FMT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const fmtDate = d => { d = d instanceof Date ? d : new Date(d + "T00:00:00"); return Number.isNaN(+d) ? "Invalid Date" : DATE_FMT.format(d); };
