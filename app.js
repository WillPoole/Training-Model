/* EHM Player Cards: static site over data/ehm_data.js (built by build_data.py). */
"use strict";

const D = window.EHM_DATA;
if (!D) {   // everything below reads the data at load: say so and stop
  document.getElementById("view").innerHTML = `<div class="wrap page"><div class="panel">No data found. Run <code>python build_data.py</code> in the website folder first.</div></div>`;
  throw new Error("data/ehm_data.js is missing");
}
// History rows that repeat the previous row's attributes arrive as [snapshot, est CA] (build_data.compact_history):
// expand them here, before anything reads p.h, so every page sees full rows as before.
for (const p of D.players) {
  let prev = null;
  p.h = (p.h || []).map(r => (prev = r.length > 2 || !prev ? r : [r[0], r[1], ...prev.slice(2)]));
}
const MY_TEAM = D.myTeam || "Montréal";  // the user's club (build_data --my-team): default side in head to head / trades
const RIVAL = MY_TEAM === "Toronto" ? "Montréal" : "Toronto";
// every file:// page shares one localStorage: keep a league's own settings (cap, home team) apart
const storeKey = k => D.siteKey ? `${k}-${D.siteKey}` : k;
const view = document.getElementById("view");
const tip = document.getElementById("tip");
const byKey = new Map();
const ALUMNI = new Map();   // players who left the data: a former-player page (renderFormer), no card
const hasPage = k => byKey.has(k) || ALUMNI.has(k);
const COMP_LABELS = {
  impact: "Overall impact", offence: "Offence", playmaking: "Playmaking", finishing: "Finishing",
  defence: "Defence", usage: "Usage", discipline: "Discipline",
};
const TIP_PCT = "Percentile within the comparison pool: 50 = median, 90 = better than 90%.";

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

// ---------------------------------------------------------------- projection
/* p.nr = est CA after 1, 2 ... months: the near-term forecast models' path, then the long-range model's (up to ~5
   years, build_data.long_paths); after that, monthly dCA = a(age)*(PA-CA) + b(age). The 80% band is the long-range
   model's 10th/90th percentiles (p.nq) while it lasts, then the PA band's lines plus the growth curve's noise. */
function growthAt(age, grp) {
  const g = D.growth, c = grp === "G" && g.G ? g.G : g;
  const i = Math.max(0, Math.min(g.ages.length - 1, Math.floor(age) - g.ages[0]));
  return { a: c.a[i], b: c.b[i], noise: c.noise[i] };
}
function ageAt(p, iso) {
  return p.dob ? (new Date(iso) - new Date(p.dob)) / 864e5 / 365.25 : p.age;
}
let PROJ_DATES = null;   // the projection's month dates: the same for every player (none of them is ever modified)
function project(p) {
  const last = D.dates[D.dates.length - 1];
  const dates = PROJ_DATES ||= Array.from({ length: D.projectionMonths + 1 }, (_, m) => addMonths(last, m));
  const age0 = ageAt(p, last);
  const near = p.nr || [];
  // nq = [[month, below, above], ...]: the 80% range around the path from the long-range model (build_data.long_paths),
  // linear between its months; past its last month the PA-band lines and the growth noise take over from its edges.
  const nq = p.nq || [], qEnd = nq.length ? nq.at(-1)[0] : -1;
  const band = m => {
    if (m <= nq[0][0]) return [nq[0][1], nq[0][2]];
    for (let i = 1; i < nq.length; i++) if (m <= nq[i][0]) {
      const a = nq[i - 1], b = nq[i], f = (m - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    return [nq.at(-1)[1], nq.at(-1)[2]];
  };
  const out = [];
  let mid = p.ca, lo = p.ca, hi = p.ca, noiseVar = 0;
  for (let m = 0; m <= D.projectionMonths; m++) {
    const age = age0 + m / 12;
    if (m <= qEnd) {
      const [below, above] = band(m);
      out.push({ m, date: dates[m], age, mid, lo: Math.max(1, mid - below), hi: Math.min(200, mid + above) });
    } else {
      out.push({ m, date: dates[m], age, mid, lo: Math.max(1, lo - 1.28 * Math.sqrt(noiseVar)),
                 hi: Math.min(Math.max(p.pa_hi, hi), hi + 1.28 * Math.sqrt(noiseVar)) });
    }
    const g = growthAt(age, p.grp);
    if (m < near.length) {          // near-term path: all three lines move with it
      const step = near[m] - mid;
      mid += step; lo += step; hi += step;
    } else {
      // Once the age effect is negative (from 24 on), room to grow can slow the decline but not reverse
      // it (in the training save, players past ~29 declined on average whatever their PA gap).
      // Below 24 a negative b is just noise around growth (ages 18-19), so the gap term still works.
      const curve = (ca, pa) => g.b < 0 && age >= D.declineAge ? Math.min(0, g.a * (pa - ca) + g.b) : g.a * (pa - ca) + g.b;
      // EHM never lets CA exceed PA, so each line is capped at its PA estimate.
      mid = Math.min(Math.max(p.pa, mid), Math.max(1, mid + curve(mid, p.pa)));
      lo = Math.min(Math.max(p.pa_lo, lo), Math.max(1, lo + curve(lo, p.pa_lo)));
      hi = Math.min(Math.max(p.pa_hi, hi), Math.max(1, hi + curve(hi, p.pa_hi)));
    }
    if (m + 1 <= qEnd) {  // inside the band: the lines restart from its edges at its last month
      noiseVar = 0;
      if (m + 1 === qEnd) { const [below, above] = band(qEnd); lo = mid - below; hi = mid + above; }
    } else noiseVar += g.noise ** 2;
  }
  return out;
}

// ---------------------------------------------------------------- search
const q = document.getElementById("q"), sug = document.getElementById("suggest");
let sugIdx = -1;
function renderSuggest() {
  const terms = fold(q.value).split(/\s+/).filter(Boolean);
  if (!terms.length) { sug.hidden = true; return; }
  const hits = D.players.filter(p => terms.every(t => p._n.includes(t)))
    .sort((a, b) => b.ca - a.ca).slice(0, 12);
  sugIdx = -1;
  sug.innerHTML = hits.length ? hits.map(p =>
    `<li data-k="${esc(p.k)}"><span>${esc(p.n)} <span class="muted small">${esc(p.pos)} · ${p.age}</span></span>
     <span class="muted small">${esc(p.cl || p.tm)} · ${esc(p.lg)}</span></li>`).join("")
    : `<li class="muted">No players match</li>`;
  sug.hidden = false;
}
q.addEventListener("input", renderSuggest);
q.addEventListener("keydown", e => {
  const items = [...sug.querySelectorAll("li[data-k]")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("on", i === sugIdx));
  } else if (e.key === "Enter" && items.length) {
    location.hash = route(items[Math.max(0, sugIdx)].dataset.k);
    sug.hidden = true; q.blur();
  } else if (e.key === "Escape") sug.hidden = true;
});
sug.addEventListener("mousedown", e => {
  const li = e.target.closest("li[data-k]");
  if (li) { location.hash = route(li.dataset.k); sug.hidden = true; }
});
q.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 150));

// ---------------------------------------------------------------- theme
document.getElementById("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("ehm-theme", root.dataset.theme); } catch (e) { /* storage blocked */ }
  rerenderInPlace();
});
/* Re-render the page for a theme change (charts, logos and heat maps bake their colours in) without jumping to the top. */
function rerenderInPlace() {
  const y = scrollY;
  keepScroll = true;
  render();
  scrollTo(0, y);
}
// following the OS theme (nothing stored): redraw when it changes
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!document.documentElement.dataset.theme) rerenderInPlace(); });
try { const t = localStorage.getItem("ehm-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- teams, logos, navigation
const teamRoute = club => "#/team/" + encodeURIComponent(club);
const clubOf = p => p.cl || p.tm || "";
/* Every player row in every list opens the player through here. */
function playerRow(tr) { location.hash = route(tr.dataset.k); }
/* Scroll to a section, first opening the tab that holds it. */
function reveal(el) {
  const pane = el?.closest(".tabpane");
  if (pane?.hidden) view.querySelector(`.ptabs [data-tab="${pane.dataset.tab}"]`)?.click();
  el?.scrollIntoView({ behavior: "smooth" });
}
/* NHL clubs: official logo code and team colours. Logos load from the NHL's image server; offline (or for
   any other club) a badge in the team's colours stands in. */
const NHL_TEAMS = {
  "Anaheim": ["ANA", "#F47A38", "#111111"], "Boston": ["BOS", "#FFB81C", "#111111"], "Buffalo": ["BUF", "#003087", "#FFFFFF"],
  "Calgary": ["CGY", "#C8102E", "#FFFFFF"], "Carolina": ["CAR", "#CE1126", "#FFFFFF"], "Chicago": ["CHI", "#CF0A2C", "#FFFFFF"],
  "Colorado": ["COL", "#6F263D", "#FFFFFF"], "Columbus": ["CBJ", "#002654", "#FFFFFF"], "Dallas": ["DAL", "#006847", "#FFFFFF"],
  "Detroit": ["DET", "#CE1126", "#FFFFFF"], "Edmonton": ["EDM", "#041E42", "#FF4C00"], "Florida": ["FLA", "#C8102E", "#FFFFFF"],
  "Los Angeles": ["LAK", "#111111", "#FFFFFF"], "Minnesota": ["MIN", "#154734", "#FFFFFF"], "Montréal": ["MTL", "#AF1E2D", "#FFFFFF"],
  "NY Islanders": ["NYI", "#00539B", "#FFFFFF"], "NY Rangers": ["NYR", "#0038A8", "#FFFFFF"], "Nashville": ["NSH", "#FFB81C", "#041E42"],
  "New Jersey": ["NJD", "#CE1126", "#FFFFFF"], "Ottawa": ["OTT", "#C52032", "#FFFFFF"], "Philadelphia": ["PHI", "#F74902", "#111111"],
  "Pittsburgh": ["PIT", "#111111", "#FCB514"], "San Jose": ["SJS", "#006D75", "#FFFFFF"], "Seattle": ["SEA", "#001628", "#99D9D9"],
  "St. Louis": ["STL", "#002F87", "#FCB514"], "Tampa Bay": ["TBL", "#002868", "#FFFFFF"], "Toronto": ["TOR", "#00205B", "#FFFFFF"],
  "Utah": ["UTA", "#111111", "#6CACE4"], "Vancouver": ["VAN", "#00205B", "#FFFFFF"], "Vegas": ["VGK", "#B4975A", "#111111"],
  "Washington": ["WSH", "#C8102E", "#FFFFFF"], "Winnipeg": ["WPG", "#041E42", "#FFFFFF"],
};
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
/* Every other club's logo was downloaded once into logos/ next to this file (fetch_logos.py writes logos/logos.js,
   club name -> file); the SHA site loads app.js from ../website/, so the folder is found from this script's own URL. */
const LOGOS = window.EHM_LOGOS || {};
const LOGO_BASE = (document.currentScript?.src || "").replace(/[^/]*$/, "") + "logos/";
function logo(club, size = 28) {
  const t = NHL_TEAMS[club], file = t ? null : LOGOS[club];
  const abbr = t ? t[0] : (String(club || "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "–");
  const badge = `<b style="background:${t ? t[1] : "var(--surface-2)"};color:${t ? t[2] : "var(--ink-2)"}">${esc(abbr)}</b>`;
  const src = t ? `https://assets.nhle.com/logos/nhl/svg/${t[0]}_${isDark() ? "dark" : "light"}.svg` : file ? LOGO_BASE + encodeURIComponent(file) : "";
  const img = src ? `<img src="${src}" alt="" loading="lazy">` : "";   // a failed load shows the badge (listener below)
  return `<span class="logo${src ? "" : " nologo"}${file ? " local" : ""}" style="--s:${size}px" role="img" aria-label="${esc(club || "no club")}" title="${esc(club || "")}">${img}${badge}</span>`;
}
// a logo image that fails to load (offline, a missing file) falls back to its badge; error events don't bubble, so capture
document.addEventListener("error", e => { const t = e.target; if (t.tagName === "IMG" && t.parentNode?.classList?.contains("logo")) t.parentNode.classList.add("nologo"); }, true);
// the filter bars are forms (Enter in a box would submit and reload the page): never submit them
view.addEventListener("submit", e => { if (e.target.matches("form.filters")) e.preventDefault(); });
/* Club links: only to clubs that have a team page (players in the latest snapshot), so a club that has gone from the
   data, or an abbreviation clubOfAbbr couldn't resolve, stays plain text instead of a dead link. */
let CLUBS = null;
const hasClub = c => !!c && (CLUBS ||= new Set(D.players.map(clubOf).filter(Boolean))).has(c);
// a logo that opens the club's team page (only where it isn't already inside another link)
const teamLogo = (club, size) => hasClub(club) ? `<a class="logo-link" href="${teamRoute(club)}" title="${esc(club)}">${logo(club, size)}</a>` : logo(club, size);
// html that opens one of the club's team tabs ("/drafts"), plain where the club has no team page (another save's league)
const clubLink = (club, tab, inner, cls = "") => hasClub(club) ? `<a${cls ? ` class="${cls}"` : ""} href="${teamRoute(club)}${tab}">${inner}</a>` : inner;
// a club name (or any html) that opens the club's team page
const tlink = (club, inner = esc(club)) => hasClub(club) ? `<a class="tname" href="${teamRoute(club)}">${inner}</a>` : inner;
// a club's small logo and name, opening its team page (where no logo is shown beside the name already)
const tname = (club, size = 16) => club ? tlink(club, `<span class="tn">${logo(club, size)} ${esc(club)}</span>`) : "";
// the same from a box-score abbreviation (MTL), shown as the abbreviation unless told otherwise
const alink = (abbr, inner = esc(abbr)) => tlink(clubOfAbbr(abbr), inner);
const nhlClubs = () => Object.keys(NHL_TEAMS).filter(c => D.players.some(p => clubOf(p) === c && p.lg === "NHL"))
  .sort((a, b) => a.localeCompare(b));
const abbrOf = club => (D.clubAbbr || {})[club];
const clubOfAbbr = abbr => Object.keys(D.clubAbbr || {}).find(c => D.clubAbbr[c] === abbr) || abbr;
const signed = (v, d = 1) => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const money = v => v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v).toLocaleString();
const salaryNum = s => { const m = String(s || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : 0; };
const dash = '<span class="muted">–</span>';
// an impact percentile; with an href (pRankHref) it opens the full ranking (site rule: every rank / percentile links)
const impPill = (v, href) => {
  if (v == null) return dash;
  const c = pctColor(v), pill = `<span class="pill" style="background:${c.bg};color:${c.fg}">${v}</span>`;
  return href ? rankLink(href, pill) : pill;
};
const rankChip = (rank, n = 32, href) => {
  if (rank == null) return dash;
  const chip = `<span class="rank r${rank <= n / 4 ? 1 : rank <= n / 2 ? 2 : rank <= 3 * n / 4 ? 3 : 4}">${ordinal(rank)}</span>`;
  return href ? `<a class="ranklink" href="${href}">${chip}</a>` : chip;
};
/* A row of section tabs (team, draft, prospects, playoffs pages): buttons with data-tab, wired by the page, which
   changes the URL. Arrow keys move between them (the document-level handler below). */
const tabBar = (label, tabs, cur, attr = "data-tab") => `<div class="ptabs" role="tablist" aria-label="${esc(label)}">${tabs.map(([k, t]) =>
  `<button type="button" role="tab" ${attr}="${k}" class="${cur === k ? "on" : ""}" aria-selected="${cur === k}" tabindex="${cur === k ? 0 : -1}">${esc(t)}</button>`).join("")}</div>`;
document.addEventListener("keydown", e => {
  const b = e.target.closest?.('[role="tablist"] [role="tab"]');
  if (!b || e.defaultPrevented || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const all = [...b.parentNode.querySelectorAll('[role="tab"]')], i = all.indexOf(b);
  const j = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length;
  e.preventDefault();
  FOCUS_TAB = [...all[j].attributes].find(a => a.name.startsWith("data-"))?.value ?? null;
  all[j].click();
  all[j].focus();
});
let FOCUS_TAB = null;   // after an arrow key re-renders the page, focus the tab it moved to
/* The page header shows the current section. */
function markNav(section) {
  document.querySelectorAll(".top nav a, .site-foot a[data-nav]").forEach(a => {
    const on = a.dataset.nav === section;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // the Tools menu button is lit while one of its pages is open
  const menu = document.querySelector(".navmenu-btn");
  if (menu) menu.classList.toggle("on", !!document.querySelector(`.navmenu-list a[data-nav="${section}"]`));
  setNavMenu(false);
}
/* Header Tools menu (Head to head, Trade predictor): a button and a list, closed by a click elsewhere or Escape.
   On narrow screens the list's links sit in the scrolling nav row instead (styles.css). */
function setNavMenu(open) {
  const b = document.querySelector(".navmenu-btn");
  if (!b) return;
  b.setAttribute("aria-expanded", open);
  b.parentNode.classList.toggle("open", open);
}
document.querySelector(".navmenu-btn")?.addEventListener("click", e => {
  e.stopPropagation();
  setNavMenu(e.currentTarget.getAttribute("aria-expanded") !== "true");
});
document.addEventListener("click", e => { if (!e.target.closest(".navmenu")) setNavMenu(false); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.querySelector(".navmenu.open")) { setNavMenu(false); document.querySelector(".navmenu-btn").focus(); }
});
/* Segmented controls (.seg) are toggle buttons: keep aria-pressed in step with the "on" class, whichever page code sets it. */
{
  const set = b => b.setAttribute("aria-pressed", b.classList.contains("on"));
  new MutationObserver(ms => ms.forEach(m => {
    if (m.type === "attributes") { if (m.target.matches(".seg button")) set(m.target); return; }
    m.addedNodes.forEach(n => { if (n.nodeType === 1) (n.matches(".seg button") ? [n] : n.querySelectorAll(".seg button")).forEach(set); });
  })).observe(view, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
}
/* A table wider than its box scrolls sideways; make such a box focusable so arrow keys can scroll it. */
{
  const mark = () => view.querySelectorAll(".tablewrap:not([tabindex])").forEach(w => {
    if (w.scrollWidth > w.clientWidth + 2) { w.tabIndex = 0; w.setAttribute("role", "region"); w.setAttribute("aria-label", "Table, scrolls sideways"); }
  });
  let t = 0;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(mark, 100); }).observe(view, { childList: true, subtree: true });
}
/* Sticky things below the header (player fact box, How it works contents, scroll targets) sit under its real
   height, which changes when it wraps onto two rows. */
{
  const top = document.querySelector(".top");
  const setH = () => document.documentElement.style.setProperty("--header-h", top.offsetHeight + "px");
  if (top) { setH(); if (window.ResizeObserver) new ResizeObserver(setH).observe(top); }
}
/* Snapshots come at irregular intervals (a few days to weeks), and over a few days the est. CA moves
   less than its own noise, so "moves" compare the latest snapshot with the latest one at least
   MOVE_DAYS earlier (the previous month on monthly snapshots), or the first one while the history is
   shorter. Index into D.dates, or null with a single snapshot. */
const MOVE_DAYS = 28;
function moveBase() {
  const n = D.dates.length;
  if (n < 2) return null;
  const cut = new Date(D.dates[n - 1] + "T00:00:00") - MOVE_DAYS * 864e5;
  let i = 0;
  D.dates.forEach((d, j) => { if (j < n - 1 && new Date(d + "T00:00:00") <= cut) i = j; });
  return i;
}
const MOVE_BASE = moveBase();
/* Change in est. CA since the MOVE_BASE snapshot (his last one on or before it, if that crawl missed him;
   he must be in the latest snapshot). */
function lastMove(p) {
  // only players in both snapshots: one missing from the base one (unattached for years) would compare across that gap
  const b = p.h.at(-1), a = p.h.find(h => h[0] === MOVE_BASE);
  if (MOVE_BASE == null || !a || b[0] !== D.dates.length - 1) return null;
  return b[1] - a[1];
}

// ---------------------------------------------------------------- players (rankings)
const R = { lg: "NHL", grp: "", team: "", maxAge: "", sort: "ca", dir: -1, limit: 100 };
const RCOLS = [
  ["n", "Player", false], ["pos", "Pos", false], ["age", "Age", true], ["cl", "Club", false], ["lg", "League", false],
  ["ca", "Est. CA", true], ["pa", "Est. PA", true], ["peak", "Proj. peak", true], ["war", "WAR", true],
  ["imp", "NHL impact", true],
];
const RCELL = {
  n: p => `<th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}">${logo(clubOf(p), 26)}<span><b>${esc(p.n)}</b></span></a></th>`,
  pos: p => `<td>${esc(p.pos)}</td>`,
  age: p => `<td class="num">${p.age}</td>`,
  cl: p => `<td>${clubOf(p) ? tname(clubOf(p)) : dash}</td>`,
  lg: p => `<td>${esc(p.lg || "")}</td>`,
  ca: p => `<td class="num"><b>${fmt(p.ca, 0)}</b> ${stars(p.ca)}</td>`,
  pa: p => `<td class="num">${fmt(p.pa, 0)}</td>`,
  peak: p => `<td class="num">${fmt(sortVal(p, "peak"), 0)}</td>`,
  war: p => `<td class="num">${p.war ? fmt(p.war.war, 1) : dash}</td>`,
  imp: p => `<td class="num">${impPill(p.card?.comp?.impact, pRankHref("c", "impact", p.grp, p.k))}</td>`,
};
function sortVal(p, k) {
  if (k === "imp") return p.card?.comp?.impact ?? -1;
  if (k === "war") return p.war?.war ?? -99;
  if (k === "peak") return p._peak ?? (p._peak = Math.max(...project(p).map(x => x.mid)));
  return p[k];
}
/* Regular season / playoffs switch for the WAR and impact columns. */
function rankRow(p) {
  if (PMODE !== "po") return p;
  return { ...p, card: { ...(p.po?.card || {}), ca_pct: p.card?.ca_pct, pa_pct: p.card?.pa_pct }, war: p.po?.war || null };
}
let LEAGUE_N = null;   // players per league (D.players never changes, so they're counted once)
const leagueCount = lg => (LEAGUE_N ||= D.players.reduce((n, p) => n.set(p.lg, (n.get(p.lg) || 0) + 1), new Map())).get(lg) || 0;
const leagueList = () => (leagueCount(), [...LEAGUE_N.keys()].filter(Boolean).sort((a, b) => LEAGUE_N.get(b) - LEAGUE_N.get(a)));
/* A club's league: the one most of its players are in (a player on loan or national duty doesn't move his club). */
let CLUB_LG = null;
function clubLeague(club) {
  if (D.clubLeague?.[club]) return D.clubLeague[club];
  if (!CLUB_LG) {
    const n = {};
    D.players.forEach(p => { const c = clubOf(p); if (c && p.lg) (n[c] ||= {})[p.lg] = (n[c][p.lg] || 0) + 1; });
    CLUB_LG = Object.fromEntries(Object.entries(n).map(([c, m]) => [c, NHL_TEAMS[c] ? "NHL" : Object.entries(m).sort((a, b) => b[1] - a[1])[0][0]]));
  }
  return CLUB_LG[club] || "";
}
/* Club <option>s: the NHL teams first, then every other league's clubs (biggest league first), A-Z within each group;
   with a league chosen, only the clubs that have players in it. */
function clubOptions(sel, lg) {
  const clubs = [...new Set(D.players.filter(p => !lg || p.lg === lg).map(clubOf))].filter(Boolean);
  const order = ["NHL", ...leagueList().filter(l => l !== "NHL"), ""];
  const groups = {};
  clubs.forEach(c => (groups[clubLeague(c)] ||= []).push(c));
  return order.filter(l => groups[l]).map(l => `<optgroup label="${esc(l || "Other clubs")}">${groups[l].sort((a, b) => a.localeCompare(b))
    .map(c => `<option ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("")}</optgroup>`).join("");
}
function renderRankings() {
  markNav("players");
  const leagues = leagueList();
  const count = leagueCount;
  let rows = D.players.map(inSeason).map(rankRow).filter(p => (!R.lg || p.lg === R.lg) && (!R.grp || p.grp === R.grp)
    && (!R.team || clubOf(p) === R.team) && (!R.maxAge || p.age <= +R.maxAge));
  rows.sort((a, b) => {
    const x = sortVal(a, R.sort), y = sortVal(b, R.sort);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * R.dir;
  });
  const total = rows.length;
  rows = rows.slice(0, R.limit);
  view.innerHTML = `
  <section class="band"><div class="wrap">
    <h1>Players</h1>
    <p class="lede">${D.players.length.toLocaleString()} players · snapshot ${fmtDate(D.dates.at(-1))} · est. CA and PA come from visible attributes only (see <a href="#/about">How it works</a>)</p>
    <nav class="lgtabs" aria-label="Leagues">${[...leagues.filter(l => l === "NHL"), ...leagues.filter(l => l !== "NHL"), ""].map(l =>
      `<button type="button" data-lg="${esc(l)}" class="${l === R.lg ? "on" : ""}" aria-pressed="${l === R.lg}">${l ? esc(l) : "All leagues"}${l ? ` <span>${count(l)}</span>` : ""}</button>`).join("")}</nav>
    ${hasLeague(R.lg) ? `<p class="small"><a href="${leagueRoute(R.lg)}">${esc(R.lg)} league page: standings, stats, teams and prospects →</a></p>` : R.lg === "NHL" ? `<p class="small"><a href="#/teams">NHL teams and standings →</a></p>` : ""}
  </div></section>
  <div class="wrap page">
    <form class="filters card-box" aria-label="Filters">
      <fieldset><legend>Position</legend><div class="seg" id="f-grp">${[["", "All"], ["F", "Forwards"], ["D", "Defence"], ["G", "Goalies"]]
        .map(([v, t]) => `<button type="button" data-v="${v}" class="${v === R.grp ? "on" : ""}" aria-pressed="${v === R.grp}">${t}</button>`).join("")}</div></fieldset>
      <label>Club <select id="f-team"><option value="">All clubs</option>${clubOptions(R.team, R.lg)}</select></label>
      <label class="narrow">Max age <input id="f-age" type="number" min="15" max="45" placeholder="Any" value="${esc(R.maxAge)}"></label>
      ${seasonSelect("f-season")}
      <label>Games <select id="f-mode"><option value="rs" ${PMODE === "rs" ? "selected" : ""}>Regular season</option><option value="po" ${PMODE === "po" ? "selected" : ""}>Playoffs</option></select></label>
      <span class="count">${total.toLocaleString()} players</span>
    </form>
    <section class="card-box flush" aria-label="Player list">
      <div class="tablewrap"><table class="rank">
        <thead><tr><th class="num">#</th>${RCOLS.map(([k, t, n]) =>
          `<th class="sort ${n ? "num" : ""} ${k === "n" ? "pcol" : ""} ${R.sort === k ? "on" : ""}" data-k="${k}" aria-sort="${R.sort === k ? (R.dir < 0 ? "descending" : "ascending") : "none"}"><button type="button">${t}${R.sort === k ? (R.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead>
        <tbody>${rows.map((p, i) => `<tr class="link" data-k="${esc(p.k)}"><td class="num muted">${i + 1}</td>${RCOLS.map(([k]) => RCELL[k](p)).join("")}</tr>`).join("")}</tbody>
      </table></div>
      ${total > R.limit ? `<div class="more"><button class="ghost" id="more" type="button">Show more (${(total - R.limit).toLocaleString()} left)</button></div>` : ""}
    </section>
  </div>`;
  const rerender = () => { R.limit = 100; renderRankings(); };
  view.querySelectorAll(".lgtabs button").forEach(b => b.onclick = () => { R.lg = b.dataset.lg; R.team = ""; rerender(); });
  view.querySelectorAll("#f-grp button").forEach(b => b.onclick = () => { R.grp = b.dataset.v; rerender(); });
  view.querySelector("#f-team").onchange = e => { R.team = e.target.value; rerender(); };
  view.querySelector("#f-age").onchange = e => { R.maxAge = e.target.value; rerender(); };
  view.querySelector("#f-season").onchange = e => { SEASON = e.target.value; rerender(); };
  view.querySelector("#f-mode").onchange = e => { PMODE = e.target.value; rerender(); };
  view.querySelector("#more")?.addEventListener("click", () => { R.limit += 200; renderRankings(); });
  view.querySelectorAll("th.sort button").forEach(b => b.onclick = () => {
    const k = b.parentNode.dataset.k;
    R.dir = R.sort === k ? -R.dir : (["n", "pos", "cl", "lg"].includes(k) ? 1 : -1);
    R.sort = k; renderRankings();
  });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
}

// ---------------------------------------------------------------- seasons
/* NHL stats (card percentiles, WAR, shot maps, playoffs) exist per season. The latest season sits
   on the player itself, earlier ones in p.ss[season]. Ratings and attributes are always the latest. */
const SEASONS = (D.seasons || []).map(s => s.season);
let SEASON = D?.defaultSeason || SEASONS.at(-1) || null;
const seasonLabel = s => `20${s.slice(0, 2)}-${s.slice(3)}`;
function seasonInfo() {
  return (D.seasons || []).find(s => s.season === SEASON) || { games: D.games, gamesPO: D.gamesPO, warInfo: D.warInfo };
}
function inSeason(p) {
  if (!SEASON || SEASON === SEASONS.at(-1)) return p;
  const s = p.ss?.[SEASON];
  return { ...p, card: { ...(s?.card || {}), ca_pct: p.card?.ca_pct, pa_pct: p.card?.pa_pct }, war: s?.war || null,
           shots: s?.shots || [], sa: s?.sa || [], po: s?.po || null, _peak: p._peak };
}
function seasonSelect(id) {
  return `<label class="small muted">Season <select id="${id}" ${SEASONS.length > 1 ? "" : "disabled"}>
    ${SEASONS.slice().reverse().map(s => `<option value="${s}" ${s === SEASON ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}
  </select></label>`;
}

// ---------------------------------------------------------------- player page
function barRow(label, raw, pct, title, href) {   // href: the full ranking behind the percentile
  const c = pctColor(pct), tag = href && pct != null ? "a" : "div";
  return `<${tag} class="bar"${tag === "a" ? ` href="${href}"` : ""} title="${esc(title || TIP_PCT)}">
    <div class="l">${esc(label)}${raw != null ? `<span>${esc(raw)}</span>` : ""}</div>
    <div class="track"><div class="fill" style="width:${Math.max(2, pct ?? 0)}%;background:${c.bg}"></div></div>
    <div class="v">${pct ?? "–"}</div></${tag}>`;
}
function tile(label, pct, big, href) {
  const c = pctColor(pct), tag = href && pct != null ? "a" : "div";
  return `<${tag} class="tile ${big ? "big" : ""}"${tag === "a" ? ` href="${href}"` : ""} style="background:${c.bg};color:${c.fg}" title="${TIP_PCT}">
    <div class="t">${esc(label)}</div><div class="p">${pct ?? "–"}</div></${tag}>`;
}
function rawFmt(key, v) {
  if (v == null) return null;
  if (["toi_gp", "pp_toi", "pk_toi"].includes(key)) { const sec = Math.round(v * 60); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }
  if (key === "svp") return v.toFixed(3).replace(/^0/, "");
  return v.toFixed(2);
}

let PMODE = "rs";  // player page: regular season (rs) or playoffs (po)
/* Important Matches (big-game) range from the scout report snippets, if any phrase pins it down. */
function bigGame(p) {
  const r = (p.sc?.ranges || []).find(x => x[0] === "Important Matches");
  return r ? (r[1] === r[2] ? `${r[1]}` : `${r[1]}–${r[2]}`) : null;
}
/* Playoff performer: how much better (or worse) he plays in the playoffs than in the same season's regular season,
   in WAR per 82 games. Each season's playoff-minus-regular gap is weighted by its playoff games and by recency (x0.6 per
   season back), then pulled toward 0 for small samples: x GP / (GP + 20), GP = the weighted playoff games. Same-season
   comparison, so it measures the playoff lift, not how good he is. */
const PO_K = 20, PO_DECAY = 0.6;
function playoffForm(p) {
  const last = SEASONS.length - 1;
  let num = 0, den = 0, gp = 0, seasons = 0, rsW = 0, poW = 0;
  SEASONS.forEach((s, i) => {
    const cur = i === last;
    const rs = cur ? p.war : p.ss?.[s]?.war, po = cur ? p.po?.war : p.ss?.[s]?.po?.war;
    if (!rs?.gp || !po?.gp) return;
    const w = po.gp * Math.pow(PO_DECAY, last - i);
    num += w * (po.war / po.gp - rs.war / rs.gp) * 82; den += w; gp += po.gp; seasons++;
    rsW += w * rs.war / rs.gp * 82; poW += w * po.war / po.gp * 82;
  });
  if (!den) return null;
  return { delta: num / den * den / (den + PO_K), raw: num / den, gp, seasons, rs82: rsW / den, po82: poW / den };
}
let POF = null;   // every player's playoff form, for percentiles and the ranking
function playoffForms() {
  if (POF?.data === D) return POF.rows;
  const rows = D.players.map(p => ({ p, f: playoffForm(p) })).filter(x => x.f).sort((a, b) => b.f.delta - a.f.delta);
  rows.forEach((x, i) => { x.pct = Math.round(100 * (rows.length - 1 - i) / Math.max(1, rows.length - 1)); });
  POF = { data: D, rows };
  return rows;
}
function playoffHero(p0) {
  const hasNhl = p0.war || SEASONS.some(s => p0.ss?.[s]?.war);
  if (!hasNhl) return "";
  const f = playoffForm(p0), bg = bigGame(p0);
  if (!f) return `<div><div class="lab">Playoff performer</div><div class="val muted">–</div>
    <div class="note">No NHL playoff games yet${bg ? ` · big games ${bg}/20` : ""}</div></div>`;
  const pct = playoffForms().find(x => x.p.k === p0.k)?.pct;
  const label = f.delta >= 0.5 ? "Rises in the playoffs" : f.delta <= -0.5 ? "Fades in the playoffs" : "Same as the regular season";
  return `<div title="Playoff WAR per 82 minus the same seasons' regular-season WAR per 82, recent seasons weighted more, small samples pulled toward 0">
    <div class="lab">Playoff performer</div><div class="val ${f.delta >= 0.5 ? "up" : f.delta <= -0.5 ? "down" : ""}">${signed(f.delta, 1)}</div>
    <div class="note">${label} · WAR/82 · ${f.gp} playoff GP${f.seasons > 1 ? ` in ${f.seasons} seasons` : ""}${bg ? ` · big games ${bg}/20` : ""}
      ${pct != null ? ` · ${rankLink(pRankHref("po", "po", p0.grp, p0.k), `${ordinal(pct)} pct`)}` : ""}</div></div>`;
}
let PTAB = "overview";  // Prospect Profile layout: open tab
function renderPlayer(key, tab = "overview") {
  if (!byKey.get(key) && ALUMNI.has(key)) { renderFormer(ALUMNI.get(key)); return; }
  if (!byKey.get(key)) { markNav("players"); view.innerHTML = `<div class="wrap page"><div class="panel">Unknown player. <a href="#/players">All players</a></div></div>`; return; }
  const base = inSeason(byKey.get(key));
  const hasPO = !!base.po;
  const mode = PMODE === "po" && hasPO ? "po" : "rs";   // PMODE itself stays, for the next player and the list
  // playoff view: same page, with the box-score sections swapped for playoff games
  const p = mode === "po" ? { ...base, card: { ...base.po.card, ca_pct: base.card?.ca_pct, pa_pct: base.card?.pa_pct },
                               war: base.po.war, shots: base.po.shots, sa: base.po.sa, _po: true } : base;
  const G = p._po ? (seasonInfo().gamesPO || {}) : (seasonInfo().games || {});
  const proj = project(p);
  const peak = proj.reduce((a, b) => (b.mid > a.mid ? b : a));
  const card = p.card || {};
  const isG = p.grp === "G";
  const grpName = { F: "forwards", D: "defence", G: "goalies" }[p.grp];
  const first = p.h[0], last = p.h.at(-1);
  const caChange = p.h.length > 1 ? last[1] - first[1] : null;
  // the overview's change box: est. CA now vs his last snapshot at least 4 months (120 days) before the latest one,
  // else his first snapshot (newer players)
  const dayOf = i => new Date(D.dates[i] + "T00:00:00").getTime();
  const cutoff = dayOf(last[0]) - 120 * 864e5;
  const base4 = p.h.filter(h => dayOf(h[0]) <= cutoff).at(-1) || first;
  const recent = p.h.length > 1 && base4 !== last ? last[1] - base4[1] : null;
  const recentDays = Math.round((dayOf(last[0]) - dayOf(base4[0])) / 864e5);

  const comps = card.comp ? Object.keys(COMP_LABELS).filter(k => card.comp[k] != null) : [];
  const metricsDef = isG ? D.goalieMetrics : D.skaterMetrics;
  const metricRows = card.pct ? metricsDef.map(([k, label]) => barRow(label, rawFmt(k, card.raw?.[k]), card.pct[k], null, pRankHref("m", k, p.grp, p.k))).join("") : "";
  const t = card.totals;
  const tags = [seenText(p), p.sc?.role ? "Role: " + p.sc.role : null,
    bigGame(p) ? `Big games (Important Matches): ${bigGame(p)}/20` : (p._po ? "Big-game rating unknown (no scout phrase)" : null),
    p.pr ? [p.pr, prospectHref(p)] : null, p.dr ? [p.dr, /NHL/.test(p.dr) ? "#/draft" : null] : null, t ? `NHL: ${t.gp} GP · ${t.g} G · ${t.a} A · ${t.p} P` : null,
    p.dft?.pro?.pick != null ? [`Drafted ${p.dft.pro.year} · #${p.dft.pro.pick} overall`, draftHref(p.dft.pro)] : null,
    ...achTags(p)].filter(Boolean);
  const tagsHtml = tags.map(x => Array.isArray(x) && x[1] ? `<a class="tag" href="${x[1]}">${esc(x[0])}</a>` : `<span class="tag">${esc(Array.isArray(x) ? x[0] : x)}</span>`).join("");

  const S = {};
  S.controls = `
  <div class="cardbar">
    ${backLink()}
    <span class="cardbar-r">
      ${seasonSelect("pseason")}
      <label class="small muted">Games <select id="pmode">
        <option value="rs" ${mode === "rs" ? "selected" : ""}>Regular season</option>
        <option value="po" ${mode === "po" ? "selected" : ""} ${hasPO ? "" : "disabled"}>Playoffs${hasPO ? "" : " (none yet)"}</option>
      </select></label>
      <button class="btn" id="png" type="button">Download card as PNG</button>
    </span>
  </div>`;
  S.card = `
  <div class="card" id="card">
    <div class="card-head">
      <div>
        <div class="name">${esc(p.n)}</div>
        <div class="meta">${p.no ? "#" + esc(p.no) + " · " : ""}${esc(p.pos)} · Age ${p.age}${clubOf(p) ? " · " + tname(clubOf(p)) : ""}${p.lg ? ` (${esc(p.lg)})` : ""}
          ${p.sh ? " · Shoots " + esc(p.sh[0]) : ""} · ${esc(p.ht)} · ${esc(p.wt)}</div>
        <div class="meta">${esc(p.nat)}${p.sal ? " · " + esc(p.sal) : ""}${p.exp ? " through " + esc(p.exp) : ""}</div>
        <div class="tags">${tagsHtml}</div>
      </div>
      <div class="badge"><b>EHM card</b>${fmtDate(p.seen || D.dates.at(-1))}</div>
    </div>
    <div class="hero">
      <div><div class="lab">Est. current ability</div><div class="val">${fmt(p.ca, 0)}</div>
        <div class="note">${stars(p.ca)} · ${card.ca_pct == null ? "" : rankLink(pRankHref("ca", "ca", p.grp, p.k), `${ordinal(card.ca_pct)} pct of ${grpName}`)}</div></div>
      <div><div class="lab">Est. potential ability</div><div class="val">${fmt(p.pa, 0)}</div>
        <div class="note">${stars(p.pa)} · likely ${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</div></div>
      <div><div class="lab">Projected peak (${D.projectionMonths / 12} yrs)</div><div class="val">${fmt(peak.mid, 0)}</div>
        <div class="note">${peak.m === 0 ? "at or past peak now" : `around age ${Math.floor(peak.age)} · ${fmtDate(peak.date)}`}</div></div>
      <div><div class="lab">${base4 === first && recentDays < 110 ? "Change since he appeared" : "Change in the past 4 months"}</div>
        <div class="val ${recent > 0.5 ? "up" : recent < -0.5 ? "down" : ""}">${recent == null ? "–" : (recent > 0 ? "+" : "") + recent.toFixed(1)}</div>
        <div class="note">est. CA since ${fmtDate(D.dates[base4[0]])}${recent == null ? "" : ` (${recentDays} days)`} · ${caChange == null ? "" : `${signed(caChange, 1)} since ${fmtDate(D.dates[first[0]])}`}</div></div>
      ${playoffHero(byKey.get(p.k))}
    </div>
    <div class="cols">
      <section>
        <h3>${isG ? "Goaltending" : "Impact profile"}</h3>
        ${comps.length ? `<div class="tiles">${comps.map(k => tile(COMP_LABELS[k], card.comp[k], k === "impact", pRankHref("c", k, p.grp, p.k))).join("")}</div>`
          : `<div class="empty">No NHL box-score sample (needs ${isG ? 300 : D.minToi}+ minutes in the snapshots' NHL games).</div>`}
      </section>
      <section>
        <h3>${isG ? "Goalie rates" : "Rates & usage"}</h3>
        ${metricRows ? `<div class="bars">${metricRows}</div>` : `<div class="empty">No NHL rate stats for this player yet.</div>`}
      </section>
      <section>
        <h3>Attribute profile</h3>
        <div class="bars">${p.grpS.map(([name, avg, pct]) => barRow(name, avg.toFixed(1) + "/20", pct,
          `Average of the ${name.toLowerCase()} attributes; percentile vs all ${grpName} in the database`, pRankHref("g", name, p.grp, p.k))).join("")}</div>
      </section>
    </div>
    ${warSection(p, grpName)}
    ${warHistory(p)}
    <div class="card-foot">
      <span>${p._po ? "<b>Playoffs.</b> " : ""}${card.pool ? "Stat percentiles vs " + esc(card.pool) + ". " : ""}Attribute percentiles vs all ${grpName}. NHL ${p._po ? "playoff" : "regular-season"} games ${G.first ? fmtDate(G.first) + " – " + fmtDate(G.last) : "–"}.</span>
      <span class="legend-scale">0 <i style="background:linear-gradient(90deg,${pctColor(0).bg},${pctColor(50).bg},${pctColor(100).bg})"></i> 100 percentile</span>
    </div>
  </div>`;
  S.ach = achievementsPanel(p);
  S.chart = `
  <div class="panel" id="chartpanel">
    <div class="chart-head">
      <div><h2 id="chart-title">Ability over time and projection</h2>
        <p class="sub" id="chart-sub"></p></div>
      <label class="small muted">Show <select id="metric">
        <option value="ca">Est. CA + projection</option>
        ${D.attrs.map((a, i) => p.h.some(h => h[i + 2] != null) ? `<option value="${i}">${esc(a.split(": ")[1])}</option>` : "").join("")}
      </select></label>
    </div>
    <div class="legend" id="legend"></div>
    <div id="chart"></div>
    <details><summary>Data table</summary><div class="tablewrap" id="chart-table"></div></details>
    <div id="attrproj"></div>
  </div>`;
  S.comps = compsPanel(p, proj);
  S.scout = scoutPanel(p);
  S.shots = shotPanel(p);
  S.attrs = `
  <div class="panel" id="attrpanel">
    <h2>Attributes</h2>
    <p class="sub">Latest snapshot; change since ${fmtDate(D.dates[first[0]])}. Click an attribute to chart it.</p>
    <div class="attr-grid">${attrTables(p)}</div>
  </div>`;
  S.career = careerPanel(p);

  const X = { proj, peak, card, t, isG, grpName, first, caChange, comps, metricsDef, tagsHtml, G, hasPO, key };
  view.innerHTML = composePlayer(S, p, X);

  const sel = view.querySelector("#metric");
  sel.onchange = () => drawChart(p, proj, sel.value);
  view.querySelectorAll(".attr-grid tr[data-i]").forEach(tr => {
    tr.onclick = () => {
      sel.value = tr.dataset.i; drawChart(p, proj, sel.value);
      reveal(view.querySelector("#chartpanel"));
    };
    tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tr.onclick(); } };   // reachable by keyboard too
  });
  view.querySelector("#png").onclick = () => exportCard(p, proj, X);
  view.querySelector("#pmode").onchange = e => { PMODE = e.target.value; renderPlayer(key, PTAB); };
  view.querySelector("#pseason").onchange = e => { SEASON = e.target.value; renderPlayer(key, PTAB); };
  drawChart(p, proj, "ca");
  renderAttrProjection(p, proj, 12);
  drawComps(p, proj, view.querySelector("#comps-mode button.on").dataset.m);
  drawCareer(p);
  view.querySelectorAll("#car-type button").forEach(b => b.onclick = () => { CTYPE = b.dataset.t; drawCareer(p); });
  view.querySelectorAll("#comps-mode button").forEach(b => b.onclick = () => drawComps(p, proj, b.dataset.m));
  initShotMaps(p);
  GAMELOG = () => drawGameLog(p);
  wireTabs(key, tab);
  if (!keepScroll) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- player page layout
// on-ice performance first (stats, games, shots), then ability (development, scouting, comparables), then the record
const PTABS = [["overview", "Overview"], ["stats", "Stats"], ["games", "Game log"], ["shots", "Shots"], ["dev", "Development"],
               ["scout", "Scouting"], ["comps", "Comparables"], ["awards", "Draft & awards"]];
let GAMELOG = null;   // draws the open player's game log when its tab is shown (the box scores load on demand)
function wireTabs(key, tab) {
  const btns = [...view.querySelectorAll(".ptabs [data-tab]")];
  if (!btns.length) return;
  const show = (t, focus, push) => {
    // a tab name from the URL: only a known one goes into the selector (an odd one would make querySelector throw)
    if (!PTABS.some(x => x[0] === t) || !view.querySelector(`.tabpane[data-tab="${t}"]`)) t = "overview";
    PTAB = t;
    btns.forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    view.querySelectorAll(".tabpane").forEach(s => (s.hidden = s.dataset.tab !== t));
    if (t === "games") GAMELOG?.();
    if (t === "dev") redrawChartIfResized();   // drawn while its tab was hidden (no width yet)
    // push/replaceState don't fire hashchange, so switching tabs doesn't re-render the page; a click adds a history
    // entry (the browser's Back returns to the previous tab), the initial show only normalises the URL
    const url = route(key) + (t === "overview" ? "" : "/" + t);
    if (push && location.hash !== url) history.pushState(null, "", url); else history.replaceState(null, "", url);
  };
  btns.forEach((b, i) => {
    b.onclick = () => show(b.dataset.tab, false, true);
    b.onkeydown = e => {   // arrow keys move between tabs
      const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (j == null) return;
      e.preventDefault(); show(btns[(j + btns.length) % btns.length].dataset.tab, true, true);
    };
  });
  show(tab);
}
/* Player Game log tab: every NHL game he played in a season (regular season and playoffs) from data/games_<season>.js,
   each opening its box score on his team's Results tab. */
let GL_SEASON = null;
function gameLogSeasons(p) {
  return SEASONS.filter(s => Object.values(D.teamPlayers?.[s] || {}).some(m => ["R", "P"].some(t => (m[t] || []).some(row => row[0] === p.k))));
}
function drawGameLog(p) {
  const box = view.querySelector("#gamelog");
  if (!box) return;
  const seasons = gameLogSeasons(p);
  if (!seasons.length) { box.innerHTML = `<h2>Game log</h2><p class="muted small">No NHL games in this save's box scores.</p>`; return; }
  const season = seasons.includes(GL_SEASON) ? GL_SEASON : seasons.includes(SEASON) ? SEASON : seasons.at(-1);
  box.dataset.season = season;
  loadGames(season).then(list => {
    if (box.dataset.season !== season || !view.contains(box)) return;
    if (!list) { box.innerHTML = `<h2>Game log</h2><p class="muted small">Box scores for ${seasonLabel(season)} aren't in this build.</p>`; return; }
    const isG = p.grp === "G";
    const games = list.map((g, i) => ({ g, i, x: g.pl.find(y => y[1] === p.k) })).filter(o => o.x && (o.x[11] > 0 || !isG));
    const tot = { gp: 0, g: 0, a: 0, p: 0, pm: 0, st: 0, s: 0, blk: 0, pim: 0, toi: 0, sa: 0, ga: 0, w: 0, l: 0 };
    const rows = games.map(({ g, i, x }) => {
      const club = x[0] === "home" ? g.h : g.a, opp = x[0] === "home" ? g.a : g.h, [res, gf, ga] = gameResult(g, club);
      const href = `${teamRoute(club)}/results/${season}/${i}`;
      tot.gp++; tot.toi += x[11] || 0;
      let line;
      if (isG) {
        const q = goalieGame(g, x);
        tot.sa += q.sa || 0; tot.ga += q.ga || 0; if (/W/.test(res)) tot.w++; else if (res) tot.l++;
        line = `<td class="num">${q.sa == null ? dash : Math.round(q.sa)}</td><td class="num">${q.sa == null ? dash : Math.round(q.sa - q.ga)}</td><td class="num">${q.ga == null ? dash : Math.round(q.ga)}</td>
          <td class="num">${q.sa ? (1 - q.ga / q.sa).toFixed(3).replace(/^0/, "") : dash}</td>`;
      } else {
        [["g", 4], ["a", 5], ["p", 6], ["pm", 7], ["st", 8], ["s", 9], ["blk", 14], ["pim", 10]].forEach(([k, j]) => { tot[k] += x[j] || 0; });
        line = [4, 5, 6, 7, 8, 9, 14, 10].map(j => `<td class="num">${x[j] == null ? dash : j === 6 ? `<b>${x[j]}</b>` : j === 7 && x[j] > 0 ? "+" + x[j] : x[j]}</td>`).join("");
      }
      return `<tr class="glink" data-href="${href}"><td class="nowrap" data-v="${g.d}"><a href="${href}" title="Box score">${fmtDate(g.d)}</a>${g.t === "P" ? ' <span class="chip">PO</span>' : ""}</td>
        <td class="nowrap">${tlink(club, `${logo(club, 20)} ${esc(NHL_TEAMS[club]?.[0] || club)}`)}</td><td class="nowrap">${x[0] === "home" ? "vs" : "@"} ${tlink(opp, `${logo(opp, 20)} ${esc(opp)}`)}</td>
        <td class="${/W/.test(res) ? "up" : res ? "down" : ""}"><b>${res}</b></td><td class="num" data-v="${gf - ga}">${gf ?? "–"}–${ga ?? "–"}</td>
        ${line}<td class="num" data-v="${x[11] ?? ""}">${x[11] == null ? dash : rawFmt("toi_gp", x[11])}</td><td class="num">${x[12] ?? dash}</td></tr>`;
    });
    const head = isG ? `<th class="num" title="Shots against">SA</th><th class="num">Saves</th><th class="num">GA</th><th class="num">SV%</th>`
      : `<th class="num">G</th><th class="num">A</th><th class="num">P</th><th class="num">+/−</th><th class="num" title="Shots on goal">SOG</th><th class="num" title="Shot attempts">Shots</th><th class="num" title="Shots blocked">Blk</th><th class="num">PIM</th>`;
    const totals = isG
      ? `${tot.w}–${tot.l} · ${tot.sa ? (1 - tot.ga / tot.sa).toFixed(3).replace(/^0/, "") : "–"} SV% · ${tot.toi ? (tot.ga * 60 / tot.toi).toFixed(2) : "–"} GAA`
      : `${tot.g} G · ${tot.a} A · ${tot.p} P · ${tot.pm > 0 ? "+" : ""}${tot.pm} · ${tot.st} SOG · ${tot.blk} blocks · ${tot.gp ? rawFmt("toi_gp", tot.toi / tot.gp) : "–"} TOI/GP`;
    box.innerHTML = `<div class="chart-head"><div><h2>Game log</h2><p class="sub">${seasonLabel(season)}: ${tot.gp} games · ${totals}. Click a game (or its date) for its box score. PO = playoffs.</p></div>
        ${seasons.length > 1 ? `<label class="inline small muted">Season <select id="gl-season">${seasons.slice().reverse().map(s => `<option value="${s}" ${s === season ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>` : ""}</div>
      <div class="tablewrap"><table class="rank sortable picks gamelog"><thead><tr><th>Date</th><th>Team</th><th>Opponent</th><th>Result</th><th class="num">Score</th>${head}
        <th class="num">TOI</th><th class="num" title="Game rating">Rtg</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="16" class="muted small">No games captured.</td></tr>`}</tbody></table></div>
      <p class="small muted">From this save's box scores (about 2% of games missing). Score: his team first.${isG ? " Shots and goals against: the box score's when he played the whole game, else the shot chart's." : ""}</p>`;
    box.querySelector("#gl-season")?.addEventListener("change", e => { GL_SEASON = e.target.value; drawGameLog(p); });
    box.querySelectorAll("tr.glink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = tr.dataset.href; });
    makeSortable(box);
  });
}
/* Box-score totals for the selected season / game type, with the team(s) he played for. */
function totalsTable(p, t) {
  if (!t) return `<p class="muted small">No NHL box-score games for this player in the selected season.</p>`;
  const toi = t.gp ? t.toi / t.gp : null;
  return `<div class="tablewrap"><table class="totals"><thead><tr><th>NHL ${p._po ? "playoffs" : "regular season"}</th><th>Team</th>
    <th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">A1</th><th class="num">P</th><th class="num">+/-</th>
    <th class="num">PIM</th><th class="num">SOG</th><th class="num">ixG</th><th class="num">TOI/GP</th><th class="num">TOI</th></tr></thead>
    <tbody><tr><td>${SEASON ? seasonLabel(SEASON) : ""}</td><td class="nowrap">${(t.team || abbrOf(clubOf(p)) || "–").split("/").map(a => `${teamLogo(clubOfAbbr(a), 22)} <b>${esc(a)}</b>`).join(" ")}</td>
    <td class="num">${t.gp}</td><td class="num">${t.g}</td><td class="num">${t.a}</td><td class="num">${t.a1}</td>
    <td class="num"><b>${t.p}</b></td><td class="num">${t.pm > 0 ? "+" : ""}${t.pm}</td><td class="num">${t.pim}</td><td class="num">${t.st}</td>
    <td class="num">${t.ixg ?? "–"}</td><td class="num">${toi == null ? "–" : rawFmt("toi_gp", toi)}</td><td class="num">${Math.round(t.toi)}</td></tr></tbody></table></div>`;
}
const bornText = p => p.dob ? fmtDate(p.dob) : "–";
/* A player the latest crawl didn't read (a quick SHA crawl reads only the NHL and AHL): build_data carries his card from
   the last snapshot that had him (p.seen); p.left = the club he was no longer on when a crawl read its league. */
const seenText = p => !p.seen ? null : p.left ? `Left ${p.left} · last seen ${fmtDate(p.seen)}`
  : `Last seen ${fmtDate(p.seen)} (his league wasn't in the latest crawl)`;
function factRows(p, X) {
  const pro = draftLine(p.dft?.pro), jr = draftLine(p.dft?.junior);
  return [
    ["Age", p.age], ["Born", bornText(p)], ["Birthplace", p.bp], ["Nationality", p.nat], ["Position", p.pos],
    ["Number", p.no ? "#" + p.no : null], ["Shoots", p.sh], ["Height", p.ht], ["Weight", p.wt],
    ["Club", clubOf(p) ? tname(clubOf(p)) : null, true], ["League", p.lg],
    ["Last seen", p.seen ? `${fmtDate(p.seen)} (${p.left ? "not on " + p.left + " in the latest crawl" : "league not in the latest crawl"})` : null],
    ["Contract", p.sal], ["Expires", p.exp], ["Condition", p.inj],
    ["Drafted", linkText(pro, draftHref(p.dft?.pro)), true], ["Junior draft", jr], ["Role", p.sc?.role], ["Career role", p.sc?.career],
    ["Big games", bigGame(p) ? bigGame(p) + "/20" : null], ["Top prospect", linkText(p.pr, prospectHref(p)), true], ["Draft ranking", linkText(p.dr, /NHL/.test(p.dr || "") ? "#/draft" : null), true],
    ["Est. CA", `${fmt(p.ca, 0)} ${stars(p.ca)}`, true], ["Est. PA", `${fmt(p.pa, 0)} ${stars(p.pa)} <span class="muted small">${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</span>`, true],
    ["Proj. peak", `${fmt(X.peak.mid, 0)}${X.peak.m ? ` <span class="muted small">age ${Math.floor(X.peak.age)}</span>` : ""}`, true],
  ].filter(r => r[1] != null && r[1] !== "");
}
const factList = rows => `<dl class="facts">${rows.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(v)}</dd>`).join("")}</dl>`;

function composePlayer(S, p, X) {
  const statsTab = `${S.career}
    <div class="panel"><h2>NHL box-score totals</h2><p class="sub">Games in this save's box scores (the source of the card's percentiles and WAR).</p>${totalsTable(p, X.t)}</div>`;
  const awards = S.ach || `<div class="panel"><h2>Draft &amp; awards</h2><p class="sub">No draft or achievements recorded for this player.</p></div>`;
  // tabs with nothing for this player stay clickable (their panel says why) but are dimmed
  const empty = {
    games: !X.t && !Object.keys(p.ss || {}).length, shots: !(X.isG ? p.sa : p.shots)?.length, scout: !p.sc, awards: !S.ach,
  };
  const pane = (k, html) => `<section class="tabpane" data-tab="${k}" role="tabpanel" aria-label="${PTABS.find(t => t[0] === k)[1]}">${html}</section>`;
  return `
  <section class="band pband"><div class="wrap">
    ${S.controls}
    <div class="phead">
      ${teamLogo(clubOf(p), 64)}
      <div class="phead-id">
        <h1>${p.no ? `<span class="no">#${esc(p.no)}</span>` : ""}${esc(p.n)}</h1>
        <p>${esc(p.pos)} · ${clubOf(p) ? `<a href="${teamRoute(clubOf(p))}">${esc(clubOf(p))}</a>` : "–"}${p.lg ? " · " + esc(p.lg) : ""} · Age ${p.age}${p.nat ? " · " + esc(p.nat) : ""}</p>
        <div class="chips">${X.tagsHtml}</div>
      </div>
    </div>
    <div class="ptabs" role="tablist" aria-label="Player sections">${PTABS.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}"${empty[k] ? ` class="empty" title="Nothing recorded for this player yet"` : ""}>${t}</button>`).join("")}</div>
  </div></section>
  <div class="wrap page player">
    <aside class="factbox card-box" aria-label="Player facts"><h2>Player facts</h2>${factList(factRows(p, X))}</aside>
    <div class="pmain">
      ${pane("overview", S.card)}${pane("stats", statsTab)}${pane("games", `<div class="panel" id="gamelog"><h2>Game log</h2><p class="muted small">Loading the box scores…</p></div>`)}${pane("dev", S.attrs + S.chart)}${pane("scout", S.scout)}
      ${pane("shots", S.shots)}${pane("comps", S.comps)}${pane("awards", awards)}
    </div>
  </div>`;
}

/* #/p/<key> for a player who has left the data (D.teamHist.alumni: retired, unsigned or moved to a league the crawl
   doesn't read) but still appears in box scores and franchise records: bio and est. CA from the last snapshot that
   had him, NHL WAR by season, honours and his career lines. No card or projection: there are no current attributes. */
function renderFormer(a) {
  markNav("players");
  const L = a.last || {}, seasons = Object.keys(a.war || {}).sort();
  const facts = [["Last seen", L.d ? fmtDate(L.d) : "–"], ["Club then", L.cl ? `${logo(L.cl, 18)} ${tlink(L.cl)}${L.lg ? ` <span class="muted small">${esc(L.lg)}</span>` : ""}` : "–", true],
    ["Age then", L.age ?? "–"], ["Born", L.dob || "–"], ["Birthplace", L.bp || "–"], ["Nationality", L.nat || "–"],
    ["Height", L.ht || "–"], ["Weight", L.wt || "–"], ["Shoots", L.sh || "–"], ["Contract ran to", L.exp || "–"],
    ["Est. CA then", L.ca == null ? "–" : fmt(L.ca, 0)]];
  const warPanel = seasons.length ? `<div class="panel"><h2>NHL WAR by season</h2><p class="sub">From this save's box scores (regular season).</p>
    <div class="tablewrap"><table class="rank"><thead><tr><th>Season</th><th>Team</th><th class="num">GP</th><th class="num">WAR</th></tr></thead><tbody>
    ${seasons.map(s => { const [w, gp, t] = a.war[s]; return `<tr><td>${seasonLabel(s)}</td><td>${String(t || "").split("/").map(x => alink(x, `${logo(clubOfAbbr(x), 16)} ${esc(x)}`)).join(" / ")}</td><td class="num">${gp}</td><td class="num">${w.toFixed(2)}</td></tr>`; }).join("")}
    </tbody></table></div></div>` : "";
  const achPanel = a.ach?.length ? `<div class="panel"><h2>NHL honours</h2><ul class="plain">${a.ach.map(x => `<li><span class="muted small">${esc(x[0])}</span> ${achHref(x[0], x[2]) ? `<a href="${achHref(x[0], x[2])}">${esc(x[2])}</a>` : esc(x[2])} <span class="muted small">${tname(x[1])}</span></li>`).join("")}</ul></div>` : "";
  view.innerHTML = `<section class="band pband"><div class="wrap"><div class="cardbar">${backLink()}<span></span></div><div class="phead">${teamLogo(L.cl, 64)}
      <div class="phead-id"><h1>${esc(a.n)}</h1><p>${esc(a.pos || "")} · Former player: not in the latest snapshot (${fmtDate(D.dates.at(-1))})</p></div></div></div></section>
    <div class="wrap page player"><aside class="factbox card-box" aria-label="Player facts"><h2>Player facts</h2>${factList(facts)}</aside>
      <div class="pmain"><div class="panel"><p class="sub">He was last crawled on ${L.d ? fmtDate(L.d) : "an earlier snapshot"}${L.cl ? ` with ${tname(L.cl)}` : ""}. Since then he isn't on any roster,
        prospect or draft list the crawl reads (retired, unsigned, or playing in a league that isn't crawled), so there is no card, attribute history or projection.</p></div>
      ${careerPanel(a)}${warPanel}${achPanel}</div></div>`;
  drawCareer(a);
  view.querySelectorAll("#car-type button").forEach(b => b.onclick = () => { CTYPE = b.dataset.t; drawCareer(a); });
  if (!keepScroll) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- career stats
/* Season-by-season lines like an NHL stats site, from the player's History tab: one line per club he played for
   in each season of the save (EHM shows nothing from before it), in any league. A finished NHL stint whose History
   line stopped early is completed from the box scores (src "box", marked †). NHL lines add PP/SH points, GWG, TOI
   and shutouts from the team's Statistics tab. Totals per league once he has two lines in it. */
const CAR_TYPES = [["R", "Regular season"], ["P", "Playoffs"], ["O", "Preseason & other"]];
let CTYPE = "R";
const careerLines = p => ((byKey.get(p.k) || ALUMNI.get(p.k))?.car || []).map(r => Object.fromEntries((D.careerCols || []).map((c, i) => [c, r[i]])));
function careerPanel(p) {
  if (!D.careerCols) return `<div class="panel"><h2>Career statistics</h2><p class="sub">Rebuild the site data (<code>build_data.py</code>) to see season-by-season stats.</p></div>`;
  const lines = careerLines(p);
  if (!lines.length) return `<div class="panel"><h2>Career statistics</h2><p class="sub">No games on his History tab in any season of this save yet.</p></div>`;
  const types = CAR_TYPES.filter(([t]) => lines.some(l => l.type === t));
  return `<div class="panel" id="careerpanel">
    <div class="chart-head"><div><h2>Career statistics</h2>
      <p class="sub">Every club he played for in each season of this save, in any league, from his History tab (the current season is so far).
      ${p.grp === "G" ? "Shutouts come" : "PP, SH, GWG and TOI come"} from NHL team statistics, so other leagues show –.</p></div>
      <div class="seg" id="car-type">${types.map(([t, label]) => `<button type="button" data-t="${t}">${label}</button>`).join("")}</div>
    </div>
    <div class="tablewrap" id="car-table"></div></div>`;
}
/* Sum of a column, or null when any line lacks it (a partial total would understate). */
const carSum = (rows, k) => rows.every(r => r[k] != null) ? rows.reduce((s, r) => s + r[k], 0) : null;
function careerTotal(rows, label) {
  const t = { season: label, club: "", league: rows[0].league, total: true };
  ["gp", "g", "a", "p", "pm", "pim", "s", "ppg", "ppa", "shg", "sha", "gwg", "w", "l", "t", "min", "ga", "so"].forEach(k => (t[k] = carSum(rows, k)));
  t.toi = rows.every(r => r.toi != null) ? rows.reduce((s, r) => s + r.toi * r.gp, 0) / t.gp : null;
  t.avr = rows.every(r => r.avr != null) ? rows.reduce((s, r) => s + r.avr * r.gp, 0) / t.gp : null;
  t.gaa = t.min && t.ga != null ? t.ga * 60 / t.min : null;
  // shots against from each line's GA and SV%
  const sa = rows.every(r => r.ga != null && r.svp != null && r.svp < 1) ? rows.reduce((s, r) => s + r.ga / (1 - r.svp), 0) : null;
  t.svp = sa ? 1 - t.ga / sa : null;
  return t;
}
function drawCareer(p) {
  const box = view.querySelector("#car-table");
  if (!box) return;
  const lines = careerLines(p), isG = p.grp === "G";
  const btns = [...view.querySelectorAll("#car-type button")];
  if (!btns.some(b => b.dataset.t === CTYPE)) CTYPE = btns[0].dataset.t;
  btns.forEach(b => { const on = b.dataset.t === CTYPE; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  const rows = lines.filter(l => l.type === CTYPE);
  const leagues = [...new Set(rows.map(r => r.league || ""))];
  const totals = leagues.map(lg => rows.filter(r => (r.league || "") === lg)).filter(rs => rs.length > 1)
    .map(rs => careerTotal(rs, `${rs[0].league || "Other"} totals`));
  const known = new Set(D.players.map(clubOf));
  const team = r => r.total ? "" : r.club ? `${logo(r.club, 20)} ${known.has(r.club) ? `<a href="${teamRoute(r.club)}">${esc(r.club)}</a>` : esc(r.club)}` : dash;
  const BOX = "From this save's box scores: the History tab dropped this line when he changed clubs, after the last snapshot that showed it";
  const n = (v, d = 0) => v == null ? dash : fmt(v, d);
  const cols = isG
    ? [["GP", r => n(r.gp)], ["W", r => n(r.w)], ["L", r => n(r.l)], ["T/OT", r => n(r.t)], ["GA", r => n(r.ga)],
       ["GAA", r => n(r.gaa, 2)], ["SV%", r => r.svp == null ? dash : r.svp.toFixed(3).replace(/^0/, "")], ["SO", r => n(r.so)],
       ["MIN", r => r.min == null ? dash : Math.round(r.min).toLocaleString()], ["Av R", r => n(r.avr, 2)]]
    : [["GP", r => `${n(r.gp)}${r.src === "box" ? `<sup title="${BOX}">†</sup>` : ""}`], ["G", r => n(r.g)], ["A", r => n(r.a)], ["P", r => `<b>${n(r.p)}</b>`],
       ["+/-", r => r.pm == null ? dash : (r.pm > 0 ? "+" : "") + r.pm], ["PIM", r => n(r.pim)], ["PPG", r => n(r.ppg)],
       ["PPP", r => r.ppg == null || r.ppa == null ? dash : r.ppg + r.ppa], ["SHG", r => n(r.shg)],
       ["SHP", r => r.shg == null || r.sha == null ? dash : r.shg + r.sha], ["GWG", r => n(r.gwg)], ["S", r => n(r.s)],
       ["S%", r => r.s ? (100 * r.g / r.s).toFixed(1) : dash], ["TOI/GP", r => r.toi == null ? dash : rawFmt("toi_gp", r.toi)],
       ["Av R", r => n(r.avr, 2)]];
  const tips = { "Av R": "Average game rating", "T/OT": "Ties and overtime / shootout losses", PPP: "Power-play points",
                 SHP: "Short-handed points", GWG: "Game-winning goals", "TOI/GP": "Average time on ice per game" };
  const seasonCell = r => {
    if (r.total) return esc(r.season);
    const abbr = r.league === "NHL" && NHL_TEAMS[r.club] && abbrOf(r.club);
    return abbr && D.teamPlayers?.[r.season]?.[abbr]
      ? `<a href="${teamRoute(r.club)}/players/${r.season}/${encodeURIComponent(p.k)}" data-mode="${CTYPE === "P" ? "P" : "R"}" title="${esc(r.club)} player stats and team stats, ${seasonLabel(r.season)}">${seasonLabel(r.season)}</a>`
      : seasonLabel(r.season);
  };
  const row = r => `<tr class="${r.total ? "total" : ""}"><th scope="row" class="nowrap">${seasonCell(r)}</th>
    <td class="nowrap">${team(r)}</td><td>${r.total ? "" : esc(r.league || "")}</td>${cols.map(([, f]) => `<td class="num">${f(r)}</td>`).join("")}</tr>`;
  box.innerHTML = `<table class="career"><thead><tr><th>Season</th><th>Team</th><th>League</th>${cols.map(([h]) =>
    `<th class="num"${tips[h] ? ` title="${tips[h]}"` : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row).join("")}</tbody>${totals.length ? `<tfoot>${totals.map(row).join("")}</tfoot>` : ""}</table>
    ${rows.some(r => r.src === "box") ? `<p class="small muted">† ${BOX}; the box scores miss about 2% of games.</p>` : ""}
    <p class="small muted">Click an NHL season for that club's player and team stats that season.</p>`;
  box.querySelectorAll("a[data-mode]").forEach(x => x.addEventListener("click", () => { TPS.mode = x.dataset.mode; }));
}

// ---------------------------------------------------------------- draft + achievements
/* Links from a player's draft and Top Prospects tags: an NHL draft pick opens that draft on the Past drafts tab
   (his pick highlighted), a prospect rank opens the NHL club's Prospects & picks tab. */
const draftHref = d => d?.pick != null && /NHL/.test(d.draft || "") && draftValues().years.includes(d.year) ? `#/draft/past/${d.year}/${d.pick}` : null;
const prospectHref = p => p.tp && NHL_TEAMS[p.tp[0]] ? teamRoute(p.tp[0]) + "/prospects" : null;
const linkText = (text, href) => text == null ? null : href ? `<a href="${href}">${esc(text)}</a>` : esc(text);
function draftLine(d) {
  if (!d) return null;
  if (d.pick == null) return d.text && d.text !== "-" ? d.text : null;
  return `${d.year} ${d.draft.replace(/ Entry Draft| Priority Selection| Draft$/, "")} draft · Round ${d.round}, #${d.pick} overall · ${d.team}`;
}
const LEAGUE_SHORT = [["National Hockey League", "NHL"], ["American Hockey League", "AHL"], ["Kontinental Hockey League", "KHL"],
  ["Canadian Hockey League", "CHL"], ["Western Hockey League", "WHL"], ["Ontario Hockey League", "OHL"],
  ["Quebec Major Junior Hockey League", "QMJHL"], ["Québec Maritimes Junior Hockey League", "QMJHL"]];
function achText(t) {
  if (/^National Hockey League winners$/.test(t)) return "Stanley Cup champion";
  if (/^National Hockey League runners up$/.test(t)) return "Stanley Cup finalist";
  if (/^Canadian Hockey League Memorial Cup winners$/.test(t)) return "Memorial Cup champion";
  LEAGUE_SHORT.forEach(([a, b]) => { t = t.replace(a, b); });
  return t.replace(/^Named in /, "").replace(/ winners$/, " champion").replace(/ runners up$/, " runner-up")
          .replace(/ third placed$/, " (3rd)").replace(/ runner up$/, " (2nd)");
}
/* Header tags: trophies won, championships and NHL First/Second All-Star teams. */
/* An achievement won in a specific NHL playoff (Stanley Cup champion / finalist, Conn Smythe) links to that playoff page. */
const seasonOfDay = d => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 7 ? y : y - 1; return `${String(s % 100).padStart(2, "0")}-${String((s + 1) % 100).padStart(2, "0")}`; };
function achHref(d, text) {
  if (!/^National Hockey League (winners|runners up)$|Conn Smythe/.test(text)) return null;
  const s = seasonOfDay(d);
  return playoffSeasons().includes(s) ? `#/playoffs/${s}` : null;
}
function achTags(p) {
  return (p.ach || []).filter(([, , t, k]) => k === "T" || k === "C" || (k === "A" && /National Hockey League (First|Second)/.test(t)))
    .map(([d, , t]) => [`${achText(t).replace(/^\d+\/\d+ /, "")} (${d.slice(0, 4)})`, achHref(d, t)]);
}
function achievementsPanel(p) {
  const a = p.ach || [], pro = draftLine(p.dft?.pro), jr = draftLine(p.dft?.junior);
  if (!a.length && !pro && !jr) return "";
  const of = k => a.filter(x => k.includes(x[3]));
  const row = ([d, team, text]) => { const href = achHref(d, text);
    return `<tr><td class="nowrap ${href ? "" : "muted"}">${href ? `<a href="${href}" title="${seasonLabel(seasonOfDay(d))} playoffs">${fmtDate(d)}</a>` : fmtDate(d)}</td><td>${esc(achText(text))}</td><td class="muted nowrap">${tname(team)}</td></tr>`; };
  const table = rows => `<div class="tablewrap"><table class="fit"><tbody>${rows.map(row).join("")}</tbody></table></div>`;
  const counts = {};
  of("m").forEach(([, , text]) => { const t = achText(text).replace(/ for \w+$/, ""); counts[t] = (counts[t] || 0) + 1; });
  const sections = [["Trophies &amp; awards", of("T")], ["Award finalist", of("F")], ["Championships", of("Cc")], ["All-Star teams", of("A")]]
    .filter(([, r]) => r.length);
  return `<div class="panel" id="achpanel">
    <h2>Draft &amp; awards</h2>
    <p class="sub">Draft from the player's Information tab. Achievements are the save's own log (History tab), so they
      start when the save started; real-life trophies from before then aren't in the game's database.</p>
    <div class="tags-plain">
      <div><span class="muted small">Drafted (pro)</span> <b>${pro ? linkText(pro, draftHref(p.dft?.pro)) : "None recorded"}</b>${pro ? "" : ` <span class="muted small">(undrafted, or a pick the game's database lacks, e.g. some Arizona picks)</span>`}</div>
      ${jr ? `<div><span class="muted small">Drafted (junior)</span> ${esc(jr)}</div>` : ""}
    </div>
    ${sections.map(([h, r]) => `<h3>${h}</h3>${table(r)}`).join("")}
    ${Object.keys(counts).length ? `<h3>Other recognition</h3>
      <p class="small">${Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${esc(t)}${n > 1 ? ` <b>×${n}</b>` : ""}`).join(" · ")}</p>` : ""}
    ${of("x").length ? `<details><summary>Career moves (${of("x").length})</summary>${table(of("x"))}</details>` : ""}
    ${!a.length ? `<p class="small muted">Nothing logged in this save yet.</p>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- comparable players
/* Similarity = distance between visible-attribute profiles, each attribute standardized within the
   position group (a point of a rare attribute counts more than a point of a common one).
   Now: anyone in the group. Same age: within a year. Could become (23 and under): his projected
   attributes at his projected peak vs established players aged 24-31 today. */
const COMP_STATS = {};
function compStats(grp) {
  if (COMP_STATS[grp]) return COMP_STATS[grp];
  const pool = D.players.filter(q => q.grp === grp && q.h.length);
  const idx = D.attrs.map((_, i) => i).filter(i => pool.filter(q => q.h.at(-1)[i + 2] != null).length > pool.length * 0.9);
  const mean = {}, sd = {};
  idx.forEach(i => {
    const v = pool.map(q => q.h.at(-1)[i + 2]).filter(x => x != null);
    mean[i] = v.reduce((a, b) => a + b, 0) / v.length;
    sd[i] = Math.sqrt(v.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / v.length) || 1;
  });
  return (COMP_STATS[grp] = { pool, idx, sd });
}
function compDist(S, a, b) {
  let s = 0, n = 0;
  for (const i of S.idx) {
    if (a[i] == null || b[i] == null) continue;
    s += ((a[i] - b[i]) / S.sd[i]) ** 2; n++;
  }
  return n ? Math.sqrt(s / n) : Infinity;
}
function compList(p, proj, mode) {
  const S = compStats(p.grp);
  let vec = p.h.at(-1).slice(2), pool = S.pool.filter(q => q.k !== p.k), peak = null;
  if (mode === "age") pool = pool.filter(q => Math.abs(q.age - p.age) <= 1);
  if (mode === "become") {
    peak = proj.reduce((a, b) => (b.mid > a.mid ? b : a));
    vec = D.attrs.map(() => null);
    projectAttrs(p, peak).forEach(r => { vec[D.attrs.indexOf(r.c)] = r.mid; });
    pool = pool.filter(q => q.age >= 24 && q.age <= 31);
  }
  const rows = pool.map(q => ({ q, d: compDist(S, vec, q.h.at(-1).slice(2)) }))
    .sort((a, b) => a.d - b.d).slice(0, 10);
  return { rows, peak };
}
function compsPanel(p, proj) {
  const canBecome = p.age <= 23 && proj.some(x => x.m > 0 && x.mid > p.ca + 1);
  const modes = [["now", "Most similar now"], ["age", "Same age (±1)"], ...(canBecome ? [["become", "Could become"]] : [])];
  return `<div class="panel" id="comps">
    <div class="chart-head"><div><h2>Comparable players</h2>
      <p class="sub" id="comps-sub"></p></div>
      <div class="seg" id="comps-mode">${modes.map(([k, t]) => `<button type="button" data-m="${k}" class="${k === (canBecome ? "become" : "now") ? "on" : ""}">${t}</button>`).join("")}</div>
    </div>
    <div class="tablewrap" id="comps-table"></div></div>`;
}
function drawComps(p, proj, mode) {
  const box = view.querySelector("#comps");
  if (!box) return;
  box.querySelectorAll("#comps-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
  const { rows, peak } = compList(p, proj, mode);
  const grpName = { F: "forwards", D: "defencemen", G: "goalies" }[p.grp];
  box.querySelector("#comps-sub").innerHTML = {
    now: `The ${grpName} whose current attributes look most like his, at any age.`,
    age: `The ${grpName} within a year of his age whose attributes look most like his.`,
    become: `His <b>projected</b> attributes at his projected peak (est. CA ${peak ? fmt(peak.mid, 0) : "–"}, age ${peak ? Math.floor(peak.age) : "–"})
      compared with established ${grpName} aged 24–31 today: who he could turn into.`,
  }[mode] + ` Match = how close the attribute profiles are (100 = identical), each attribute scaled by how much it varies among ${grpName}.`;
  box.querySelector("#comps-table").innerHTML = `<table><thead><tr><th>Player</th><th class="num">Age</th><th>Pos</th><th>Club</th>
    <th class="num">Est. CA</th><th class="num">Est. PA</th><th>Role</th><th class="num">NHL WAR/82</th><th class="num">Match</th></tr></thead><tbody>
    ${rows.map(({ q, d }) => `<tr class="link" data-k="${esc(q.k)}"><td><a href="${route(q.k)}">${esc(q.n)}</a></td>
      <td class="num">${q.age}</td><td>${esc(q.pos)}</td><td>${tname(clubOf(q))}${q.lg ? ` <span class="muted small">${esc(q.lg)}</span>` : ""}</td>
      <td class="num">${fmt(q.ca, 0)}</td><td class="num">${fmt(q.pa, 0)}</td><td class="small">${esc(q.sc?.role?.split(" / ")[1] || q.sc?.role || "")}</td>
      <td class="num">${q.war ? q.war.war82.toFixed(1) : "–"}</td><td class="num"><b>${Math.round(100 * Math.exp(-d * d))}</b></td></tr>`).join("")}
    </tbody></table>`;
  box.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (e.target.tagName !== "A") location.hash = route(tr.dataset.k); });
}

// ---------------------------------------------------------------- WAR
const WAR_LABELS = { shooting: "Shot generation", finishing: "Finishing", playmaking: "Playmaking",
                     defence: "Defence", penalties: "Penalties", goaltending: "Goaltending" };
function warSection(p, grpName) {
  const w = p.war;
  if (!w) return `<div class="war-row"><div class="war-main"><div class="lab">Wins above replacement</div>
    <div class="empty">No NHL box-score games yet.</div></div></div>`;
  const comps = Object.entries(w.comps);
  const max = Math.max(2, ...comps.map(([, v]) => Math.abs(v)));
  const c = pctColor(w.pct);
  return `<div class="war-row">
    <div class="war-main">
      <div class="lab">Wins above replacement</div>
      <div class="war-num">${w.war.toFixed(1)} <span>WAR</span></div>
      <div class="note">${w.war82.toFixed(1)} per 82 GP · ${w.gar.toFixed(1)} goals above replacement · ${w.gp} GP</div>
      ${w.pct != null ? `<a class="pill" href="${pRankHref("war", "war", p.grp, p.k)}" style="background:${c.bg};color:${c.fg}" title="${TIP_PCT}">${ordinal(w.pct)} pct WAR/82 of ${grpName}</a>` : ""}
    </div>
    <div class="war-bars" title="Goals above replacement by component">
      ${comps.map(([k, v]) => {
        const pct = Math.abs(v) / max * 50;
        return `<div class="wb"><span class="wl">${WAR_LABELS[k] || k}</span>
          <span class="wt"><i class="${v >= 0 ? "pos" : "neg"}" style="${v >= 0 ? "left:50%" : `left:${50 - pct}%`};width:${pct}%"></i><b></b></span>
          <span class="wv">${v > 0 ? "+" : ""}${v.toFixed(1)}</span></div>`;
      }).join("")}
      <div class="wb axis"><span></span><span class="wt-axis"><span>−${max.toFixed(0)}</span><span>0</span><span>+${max.toFixed(0)} goals</span></span><span></span></div>
    </div>
  </div>`;
}

/* WAR in each of the last seasons (regular season), the current one so far; the selected season is outlined. */
function warHistory(p) {
  const base = byKey.get(p.k) || p;
  const rows = SEASONS.slice(-3).map(s => {
    const w = s === SEASONS.at(-1) ? base.war : base.ss?.[s]?.war;
    const games = (D.seasons || []).find(x => x.season === s)?.games?.games || 0;
    return { s, w, partial: games < 0.9 * (D.predict?.blend?.season_gp || 84) * 16 };
  }).filter(r => r.w);
  if (!rows.length) return "";
  const max = Math.max(1, ...rows.map(r => Math.abs(r.w.war)));
  return `<div class="war-hist" aria-label="WAR by season">
    <div class="lab">WAR by season · regular season</div>
    ${rows.map(r => `<div class="wh ${r.s === SEASON ? "sel" : ""}"><span class="wl">${seasonLabel(r.s)}${r.partial ? " <small>so far</small>" : ""}</span>
      <span class="wt"><i class="${r.w.war >= 0 ? "pos" : "neg"}" style="${r.w.war >= 0 ? "left:0" : "left:0"};width:${(Math.abs(r.w.war) / max * 100).toFixed(1)}%"></i></span>
      <span class="wv">${fmt(r.w.war, 1)}</span><span class="wx">${r.w.gp} GP · ${fmt(r.w.war82, 1)} per 82</span></div>`).join("")}
  </div>`;
}

// ---------------------------------------------------------------- shot maps
/* Shot rows: [fx, fy, nx, ny, outcome, xg*1000]. fx = feet out from the attacked goal line,
   fy = feet from the middle (negative = attacker's left). nx/ny = 0..1 across the net opening
   (shooter's view) and crossbar (0) to ice (1). Outcome 0 save, 1 goal, 2 block, 3 miss. */
const ZONES = [
  ["Behind net", -11, 0, -42.5, 42.5], ["Crease", 0, 10, -12, 12], ["Low slot", 10, 25, -12, 12],
  ["High slot", 25, 45, -12, 12], ["Left circle", 0, 45, -42.5, -12], ["Right circle", 0, 45, 12, 42.5],
  ["Left point", 45, 64, -42.5, -12], ["Centre point", 45, 64, -12, 12], ["Right point", 45, 64, 12, 42.5],
  ["Long range", 64, 200, -42.5, 42.5],
];
function zoneOf(fx, fy) {
  for (const z of ZONES) if (fx >= z[1] && fx < z[2] && fy >= z[3] && fy < z[4]) return z[0];
  return fx < 0 ? "Behind net" : "Long range";
}
const NET_ZONES = [["High", 0, 1 / 3], ["Middle", 1 / 3, 2 / 3], ["Low", 2 / 3, 1.0001]];
const NET_COLS = [["left", 0, 1 / 3], ["centre", 1 / 3, 2 / 3], ["right", 2 / 3, 1.0001]];
let LEAGUE_ZONES = null;
function leagueZones() {
  if (LEAGUE_ZONES) return LEAGUE_ZONES;
  const z = {};
  for (const p of D.players) for (const s of p.shots || []) {
    const k = zoneOf(s[0], s[1]);
    const t = (z[k] ||= { n: 0, g: 0, xg: 0 });
    t.n++; t.g += s[4] === 1; t.xg += s[5] / 1000;
  }
  return (LEAGUE_ZONES = z);
}
function zoneStats(rows) {
  const z = {};
  for (const s of rows) {
    const t = (z[zoneOf(s[0], s[1])] ||= { n: 0, g: 0, xg: 0 });
    t.n++; t.g += s[4] === 1; t.xg += s[5] / 1000;
  }
  return z;
}
const SEQ_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
// more = stronger contrast with the page: dark blue on a light page, light blue on a dark one
const seqScale = () => (isDark() ? SEQ_LIGHT.slice().reverse() : SEQ_LIGHT);
function seqColor(t, SEQ = seqScale()) {
  const i = Math.min(SEQ.length - 1.001, Math.max(0, t) * (SEQ.length - 1));
  return `rgb(${mix(hexToRgb(SEQ[Math.floor(i)]), hexToRgb(SEQ[Math.floor(i) + 1]), i % 1)})`;
}
/* Gaussian kernel density on a grid. pts = [[u, v, weight]]; returns {cells, max}. */
function kde(pts, u0, u1, v0, v1, step, su, sv) {
  const nu = Math.ceil((u1 - u0) / step), nv = Math.ceil((v1 - v0) / step);
  const grid = new Float32Array(nu * nv);
  for (const [u, v, w] of pts) {
    const iu0 = Math.max(0, Math.floor((u - 3 * su - u0) / step)), iu1 = Math.min(nu - 1, Math.ceil((u + 3 * su - u0) / step));
    const iv0 = Math.max(0, Math.floor((v - 3 * sv - v0) / step)), iv1 = Math.min(nv - 1, Math.ceil((v + 3 * sv - v0) / step));
    for (let i = iu0; i <= iu1; i++) for (let j = iv0; j <= iv1; j++) {
      const du = (u0 + (i + 0.5) * step - u) / su, dv = (v0 + (j + 0.5) * step - v) / sv;
      grid[i * nv + j] += w * Math.exp(-0.5 * (du * du + dv * dv));
    }
  }
  let max = 0;
  for (const x of grid) if (x > max) max = x;
  return { grid, nu, nv, max };
}
function heatRects(k, u0, v0, step, toX, toY, cellW, cellH) {
  if (!k.max) return "";
  let out = "";
  const seq = seqScale();   // once per map, not per cell (it reads the theme)
  for (let i = 0; i < k.nu; i++) for (let j = 0; j < k.nv; j++) {
    const t = k.grid[i * k.nv + j] / k.max;
    if (t < 0.06) continue;
    out += `<rect x="${toX(u0 + i * step).toFixed(1)}" y="${toY(v0 + j * step).toFixed(1)}" width="${cellW + 0.6}" height="${cellH + 0.6}" fill="${seqColor(t, seq)}" fill-opacity="${(0.25 + 0.7 * t).toFixed(2)}"/>`;
  }
  return out;
}

function shotPanel(p) {
  const isG = p.grp === "G";
  const rows = isG ? p.sa : p.shots;
  if (!rows || !rows.length) return `<div class="panel"><h2>Shot maps</h2><p class="sub">${(p._po ? seasonInfo().gamesPO : seasonInfo().games)?.xg_games
    ? `No charted NHL ${p._po ? "playoff " : ""}shots for this player in the selected season.` : "No NHL box scores with shot charts in this data for the selected season."}</p></div>`;
  const modes = isG ? [["shots", "Shots against"], ["goals", "Goals against"], ["eff", "Saves vs expected"]]
                    : [["shots", "Shots taken"], ["goals", "Goals scored"], ["eff", "Effectiveness by zone"]];
  return `<div class="panel" id="shotpanel">
    <div class="chart-head">
      <div><h2>Shot maps</h2>
        <p class="sub">${isG ? "Every charted unblocked shot he faced while in net" : "Every charted shot attempt of his"} in his
          ${p.card?.totals?.xg_gp ?? "–"} NHL ${p._po ? "playoff" : "regular-season"} games with a shot chart
          (${(p._po ? seasonInfo().gamesPO?.xg_games : seasonInfo().games?.xg_games) || 0} league games have one).
          EHM's charts show about 3 in 4 shots on goal, so counts run lower than the box score; locations and rates are what matter.
          The rink is drawn attacking the net at the top; the net is seen from the shooter.</p></div>
      <div class="seg" role="group" aria-label="Shot map">${modes.map(([k, t], i) => `<button type="button" data-m="${k}" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
    </div>
    <p class="headline" id="shot-headline"></p>
    <div class="maps">
      <figure><div id="rinkmap"></div><figcaption id="rink-cap"></figcaption></figure>
      <figure><div id="netmap"></div><figcaption id="net-cap"></figcaption></figure>
    </div>
    <div class="legend" id="shot-legend"></div>
    <details><summary>Zone table</summary><div class="tablewrap" id="zone-table"></div></details>
  </div>`;
}

function initShotMaps(p) {
  const panel = view.querySelector("#shotpanel");
  if (!panel) return;
  const draw = m => {
    panel.querySelectorAll(".seg button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
    drawShotMaps(p, m);
  };
  panel.querySelectorAll(".seg button").forEach(b => b.onclick = () => draw(b.dataset.m));
  draw("shots");
}

function rinkSVG(inner, k) {
  const W = 85 * k, H = 81 * k, X = fy => (fy + 42.5) * k, Y = fx => (fx + 11) * k;
  const line = css("--axis"), red = css("--neg"), blue = css("--s1");
  const r = 28 * k, gx = (28 - Math.sqrt(28 * 28 - 17 * 17)) * k;
  const outline = `M0,${H} L0,${r} A${r},${r} 0 0 1 ${r},0 L${W - r},0 A${r},${r} 0 0 1 ${W},${r} L${W},${H} Z`;
  const circle = fy => `<circle cx="${X(fy)}" cy="${Y(20)}" r="${15 * k}" fill="none" stroke="${red}" stroke-opacity=".45"/>
    <circle cx="${X(fy)}" cy="${Y(20)}" r="${1 * k}" fill="${red}" fill-opacity=".6"/>`;
  return `<svg class="rink" viewBox="-2 -2 ${W + 4} ${H + 4}" role="img" aria-label="Offensive-zone shot map">
    <defs><clipPath id="rinkclip"><path d="${outline}"/></clipPath></defs>
    <path d="${outline}" fill="${css("--surface")}" stroke="none"/>
    <g clip-path="url(#rinkclip)">${inner}
      <line x1="${gx}" x2="${W - gx}" y1="${Y(0)}" y2="${Y(0)}" stroke="${red}" stroke-opacity=".6" stroke-width="2"/>
      <rect x="0" y="${Y(64)}" width="${W}" height="${1 * k}" fill="${blue}" fill-opacity=".45"/>
      <path d="M${X(-6)},${Y(0)} A${6 * k},${6 * k} 0 0 0 ${X(6)},${Y(0)}" fill="${blue}" fill-opacity=".12" stroke="${red}" stroke-opacity=".5"/>
      <rect x="${X(-3)}" y="${Y(-3.3)}" width="${6 * k}" height="${3.3 * k}" fill="none" stroke="${line}" stroke-width="2"/>
      ${circle(-22)}${circle(22)}
    </g>
    <path d="${outline}" fill="none" stroke="${line}" stroke-width="2"/>
  </svg>`;
}

function drawShotMaps(p, mode) {
  const isG = p.grp === "G";
  const rows = (isG ? p.sa : p.shots) || [];
  const k = 6, X = fy => (fy + 42.5) * k, Y = fx => (fx + 11) * k;
  const goals = rows.filter(s => s[4] === 1);
  const zs = zoneStats(rows), lz = leagueZones();
  const s2 = css("--s2");
  let inner = "", legend = "";

  if (mode === "eff") {
    // Per zone: goals vs expected, shrunk towards zero for small samples.
    for (const [name, a, b, c, d] of ZONES) {
      const z = zs[name];
      if (!z) continue;
      const val = (z.g - z.xg) / (z.n + 10) * (isG ? -1 : 1);
      const col = pctColor(Math.max(0, Math.min(100, 50 + val / 0.08 * 50)));
      inner += `<rect x="${X(c)}" y="${Y(a)}" width="${(d - c) * k}" height="${(Math.min(b, 70) - a) * k}" fill="${col.bg}" stroke="${css("--surface")}" stroke-width="2"/>`;
      if (z.n >= 3 && b <= 70) inner += `<text x="${X((c + d) / 2)}" y="${Y((a + Math.min(b, 70)) / 2) + 4}" text-anchor="middle" class="zl" fill="${col.fg}">${z.g}/${z.n}</text>`;
    }
    legend = `<span class="legend-scale">${isG ? "worse than expected" : "below expected"} <i style="background:linear-gradient(90deg,${pctColor(0).bg},${pctColor(50).bg},${pctColor(100).bg})"></i> ${isG ? "better" : "above expected"}</span>
      <span class="muted small">Numbers = ${isG ? "goals allowed / shots faced" : "goals / shots"} from that zone</span>`;
  } else {
    const pts = (mode === "goals" ? goals : rows).filter(s => s[0] < 75).map(s => [s[1], s[0], 1]);
    const dens = kde(pts, -42.5, 42.5, -11, 70, 1.5, 4, 4);
    inner += heatRects(dens, -42.5, -11, 1.5, X, Y, 1.5 * k, 1.5 * k);
    legend = `<span class="legend-scale">fewer <i style="background:linear-gradient(90deg,${seqScale().join(",")})"></i> more ${mode === "goals" ? "goals" : "shots"}</span>
      <span style="--c:${s2}" class="dot">${isG ? "goal against" : "goal"}</span>`;
  }
  inner += goals.filter(s => s[0] < 70).map(s =>
    `<circle cx="${X(s[1]).toFixed(1)}" cy="${Y(s[0]).toFixed(1)}" r="4" fill="${s2}" stroke="${css("--surface")}" stroke-width="2"/>`).join("");
  // zone hit areas for the tooltip
  inner += ZONES.filter(z => z[1] < 70).map(([name, a, b, c, d]) =>
    `<rect class="zhit" data-z="${name}" x="${X(c)}" y="${Y(a)}" width="${(d - c) * k}" height="${(Math.min(b, 70) - a) * k}" fill="transparent"/>`).join("");
  view.querySelector("#rinkmap").innerHTML = rinkSVG(inner, k);
  view.querySelector("#rink-cap").textContent = isG ? "Where shots against came from" : "Where he shoots from";
  view.querySelector("#shot-legend").innerHTML = legend;

  const zoneTip = name => {
    const z = zs[name] || { n: 0, g: 0, xg: 0 }, l = lz[name] || { n: 0, g: 0, xg: 0 };
    const pct = (g, n) => n ? (100 * g / n).toFixed(1) + "%" : "–";
    return `<b>${name}</b>
      <div class="row"><span>${isG ? "Shots faced" : "Shots"}</span><b>${z.n}</b></div>
      <div class="row"><span>${isG ? "Goals allowed" : "Goals"}</span><b>${z.g}</b></div>
      <div class="row"><span>Expected goals</span><span>${z.xg.toFixed(1)}</span></div>
      <div class="row"><span>${isG ? "Save %" : "Shooting %"}</span><span>${isG ? (z.n ? (1 - z.g / z.n).toFixed(3).replace(/^0/, "") : "–") : pct(z.g, z.n)}</span></div>
      <div class="row muted"><span>League ${isG ? "save %" : "shooting %"}</span><span>${isG ? (l.n ? (1 - l.g / l.n).toFixed(3).replace(/^0/, "") : "–") : pct(l.g, l.n)}</span></div>`;
  };
  view.querySelectorAll("#rinkmap .zhit").forEach(r => {
    r.addEventListener("mousemove", e => showTip(e, zoneTip(r.dataset.z)));
    r.addEventListener("mouseleave", () => (tip.hidden = true));
  });

  drawNet(p, rows, mode);
  shotHeadline(p, zs, lz);

  const order = ZONES.map(z => z[0]).filter(n => zs[n]);
  view.querySelector("#zone-table").innerHTML = `<table><thead><tr><th>Zone</th><th class="num">${isG ? "Shots faced" : "Shots"}</th>
    <th class="num">Share</th><th class="num">${isG ? "GA" : "Goals"}</th><th class="num">xG</th><th class="num">${isG ? "xG − GA" : "G − xG"}</th>
    <th class="num">${isG ? "Sv%" : "Sh%"}</th><th class="num">League</th></tr></thead><tbody>${order.map(n => {
      const z = zs[n], l = lz[n] || { n: 0, g: 0 }, diff = isG ? z.xg - z.g : z.g - z.xg;
      const rate = (g, c) => c ? (isG ? (1 - g / c).toFixed(3).replace(/^0/, "") : (100 * g / c).toFixed(1) + "%") : "–";
      return `<tr><td>${n}</td><td class="num">${z.n}</td><td class="num">${(100 * z.n / rows.length).toFixed(0)}%</td>
        <td class="num">${z.g}</td><td class="num">${z.xg.toFixed(1)}</td>
        <td class="num ${diff > 0.5 ? "up" : diff < -0.5 ? "down" : ""}">${diff > 0 ? "+" : ""}${diff.toFixed(1)}</td>
        <td class="num">${rate(z.g, z.n)}</td><td class="num muted">${rate(l.g, l.n)}</td></tr>`;
    }).join("")}</tbody></table>`;
}

function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  placeTip(e);
}
/* Next to the pointer, kept inside the window (flipped above it near the bottom edge). */
function placeTip(e) {
  tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)) + "px";
  const below = e.clientY + 14;
  tip.style.top = (below + tip.offsetHeight > innerHeight - 8 ? Math.max(8, e.clientY - tip.offsetHeight - 10) : below) + "px";
}
// a tap leaves no mouseleave behind: hide the tooltip on scroll and on a tap elsewhere
addEventListener("scroll", () => { if (!tip.hidden) tip.hidden = true; }, { passive: true });
document.addEventListener("touchstart", e => { if (!e.target.closest("svg")) tip.hidden = true; }, { passive: true });

function shotHeadline(p, zs, lz) {
  const isG = p.grp === "G";
  const scored = Object.entries(zs).filter(([, z]) => z.n >= 5)
    .map(([n, z]) => [n, z, (isG ? z.xg - z.g : z.g - z.xg) / (z.n + 10)]);
  const most = Object.entries(zs).sort((a, b) => b[1].n - a[1].n)[0];
  const total = Object.values(zs).reduce((s, z) => s + z.n, 0);
  let html = `<b>${isG ? "Most shots faced from" : "Shoots most from"}:</b> ${most[0]} (${(100 * most[1].n / total).toFixed(0)}% of ${total}).`;
  if (scored.length) {
    const best = scored.reduce((a, b) => (b[2] > a[2] ? b : a)), worst = scored.reduce((a, b) => (b[2] < a[2] ? b : a));
    const sh = z => isG ? (1 - z.g / z.n).toFixed(3).replace(/^0/, "") + " sv%" : (100 * z.g / z.n).toFixed(0) + "% shooting";
    const lg = n => { const l = lz[n]; return l && l.n ? (isG ? (1 - l.g / l.n).toFixed(3).replace(/^0/, "") : (100 * l.g / l.n).toFixed(0) + "%") : "–"; };
    html += ` <b>${isG ? "Strongest against" : "Most effective from"}:</b> ${best[0]}: ${best[1].g} ${isG ? "GA" : "G"} on ${best[1].n} (${sh(best[1])}, league ${lg(best[0])}).`;
    if (worst[0] !== best[0] && worst[2] < 0)
      html += ` <b>${isG ? "Weakest against" : "Least effective"}:</b> ${worst[0]}: ${worst[1].g} on ${worst[1].n} (league ${lg(worst[0])}).`;
  }
  view.querySelector("#shot-headline").innerHTML = html;
}

function drawNet(p, rows, mode) {
  const isG = p.grp === "G";
  const on = rows.filter(s => s[2] != null && s[3] != null);
  const goals = on.filter(s => s[4] === 1);
  const k = 52, u0 = -0.2, u1 = 1.2, v0 = -0.4, v1 = 1.08;     // units: nx (6 ft), ny (4 ft)
  const X = u => (u - u0) * 6 * k, Y = v => (v - v0) * 4 * k;
  const W = (u1 - u0) * 6 * k, H = (v1 - v0) * 4 * k;
  const s2 = css("--s2"), line = css("--ink-2"), surface = css("--surface");
  let inner = "";
  if (mode === "eff") {
    for (const [rn, a, b] of NET_ZONES) for (const [cn, c, d] of NET_COLS) {
      const inZ = on.filter(s => s[3] >= a && s[3] < b && s[2] >= c && s[2] < d);
      if (!inZ.length) continue;
      const g = inZ.filter(s => s[4] === 1).length, xg = inZ.reduce((t, s) => t + s[5] / 1000, 0);
      const val = (g - xg) / (inZ.length + 10) * (isG ? -1 : 1);
      const col = pctColor(Math.max(0, Math.min(100, 50 + val / 0.08 * 50)));
      inner += `<rect x="${X(c)}" y="${Y(a)}" width="${(d - c) * 6 * k}" height="${(Math.min(b, 1) - a) * 4 * k}" fill="${col.bg}" stroke="${surface}" stroke-width="2"/>
        <text x="${X((c + d) / 2)}" y="${Y((a + Math.min(b, 1)) / 2) + 4}" text-anchor="middle" class="zl" fill="${col.fg}">${g}/${inZ.length}</text>`;
    }
  } else {
    const pts = (mode === "goals" ? goals : on).map(s => [s[2], s[3], 1]);
    const dens = kde(pts, u0, u1, v0, v1, 0.02, 0.07, 0.1);
    inner += heatRects(dens, u0, v0, 0.02, X, Y, 0.02 * 6 * k, 0.02 * 4 * k);
  }
  inner += goals.map(s => `<circle cx="${X(s[2]).toFixed(1)}" cy="${Y(s[3]).toFixed(1)}" r="4" fill="${s2}" stroke="${surface}" stroke-width="2"/>`).join("");
  // 3 x 3 hit areas for the tooltip
  for (const [rn, a, b] of NET_ZONES) for (const [cn, c, d] of NET_COLS)
    inner += `<rect class="nhit" data-r="${rn}" data-c="${cn}" data-a="${a}" data-b="${b}" data-cc="${c}" data-d="${d}" x="${X(c)}" y="${Y(a)}" width="${(d - c) * 6 * k}" height="${(Math.min(b, 1) - a) * 4 * k}" fill="transparent"/>`;
  const grid = [1 / 3, 2 / 3].map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${Y(0)}" y2="${Y(1)}" stroke="${line}" stroke-opacity=".18"/>
    <line x1="${X(0)}" x2="${X(1)}" y1="${Y(t)}" y2="${Y(t)}" stroke="${line}" stroke-opacity=".18"/>`).join("");
  view.querySelector("#netmap").innerHTML = `<svg class="net" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net shot map">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${surface}"/>
    <rect x="${X(0)}" y="${Y(0)}" width="${6 * k}" height="${4 * k}" fill="${css("--surface-2")}"/>
    ${inner}${grid}
    <path d="M${X(0)},${Y(1)} L${X(0)},${Y(0)} L${X(1)},${Y(0)} L${X(1)},${Y(1)}" fill="none" stroke="${css("--neg")}" stroke-width="5" stroke-linejoin="round"/>
    <line x1="0" x2="${W}" y1="${Y(1)}" y2="${Y(1)}" stroke="${css("--axis")}" stroke-width="2"/>
    <text x="${X(0)}" y="${H - 4}" class="nl">shooter's left</text>
    <text x="${X(1)}" y="${H - 4}" text-anchor="end" class="nl">shooter's right</text>
  </svg>`;
  view.querySelector("#net-cap").textContent = isG ? `Where the ${on.length} on-target shots against went` : `Where his ${on.length} on-target shots went`;
  view.querySelectorAll("#netmap .nhit").forEach(r => {
    const a = +r.dataset.a, b = +r.dataset.b, c = +r.dataset.cc, d = +r.dataset.d;
    const inZ = on.filter(s => s[3] >= a && s[3] < b && s[2] >= c && s[2] < d);
    const g = inZ.filter(s => s[4] === 1).length;
    const html = `<b>${r.dataset.r} ${r.dataset.c}</b>
      <div class="row"><span>${isG ? "Shots faced" : "On target"}</span><b>${inZ.length}</b></div>
      <div class="row"><span>${isG ? "Goals allowed" : "Goals"}</span><b>${g}</b></div>
      <div class="row"><span>${isG ? "Save %" : "Shooting %"}</span><span>${inZ.length ? (isG ? (1 - g / inZ.length).toFixed(3).replace(/^0/, "") : (100 * g / inZ.length).toFixed(1) + "%") : "–"}</span></div>`;
    r.addEventListener("mousemove", e => showTip(e, html));
    r.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

function attrTables(p) {
  const last = p.h.at(-1), first = p.h[0];
  const sections = {};
  D.attrs.forEach((a, i) => {
    const v = last[i + 2];
    if (v == null) return;
    const [sec, name] = a.split(": ");
    const d = first[i + 2] == null ? 0 : v - first[i + 2];
    (sections[sec] ||= []).push(`<tr data-i="${i}" tabindex="0" title="Chart ${esc(name)}"><td>${esc(name)}</td><td class="num"><b>${v}</b></td>
      <td class="num ${d > 0 ? "up" : d < 0 ? "down" : "muted"}">${d > 0 ? "+" + d : d < 0 ? d : "·"}</td></tr>`);
  });
  return Object.entries(sections).map(([s, rows]) => `<div><h4>${esc(s)}</h4><table><tbody>${rows.join("")}</tbody></table></div>`).join("");
}

// ---------------------------------------------------------------- projected attributes
/* Attribute change = b0*dCA + b1*dCA*(a-10)/10 + b2*m + b3*m*(age-27)/10, coefficients per position
   group and (when known) preferred role; range from the CA band plus the attribute's own noise.
   Up to 12 months the expected value comes from the forecast models instead (p.af: change after 3, 6
   and 12 months, interpolated from 0 today), which beat this model in the fair test; the range keeps
   its width, centred on that value. */
function forecastChange(p, i, m) {
  if (!p.af || m > 12) return null;
  const pts = [[0, 0], ...Object.entries(p.af).map(([k, v]) => [+k, v[i]])].sort((a, b) => a[0] - b[0]);
  if (pts.some(x => x[1] == null)) return null;
  for (let j = 1; j < pts.length; j++)
    if (m <= pts[j][0]) return pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * (m - pts[j - 1][0]) / (pts[j][0] - pts[j - 1][0]);
  return pts.at(-1)[1];
}
function projectAttrs(p, q) {
  const M = D.attrModel;
  if (!M) return [];
  const last = p.h.at(-1), age0 = q.age - q.m / 12;
  const out = [];
  D.attrs.forEach((c, i) => {
    const v0 = last[i + 2];
    const coef = (p.sc?.role && M.roles[p.sc.role]?.[c]) || M.groups[p.grp]?.[c];
    if (v0 == null || !coef) return;
    const lin = dca => v0 + coef[0] * dca + coef[1] * dca * (v0 - 10) / 10 + coef[2] * q.m + coef[3] * q.m * (age0 - 27) / 10;
    const fc = forecastChange(p, i, q.m), shift = fc == null ? 0 : v0 + fc - lin(q.mid - p.ca);
    const f = dca => lin(dca) + shift;
    const a = f(q.lo - p.ca), b = f(q.hi - p.ca), mid = f(q.mid - p.ca);
    const noise = 1.28 * coef[4] * Math.sqrt(Math.max(q.m, 0.5));
    const clamp = v => Math.max(1, Math.min(20, v));
    out.push({ c, v0, mid: clamp(mid), lo: clamp(Math.min(a, b, mid) - noise), hi: clamp(Math.max(a, b, mid) + noise),
               role: !!(p.sc?.role && M.roles[p.sc.role]?.[c]) });
  });
  return out;
}
function renderAttrProjection(p, proj, month) {
  const box = view.querySelector("#attrproj");
  if (!box || !D.attrModel) return;
  const q = proj[Math.max(1, Math.min(proj.length - 1, month))];
  const rows = projectAttrs(p, q);
  if (!rows.length) { box.innerHTML = ""; return; }
  const opts = proj.filter(x => x.m > 0 && (x.m % 6 === 0 || x.m === q.m));
  const sections = {};
  rows.forEach(r => (sections[r.c.split(": ")[0]] ||= []).push(r));
  const usesRole = rows.some(r => r.role);
  box.innerHTML = `<div class="attrproj">
    <div class="chart-head"><div><h3>Projected attributes</h3>
      <p class="sub">Click any point on the projection, or pick a date. Expected value with an 80% range, driven by the projected
      ability (${q.mid.toFixed(0)}, range ${q.lo.toFixed(0)}–${q.hi.toFixed(0)}) and ${usesRole ? `how <b>${esc(p.sc.role)}s</b>` : `how ${{ F: "forwards", D: "defencemen", G: "goalies" }[p.grp]}`}
      typically spread growth across attributes at age ${q.age.toFixed(1)}.</p></div>
      <label class="small muted">Date <select id="ap-month">${opts.map(x => `<option value="${x.m}" ${x.m === q.m ? "selected" : ""}>${fmtDate(x.date)} (age ${x.age.toFixed(1)})</option>`).join("")}</select></label>
    </div>
    <div class="attr-grid">${Object.entries(sections).map(([sec, rs]) => `<div><h4>${esc(sec)}</h4><table><thead><tr>
      <th>Attribute</th><th class="num">Now</th><th class="num">Projected</th><th class="num">Range</th><th></th></tr></thead><tbody>
      ${rs.map(r => { const d = Math.round(r.mid) - r.v0;
        return `<tr><td>${esc(r.c.split(": ")[1])}</td><td class="num">${r.v0}</td><td class="num"><b>${Math.round(r.mid)}</b></td>
          <td class="num muted">${Math.round(r.lo)}–${Math.round(r.hi)}</td>
          <td class="num ${d > 0 ? "up" : d < 0 ? "down" : "muted"}">${d > 0 ? "+" + d : d < 0 ? d : "·"}</td></tr>`; }).join("")}
      </tbody></table></div>`).join("")}</div></div>`;
  box.querySelector("#ap-month").onchange = e => renderAttrProjection(p, proj, +e.target.value);
}

// ---------------------------------------------------------------- chart
let LAST_CHART = null;   // [player, projection, metric, width] of the drawn ability chart
addEventListener("resize", () => {
  clearTimeout(LAST_CHART?.timer);
  if (!LAST_CHART) return;
  LAST_CHART.timer = setTimeout(() => {
    redrawChartIfResized();
  }, 200);
});
function redrawChartIfResized() {
  const box = view.querySelector("#chart");
  if (box && box.clientWidth && LAST_CHART && Math.abs(box.clientWidth - LAST_CHART[3]) > 60) drawChart(...LAST_CHART.slice(0, 3));
}
function drawChart(p, proj, metric) {
  const box = view.querySelector("#chart");
  const isCA = metric === "ca";
  const idx = isCA ? 1 : +metric + 2;
  const hist = p.h.filter(h => h[idx] != null).map(h => ({ date: new Date(D.dates[h[0]] + "T00:00:00"), v: h[idx] }));
  const name = isCA ? "Est. CA" : D.attrs[+metric].split(": ")[1];
  const s1 = css("--s1"), s2 = css("--s2");

  view.querySelector("#chart-title").textContent = isCA ? "Ability over time and projection" : `${name} over time`;
  view.querySelector("#chart-sub").textContent = isCA
    ? `Estimated CA at each snapshot, then a ${D.projectionMonths}-month projection towards estimated PA (${fmt(p.pa, 0)}). Shaded band = 80% range.`
    : "Attribute value (1–20) at each snapshot. Projections are only made for overall ability.";
  view.querySelector("#legend").innerHTML = isCA
    ? `<span style="--c:${s1}">Est. CA (snapshots)</span><span style="--c:${s2}">Projection</span><span class="band" style="--c:${s2}">80% range</span>`
    : "";

  // drawn at the box's real width (1 unit = 1 px), so the labels keep their size on a phone instead of shrinking
  // with a fixed 1000-wide viewBox; redrawn when the width changes a lot (see the resize listener below)
  const W = Math.round(Math.max(300, Math.min(1400, box.clientWidth || 1000))), H = W < 640 ? 240 : 340;
  const m = { l: 40, r: W < 640 ? 34 : 70, t: 14, b: 30 };
  LAST_CHART = [p, proj, metric, W];
  const x0 = hist[0].date, x1 = isCA ? proj.at(-1).date : hist.at(-1).date;
  const span = Math.max(1, x1 - x0);
  let lo, hi;
  if (isCA) {
    lo = Math.min(...hist.map(h => h.v), ...proj.map(q => q.lo));
    hi = Math.max(...hist.map(h => h.v), ...proj.map(q => q.hi));
    lo = Math.max(0, Math.floor((lo - 8) / 20) * 20); hi = Math.min(200, Math.ceil((hi + 8) / 20) * 20);
  } else { lo = 0; hi = 20; }
  const X = d => m.l + (d - x0) / span * (W - m.l - m.r);
  const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const step = isCA ? (hi - lo > 80 ? 40 : 20) : 5;

  let g = "";
  for (let v = lo; v <= hi; v += step)
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css("--grid")}" stroke-width="1"/>
          <text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  // month ticks at least ~56 px apart: every 6 or 12 months (Jan/Jul) for the CA chart, every n months for attributes
  const perMonth = (W - m.l - m.r) / Math.max(1, span / (30.44 * 864e5));
  const tickEvery = isCA ? (perMonth * 6 < 56 ? 12 : 6) : Math.max(1, Math.ceil(56 / perMonth));
  const t = new Date(x0.getFullYear(), x0.getMonth() + 1, 1);
  for (let i = 0; t <= x1; i++, t.setMonth(t.getMonth() + 1)) {
    if (isCA ? t.getMonth() % tickEvery !== 0 : i % tickEvery !== 0) continue;
    g += `<line x1="${X(t)}" x2="${X(t)}" y1="${H - m.b}" y2="${H - m.b + 4}" stroke="${css("--axis")}"/>
          <text x="${X(t)}" y="${H - m.b + 17}" text-anchor="middle">${t.toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</text>`;
  }
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${css("--axis")}"/>`;

  if (isCA) {
    const band = proj.map(q => `${X(q.date)},${Y(q.hi)}`).join(" ") + " " + proj.slice().reverse().map(q => `${X(q.date)},${Y(q.lo)}`).join(" ");
    g += `<polygon points="${band}" fill="${s2}" opacity="0.12"/>`;
    g += `<polyline points="${proj.map(q => `${X(q.date)},${Y(q.mid)}`).join(" ")}" fill="none" stroke="${s2}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const end = proj.at(-1);
    g += `<circle cx="${X(end.date)}" cy="${Y(end.mid)}" r="4" fill="${s2}" stroke="${css("--surface")}" stroke-width="2"/>
          <text class="lbl" x="${X(end.date) + 8}" y="${Y(end.mid) + 4}">${end.mid.toFixed(0)}</text>`;
  }
  g += `<polyline points="${hist.map(h => `${X(h.date)},${Y(h.v)}`).join(" ")}" fill="none" stroke="${s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  g += hist.map(h => `<circle cx="${X(h.date)}" cy="${Y(h.v)}" r="4" fill="${s1}" stroke="${css("--surface")}" stroke-width="2"/>`).join("");
  const lastH = hist.at(-1);
  if (!isCA) g += `<text class="lbl" x="${X(lastH.date) + 8}" y="${Y(lastH.v) + 4}">${lastH.v}</text>`;
  else g += `<text class="lbl" x="${X(lastH.date)}" y="${Y(lastH.v) - 10}" text-anchor="middle">${lastH.v.toFixed(0)}</text>`;
  g += `<line id="xh" y1="${m.t}" y2="${H - m.b}" stroke="${css("--axis")}" stroke-width="1" visibility="hidden"/>
        <rect id="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} over time">${g}</svg>`;

  // hover: nearest snapshot or projection month
  const pts = hist.map(h => ({ date: h.date, html: `<div class="row"><span>${esc(name)}</span><b>${isCA ? h.v.toFixed(1) : h.v}</b></div>` }));
  if (isCA) proj.slice(1).forEach(q => pts.push({ date: q.date, q,
    html: `<div class="row"><span>Projected</span><b>${q.mid.toFixed(0)}</b></div><div class="row muted"><span>80% range</span><span>${q.lo.toFixed(0)}–${q.hi.toFixed(0)}</span></div><div class="row muted"><span>Age</span><span>${q.age.toFixed(1)}</span></div>` }));
  const svg = box.querySelector("svg"), xh = svg.querySelector("#xh");
  svg.querySelector("#hit").addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width * W;
    const best = pts.reduce((a, b) => Math.abs(X(b.date) - sx) < Math.abs(X(a.date) - sx) ? b : a);
    xh.setAttribute("x1", X(best.date)); xh.setAttribute("x2", X(best.date)); xh.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${fmtDate(best.date)}</b>${best.html}${best.q ? `<div class="muted small">Click for the projected attributes</div>` : ""}`;
    tip.hidden = false;
    placeTip(e);
    e.currentTarget.style.cursor = best.q ? "pointer" : "default";   // only projected months open something
  });
  svg.querySelector("#hit").addEventListener("mouseleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
  // click a projected month: show the projected attributes for that date
  svg.querySelector("#hit").addEventListener("click", e => {
    if (!isCA) return;
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W;
    const best = pts.reduce((a, b) => Math.abs(X(b.date) - sx) < Math.abs(X(a.date) - sx) ? b : a);
    if (best.q) renderAttrProjection(p, proj, best.q.m);
  });

  const rows = hist.map(h => `<tr><td>${fmtDate(h.date)}</td><td>Snapshot</td><td class="num">${isCA ? h.v.toFixed(1) : h.v}</td><td></td></tr>`);
  if (isCA) proj.filter(q => q.m % 3 === 0 && q.m > 0).forEach(q =>
    rows.push(`<tr><td>${fmtDate(q.date)}</td><td>Projection (age ${q.age.toFixed(1)})</td><td class="num">${q.mid.toFixed(1)}</td><td class="num muted">${q.lo.toFixed(0)}–${q.hi.toFixed(0)}</td></tr>`));
  view.querySelector("#chart-table").innerHTML = `<table><thead><tr><th>Date</th><th>Source</th><th class="num">${esc(name)}</th><th class="num">80% range</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/* PNG export: every tab on one compact sheet (card, bio, ability chart, attributes with the 12-month projection,
   career stats, scout report, shot maps, comparables, draft & achievements). The sheet is built off-screen and
   removed again; charts drawn in a different mode for the export (CA chart, shots-taken maps, each career table)
   are redrawn as they were in the same task, so the page never shows it. */
function exportCard(p, proj, X) {
  if (!window.html2canvas) { alert("PNG export needs an internet connection (html2canvas loads from cdnjs)."); return; }
  const grab = sel => view.querySelector(sel)?.innerHTML || "";
  const frag = html => { const t = document.createElement("template"); t.innerHTML = html; return t.content; };
  const outer = f => [...f.children].map(e => e.outerHTML).join("");

  const metric = view.querySelector("#metric").value;
  if (metric !== "ca") drawChart(p, proj, "ca");
  const chart = grab("#chart"), legend = grab("#legend");
  if (metric !== "ca") drawChart(p, proj, metric);

  let shots = "";
  const shotMode = view.querySelector("#shotpanel .seg button.on")?.dataset.m;
  if (shotMode) {
    if (shotMode !== "shots") drawShotMaps(p, "shots");
    shots = `<div class="panel"><h2>Shot maps · ${p.grp === "G" ? "shots against" : "shots taken"}</h2><p class="headline">${grab("#shot-headline")}</p>
      <div class="maps"><figure>${grab("#rinkmap")}<figcaption>${grab("#rink-cap")}</figcaption></figure>
        <figure>${grab("#netmap")}<figcaption>${grab("#net-cap")}</figcaption></figure></div>
      <div class="legend">${grab("#shot-legend")}</div></div>`;
    if (shotMode !== "shots") drawShotMaps(p, shotMode);
  }

  const keep = CTYPE, careers = [];
  for (const [t, label] of CAR_TYPES.filter(([t]) => t !== "O" && view.querySelector(`#car-type button[data-t="${t}"]`))) {
    CTYPE = t; drawCareer(p); careers.push(`<h3>${label}</h3>${grab("#car-table")}`);
  }
  if (careers.length) { CTYPE = keep; drawCareer(p); }

  const compMode = view.querySelector("#comps-mode button.on");
  const comps = frag(grab("#comps-table"));
  comps.querySelectorAll("tbody tr:nth-child(n+7)").forEach(tr => tr.remove());

  let scout = "";
  if (p.sc) {
    const f = frag(scoutPanel(p));
    const report = [p.sc.report, p.sc.projection].filter(Boolean).map(esc).join(" ");
    f.querySelector("details").outerHTML = report ? `<p class="small">${report}</p>` : "";
    scout = outer(f);
  }

  // facts the card's header doesn't already show
  const bio = factRows(p, X).filter(([k]) => ["Born", "Birthplace", "Condition", "Drafted", "Junior draft", "Career role"].includes(k));
  const sheet = document.createElement("div");
  sheet.className = "xsheet";
  sheet.innerHTML = `
    <div class="xrow">
      ${view.querySelector("#card").outerHTML}
      <div class="xcol">
        ${bio.length ? `<div class="panel"><h2>Bio</h2>${factList(bio)}</div>` : ""}
        <div class="panel"><h2>Ability over time and projection</h2><div class="legend">${legend}</div>${chart}</div>
        <div class="panel"><h2>Attributes · change since ${fmtDate(D.dates[X.first[0]])}${D.attrModel ? " · projected in 12 months" : ""}</h2>
          <div class="attr-grid">${exportAttrs(p, proj)}</div></div>
        ${comps.children.length ? `<div class="panel"><h2>Comparable players${compMode ? " · " + esc(compMode.textContent) : ""}</h2>${outer(comps)}</div>` : ""}
      </div>
    </div>
    ${careers.length ? `<div class="panel"><h2>Career statistics</h2>${careers.join("")}</div>` : ""}
    ${X.t ? `<div class="panel"><h2>NHL box-score totals</h2>${totalsTable(p, X.t)}</div>` : ""}
    <div class="xrow">${scout}<div class="xcol">${shots}${achievementsPanel(p)}</div></div>
    <div class="xfoot"><span>${esc(D.title || "EHM Player Cards")} · ${esc(p.n)}${SEASON ? " · " + seasonLabel(SEASON) : ""}${p._po ? " playoffs" : ""}</span>
      <span>Snapshot ${fmtDate(D.dates.at(-1))}</span></div>`;
  sheet.querySelectorAll(".logo").forEach(e => e.remove());   // NHL logos are cross-origin: html2canvas can't draw them
  document.body.appendChild(sheet);
  // html2canvas draws an SVG as an image of its own markup, so the stylesheet's text styles must be inlined
  sheet.querySelectorAll("svg text").forEach(t => {
    const s = getComputedStyle(t);
    Object.assign(t.style, { fill: s.fill, fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily });
  });
  html2canvas(sheet, { scale: 2, backgroundColor: css("--page"), windowWidth: 1700 }).then(canvas => {
    const a = document.createElement("a");
    a.download = p.n.replace(/[^\w\- ]+/g, "") + " card.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  }).catch(e => alert("PNG export failed: " + e.message)).finally(() => sheet.remove());
}
/* Attribute tables for the export: value, change since the first snapshot, expected value in 12 months. */
function exportAttrs(p, proj) {
  const last = p.h.at(-1), first = p.h[0];
  const q = proj[Math.min(12, proj.length - 1)];
  const fut = new Map(q?.m ? projectAttrs(p, q).map(r => [r.c, Math.round(r.mid)]) : []);
  const delta = d => `<td class="num ${d > 0 ? "up" : d < 0 ? "down" : "muted"}">${d > 0 ? "+" + d : d < 0 ? d : "·"}</td>`;
  const sections = {};
  D.attrs.forEach((a, i) => {
    const v = last[i + 2];
    if (v == null) return;
    const [sec, name] = a.split(": ");
    const f = fut.get(a);
    (sections[sec] ||= []).push(`<tr><td>${esc(name)}</td><td class="num"><b>${v}</b></td>${delta(first[i + 2] == null ? 0 : v - first[i + 2])}
      ${fut.size ? (f == null ? `<td class="num muted">–</td>` : `<td class="num ${f > v ? "up" : f < v ? "down" : ""}">${f}</td>`) : ""}</tr>`);
  });
  return Object.entries(sections).map(([s, rows]) => `<div><h4>${esc(s)}</h4><table><thead><tr><th></th><th class="num">Now</th>
    <th class="num">±</th>${fut.size ? `<th class="num">12 mo</th>` : ""}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`).join("");
}

// ---------------------------------------------------------------- about
// ---------------------------------------------------------------- scout report + hidden values
let SCOUTED = null;
function scoutPanel(p) {
  const s = p.sc;
  if (!s) {
    // with reports in the data, a missing one means the crawled club's scouts have none (his Scout Report tab is greyed out)
    SCOUTED ??= D.players.filter(q => q.sc).length;
    return `<div class="panel" id="scoutpanel"><h2>Scout report &amp; hidden values</h2>
    <p class="sub">${SCOUTED ? `No scout report on him: the scouts of the club the crawler logs in as haven't covered him, so his Scout Report
      tab was greyed out when the crawler read it (${SCOUTED.toLocaleString()} of ${D.players.length.toLocaleString()} players have one). Scouting him in the game
      (or a scout assignment that covers him) brings it in with the next scout pass.` : `No scout reports in this data yet. Run the crawler with <code>--scout</code>
      to read every player's Scout Report tab (stars, report text and role).`} The report phrases are decoded into hidden-value ranges.</p></div>`;
  }
  const hidden = s.ranges.filter(r => r[3]), shown = s.ranges.filter(r => !r[3]);
  const actual = name => {
    const i = D.attrs.findIndex(a => a.endsWith(": " + name));
    return i < 0 ? null : p.h.at(-1)[i + 2];
  };
  const row = ([name, lo, hi, isHidden]) => {
    const v = isHidden ? null : actual(name);
    const off = v != null && (v < lo || v > hi);
    const X = x => ((x - 0.5) / 20 * 100).toFixed(2);
    return `<div class="hv" title="${esc(name)}: ${lo === hi ? lo : lo + "–" + hi}${v != null ? ` (shown: ${v})` : ""}">
      <span class="hl">${esc(name)}</span>
      <span class="ht">${[5, 10, 15].map(t => `<i class="tick" style="left:${X(t + 0.5)}%"></i>`).join("")}
        <i class="band ${isHidden ? "hid" : "vis"}" style="left:${X(lo)}%;width:${((hi - lo + 1) / 20 * 100).toFixed(2)}%"></i>
        ${v != null ? `<i class="val ${off ? "off" : ""}" style="left:${X(v + 0.5)}%"></i>` : ""}</span>
      <span class="hr">${lo === hi ? lo : `${lo}–${hi}`}${off ? ' <span class="down" title="Shown value is outside the range this phrase implies">≠ ' + v + "</span>" : ""}</span></div>`;
  };
  const starRow = (lab, n) => n == null ? "" : `<span>${lab} <span class="stars">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span></span>`;
  return `<div class="panel" id="scoutpanel">
    <h2>Scout report &amp; hidden values</h2>
    <p class="sub">${esc(s.scout || "Scout")} · ${fmtDate(s.date)} · ${esc(D.title)}
      ${s.reports > 1 ? ` · ${s.reports} reports combined` : ""}</p>
    <div class="scout-head">
      ${starRow("Current", s.cur)}${starRow("Future", s.fut)}
      ${s.career ? `<span>Career role <b>${esc(s.career)}</b></span>` : ""}
      ${s.role ? `<span>Preferred role <b>${esc(s.role)}</b></span>` : ""}
    </div>
    ${s.ranges.length ? `<div class="hv-grid">
      ${hidden.length ? `<div><h4>Hidden (only the scout report reveals these)</h4>${hidden.map(row).join("")}</div>` : ""}
      ${shown.length ? `<div><h4>Visible attributes the report confirms</h4>${shown.map(row).join("")}</div>` : ""}
    </div>
    <div class="legend small"><span class="band hid" style="--c:${css("--s2")}">hidden range</span>
      <span class="band" style="--c:${css("--s1")}">range from the report</span>
      <span class="dot" style="--c:${css("--ink")}">value on the profile</span>
      <span class="muted">scale 1–20</span></div>`
      : `<p class="muted">None of the report's phrases are in the snippet table yet.</p>`}
    ${s.notes.length ? `<p class="small muted">Not pinned to a single attribute: ${s.notes.map(esc).join(" · ")}</p>` : ""}
    <details><summary>Full report and matched phrases</summary>
      <p>${esc(s.report)}</p><p class="muted">${esc(s.projection)}</p>
      <p class="small">Matched snippets: ${s.matched.map(m => `<code>${esc(m)}</code>`).join(" ")}</p></details>
  </div>`;
}

// ---------------------------------------------------------------- draft board
const DR = { mode: "mid", sort: "ours", dir: 1, f: {}, limit: 150 };
const STAGE_ORDER = ["Preliminary", "Mid-Season", "Final"];
/* [key, label, value getter, numeric] */
const DRAFT_COLS = [
  ["ours", "Ours", s => s.ours, true],
  ["nhl", "NHL rank", s => s.nhl, true],
  ["move", "Move", s => s.move, true],
  ["n", "Player", s => s.p.n, false],
  ["pos", "Pos", s => s.p.pos, false],
  ["age", "Age", s => s.p.age, true],
  ["lg", "League", s => s.p.lg || "", false],
  ["cl", "Club", s => s.p.cl || s.p.tm || "", false],
  ["ca", "Est. CA", s => s.p.ca, true],
  ["pa", "Est. PA", s => s.p.pa, true],
  ["peak", "Proj. peak", s => s.mid, true],
  ["lo", "Safe", s => s.lo, true],
  ["hi", "Upside", s => s.hi, true],
  ["fut", "Scout ★", s => s.p.sc?.fut ?? null, true],
  ["tier", "Scout tier", s => (s.p.sc?.career || "").split(",").slice(1).join(",").trim(), false],
  ["role", "Role", s => s.p.sc?.role || "", false],
  ["other", "Other lists", s => s.other, false],
];
/* Column filter: text = contains (case/accent-insensitive, "!x" = doesn't contain);
   numbers: ">150", ">=150", "<20", "100-150", "=5" or a bare number. */
function matchFilter(value, q, numeric) {
  q = q.trim();
  if (!q) return true;
  if (numeric) {
    if (value == null || Number.isNaN(value)) return false;
    let m;
    if ((m = q.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/))) return value >= +m[1] && value <= +m[2];
    if ((m = q.match(/^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/))) {
      const n = +m[2];
      return { ">": value > n, ">=": value >= n, "<": value < n, "<=": value <= n }[m[1]] ?? Math.abs(value - n) < 0.5;
    }
    return true;
  }
  const neg = q.startsWith("!"), t = fold(neg ? q.slice(1) : q);
  return neg ? !fold(value).includes(t) : fold(value).includes(t);
}
function nhlRanks(p) {
  const cur = (p.drs || []).filter(d => d[0].includes("(NHL)"))
    .sort((a, b) => STAGE_ORDER.indexOf(b[0].split(" (")[0]) - STAGE_ORDER.indexOf(a[0].split(" (")[0]))[0];
  if (!cur) return null;
  // movement: the previous NHL list (an earlier stage; the same list repeats in every snapshot of its stage) minus the current one
  const curStage = cur[0].split(" (")[0];
  const hist = (p.nhlr || []).filter(h => h[1] !== curStage)
    .sort((a, b) => a[0].localeCompare(b[0]) || STAGE_ORDER.indexOf(a[1]) - STAGE_ORDER.indexOf(b[1]));
  const prev = hist.at(-1);
  return { rank: cur[1], stage: curStage, move: prev ? prev[2] - cur[1] : null,
           prevTxt: prev ? `${prev[1]} #${prev[2]} (${fmtDate(prev[0])})` : null };
}
/* Players on the latest NHL draft ranking, ranked by projected peak ("ours") under the chosen outcome. */
function draftBoard(mode) {
  const pool = D.players.map(p => ({ p, r: nhlRanks(p) })).filter(x => x.r);
  const stage = pool[0]?.r.stage || "";
  const rows = pool.map(({ p, r }) => {
    const pr = p._proj || (p._proj = project(p));
    const peak = k => Math.max(...pr.map(x => x[k]));
    const other = (p.drs || []).filter(d => !d[0].includes("(NHL)"))
      .map(d => `${d[0].replace(/^(\S+) \((\w+)\)$/, "$2 $1")} #${d[1]}`).join(", ");
    return { p, nhl: r.rank, move: r.move, prevTxt: r.prevTxt, lo: peak("lo"), mid: peak("mid"), hi: peak("hi"), other };
  });
  rows.sort((a, b) => b[mode] - a[mode]).forEach((s, i) => (s.ours = i + 1));
  return { rows, stage };
}
/* Any table with class "sortable": clicking a header sorts the rows by that column (numbers high to low first, text A to Z;
   again to reverse). A cell's data-v overrides its text; "–" sorts last. */
function cellValue(td) {
  const raw = (td?.dataset.v ?? td?.textContent ?? "").trim().replace(/−/g, "-").replace(/,/g, "");
  if (!raw || raw === "–" || raw === "-") return null;
  const m = raw.match(/^([+-]?\d+(?:\.\d+)?)%?(?:\s|$)/);
  return m ? +m[1] : raw.toLowerCase();
}
function makeSortable(root = view) {
  root.querySelectorAll("table.sortable").forEach(tbl => {
    const ths = [...(tbl.tHead?.rows[0]?.cells || [])];
    ths.forEach((th, i) => {
      if (th.dataset.nosort != null) return;
      th.classList.add("sort");
      th.tabIndex = 0;
      if (!th.hasAttribute("aria-sort")) th.setAttribute("aria-sort", "none");
      const go = () => {
        const body = tbl.tBodies[0], rows = [...body.rows];
        const vals = rows.map(tr => cellValue(tr.cells[i]));
        const numeric = vals.some(v => typeof v === "number");
        const cur = th.getAttribute("aria-sort");
        const dir = cur === "none" ? (numeric ? -1 : 1) : cur === "descending" ? 1 : -1;
        const order = rows.map((tr, j) => [tr, vals[j], j]).sort((x, y) => {
          if (x[1] == null) return y[1] == null ? x[2] - y[2] : 1;
          if (y[1] == null) return -1;
          const c = typeof x[1] === "number" && typeof y[1] === "number" ? x[1] - y[1] : String(x[1]).localeCompare(String(y[1]));
          return c * dir || x[2] - y[2];
        });
        order.forEach(([tr]) => body.appendChild(tr));
        ths.forEach(h => { if (h.dataset.nosort == null) { h.setAttribute("aria-sort", "none"); h.classList.remove("on"); } });
        th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
        th.classList.add("on");
      };
      th.onclick = e => { if (!e.target.closest("a")) go(); };
      th.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
  });
}
const DRAFT_TABS = [["board", "Draft board"], ["past", "Past drafts"], ["scores", "Drafters"]];
function draftHead(tab) {
  const tabs = draftValues().picks.length ? DRAFT_TABS : DRAFT_TABS.slice(0, 1);
  return `<section class="band"><div class="wrap"><h1>Draft</h1>
    ${tabBar("Draft sections", tabs, tab, "data-dtab")}</div></section>`;
}
function bindDraftHead() {
  view.querySelectorAll("[data-dtab]").forEach(b => b.onclick = () => (location.hash = "#/draft" + (b.dataset.dtab === "board" ? "" : "/" + b.dataset.dtab)));
}
function renderDraft(tab = "board", arg, pick) {
  markNav("draft");
  if (!DRAFT_TABS.some(t => t[0] === tab)) tab = "board";   // a mistyped #/draft/<x> shows the board
  if (tab !== "board" && draftValues().picks.length) { renderDraftHistory(tab, arg, pick); return; }
  const { rows, stage } = draftBoard(DR.mode);
  const steals = rows.filter(s => s.ours <= 60).sort((a, b) => (b.nhl - b.ours) - (a.nhl - a.ours)).slice(0, 5);
  const fades = rows.filter(s => s.nhl <= 30).sort((a, b) => (a.nhl - a.ours) - (b.nhl - b.ours)).slice(0, 5);
  const line = s => `<li><a href="${route(s.p.k)}">${esc(s.p.n)}</a> <span class="muted">${esc(s.p.pos)}, ${esc(s.p.cl || "")}</span>
    · ours #${s.ours}, NHL #${s.nhl} <span class="muted">(${s.nhl - s.ours > 0 ? "+" : ""}${s.nhl - s.ours})</span></li>`;
  const modeName = { lo: "Safe (10th percentile outcome)", mid: "Balanced (expected outcome)", hi: "Upside (90th percentile outcome)" };
  view.innerHTML = `${draftHead("board")}<div class="panel draftpage">
    <h2>NHL draft board</h2>
    <p class="sub">${rows.length} players on the ${esc(stage)} NHL draft ranking (${fmtDate(D.dates.at(-1))}), ranked by projected peak ability over
      the next ${D.projectionMonths / 12} years. The OHL / WHL / QMJHL / Import lists are shown as extra context only.
      Teenage PA is uncertain (±${D.report.pa_by_age["16-18"].mae} on average), so weigh the range, not just the middle.</p>
    <div class="filters">
      <div class="seg" id="d-mode">${Object.entries({ lo: "Safe", mid: "Balanced", hi: "Upside" })
        .map(([k, t]) => `<button type="button" data-m="${k}" class="${DR.mode === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <span class="muted small">"Ours" ranks by: ${modeName[DR.mode]}</span>
      <button class="ghost small" id="d-clear" type="button">Clear filters</button>
      <span class="muted small" id="d-count"></span>
    </div>
    <div class="draft-notes">
      <div><h4>Best value vs the NHL ranking</h4><ol>${steals.map(line).join("") || "<li class='muted'>–</li>"}</ol></div>
      <div><h4>Ranked higher by the NHL than here</h4><ol>${fades.map(line).join("") || "<li class='muted'>–</li>"}</ol></div>
    </div>
    <div class="tablewrap"><table class="draft">
      <thead><tr>${DRAFT_COLS.map(([k, t, , n]) => `<th class="sort ${n ? "num" : ""} ${DR.sort === k ? "on" : ""}" data-k="${k}">${t}${DR.sort === k ? (DR.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr>
        <tr class="frow">${DRAFT_COLS.map(([k, t, , n]) => `<th><input data-k="${k}" value="${esc(DR.f[k] || "")}" placeholder="${n ? ">0, 5-10" : "filter"}" aria-label="Filter ${esc(t)}"></th>`).join("")}</tr></thead>
      <tbody id="d-body"></tbody></table></div>
    <p id="d-more-wrap"></p>
    <p class="small muted">Filters: text matches anywhere ("!" excludes); numbers accept &gt;, &lt;, &gt;=, &lt;=, ranges like 100-150, or an exact value.
      Move = places gained since the previous NHL ranking. Safe / Upside = projected peak at the 10th / 90th percentile.</p>
  </div>`;
  const tierOf = DRAFT_COLS.find(c => c[0] === "tier")[2];
  const body = () => {
    let shown = rows.filter(s => DRAFT_COLS.every(([k, , g, n]) => matchFilter(g(s), DR.f[k] || "", n)));
    const [, , g, n] = DRAFT_COLS.find(c => c[0] === DR.sort);
    shown.sort((a, b) => {
      const x = g(a), y = g(b);
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      return (n ? x - y : String(x).localeCompare(String(y))) * DR.dir;
    });
    view.querySelector("#d-count").textContent = `${shown.length} of ${rows.length} shown`;
    const W = v => Math.max(0, Math.min(100, (v - 60) / 140 * 100)).toFixed(1);
    view.querySelector("#d-body").innerHTML = shown.slice(0, DR.limit).map(s => {
      const p = s.p, d = s.nhl - s.ours;
      return `<tr class="link" data-k="${esc(p.k)}">
        <td class="num"><b>${s.ours}</b></td>
        <td class="num">${s.nhl} <span class="small ${d > 5 ? "up" : d < -5 ? "down" : "muted"}" title="ours vs NHL">${d > 0 ? "▲" + d : d < 0 ? "▼" + -d : ""}</span></td>
        <td class="num ${s.move > 0 ? "up" : s.move < 0 ? "down" : "muted"}" title="${esc(s.prevTxt || "no earlier ranking")}">${s.move == null ? "–" : (s.move > 0 ? "+" : "") + s.move}</td>
        <td><a href="${route(p.k)}"><b>${esc(p.n)}</b></a></td><td>${esc(p.pos)}</td><td class="num">${p.age}</td><td>${esc(p.lg || "")}</td><td>${tname(clubOf(p))}</td>
        <td class="num">${fmt(p.ca, 0)}</td><td class="num">${fmt(p.pa, 0)}</td>
        <td class="num"><b>${fmt(s.mid, 0)}</b> <span class="rangebar" title="${s.lo.toFixed(0)} – ${s.hi.toFixed(0)}"><i style="left:${W(s.lo)}%;width:${(W(s.hi) - W(s.lo)).toFixed(1)}%"></i><b style="left:${W(s.mid)}%"></b></span></td>
        <td class="num">${fmt(s.lo, 0)}</td><td class="num">${fmt(s.hi, 0)}</td>
        <td class="num">${p.sc?.fut != null ? `<span class="stars">${"★".repeat(p.sc.fut)}</span>` : '<span class="muted">–</span>'}</td>
        <td class="small">${esc(tierOf(s)) || '<span class="muted">–</span>'}</td>
        <td class="small">${esc(p.sc?.role || "") || '<span class="muted">–</span>'}</td>
        <td class="small">${esc(s.other) || '<span class="muted">–</span>'}</td></tr>`;
    }).join("");
    view.querySelector("#d-more-wrap").innerHTML = shown.length > DR.limit
      ? `<button class="ghost" id="d-more">Show more (${shown.length - DR.limit} left)</button>` : "";
    view.querySelector("#d-more")?.addEventListener("click", () => { DR.limit += 200; body(); });
    view.querySelectorAll("#d-body tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  };
  view.querySelectorAll("tr.frow input").forEach(inp => inp.addEventListener("input", () => {
    DR.f[inp.dataset.k] = inp.value; DR.limit = 150; body();
  }));
  view.querySelectorAll("th.sort").forEach(th => th.onclick = () => {
    const k = th.dataset.k, col = DRAFT_COLS.find(c => c[0] === k);
    DR.dir = DR.sort === k ? -DR.dir : (col[3] && !["ours", "nhl", "age"].includes(k) ? -1 : 1);
    DR.sort = k; renderDraft();
  });
  view.querySelectorAll("#d-mode button").forEach(b => b.onclick = () => { DR.mode = b.dataset.m; renderDraft(); });
  view.querySelector("#d-clear").onclick = () => { DR.f = {}; renderDraft(); };
  bindDraftHead();
  body();
}

/* Draft value of a pick = expected WAR per season at the player's projected peak (best est. CA on his projected path,
   through the expected-WAR curve the trade predictor uses), so every draft year can be compared, not only the ones
   with NHL seasons in the box scores. The slot expectation is the average value at that slot: one decreasing slot
   shape pooled over every draft year, scaled to each year's average, so a draft's known picks add up to zero above
   slot and every pick is compared with picks of the same class. Slots without a draft record (players who left the
   database, or weren't crawled) are left out of both. */
let DV = null;
function draftValues() {
  if (DV && DV.data === D) return DV;
  const picks = (D.draftHist || []).map(([year, round, pick, team, k, n, w, last]) => {
    const p = byKey.get(k) || null, seasons = Object.values(w || {});
    // a player no longer in the data keeps the value of his last estimate (no projection)
    return { year, round, pick, team, club: draftClub(team) || team, k, n: p ? p.n : n, p, last,
             v: p ? expWar(p.grp, sortVal(p, "peak")) : last ? expWar(last[2], last[1]) : 0,
             war: seasons.reduce((s, x) => s + x[0], 0), gp: seasons.reduce((s, x) => s + x[1], 0) };
  });
  const years = [...new Set(picks.map(x => x.year))].sort((a, b) => b - a);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const yMean = Object.fromEntries(years.map(y => [y, mean(picks.filter(x => x.year === y).map(x => x.v))]));
  const rel = Array.from({ length: 224 }, () => []);
  picks.forEach(x => { if (yMean[x.year] > 0 && x.pick <= 224) rel[x.pick - 1].push(x.v / yMean[x.year]); });
  let raw = rel.map(a => a.length ? mean(a) : null);
  raw = raw.map((v, i) => v ?? raw.slice(0, i).reverse().find(x => x != null) ?? raw.find(x => x != null) ?? 1);
  const W = 9;   // smoothed over 9 picks, then made to fall (an earlier pick is never expected to be worth less)
  const shape = raw.map((_, i) => mean(raw.slice(Math.max(0, i - (W >> 1)), i + (W >> 1) + 1)));
  for (let i = 1; i < shape.length; i++) shape[i] = Math.min(shape[i], shape[i - 1]);
  years.forEach(y => {   // scale the shape so the year's known picks average out to the year's mean value
    const own = picks.filter(x => x.year === y), m = mean(own.map(x => shape[Math.min(224, x.pick) - 1]));
    own.forEach(x => { x.exp = m > 0 ? yMean[y] * shape[Math.min(224, x.pick) - 1] / m : 0; x.above = x.v - x.exp; });
  });
  const cover = Object.fromEntries(years.map(y => [y, picks.filter(x => x.year === y).length]));
  DV = { data: D, picks, years, cover, slots: y => (y >= 2021 ? 224 : y >= 2017 ? 217 : 211) };
  return DV;
}
/* Per club over the chosen draft years: picks, value, expected, above slot, hits (picks above their slot). */
function drafterTable(from, to) {
  const by = {};
  draftValues().picks.filter(x => x.year >= from && x.year <= to).forEach(x => {
    const t = (by[x.club] ||= { club: x.club, n: 0, v: 0, exp: 0, above: 0, hits: 0, gp: 0, war: 0, nhl: 0, best: null });
    t.n++; t.v += x.v; t.exp += x.exp; t.above += x.above; t.hits += x.above > 0; t.gp += x.gp; t.war += x.war; t.nhl += x.gp > 0;
    if (!t.best || x.above > t.best.above) t.best = x;
  });
  return Object.values(by).filter(t => NHL_TEAMS[t.club]).sort((a, b) => b.above - a.above);
}
const aboveCell = v => `<td class="num ${v > 0.05 ? "up" : v < -0.05 ? "down" : ""}"><b>${signed(v, 2)}</b></td>`;
// a pick whose player has left the data still opens his former-player page (hasPage)
const pickRows = (rows, withClub, hl) => rows.map(x => `<tr id="pick-${x.pick}" class="${hasPage(x.k) ? "link" : ""}${x.pick === hl ? " hl" : ""}"${hasPage(x.k) ? ` data-k="${esc(x.k)}"` : ""}>
    <td class="num">${x.pick}</td><td class="num">${x.round}</td>${withClub ? `<td class="nowrap">${tlink(x.club, `${logo(x.club, 22)} ${esc(NHL_TEAMS[x.club]?.[0] || x.club)}`)}</td>` : ""}
    <th scope="row" class="pcol">${hasPage(x.k) ? `<a class="pcell" href="${route(x.k)}"><span><b class="${x.p ? "" : "muted"}">${esc(x.n)}</b></span></a>` : `<span class="muted">${esc(x.n)}</span>`}</th>
    <td>${x.p ? esc(x.p.pos) : ""}</td><td class="num">${x.p ? x.p.age : ""}</td>
    <td class="now">${x.p ? `${tname(clubOf(x.p))}${x.p.lg ? ` <span class="muted small">${esc(x.p.lg)}</span>` : ""}` : `<span class="muted small">${x.last ? `last seen ${fmtDate(x.last[0])}` : "never in a snapshot"}</span>`}</td>
    <td class="num">${x.p ? fmt(x.p.ca, 0) : x.last ? `<span class="muted">${fmt(x.last[1], 0)}</span>` : dash}</td><td class="num">${x.p ? fmt(sortVal(x.p, "peak"), 0) : dash}</td>
    <td class="num">${fmt(x.v, 2)}</td><td class="num muted">${fmt(x.exp, 2)}</td>${aboveCell(x.above)}
    <td class="num">${x.gp || dash}</td><td class="num">${x.gp ? fmt(x.war, 1) : dash}</td></tr>`).join("");
const pickHead = withClub => `<thead><tr><th class="num">Pick</th><th class="num">Rd</th>${withClub ? "<th>Team</th>" : ""}<th class="pcol">Player</th><th>Pos</th><th class="num">Age</th>
    <th>Now</th><th class="num">Est. CA</th><th class="num">Proj. peak</th><th class="num">Value</th><th class="num">Slot avg</th><th class="num">Above slot</th>
    <th class="num">NHL GP</th><th class="num">NHL WAR</th></tr></thead>`;
const DRAFT_VALUE_NOTE = `Value = expected WAR per season at the player's projected peak (his best est. CA, now or projected,
  through the expected-WAR curve on the trade predictor). Slot avg = the average value at that pick over every draft in the data, scaled to the
  class. Above slot = value − slot avg. A player who has left the data keeps the value of his last est. CA; one never seen counts as 0.
  NHL GP / WAR: regular-season box scores in this save so far. Picks without a draft record are left out.`;
const DH = { from: null, to: null, sort: "above" };
function renderDraftHistory(tab, arg, pick) {
  const V = draftValues(), years = V.years;
  let body = "";
  if (tab === "past") {
    const y = years.includes(+arg) ? +arg : years[0];
    const rows = V.picks.filter(x => x.year === y).sort((a, b) => a.pick - b.pick);
    const teams = drafterTable(y, y);
    const best = rows.filter(x => x.p).sort((a, b) => b.above - a.above).slice(0, 5);
    body = `<div class="cardbar"><div><h2 class="flat">${y} NHL Entry Draft</h2>
        <p class="sub">${rows.length} of ${V.slots(y)} picks in the draft records${rows.length < 0.8 * V.slots(y) ? ": players who left the database (or weren't crawled) are missing" : ""}.</p></div>
        <span class="inline yearnav">${(() => { const i = years.indexOf(y), older = years[i + 1], newer = years[i - 1];
          return `<a class="ghost${older ? "" : " disabled"}" ${older ? `href="#/draft/past/${older}"` : 'aria-disabled="true"'} title="Previous draft">← ${older || ""}</a>
          <label class="inline">Draft <select id="dh-year">${years.map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <a class="ghost${newer ? "" : " disabled"}" ${newer ? `href="#/draft/past/${newer}"` : 'aria-disabled="true"'} title="Next draft">${newer || ""} →</a>`; })()}</span></div>
      <div class="row">
        <section class="card-box" aria-labelledby="bp-h"><h2 id="bp-h">Best value</h2><p class="sub">Most above their slot</p>
          ${best.map(x => listRow(x.p, `<span class="lnum"><b>${signed(x.above, 2)}</b></span>`, `<a href="#/draft/past/${y}/${x.pick}">#${x.pick}</a> · ${tname(x.club)} · ${esc(x.p.pos)} · peak ${fmt(sortVal(x.p, "peak"), 0)}`)).join("")}</section>
        <section class="card-box" aria-labelledby="bt-h"><h2 id="bt-h">Best drafting teams</h2><p class="sub">Value above slot, ${y} picks</p>
          ${teams.slice(0, 5).map((t, i) => `<div class="lrow">${logo(t.club, 30)}<span class="lmain">${clubLink(t.club, "/drafts", `<b>${i + 1}. ${esc(t.club)}</b>`, "lname")}
            <small>${t.n} picks · best: ${hasPage(t.best.k) ? `<a href="${route(t.best.k)}">${esc(t.best.n)}</a>` : esc(t.best.n)} (<a href="#/draft/past/${y}/${t.best.pick}">#${t.best.pick}</a>)</small></span><span class="lnum"><b>${signed(t.above, 2)}</b></span></div>`).join("")}</section>
      </div>
      <section class="card-box flush" aria-label="Every pick"><h2 class="box-h">Every pick <span class="muted">${rows.length}</span></h2>
        <div class="tablewrap"><table class="rank sortable picks">${pickHead(true)}<tbody>${pickRows(rows, true, +pick)}</tbody></table></div><p class="sub pad">${DRAFT_VALUE_NOTE}</p></section>`;
  } else {
    const lo = years.at(-1), hi = years[0];
    if (arg === "all") Object.assign(DH, { from: lo, to: hi });
    else if (arg === "5") Object.assign(DH, { from: Math.max(lo, hi - 4), to: hi });
    DH.to = years.includes(DH.to) ? DH.to : hi;
    DH.from = years.includes(DH.from) ? DH.from : Math.max(lo, hi - 9);
    if (DH.from > DH.to) [DH.from, DH.to] = [DH.to, DH.from];
    const T = drafterTable(DH.from, DH.to);
    const yearsIn = years.filter(y => y >= DH.from && y <= DH.to).reverse();
    const th = (k, t) => `<th class="num${k === "above" ? " on" : ""}"${k === "above" ? ' aria-sort="descending"' : ""}>${t}</th>`;
    const sel = (id, v) => `<select id="${id}">${years.map(y => `<option ${y === v ? "selected" : ""}>${y}</option>`).join("")}</select>`;
    body = `<div class="cardbar"><div><h2 class="flat">Best drafters, ${DH.from}–${DH.to}</h2>
        <p class="sub">Each club's picks against what's normal at those slots. Picks in the records: ${yearsIn.map(y => `${y} ${V.cover[y]}/${V.slots(y)}`).join(" · ")}.</p></div>
        <span class="inline"><label>From ${sel("dh-from", DH.from)}</label> <label>To ${sel("dh-to", DH.to)}</label></span></div>
      <section class="card-box flush" aria-label="Drafting scoreboard"><div class="tablewrap"><table class="rank sortable"><thead><tr><th class="num">#</th><th>Team</th><th class="num">Picks</th>
        ${th("v", "Value")}<th class="num">Slot avg</th>${th("above", "Above slot")}${th("per", "Per pick")}${th("hits", "Beat slot")}${th("nhl", "Made NHL")}${th("war", "NHL WAR")}<th>Best pick</th></tr></thead><tbody>
        ${T.map((t, i) => `<tr class="${hasClub(t.club) ? "tlink" : ""}${t.club === decodePart(pick || "") ? " hl" : ""}" data-club="${esc(t.club)}"><td class="num">${i + 1}</td><th scope="row" class="nowrap">${clubLink(t.club, "/drafts", `${logo(t.club, 24)} ${esc(t.club)}`)}</th>
          <td class="num">${t.n}</td><td class="num">${fmt(t.v, 1)}</td><td class="num muted">${fmt(t.exp, 1)}</td>${aboveCell(t.above)}
          <td class="num" data-v="${t.above / t.n}">${signed(t.above / t.n, 3)}</td><td class="num">${Math.round(100 * t.hits / t.n)}%</td><td class="num">${t.nhl}</td><td class="num">${fmt(t.war, 1)}</td>
          <td class="small">${hasPage(t.best.k) ? `<a href="${route(t.best.k)}">${esc(t.best.n)}</a>` : esc(t.best.n)} <span class="muted"><a href="#/draft/past/${t.best.year}/${t.best.pick}">${t.best.year} #${t.best.pick}</a>, ${signed(t.best.above, 2)}</span></td></tr>`).join("")}
        </tbody></table></div>
        <p class="sub pad">Above slot = the sum over the club's picks of value − slot avg (value = expected WAR per season at the player's projected peak).
          Per pick = above slot / picks, fairer when clubs made different numbers of picks. Beat slot = share of picks worth more than their slot avg.
          Made NHL / NHL WAR: picks with regular-season NHL games in this save's box scores. The club is the one that made the pick; a club isn't its GM,
          so in a multiplayer league read it per GM tenure. Recent classes are mostly projection, older ones mostly settled ability.</p></section>`;
  }
  view.innerHTML = `${draftHead(tab)}<div class="wrap page">${body}</div>`;
  bindDraftHead();
  view.querySelector("#dh-year")?.addEventListener("change", e => (location.hash = "#/draft/past/" + e.target.value));
  // the router scrolls to the top after rendering: scroll to the highlighted pick after that
  const hl = view.querySelector("tr.hl");
  if (hl) setTimeout(() => hl.scrollIntoView({ block: "center" }), 0);
  view.querySelector("#dh-from")?.addEventListener("change", e => { DH.from = +e.target.value; renderDraftHistory(tab, null, pick); });
  view.querySelector("#dh-to")?.addEventListener("change", e => { DH.to = +e.target.value; renderDraftHistory(tab, null, pick); });
  makeSortable();
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  view.querySelectorAll("tr.tlink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = teamRoute(tr.dataset.club) + "/drafts"; });
}
/* Team page: every pick the club made, newest draft first, with the running total above slot. */
function teamDraftsTab(club) {
  const V = draftValues(), mine = V.picks.filter(x => x.club === club);
  const years = [...new Set(mine.map(x => x.year))].sort((a, b) => b - a);
  const all = drafterTable(V.years.at(-1), V.years[0]), rank = all.findIndex(t => t.club === club) + 1;
  const recent = drafterTable(V.years[0] - 4, V.years[0]), rRank = recent.findIndex(t => t.club === club) + 1;
  let run = 0;
  const tot = {};
  years.slice().reverse().forEach(y => { const a = mine.filter(x => x.year === y).reduce((s, x) => s + x.above, 0); run += a; tot[y] = [a, run]; });
  return `<div class="stat-cards">
      <div><span>Picks in the records</span><b>${mine.length}</b><small>${years.at(-1)}–${years[0]} drafts</small></div>
      <div><span>Above slot, all drafts</span><b>${rank ? signed(all[rank - 1].above, 2) : "–"}</b><small>${rank ? rankLink(`#/draft/scores/all/${encodeURIComponent(club)}`, `${ordinal(rank)} of ${all.length}`) : ""}</small></div>
      <div><span>Above slot, last 5 drafts</span><b>${rRank ? signed(recent[rRank - 1].above, 2) : "–"}</b><small>${rRank ? rankLink(`#/draft/scores/5/${encodeURIComponent(club)}`, `${ordinal(rRank)} of ${recent.length}`) : ""}</small></div>
      <div><span>Picks who made the NHL</span><b>${mine.filter(x => x.gp > 0).length}</b><small>${fmt(mine.reduce((s, x) => s + x.war, 0), 1)} WAR in this save</small></div>
    </div>
    ${years.map(y => { const rows = mine.filter(x => x.year === y).sort((a, b) => a.pick - b.pick);
      return `<section class="card-box flush" aria-label="${y} draft"><h2 class="box-h">${y} draft <span class="muted">${rows.length} picks · above slot ${signed(tot[y][0], 2)} · running total ${signed(tot[y][1], 2)}</span>
        <a class="small" href="#/draft/past/${y}">Whole draft →</a></h2>
        <div class="tablewrap"><table class="rank sortable picks">${pickHead(false)}<tbody>${pickRows(rows, false)}</tbody></table></div></section>`; }).join("")}
    <p class="sub">${DRAFT_VALUE_NOTE} Running total = above slot summed from the oldest draft in the data up to that one. <a href="#/draft/scores">Every club →</a></p>`;
}


// ---------------------------------------------------------------- backtest, history, roles (How it works)
function lineChart(series, xLabel, yLabel, opts = {}) {
  const W = 640, H = 240, m = { l: 44, r: 16, t: 12, b: 34 };
  const xs = series.flatMap(s => s.pts.map(q => q[0])), ys = series.flatMap(s => s.pts.map(q => q[1]));
  const x0 = opts.x0 ?? Math.min(...xs), x1 = opts.x1 ?? Math.max(...xs);
  const y0 = Math.floor(Math.min(...ys, opts.ymin ?? Infinity) * 2) / 2, y1 = Math.ceil(Math.max(...ys) * 2) / 2;
  const X = x => m.l + (x - x0) / Math.max(1e-9, x1 - x0) * (W - m.l - m.r), Y = y => m.t + (1 - (y - y0) / Math.max(1e-9, y1 - y0)) * (H - m.t - m.b);
  let g = "";
  const step = (y1 - y0) > 3 ? 1 : 0.5;
  for (let v = y0; v <= y1 + 1e-9; v += step)
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css("--grid")}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  [...new Set(xs)].sort((a, b) => a - b).forEach(x => (g += `<text x="${X(x)}" y="${H - m.b + 16}" text-anchor="middle">${opts.xfmt ? opts.xfmt(x) : x}</text>`));
  g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">${esc(xLabel)}</text>
        <text x="12" y="${(m.t + H - m.b) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(m.t + H - m.b) / 2})">${esc(yLabel)}</text>`;
  for (const s of series) {
    g += `<polyline points="${s.pts.map(q => `${X(q[0])},${Y(q[1])}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    g += s.pts.map(q => `<circle cx="${X(q[0])}" cy="${Y(q[1])}" r="4" fill="${s.color}" stroke="${css("--surface")}" stroke-width="2"><title>${esc(s.name)}: ${q[1]}</title></circle>`).join("");
  }
  return `<div class="legend">${series.map(s => `<span style="--c:${s.color}">${esc(s.name)}</span>`).join("")}</div>
    <svg class="chart lc" viewBox="0 0 ${W} ${H}" style="max-width:${W}px">${g}</svg>`;
}

function backtestSection() {
  const bt = D.backtest;
  if (!bt || !bt.pairs) return `<h3>Projection backtest</h3><p class="muted">Needs at least four training snapshots.</p>`;
  const cols = [css("--s1"), css("--s2"), "#1baf7a", "#6250d6"];
  // error by horizon: average over origins
  const byH = {};
  bt.pairs.forEach(r => { const h = Math.round(r.h); (byH[h] ||= []).push(r); });
  const hs = Object.keys(byH).map(Number).sort((a, b) => a - b);
  const avg = (arr, k) => +(arr.reduce((s, r) => s + r[k] * r.n, 0) / arr.reduce((s, r) => s + r.n, 0)).toFixed(2);
  const horizonChart = lineChart([
    { name: "Projection", color: cols[0], pts: hs.map(h => [h, avg(byH[h], "mae_proj")]) },
    { name: "No change (today's estimate held flat)", color: css("--muted"), pts: hs.map(h => [h, avg(byH[h], "mae_flat")]) },
  ], "Months ahead", "Mean error (CA points)");
  // improvement: same horizon, more snapshots used
  const bySnap = hs.filter(h => h <= 2).map((h, i) => ({ name: `${h} month${h > 1 ? "s" : ""} ahead`, color: cols[i + 1] || cols[0],
    pts: bt.pairs.filter(r => Math.round(r.h) === h).map(r => [r.n_snap, r.mae_proj]) })).filter(s => s.pts.length > 1);
  const hist = (D.history || []);
  const lh = D.longHorizon;
  const lhLine = lh ? `<p class="small">Training save: ${lh.span.toFixed(0)} months of labelled snapshots so far.
    ${lh.horizons.map(r => r.ready ? `<b>${r.months / 12}-year test: ready</b> (${r.origins} origins, ${r.young.toLocaleString()} players aged ${lh.ages[0]}–${lh.ages[1]})`
      : `${r.months / 12}-year test: ${r.origins} of ${lh.minOrigins} origins, ${r.young.toLocaleString()} of ${lh.minYoung.toLocaleString()} players aged ${lh.ages[0]}–${lh.ages[1]} (ready about ${fmtDate(r.readyAbout)} in game at the earliest)`).join("; ")}.</p>` : "";
  return `<h3>Projection backtest</h3>
  ${lhLine}
  <p>Walk-forward test on the training save: at each past snapshot every model (CA, PA, growth curve) is retrained using only
  the snapshots up to that date. Each player is estimated by models that never saw his own labels, as on the live league.
  The projection is then compared with his true CA at every later snapshot.
  Overall: <b>${bt.overall.mae_proj}</b> mean error vs <b>${bt.overall.mae_flat}</b> for "no change" (${bt.overall.n.toLocaleString()} projections).${bt.latest ? ` Run on the snapshots up to ${fmtDate(bt.latest)} (it only re-runs on a full model rebuild).` : ""}</p>
  ${horizonChart}
  ${bySnap.length ? `<p>Accuracy as snapshots accumulate: the same horizon, projected from later origins that had more snapshots to learn from.</p>
    ${lineChart(bySnap, "Snapshots available when projecting", "Mean error (CA points)")}` : ""}
  <div class="tablewrap"><table><thead><tr><th>From</th><th class="num">Snapshots used</th><th>To</th><th class="num">Months</th>
    <th class="num">Players</th><th class="num">Projection error</th><th class="num">No-change error</th><th class="num">Bias</th></tr></thead><tbody>
    ${bt.pairs.map(r => `<tr><td>${fmtDate(r.origin)}</td><td class="num">${r.n_snap}</td><td>${fmtDate(r.target)}</td><td class="num">${r.h.toFixed(1)}</td>
      <td class="num">${r.n.toLocaleString()}</td><td class="num"><b>${r.mae_proj}</b></td><td class="num">${r.mae_flat}</td>
      <td class="num ${Math.abs(r.bias) > 0.5 ? "down" : ""}">${r.bias > 0 ? "+" : ""}${r.bias}</td></tr>`).join("")}</tbody></table></div>
  <p>By age, ${bt.by_age_horizon} months ahead (bias below zero = the projection was too low):</p>
  <div class="tablewrap"><table><thead><tr><th>Age</th><th class="num">Players</th><th class="num">Projection error</th><th class="num">No-change error</th><th class="num">Bias</th></tr></thead><tbody>
    ${bt.by_age.map(r => `<tr><td>${esc(r.age_band)}</td><td class="num">${r.n.toLocaleString()}</td><td class="num"><b>${r.mae_proj}</b></td>
      <td class="num">${r.mae_flat}</td><td class="num ${Math.abs(r.bias) > 0.5 ? "down" : ""}">${r.bias > 0 ? "+" : ""}${r.bias}</td></tr>`).join("")}</tbody></table></div>
  <p class="small muted">Read it as: from about 23 onwards the projection beats "no change"; for teenagers it currently under-predicts growth,
  mostly because their PA estimate is pulled towards the average. Expect this to move as the save is simmed further.</p>
  ${bt.attrs ? `<h3>Attribute projection backtest</h3>
  <p>Same walk-forward test for the projected attributes (a quarter of the players, every attribute): mean error in attribute points (1–20 scale)
  vs assuming the attribute stays where it is. Overall <b>${bt.attrs_overall.mae_model}</b> vs ${bt.attrs_overall.mae_flat}
  (${bt.attrs_overall.n.toLocaleString()} attribute projections).</p>
  <div class="tablewrap"><table><thead><tr><th class="num">Months ahead</th><th class="num">Attribute values</th><th class="num">Projection error</th><th class="num">No-change error</th></tr></thead><tbody>
  ${bt.attrs.map(r => `<tr><td class="num">${r.h}</td><td class="num">${r.n.toLocaleString()}</td><td class="num"><b>${r.mae_model}</b></td><td class="num">${r.mae_flat}</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  <h3>Model history</h3>
  <p>One row per build, keyed by the latest training snapshot and the model (rebuilding the same snapshot replaces its row).</p>
  <div class="tablewrap"><table><thead><tr><th>Latest snapshot</th><th>Model</th><th class="num">Snapshots</th><th class="num">CA error</th><th class="num">PA error</th>
    <th class="num">PA error (16–18)</th><th class="num">Backtest error</th><th class="num">No-change</th></tr></thead><tbody>
    ${hist.map(h => `<tr><td>${fmtDate(h.latest)}</td><td>${h.model === "accurate" ? "Accurate" : "Fast"}</td><td class="num">${h.snapshots}</td><td class="num">${h.ca_mae}</td><td class="num">${h.pa_mae}</td>
      <td class="num">${h.pa_mae_young ?? "–"}</td><td class="num">${h.bt_mae ?? "–"}</td><td class="num">${h.bt_flat ?? "–"}</td></tr>`).join("")}</tbody></table></div>
  ${hist.length > 1 ? lineChart([
    { name: "CA error", color: cols[0], pts: hist.filter(h => h.model !== "accurate").map(h => [h.snapshots, h.ca_mae]) },
    { name: "PA error", color: cols[1], pts: hist.filter(h => h.model !== "accurate").map(h => [h.snapshots, h.pa_mae]) },
  ], "Training snapshots", "Mean error") : `<p class="small muted">The chart appears after the next build with a new snapshot.</p>`}`;
}

function rolesSection() {
  const R = D.roles || { rows: [] };
  return `<h3>Player roles</h3>
  <p>The preferred role ("Finesse Winger", "Defensive Center", ...) is shown on the Scout Report tab, so it's only known for players with a report.
  For each role: average WAR per 82 games, and how far that is above or below what the players' estimated CA predicts
  (positive = the role gets more out of the same ability).</p>
  ${R.rows.length ? `<div class="tablewrap"><table><thead><tr><th>Position</th><th>Preferred role</th><th class="num">NHL players</th><th class="num">Avg est. CA</th>
    <th class="num">WAR/82</th><th class="num">vs expected</th><th class="num">± (1 SE)</th></tr></thead><tbody>
    ${R.rows.map(r => `<tr class="${r.enough ? "" : "muted"}"><td>${r.grp}</td><td>${esc(r.role)}</td><td class="num">${r.n}</td><td class="num">${r.ca}</td>
      <td class="num">${r.war82}</td><td class="num ${r.enough && r.vs_expected > 0 ? "up" : r.enough && r.vs_expected < 0 ? "down" : ""}">${r.vs_expected == null ? "–" : (r.vs_expected > 0 ? "+" : "") + r.vs_expected}</td>
      <td class="num">${r.se ?? "–"}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">${R.rated} rated NHL players have a known role. Greyed rows have fewer than ${R.min_players} players and aren't used anywhere yet.</p>`
    : `<p class="muted">No roles yet: run the crawler with <code>--scout</code>.</p>`}`;
}

function extraInputsSection() {
  const sg = D.report.scout_gain, ng = D.report.nhl_rank_gain;
  const row = (label, r, extra = "") => r ? `<tr><td>${label}</td><td class="num">${r.without}</td><td class="num"><b>${r.with}</b></td>
    <td class="num ${r.with < r.without ? "up" : "down"}">${r.with < r.without ? "−" : "+"}${Math.abs(r.with - r.without).toFixed(2)}</td><td class="small muted">${extra}</td></tr>` : "";
  return `<h3>Do the scout report and NHL rankings help?</h3>
  <p>Each extra input is tested on exactly the players who have it, across every labelled snapshot, with the same
  player-grouped folds with and without it.</p>
  <div class="tablewrap"><table><thead><tr><th>Input</th><th class="num">Error without</th><th class="num">Error with</th><th class="num">Change</th><th></th></tr></thead><tbody>
    ${sg ? row(`Scout report → CA (${sg.players.toLocaleString()} players)`, sg.ca) + row("Scout report → PA", sg.pa,
      `stars match round(ability/40): current ${sg.sc_cur_exact != null ? (sg.sc_cur_exact * 100).toFixed(0) + "%" : "–"}, future ${sg.sc_fut_exact != null ? (sg.sc_fut_exact * 100).toFixed(0) + "%" : "–"}`) : ""}
    ${ng ? row(`NHL ranking history → PA (${ng.rows.toLocaleString()} rows, ${ng.players.toLocaleString()} players)`, ng.pa,
      `movement alone: ${ng.pa.without_move_only} without it`) + row("NHL ranking history → CA", ng.ca) : ""}
  </tbody></table></div>
  ${!sg ? `<p class="small muted">Scout test needs a training snapshot taken with --scout (at least 200 reports).</p>` : ""}
  <p class="small muted">Scout inputs used: ${(D.report.scout_columns || []).length} (stars, talent tier from the career role,
  points projection, and the midpoint of every hidden-value range at least 30 reports mention).</p>`;
}

function predictorsSection() {
  const P = D.predict || {}, h = P.h2h, pk = P.picks, cw = P.carWar;
  const pc = v => v == null ? "–" : (100 * v).toFixed(1) + "%";
  return `<h3>Head to head</h3>
  ${h ? `<p>A logistic regression of a home win (overtime and shootouts included; a shootout's winner is read from the "SO" result,
  because the box score keeps the tied score) on the home-minus-away difference in the top-6 forwards' and top-4 defence's average
  est. CA, the starting goalie's est. CA (each as known at the snapshot before the game) and home ice. Once both teams have played
  ${h.standings_min_gp}+ games of a season, their win rate and goal difference per game so far are added. Fitted on
  ${h.games.toLocaleString()} games (${h.seasons.map(seasonLabel).join(", ")}).</p>
  <p>Walk-forward test: every month predicted using only earlier games (${h.tested.toLocaleString()} games).</p>
  <div class="tablewrap"><table><thead><tr><th>Model</th><th class="num">Picked the winner</th><th class="num">Log loss</th><th class="num">Brier</th></tr></thead><tbody>
    ${[["home", "Home team every time"], ["standings", "Standings so far"], ["lineup", "Lineups"], ["full", "Lineups + standings"]].map(([k, t]) =>
      `<tr><td>${t}</td><td class="num">${pc(h.results[k].accuracy)}</td><td class="num">${h.results[k].log_loss}</td><td class="num">${h.results[k].brier}</td></tr>`).join("")}
  </tbody></table></div>
  <p class="small muted">Calibration: ${h.bands.map(b => `favourites at ${Math.round(100 * b.lo)}${b.hi > 1 ? "%+" : "–" + Math.round(100 * b.hi) + "%"} won ${pc(b.won)} (${b.n} games)`).join("; ")}.
  Est. CA comes from the final CA model, which saw these players' labels in training (its error is small, 3-4 points).</p>` : `<p class="muted">Needs at least 200 games with box-score lineups.</p>`}

  <h3>Draft-pick value</h3>
  ${pk ? `<p>A pick is worth the NHL WAR the player taken at that slot is expected to produce. Every draft slot had exactly one player;
  one who isn't in the data, or didn't play in the NHL, counts as 0 WAR. Expected WAR per season = A(seasons since the draft) × f(slot),
  with f smooth and strictly decreasing, so an earlier pick is always worth more (unsmoothed slot averages rise from one pick to the next
  ${pk.validation.raw_rises} times out of 223). In trades a pick is valued on ${P.prime5.length} seasons of his prime
  (${P.prime5[0]}–${P.prime5.at(-1)} seasons after the draft), the same length as the players' 5-season window.</p>
  <p>From ${pk.seasons.map(seasonLabel).join(", ")}, draft classes ${pk.draft_years[0]}–${pk.draft_years[1]}. Leaving one draft year out at a time
  (${pk.validation.years_tested} tests): error <b>${pk.validation.model}</b> WAR per pick vs ${pk.validation.flat} for giving every pick the average value.
  The slot shape is chosen by that same test at every build: ${Object.entries(pk.method_errors || {}).map(([m, e]) => `${m.startsWith("flex") ? `flexible shape smoothed over ${m.slice(4)} picks` : "3-parameter curve"} ${e}`).join(", ")}
  (using the ${pk.method.startsWith("flex") ? `flexible shape smoothed over ${pk.method.slice(4)} picks` : "3-parameter curve"}).
  Round averages over 5 prime seasons: ${pk.rounds.map((v, i) => `R${i + 1} ${v}`).join(", ")}.</p>${borrowed(pk)}` : `<p class="muted">Needs a complete NHL season.</p>`}

  <h3>Expected WAR from ability</h3>
  ${cw ? `<p>Season WAR by pre-season est. CA (the snapshot before the season's first game), per forwards, defence and goalies; players who
  didn't play in the NHL count as 0. A smoothed curve that never falls as CA rises, pooled over ${cw.seasons.map(seasonLabel).join(", ")}.
  Used for the trade predictor's "this season" and 5-season values (5 seasons = the curve at each future season's projected CA).</p>
  <div class="tablewrap"><table><thead><tr><th>Group</th><th class="num">Players</th><th class="num">In the NHL</th><th class="num">Curve error</th><th class="num">Straight line</th><th class="num">Constant</th><th class="num">Error, NHL players only</th></tr></thead><tbody>
    ${Object.entries(cw.validation).map(([g, v]) => `<tr><td>${{ F: "Forwards", D: "Defence", G: "Goalies" }[g]}</td><td class="num">${v.n.toLocaleString()}</td><td class="num">${v.nhl}</td>
      <td class="num"><b>${v.curve}</b></td><td class="num">${v.line}</td><td class="num">${v.constant}</td><td class="num">${v.nhl_only.curve} <span class="muted">(vs ${v.nhl_only.constant})</span></td></tr>`).join("")}
  </tbody></table></div>
  <p class="small muted">5-fold cross-validation, mean absolute error in WAR per season. Most players never reach the NHL, so the overall error looks small;
  the last column is the honest one for NHL regulars. Multi-season projections can only be checked once more seasons are simmed.</p>${borrowed(cw)}` : `<p class="muted">Needs a complete NHL season.</p>`}

  <h3>Own record vs ability</h3>
  ${P.blend ? `<p>A player's expected WAR blends his own record with what his ability predicts:
  <code>(GP × own WAR pace + K × ability curve) / (GP + K)</code>, so the more NHL games he has, the more his own results count.
  K = <b>${P.blend.K}</b> games, fitted by predicting each player's WAR pace in the next season from everything before it
  (${P.blend.players.toLocaleString()} player-seasons with ${P.blend.min_gp}+ GP in ${P.blend.seasons.map(seasonLabel).join(", ")}, weighted by games).
  Error in WAR per ${P.blend.season_gp} GP: blend <b>${P.blend.validation.blend}</b>, ability only ${P.blend.validation.ability_only},
  own record only ${P.blend.validation.own_only}. The trade predictor uses it for "this season" and carries the same pull into the 5-season value.</p>${borrowed(P.blend)}`
    : `<p class="muted">Needs a season with games after a complete one.</p>`}
  ${pickCheck(pk)}

  <h3>Team stats</h3>
  <p>From the de-duplicated box scores of each season. Points: 2 for a win, 1 for an overtime or shootout loss. xG from the shot charts
  (only games with one). Ranks are out of every team with games; 1st is best (fewest for goals and shots against, giveaways and penalty minutes).</p>`;
}

/* #/about[/<section slug>]: every h3 is a section with its own URL (the Contents list links to them). */
const slug = t => fold(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function renderAbout(section) {
  markNav("about");
  const r = D.report, g = D.growth, G0 = seasonInfo().games || {};
  const bandRows = Object.entries(r.pa_by_age).map(([k, s]) =>
    `<tr><td>${k}</td><td class="num">${s.mae}</td><td class="num">${s.p90}</td><td class="num">${s.r2}</td>
     <td class="num">${r.pa_band_by_age[k][0]} / +${r.pa_band_by_age[k][1]}</td></tr>`).join("");
  view.innerHTML = `<div class="panel about">

  <h3>Estimated CA and PA</h3>
  <p>EHM never sends current or potential ability to a client, so both are <b>estimated from what a client can see</b>:
  every profile attribute, position, age, height/weight, league, Top-Prospect rank and draft ranking, plus how fast the
  attributes have moved over the last 1-12 months. The models are trained on the hosted training save, where the true
  CA/PA can be read for scoring. The true values are never inputs and never shown here.</p>
  <p><b>This build used the ${esc(r.model_label || "fast model: gradient-boosted trees on the CPU")}.</b>
  Regular builds use the fast model; the accurate one is a separate, much slower build
  (${D.siteKey ? "Build SHA Website - Accurate (GPU).bat" : "Build Website - Accurate (GPU).bat"}): in the benchmark it cut the CA error from 3.29 to 2.51 and the PA error from 8.91 to 8.28.</p>
  <div class="tablewrap"><table><thead><tr><th>Model</th><th class="num">Mean error</th><th class="num">90% within</th><th class="num">R²</th></tr></thead><tbody>
    <tr><td>Current ability</td><td class="num">${r.ca.mae}</td><td class="num">${r.ca.p90}</td><td class="num">${r.ca.r2}</td></tr>
    <tr><td>Potential ability</td><td class="num">${r.pa.mae}</td><td class="num">${r.pa.p90}</td><td class="num">${r.pa.r2}</td></tr>
  </tbody></table></div>
  <p class="small muted">Cross-validated by player (5 folds, ${r.rows.toLocaleString()} player-snapshots, ${r.players.toLocaleString()} players).
  Stars ≈ round(ability / 40), the calibration from the Scout Report.</p>
  <p>PA is much harder to guess for teenagers than for veterans. The "likely" PA range on each card is the 10th–90th
  percentile of the model's error for that age group:</p>
  <div class="tablewrap"><table><thead><tr><th>Age</th><th class="num">Mean error</th><th class="num">90% within</th><th class="num">R²</th><th class="num">Range used</th></tr></thead><tbody>${bandRows}</tbody></table></div>

  ${extraInputsSection()}

  <h3>Projection</h3>
  <p>Fitted on ${g.pairs.toLocaleString()} consecutive-snapshot pairs of true CA in the training save:
  <code>monthly change = a(age) × (PA − CA) + b(age)</code>. The first term is growth towards potential, the second
  the age effect (positive in the early-to-mid 20s, increasingly negative into the 30s). There is no hard cut-off age.
  Goalies get their own curve (they decline more slowly in their 30s), blended towards the all-player curve because only
  ${(g.goalie_pairs || 0).toLocaleString()} of the pairs are goalies. Ages with fewer than ${g.min_n || 300} observations borrow the nearest well-sampled age.
  The gap is the <i>estimated</i> PA − CA, the same numbers the projection starts from, so the curve allows for the
  PA estimate being shrunk towards the average (fitting on the true gap under-projected teenagers).
  ${g.near_months ? `The first ${g.near_months} months come from separate forecast models, fitted on
  ${g.near_pairs.toLocaleString()} snapshot pairs: true CA after <i>h</i> months minus today's estimate, from far more than
  the estimate (the whole attribute profile and how each attribute moved over the last 1-12 months, the est-CA trend,
  status, contract, season line, role and the calendar). They learn where the CA estimate runs low or high and how much
  of a trend carries on; the curve continues from where they end. The same models forecast each attribute's change up to
  12 months ahead (Projected attributes on each player).` : ""}
  ${D.longModel ? `After them, out to ${D.longModel.hmax} months, a long-range model takes over: true CA <i>h</i> months
  later minus today's estimate, from the estimates, age and position, fitted on ${D.longModel.pairs.toLocaleString()}
  snapshot pairs up to ${D.longModel.hmax} months apart (the forecast path blends into it over a year). Tested on players it
  never saw (5 player folds), it cut the error of 3-year projections at ages 24-29 from 8.0 to 5.8 and at 30+ from 8.8 to
  6.5, and took away the curve's biases. The curve above only continues past ${D.longModel.hmax} months.
  The 80% band is that model's 10th–90th percentile (it covered 76–78% of real outcomes at every age, where the old band
  covered about half at 0-6 months); past it, the PA range above plus the month-to-month noise of real growth.` :
  "The 80% band uses the PA range above plus the month-to-month noise of real growth."}</p>
  <p class="small muted">Caveat: the snapshots so far run from ${fmtDate(D.dates[0])} to ${fmtDate(D.dates.at(-1))}.
  Months not covered yet (especially the off-season) aren't in the fit, and long-range projections can't be checked against reality
  until the save has been simmed that far. The curve will sharpen as more snapshots arrive; just rebuild.</p>

  <h3>JFresh-style stats (NHL)</h3>
  <p>${G0.games ? `From ${G0.games} de-duplicated NHL box scores (${fmtDate(G0.first)} – ${fmtDate(G0.last)}),
  ${G0.xg_games} of them with shot charts for expected goals.` : "No NHL box scores in this data yet: these stats appear once a snapshot is taken with <code>--games</code>."}
  Every number is a percentile within the player's position group (forwards / defence with ≥${D.minToi} minutes; goalies ≥300).</p>
  <ul>
    <li><b>Offence</b>: individual xG/60, points/60 and shots on goal/60.</li>
    <li><b>Playmaking</b>: primary assists/60 (from the goal log; assists are matched by surname within the scorer's team).</li>
    <li><b>Finishing</b>: goals minus individual xG, per 60 (xG model from shot location, type and rebound; AUC 0.73).</li>
    <li><b>Defence</b>: +/− per 60 and PK time. EHM exposes no on-ice data, so this is the weakest component.</li>
    <li><b>Usage</b>: TOI/game (double weight), PP and PK TOI/game.</li>
    <li><b>Discipline</b>: penalty minutes per 60, inverted.</li>
    <li><b>Overall impact</b>: 40% offence, 15% each finishing / playmaking / defence, 10% usage, 5% discipline.</li>
    <li><b>Goalies</b>: GSAx = post-shot xG of on-target shots faced minus goals allowed.</li>
  </ul>
  <p><b>Attribute profile</b> bars average groups of the 1–20 attributes and rank them against every player at the same position group.</p>

  ${D.warInfo && D.warInfo.goals_per_win ? `<h3>WAR (wins above replacement)</h3>
  <p>Goals above a replacement-level player, converted to wins. A replacement player is anyone outside each team's
  top 13 forwards / 7 defence (top 2 goalies) by ice time; their pooled rates are the zero line.
  ${D.warInfo.goals_per_win} goals = 1 win (twice the league's ${(D.warInfo.goals_per_win / 2).toFixed(2)} goals per team-game,
  from a Pythagorean win expectation).</p>
  <ul>
    <li><b>Shot generation</b>: individual xG per 60 minus replacement, times ice time.</li>
    <li><b>Finishing</b>: goals minus xG, shrunk towards zero (shots / (shots + ${D.warInfo.finishing_shrink})) because it's partly luck over a small sample.</li>
    <li><b>Playmaking</b>: primary assists earn ${D.warInfo.a1_credit} of a goal, secondary ${D.warInfo.a2_credit}. The scorer keeps the rest
      (${(D.warInfo.scorer_share * 100).toFixed(0)}% of an average goal), so every goal is credited exactly once.</li>
    <li><b>Defence</b>: a ridge regression over ${D.warInfo.defence.obs.toLocaleString()} team-games of the xG the opponent generated on
      <i>unblocked</i> shots (so blocking shots counts), using each skater's ice time in that game. It also accounts for the opponent and how many
      power plays they had. Players are pulled towards what their defensive attributes predict
      (${D.warInfo.defence.attr_slope} xGA/60 per standard deviation). EHM has no on-ice data, so treat it as a rough estimate.</li>
    <li><b>Penalties</b>: minors taken (PIM / 2) × ${D.warInfo.pp_goal_value} goals per power play. Penalties drawn aren't recorded anywhere a client can see.</li>
    <li><b>Goalies</b>: goals saved above expected (post-shot xG, which knows where the shot was aimed) minus what a replacement goalie saves on the same shots.</li>
  </ul>` : ""}

  <h3>Shot maps</h3>
  <p>Every shot on the box-score shot chart has a rink position and a target on the net. Away-team charts are rotated so every shot
  attacks the net at the top of the rink drawing. Heatmaps are smoothed (4 ft on the rink); orange dots are goals.
  "Effectiveness" compares goals with xG per zone, shrunk towards zero for zones with few shots. The net is drawn from the shooter's view:
  the opening runs post to post and crossbar to ice, and saves can land just outside it (the goalie's body).</p>

  <h3>Data checks</h3>
  <p>Every snapshot re-reads the previous month, so the same games show up in several files. Each table is
  de-duplicated before anything is counted, and the growth model skips snapshot pairs with no sim between them.</p>
  <div class="tablewrap"><table><thead><tr><th>Check</th><th>Result</th><th class="num">Duplicates removed</th></tr></thead><tbody>
    ${(D.audit || []).map(a => `<tr><td>${esc(a.check)}</td><td style="white-space:normal">${esc(a.detail)}</td><td class="num">${a.removed ? a.removed.toLocaleString() : "·"}</td></tr>`).join("")}
  </tbody></table></div>

  ${backtestSection()}

  ${rolesSection()}

  ${predictorsSection()}

  <h3>Updating</h3>
  ${D.siteKey ? `<p>Take SHA Snapshot.bat crawls the league and builds this site; to rebuild without crawling, run <code>Build SHA Website.bat</code>
  in the SHA_Website folder, then refresh the page. Publish SHA Website.bat copies it for the public site.</p>`
  : `<p>After a new snapshot run <code>Build Website.bat</code> (or <code>python build_data.py</code>), then refresh the page.
  For league data: <code>python build_data.py --data "../player data"</code>.</p>`}
  </div>`;
  // sticky table of contents: each section is a route of its own (#/about/<slug>), so it can be linked to
  {
    const panel = view.querySelector(".about"), hs = [...panel.querySelectorAll("h3")];
    hs.forEach(h => (h.id = "ab-" + slug(h.textContent)));
    view.innerHTML = `<section class="band"><div class="wrap"><h1>How it works</h1>
      <p class="lede">The models behind every estimate on this site, how accurate they are, and the data checks. Built ${esc(D.built)} from ${D.dates.length} snapshots
        (${fmtDate(D.dates[0])} to ${fmtDate(D.dates.at(-1))}).</p></div></section>
      <div class="about-wrap"><nav class="toc" aria-label="Contents"><b>Contents</b>${hs.map(h =>
      `<a href="#/about/${slug(h.textContent)}" class="${section === slug(h.textContent) ? "on" : ""}">${esc(h.textContent)}</a>`).join("")}</nav></div>`;
    view.querySelector(".about-wrap").append(panel);
    const target = section && view.querySelector("#ab-" + CSS.escape(section));
    if (target) { keepScroll = true; requestAnimationFrame(() => target.scrollIntoView()); }
  }
}

// ---------------------------------------------------------------- season helpers for the new pages
const teamTable = season => D.predict?.teams?.[season] || null;
const lastComplete = () => (D.predict?.complete || []).at(-1) || SEASONS.at(-1);
const warIn = (p, season) => season === SEASONS.at(-1) ? p.war : p.ss?.[season]?.war || null;
const nextDraftYear = () => 2000 + +(SEASONS.at(-1) || "26-27").slice(3);   // '27-28' -> the 2028 draft
function expWar(grp, ca) {   // expected season WAR at this est. CA (forward-tested curve, see How it works)
  const cw = D.predict?.carWar;
  const curve = cw?.curves?.[grp];
  if (!curve) return 0;
  const i = Math.max(0, Math.min(curve.length - 1, Math.round(ca) - cw.grid[0]));
  return curve[i];
}
/* Regular-season WAR and games over every season in the data (the current one so far included). */
function ownRecord(p) {
  const base = byKey.get(p.k) || p;
  let war = 0, gp = 0;
  SEASONS.forEach(s => { const w = s === SEASONS.at(-1) ? base.war : base.ss?.[s]?.war; if (w) { war += w.war; gp += w.gp; } });
  return { war, gp };
}
/* Expected WAR = his own record blended with the ability curve: (GP x own pace + K x curve) / (GP + K), K fitted
   at each build (How it works). His record's pull is carried into the 5 future seasons on top of the curve at
   each season's projected CA. */
function playerValue(p) {
  const B = D.predict?.blend, sg = B?.season_gp || 84;
  const pr = p._proj || (p._proj = project(p));
  const ability = expWar(p.grp, p.ca), rec = ownRecord(p);
  const own = rec.gp ? rec.war / rec.gp * sg : null;
  const now = B && rec.gp ? (rec.gp * own + B.K * ability) / (rec.gp + B.K) : ability;
  const pull = now - ability;
  const five = [0, 1, 2, 3, 4].reduce((s, y) => s + expWar(p.grp, pr[Math.min(12 * y + 6, pr.length - 1)].mid) + pull, 0);
  const last = warIn(p, lastComplete());
  return { last: last ? last.war : 0, lastGp: last ? last.gp : 0, now, five, own, gp: rec.gp, ability,
           weight: B && rec.gp ? rec.gp / (rec.gp + B.K) : 0 };
}
/* Value vs contract (2026-10-27). A season of a player is worth the league minimum (5th-percentile NHL salary) plus his
   expected WAR at the league's market price: what NHL clubs pay above the minimum divided by the expected WAR they get
   for it. Surplus = worth - cap hit, summed over the seasons left on his deal (this one pro-rated by the share of the
   regular season still to play, Oct 1 - Apr 15). Expected WAR: this season = playerValue's blend, later seasons = the
   curve at his projected CA plus his record's pull, as the trade tool. */
let MARKET = null;
function market() {
  if (MARKET) return MARKET;
  const nhl = D.players.filter(p => p.lg === "NHL" && salaryNum(p.sal) > 0);
  const sal = nhl.map(p => salaryNum(p.sal)).sort((a, b) => a - b);
  const min = sal[Math.floor(0.05 * (sal.length - 1))] || 0;
  const war = nhl.reduce((s, p) => s + Math.max(0, playerValue(p).now), 0);
  const paid = sal.reduce((s, x) => s + Math.max(0, x - min), 0);
  return (MARKET = { min, perWar: war > 0 ? paid / war : 0, n: nhl.length });
}
function contractSeasons(p) {
  const now = new Date(D.dates.at(-1) + "T00:00:00"), y = now.getFullYear(), end = now.getMonth() >= 6 ? y + 1 : y;
  const exp = +(String(p.exp || "").match(/\d{4}/) || [0])[0];
  if (!exp) return [];
  const start = new Date(end - 1, 9, 1), stop = new Date(end, 3, 15);
  const frac0 = Math.max(0, Math.min(1, (stop - now) / (stop - start)));
  const out = [];
  for (let k = 0; end + k <= exp; k++) if (k > 0 || frac0 > 0) out.push({ k, frac: k ? 1 : frac0 });
  return out;
}
function contractValue(p) {
  const sal = salaryNum(p.sal), seasons = contractSeasons(p), M = market();
  if (!sal || !seasons.length || !M.perWar) return null;
  const v = playerValue(p), pr = p._proj, pull = v.now - v.ability;
  let war = 0, surplus = 0, n = 0;
  for (const { k, frac } of seasons) {
    const w = k === 0 ? v.now : expWar(p.grp, pr[Math.min(12 * k, pr.length - 1)].mid) + pull;
    war += w * frac; surplus += (M.min + w * M.perWar - sal) * frac; n += frac;
  }
  return { sal, seasons: seasons.length, now: v.now, perM: v.now / (sal / 1e6), war, surplus, perSeason: n ? surplus / n : 0 };
}
/* Pick value / expected WAR / blend fitted on the training save, used by another league (SHA) until it has enough
   complete seasons of its own (build_data training_predictors). */
const borrowed = x => x?.source ? `<p class="small muted">Borrowed from the training save (snapshots to ${esc(x.source_date)}):
  this league switches to its own once it has ${x.own_after} complete seasons${x.draft_years ? " and its draft info" : ""}.</p>` : "";
function pickValue(slot) {
  const pk = D.predict?.picks;
  if (!pk) return { five: 0, season: 0 };
  const s = pk.shape[Math.max(1, Math.min(224, slot)) - 1];
  return { five: s * pk.prime5, season: s * pk.prime_avg };
}
function findPlayers(text, n = 8) {
  const terms = fold(text).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return D.players.filter(p => terms.every(t => p._n.includes(t))).sort((a, b) => b.ca - a.ca).slice(0, n);
}
/* A player row in the Home / Prospects lists. The name's link covers the whole row (.lname::after), and the club logo,
   club names and rank numbers inside it are links of their own on top of it. */
const listRow = (p, right, meta) => `<div class="lrow">${teamLogo(clubOf(p), 30)}
  <span class="lmain"><a class="lname" href="${route(p.k)}"><b>${esc(p.n)}</b></a><small>${meta ?? `${esc(p.pos)} · ${p.age} · ${tname(clubOf(p))}${p.lg && p.lg !== "NHL" ? ` (${esc(p.lg)})` : ""}`}</small></span>${right}</div>`;

// ---------------------------------------------------------------- home
let HOME_TEAM = "";
try { HOME_TEAM = localStorage.getItem(storeKey("ehm-home-team")) || ""; } catch (e) { /* storage blocked */ }
function renderHome() {
  markNav("home");
  const n = D.dates.length, last = D.dates[n - 1], prev = MOVE_BASE == null ? null : D.dates[MOVE_BASE];
  const days = prev ? Math.round((new Date(last + "T00:00:00") - new Date(prev + "T00:00:00")) / 864e5) : 0;
  const nhl = D.players.filter(p => p.lg === "NHL").map(inSeason);
  const clubs = nhlClubs();
  if (HOME_TEAM && !clubs.includes(HOME_TEAM)) HOME_TEAM = "";
  const top = (HOME_TEAM ? nhl.filter(p => clubOf(p) === HOME_TEAM) : nhl).sort((a, b) => b.ca - a.ca).slice(0, HOME_TEAM ? 8 : 10);
  const moves = D.players.map(p => ({ p, d: lastMove(p) })).filter(x => x.d != null);
  const risers = moves.slice().sort((a, b) => b.d - a.d).slice(0, 5), fallers = moves.slice().sort((a, b) => a.d - b.d).slice(0, 4);
  const warTop = nhl.filter(p => p.war).sort((a, b) => b.war.war - a.war.war).slice(0, 5);
  const impTop = nhl.filter(p => p.card?.comp?.impact != null).sort((a, b) => b.card.comp.impact - a.card.comp.impact || (b.war?.war || 0) - (a.war?.war || 0)).slice(0, 5);
  // the prospect and draft boxes sit beside the leaders box: as many rows as it has (its two headings count as one row)
  const sideRows = Math.max(5, warTop.length + impTop.length + 1);
  const prospects = D.players.filter(p => p.age <= 20).sort((a, b) => b.pa - a.pa).slice(0, sideRows);
  const ranked = D.players.map(p => ({ p, r: nhlRanks(p) })).filter(x => x.r).sort((a, b) => a.r.rank - b.r.rank).slice(0, sideRows);
  const lgCount = leagueCount;
  const chips = [...leagueList().slice(0, 6).map(l => [l, `${esc(l)} <span>${lgCount(l)}</span>`]), ["u20", "Prospects ≤ 20"], ["G", "Goalies"]];
  const mv = d => `<span class="delta ${d > 0 ? "pos" : "neg"}">${signed(d)}</span>`;
  const tbl = teamTable(SEASON);
  const rec = HOME_TEAM && tbl?.teams?.[abbrOf(HOME_TEAM)];
  view.innerHTML = `
  <section class="hero-band"><div class="wrap hero-grid">
    <div>
      <div class="eyebrow">${esc(D.title)} · snapshot ${fmtDate(last)}</div>
      <h1>What changed after the sim</h1>
      <p>${n} snapshot${n === 1 ? "" : "s"} · ${D.players.length.toLocaleString()} players${prev ? ` · changes are compared with the ${fmtDate(prev)} snapshot` : ""}.</p>
    </div>
    <div class="hero-search">
      <label for="home-q">Find a player</label>
      <input id="home-q" type="search" placeholder="e.g. ${esc(D.players.filter(p => p.lg === "NHL" && p.age <= 23).sort((a, b) => b.pa - a.pa).slice(0, 3).map(p => p.n.split(" ").pop()).join(", "))}" autocomplete="off">
      <ul id="home-sug" class="sug" role="listbox" hidden></ul>
      <div class="hchips">${chips.map(([k, t]) => `<button type="button" data-chip="${esc(k)}">${t}</button>`).join("")}</div>
    </div>
  </div></section>
  <div class="wrap page home">
    <div class="row">
      <section class="card-box wide" aria-labelledby="top-h">
        <div class="box-head">
          <div class="box-title">${HOME_TEAM ? teamLogo(HOME_TEAM, 40) : ""}<div><h2 id="top-h">${HOME_TEAM ? esc(HOME_TEAM) : "Top players · NHL"}</h2>
            <p class="sub">${HOME_TEAM ? `Top ${top.length} by est. CA${rec ? ` · ${seasonLabel(SEASON)}: ${rec.w}–${rec.l}–${rec.otl}, ${rec.pts} points (${rankLink(teamRankHref("pts", HOME_TEAM), ordinal(rec.place))})` : ""}` : `By estimated current ability · WAR and impact: ${SEASON ? seasonLabel(SEASON) : ""} regular season`}</p></div></div>
          <label class="inline">Team <select id="home-team"><option value="">All NHL teams</option>${clubs.map(c => `<option ${c === HOME_TEAM ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        </div>
        <div class="lhead" aria-hidden="true"><span>Player</span><span>Est. CA</span><span>WAR</span><span>Impact</span></div>
        ${top.map((p, i) => listRow(p, `<span class="lnum"><b>${fmt(p.ca, 0)}</b></span><span class="lnum">${p.war ? fmt(p.war.war, 1) : "–"}</span><span class="lnum">${impPill(p.card?.comp?.impact, pRankHref("c", "impact", p.grp, p.k))}</span>`,
          `${i + 1}. ${esc(p.pos)} · ${p.age}${HOME_TEAM ? "" : " · " + esc(clubOf(p))} · PA ${fmt(p.pa, 0)} · peak ${fmt(sortVal(p, "peak"), 0)}`)).join("")}
        <a class="more-link" href="${HOME_TEAM ? teamRoute(HOME_TEAM) : "#/players"}">${HOME_TEAM ? `Full ${esc(HOME_TEAM)} roster →` : "All players →"}</a>
      </section>
      <section class="card-box" aria-labelledby="mv-h">
        <h2 id="mv-h">Biggest moves</h2>
        <p class="sub">Est. CA${prev ? `, ${fmtDate(prev)} → ${fmtDate(last)} (${days} days)` : ""}. Part of any jump can be estimation noise.</p>
        <h3 class="pos">Risers</h3>${risers.map(x => listRow(x.p, mv(x.d), `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))} · ${fmt(x.p.ca - x.d, 0)} → ${fmt(x.p.ca, 0)}`)).join("") || `<p class="muted small">Needs two snapshots.</p>`}
        ${fallers.length ? `<h3 class="neg">Fallers</h3>${fallers.map(x => listRow(x.p, mv(x.d), `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))} · ${fmt(x.p.ca - x.d, 0)} → ${fmt(x.p.ca, 0)}`)).join("")}` : ""}
      </section>
    </div>
    <div class="row three">
      <section class="card-box" aria-labelledby="pr-h"><h2 id="pr-h">Top prospects</h2><p class="sub">Age 20 and under, by est. PA (likely range)</p>
        ${prospects.map(p => listRow(p, `<span class="lnum stack"><b>${fmt(p.pa, 0)}</b><small>${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</small></span>`)).join("")}
        <a class="more-link" href="#/prospects/search" data-chip="u20">All prospects →</a></section>
      <section class="card-box" aria-labelledby="dr-h"><h2 id="dr-h">NHL draft ranking</h2><p class="sub">${ranked.length ? `${esc(ranked[0].r.stage)} list · official rank, est. PA` : "Official rank, est. PA"}</p>
        ${ranked.map(({ p, r }) => listRow(p, `<span class="lnum"><b>${fmt(p.pa, 0)}</b></span>`, `${rankLink("#/draft", "#" + r.rank)} · ${esc(p.pos)} · ${tname(clubOf(p))}${p.lg ? ` (${esc(p.lg)})` : ""}`)).join("") || `<p class="muted small">No NHL draft ranking in the latest snapshot.</p>`}
        <a class="more-link" href="#/draft">Draft →</a></section>
      <section class="card-box" aria-labelledby="ld-h"><h2 id="ld-h">NHL leaders</h2><p class="sub">${SEASON ? seasonLabel(SEASON) : ""} regular season</p>
        ${warTop.length || impTop.length ? `<div class="split">
          <div><h3>WAR</h3>${warTop.map(p => listRow(p, `<span class="lnum">${rankLink(pRankHref("war", "war", p.grp, p.k), `<b>${fmt(p.war.war, 1)}</b>`)}</span>`, esc(p.pos))).join("")}</div>
          <div><h3>Impact</h3>${impTop.map(p => listRow(p, `<span class="lnum">${rankLink(pRankHref("c", "impact", p.grp, p.k), `<b>${p.card.comp.impact}</b>`)}</span>`, esc(p.pos))).join("")}</div>
        </div>` : `<p class="muted small">No NHL box scores for this season yet.</p>`}</section>
    </div>
  </div>`;
  view.querySelector("#home-team").onchange = e => {
    HOME_TEAM = e.target.value;
    try { localStorage.setItem(storeKey("ehm-home-team"), HOME_TEAM); } catch (err) { /* storage blocked */ }
    renderHome();
  };
  view.querySelectorAll("[data-chip]").forEach(b => b.onclick = e => {
    e.preventDefault();
    const c = b.dataset.chip;
    Object.assign(R, { lg: "", grp: "", team: "", maxAge: "", sort: "ca", dir: -1 });
    if (c === "u20") { Object.assign(PR, { grp: "", club: "", q: "", maxAge: "20", sort: "pa", nhl: true, limit: 100 }); location.hash = "#/prospects/search"; return; }
    else if (c === "G") R.grp = "G";
    else R.lg = c;
    location.hash = "#/players";
  });
  const hq = view.querySelector("#home-q"), hs = view.querySelector("#home-sug");
  hq.addEventListener("input", () => {
    const hits = findPlayers(hq.value);
    hs.innerHTML = hits.map(p => `<li><a href="${route(p.k)}">${logo(clubOf(p), 22)} <b>${esc(p.n)}</b> <span class="muted small">${esc(p.pos)} · ${p.age} · ${esc(clubOf(p))}</span></a></li>`).join("")
      || (hq.value.trim() ? `<li class="muted">No players match</li>` : "");
    hs.hidden = !hs.innerHTML;
  });
  hq.addEventListener("keydown", e => { if (e.key === "Enter") { const p = findPlayers(hq.value, 1)[0]; if (p) location.hash = route(p.k); } });
}

// ---------------------------------------------------------------- prospects
/* League-wide prospects: players aged 23 or under outside the NHL, with the NHL club that owns each one (its Top Prospects
   list, the draft rights from crawler --picks, a draft in the last 5 years) or none. #/prospects is an at-a-glance overview;
   #/prospects/drafted and /undrafted put the glance boxes on top and their full list at the bottom; /search is the free
   list (name, every filter, NHL players optional). */
const PR = { grp: "", maxAge: "23", club: "", kind: "", q: "", sort: "peak", nhl: false, limit: 100 };
const PROSPECT_TABS = [["overview", "Overview"], ["drafted", "Drafted"], ["undrafted", "Undrafted"], ["search", "Search"]];
const PROSPECT_POS = [["C", "Centres"], ["LW", "Left wings"], ["RW", "Right wings"], ["LD", "Left defence"], ["RD", "Right defence"], ["G", "Goalies"]];
const PROSPECT_AGE = 23;
let RIGHTS = null;
function nhlOwner(p) {
  if (p.tp && NHL_TEAMS[p.tp[0]]) return { club: p.tp[0], how: `#${p.tp[1]} on its Top Prospects` };
  if (D.rights && !RIGHTS) RIGHTS = new Map(D.rights.rows.filter(x => x[4]).map(x => [x[4], draftClub(x[6])]));
  if (RIGHTS?.get(p.k)) return { club: RIGHTS.get(p.k), how: "draft rights" };
  if (p.lg === "NHL" && NHL_TEAMS[clubOf(p)]) return { club: clubOf(p), how: "NHL roster" };
  const d = p.dft?.pro;
  if (!D.rights && d?.year >= nextDraftYear() - 5 && hasClub(draftClub(d.team))) return { club: draftClub(d.team), how: `drafted ${d.year}` };
  return null;
}
/* Undrafted players fall in three groups: on the NHL draft ranking, too young to be ranked yet (19 or under), past draft age. */
/* A player who has played in the NHL is no longer a prospect, whatever league he is in now: the NHL's rookie (Calder)
   rule, 25+ regular-season games in one season or 6+ in each of two seasons, counted from his career table. */
function nhlGraduated(p) {
  if (p._grad !== undefined) return p._grad;
  const C = D.careerCols || [], si = C.indexOf("season"), ti = C.indexOf("type"), li = C.indexOf("league"), gi = C.indexOf("gp");
  const gp = {};
  for (const r of p.car || []) if (r[ti] === "R" && r[li] === "NHL") gp[r[si]] = (gp[r[si]] || 0) + (r[gi] || 0);
  const g = Object.values(gp);
  return (p._grad = g.some(n => n >= 25) || g.filter(n => n >= 6).length >= 2);
}
/* Unowned players: on the NHL draft ranking, too young to be ranked yet (19 or under), past draft age and never drafted,
   or drafted once but owned by no NHL club now (rights lapsed). */
const UNDRAFTED_KINDS = [["elig", "Draft eligible"], ["young", "Not ranked yet"], ["older", "Never drafted"], ["lapsed", "Drafted, rights lapsed"]];
const undraftedKind = x => (x.r ? "elig" : x.p.age <= 19 ? "young" : x.p.dft?.pro ? "lapsed" : "older");
function prospectPool(withNhl = false) {
  return D.players.filter(p => p.age <= (withNhl ? 99 : PROSPECT_AGE) && (withNhl || (p.lg !== "NHL" && !nhlGraduated(p))))
    .map(p => ({ p, o: nhlOwner(p), r: nhlRanks(p), peak: sortVal(p, "peak") }));
}
const posOf = p => (p.pos || "").split("/")[0];
const byPeak = (a, b) => b.peak - a.peak;
// who owns a prospect: the club (linked), else the NHL draft ranking
const nhlRankLink = r => rankLink("#/draft", `NHL #${r.rank}`);
const ownerHtml = x => (x.o ? tname(x.o.club) : x.r ? `Draft eligible · ${nhlRankLink(x.r)}` : "Undrafted");
/* One player as a list row: the big number is his projected peak, the small one his est. PA. */
const prospectRow = (x, meta) => listRow(x.p, `<span class="lnum stack"><b>${fmt(x.peak, 0)}</b><small>PA ${fmt(x.p.pa, 0)}</small></span>`,
  meta ?? `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""} · ${ownerHtml(x)}`);
const rowsHead = (a = "Proj. peak", b = "") => `<div class="lhead${b ? " stack" : ""}" aria-hidden="true"><span>Player</span><span>${a}${b ? `<small> · ${b}</small>` : ""}</span></div>`;
const moreLink = (href, text) => `<a class="more-link" href="${href}">${text} →</a>`;
function posBoard(rows, title, sub, meta = x => `${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""} · ${ownerHtml(x)}`) {
  return `<section aria-labelledby="pos-h"><div class="sec-head"><h2 id="pos-h">${title}</h2><p class="sub">${sub}</p></div>
    <div class="pos-grid">${PROSPECT_POS.map(([k, t]) => {
      const top = rows.filter(x => posOf(x.p) === k).sort(byPeak).slice(0, 3);
      return `<section class="card-box" aria-label="${t}"><h3 class="box-h">${t}</h3>${rowsHead("Peak", "PA")}
        ${top.map(x => prospectRow(x, meta(x))).join("") || `<p class="muted small">None.</p>`}</section>`;
    }).join("")}</div></section>`;
}
function poolRows(n) {
  return nhlClubs().map(c => { const ps = listedBy(c); return { c, ps, v: poolValue(ps) }; }).sort((a, b) => b.v - a.v).slice(0, n);
}
const poolRow = ({ c, ps, v }, i) => {
  const best = ps.slice().sort((a, b) => sortVal(b, "peak") - sortVal(a, "peak"))[0];
  return `<div class="lrow">${logo(c, 30)}<span class="lmain"><a class="lname" href="${teamRoute(c)}/prospects"><b>${i + 1}. ${esc(c)}</b></a>
    <small>${ps.length} listed${best ? ` · best <a href="${route(best.k)}">${esc(best.n)}</a>` : ""}</small></span><span class="lnum">${rankLink(teamRankHref("pool", c), `<b>${fmt(v, 1)}</b>`)}</span></div>`;
};
function prospectTable(rows, { owner = true, ownerLabel = "NHL club", war = false, more = true } = {}) {
  if (!rows.length) return `<p class="pad muted small">No players match these filters.</p>`;
  const tier = p => (p.sc?.career || "").split(",").slice(1).join(",").trim();
  const ownerCell = x => x.o ? `${clubLink(x.o.club, "/prospects", `${logo(x.o.club, 20)} ${esc(x.o.club)}`, "nowrap")}<br><span class="muted small">${esc(x.o.how)}</span>`
    : x.r ? `<a class="small" href="#/draft">Draft eligible</a><br><span class="muted small">${esc(x.r.stage)} #${x.r.rank}</span>` : `<span class="muted small">${x.p.age <= 19 ? "Not ranked yet" : "Past draft age"}</span>`;
  const shown = rows.slice(0, PR.limit);
  return `<div class="tablewrap"><table class="rank"><thead><tr><th class="num">#</th><th class="pcol">Player</th><th>Pos</th><th class="num">Age</th>
      <th>Playing for</th>${owner ? `<th>${ownerLabel}</th>` : ""}<th class="num">Est. CA</th><th class="num">Est. PA</th><th class="num">Proj. peak</th>${war ? '<th class="num">WAR / season at peak</th>' : ""}<th>Scout tier</th></tr></thead><tbody>
      ${shown.map((x, i) => `<tr class="link" data-k="${esc(x.p.k)}"><td class="num muted">${i + 1}</td>
        <th scope="row" class="pcol"><a class="pcell" href="${route(x.p.k)}"><span><b>${esc(x.p.n)}</b></span></a></th><td>${esc(x.p.pos)}</td><td class="num">${x.p.age}</td>
        <td>${tname(clubOf(x.p))}${x.p.lg ? `<br><span class="muted small">${esc(x.p.lg)}</span>` : ""}</td>${owner ? `<td>${ownerCell(x)}</td>` : ""}<td class="num">${fmt(x.p.ca, 0)}</td>
        <td class="num"><b>${fmt(x.p.pa, 0)}</b><br><span class="muted small">${fmt(x.p.pa_lo, 0)}–${fmt(x.p.pa_hi, 0)}</span></td><td class="num"><b>${fmt(x.peak, 0)}</b></td>
        ${war ? `<td class="num">${fmt(expWar(x.p.grp, x.peak), 2)}</td>` : ""}<td class="small">${esc(tier(x.p)) || dash}</td></tr>`).join("")}
    </tbody></table></div>
    ${more && rows.length > PR.limit ? `<div class="more"><button class="ghost" id="pf-more" type="button">Show more (${(rows.length - PR.limit).toLocaleString()} left)</button></div>` : ""}`;
}
// filter controls, each tab picks the ones that make sense for it
const segCtl = (id, legend, opts, cur) => `<fieldset><legend>${legend}</legend><div class="seg" id="${id}">${opts
  .map(([v, t]) => `<button type="button" data-v="${v}" class="${v === cur ? "on" : ""}" aria-pressed="${v === cur}">${t}</button>`).join("")}</div></fieldset>`;
const CTL = {
  grp: () => segCtl("pf-grp", "Position", [["", "All"], ["F", "Forwards"], ["D", "Defence"], ["G", "Goalies"]], PR.grp),
  sort: () => segCtl("pf-sort", "Rank by", [["peak", "Proj. peak"], ["pa", "Est. PA"], ["ca", "Est. CA"]], PR.sort),
  kind: () => segCtl("pf-kind", "Group", [["", "All"], ...UNDRAFTED_KINDS], PR.kind),
  club: (extra = true) => `<label>NHL club <select id="pf-club"><option value="">All</option>${extra ? `<option value="__none" ${PR.club === "__none" ? "selected" : ""}>No NHL club</option>` : ""}
    ${nhlClubs().map(c => `<option ${c === PR.club ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>`,
  age: () => `<label>Max age <select id="pf-age">${[17, 18, 19, 20, 21, 22, 23].map(a => `<option ${String(a) === PR.maxAge ? "selected" : ""}>${a}</option>`).join("")}</select></label>`,
  q: () => `<label class="grow">Name <input id="pf-q" type="search" placeholder="Search prospects" autocomplete="off" value="${esc(PR.q)}"></label>`,
  nhl: () => `<label class="check"><input id="pf-nhl" type="checkbox" ${PR.nhl ? "checked" : ""}> Include NHL players</label>`,
};
const filterBar = (ctls, count) => `<form class="filters card-box" aria-label="Filters">${ctls.join("")}
  <span class="count">${count.toLocaleString()} player${count === 1 ? "" : "s"}</span></form>`;
const sortRows = rows => rows.sort((a, b) => (PR.sort === "peak" ? b.peak - a.peak : sortVal(b.p, PR.sort) - sortVal(a.p, PR.sort)));
const statCard = (label, value, note) => `<div><span>${label}</span><b class="${/</.test(value) ? "name" : ""}">${value}</b>${note ? `<small>${note}</small>` : ""}</div>`;
const pLink = x => (x ? `<a href="${route(x.p.k)}">${esc(x.p.n)}</a>` : "–");
const pNote = x => (x ? `${esc(x.p.pos)} · ${x.p.age} · peak ${fmt(x.peak, 0)}` : "");

function prospectsOverview(all) {
  const drafted = all.filter(x => x.o), und = all.filter(x => !x.o);
  const top = all.slice().sort(byPeak).slice(0, 10);
  const risers = all.map(x => ({ ...x, d: lastMove(x.p) })).filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 6);
  const elig = und.filter(x => x.r).sort(byPeak).slice(0, 5);
  const older = und.filter(x => undraftedKind(x) === "older").sort(byPeak).slice(0, 5);
  const prev = MOVE_BASE == null ? null : D.dates[MOVE_BASE];
  return `<div class="stat-cards">
      ${statCard("Prospects", all.length.toLocaleString(), `${PROSPECT_AGE} or under, outside the NHL and not graduated (25+ NHL games in a season or 6+ in two)`)}
      ${statCard("Drafted", drafted.length.toLocaleString(), `owned by an NHL club · <a href="#/prospects/drafted">see all</a>`)}
      ${statCard("Undrafted", und.length.toLocaleString(), `${und.filter(x => x.r).length} on the NHL draft ranking`)}
      ${statCard("Best prospect", pLink(top[0]), pNote(top[0]))}
    </div>
    <div class="row">
      <section class="card-box wide" aria-labelledby="top10-h"><h2 id="top10-h">Top 10 prospects</h2>
        <p class="sub">By projected peak: the highest est. CA on his projected path. The small number is his est. PA.</p>
        ${rowsHead("Peak", "PA")}${top.map((x, i) => prospectRow(x, `${i + 1}. ${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""} · ${ownerHtml(x)}`)).join("")}
        ${moreLink("#/prospects/search", "Search every prospect")}</section>
      <section class="card-box" aria-labelledby="rise-h"><h2 id="rise-h">Rising fast</h2>
        <p class="sub">Biggest est. CA gains${prev ? ` since ${fmtDate(prev)}` : ""}. Part of any jump can be estimation noise.</p>
        ${risers.map(x => listRow(x.p, `<span class="delta pos">${signed(x.d)}</span>`, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))} · ${fmt(x.p.ca - x.d, 0)} → ${fmt(x.p.ca, 0)}`)).join("")
          || `<p class="muted small">Needs two snapshots.</p>`}</section>
    </div>
    ${posBoard(all, "Best at every position", "Top 3 by projected peak, drafted or not (primary position).")}
    <div class="row three">
      <section class="card-box" aria-labelledby="next-h"><h2 id="next-h">Top of the next draft</h2><p class="sub">Draft eligible, by our projected peak · NHL list rank</p>
        ${elig.map(x => prospectRow(x, `${nhlRankLink(x.r)} · ${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}`)).join("") || `<p class="muted small">No NHL draft ranking in the latest snapshot.</p>`}
        ${moreLink("#/prospects/undrafted", "All undrafted")}</section>
      <section class="card-box" aria-labelledby="old-h"><h2 id="old-h">Never drafted, past draft age</h2><p class="sub">Aged 20–${PROSPECT_AGE}, never in an NHL draft, no NHL club and not on the draft ranking</p>
        ${older.map(x => prospectRow(x, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}`)).join("") || `<p class="muted small">None.</p>`}
        ${moreLink("#/prospects/undrafted", "All undrafted")}</section>
      <section class="card-box" aria-labelledby="pool-h"><h2 id="pool-h">Deepest prospect pools</h2><p class="sub">Expected WAR / season at peak, summed over each club's Top Prospects list</p>
        ${poolRows(5).map(poolRow).join("") || `<p class="muted small">None yet.</p>`}
        ${moreLink("#/prospects/drafted", "All 32 pools")}</section>
    </div>`;
}
function prospectsDrafted(all) {
  const drafted = all.filter(x => x.o);
  const ready = drafted.slice().sort((a, b) => b.p.ca - a.p.ca).slice(0, 6);
  const ceiling = drafted.slice().sort((a, b) => b.p.pa_hi - a.p.pa_hi).slice(0, 6);
  const pools = poolRows(99);
  const rows = sortRows(drafted.filter(x => (!PR.grp || x.p.grp === PR.grp) && x.p.age <= +PR.maxAge && (!PR.club || x.o.club === PR.club)));
  return `<div class="stat-cards">
      ${statCard("Drafted prospects", drafted.length.toLocaleString(), "owned by an NHL club")}
      ${statCard("Best drafted", pLink(drafted.slice().sort(byPeak)[0]), pNote(drafted.slice().sort(byPeak)[0]))}
      ${statCard("Closest to the NHL", pLink(ready[0]), ready[0] ? `est. CA ${fmt(ready[0].p.ca, 0)} · ${tname(ready[0].o.club)}` : "")}
      ${statCard("Deepest pool", pools[0] ? `<a href="${teamRoute(pools[0].c)}/prospects">${logo(pools[0].c, 20)} ${esc(pools[0].c)}</a>` : "–", pools[0] ? rankLink(teamRankHref("pool", pools[0].c), `${fmt(pools[0].v, 1)} WAR / season at peak`) : "")}
    </div>
    ${posBoard(drafted, "Best drafted prospect at every position", "Top 3 by projected peak; the last part is the NHL club that owns him.")}
    <div class="row three">
      <section class="card-box" aria-labelledby="rdy-h"><h2 id="rdy-h">Closest to the NHL</h2><p class="sub">Highest est. CA today · NHL club</p>
        ${rowsHead("Est. CA")}${ready.map(x => listRow(x.p, `<span class="lnum"><b>${fmt(x.p.ca, 0)}</b></span>`, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))} · ${tname(x.o.club)}`)).join("") || `<p class="muted small">None yet.</p>`}</section>
      <section class="card-box" aria-labelledby="ceil-h"><h2 id="ceil-h">Highest ceiling</h2><p class="sub">Top of the likely est. PA range · NHL club</p>
        ${rowsHead("PA high", "PA")}${ceiling.map(x => listRow(x.p, `<span class="lnum stack"><b>${fmt(x.p.pa_hi, 0)}</b><small>PA ${fmt(x.p.pa, 0)}</small></span>`, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))} · ${tname(x.o.club)}`)).join("") || `<p class="muted small">None yet.</p>`}</section>
      <section class="card-box" aria-labelledby="pool-h"><h2 id="pool-h">Deepest prospect pools</h2><p class="sub">Expected WAR / season at peak, summed · all 32 at the bottom</p>
        ${pools.slice(0, 6).map(poolRow).join("") || `<p class="muted small">None yet.</p>`}</section>
    </div>
    ${filterBar([CTL.grp(), CTL.sort(), CTL.club(false), CTL.age()], rows.length)}
    <section class="card-box flush" aria-labelledby="dl-h"><h2 class="box-h" id="dl-h">Every drafted prospect</h2>
      ${prospectTable(rows)}
      <p class="sub pad">NHL club: the club whose Top Prospects list he is on, else ${D.rights ? `the club holding his draft rights (${fmtDate(D.rights.date)})` : "the club that drafted him in the last 5 drafts (draft rights not read yet: crawler --picks)"}.</p></section>
    <section class="card-box flush" aria-labelledby="pools-h"><h2 class="box-h" id="pools-h">Prospect pools by club</h2>
      <div class="tablewrap"><table class="rank sortable"><thead><tr><th class="num">Rank</th><th>Club</th><th class="num">Listed</th><th class="num">Average est. PA</th>
        <th class="num">Pool value</th><th>Best prospect</th></tr></thead><tbody>
        ${pools.map(({ c, ps, v }, i) => { const b = ps.slice().sort((a, b2) => sortVal(b2, "peak") - sortVal(a, "peak"))[0];
          return `<tr><td class="num" data-v="${i + 1}">${rankChip(i + 1, pools.length, teamRankHref("pool", c))}</td><td><a class="nowrap" href="${teamRoute(c)}/prospects">${logo(c, 20)} ${esc(c)}</a></td>
          <td class="num">${ps.length}</td><td class="num">${ps.length ? fmt(ps.reduce((s, p) => s + p.pa, 0) / ps.length, 0) : dash}</td><td class="num" data-v="${v}"><b>${fmt(v, 1)}</b></td>
          <td>${b ? `<a href="${route(b.k)}">${esc(b.n)}</a> <span class="muted small">${esc(b.pos)} · ${b.age} · peak ${fmt(sortVal(b, "peak"), 0)}</span>` : dash}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="sub pad">Each club's Top Prospects list in EHM (12 players at most). Pool value = expected WAR per season at projected peak, summed over the list.</p></section>`;
}
function prospectsUndrafted(all) {
  const und = all.filter(x => !x.o);
  const group = k => und.filter(x => undraftedKind(x) === k).sort(byPeak);
  const elig = group("elig"), young = group("young"), older = group("older");
  const rows = sortRows(und.filter(x => (!PR.grp || x.p.grp === PR.grp) && x.p.age <= +PR.maxAge && (!PR.kind || undraftedKind(x) === PR.kind)));
  const box = (id, title, sub, list, meta) => `<section class="card-box" aria-labelledby="${id}"><h2 id="${id}">${title}</h2><p class="sub">${sub}</p>
    ${rowsHead("Peak", "PA")}${list.slice(0, 6).map(x => prospectRow(x, meta(x))).join("") || `<p class="muted small">None.</p>`}</section>`;
  return `<div class="stat-cards">
      ${statCard("Undrafted", und.length.toLocaleString(), `${PROSPECT_AGE} or under, no NHL club`)}
      ${statCard("Draft eligible", elig.length.toLocaleString(), `on the NHL draft ranking · <a href="#/draft">Draft board</a>`)}
      ${statCard("Best draft eligible", pLink(elig[0]), elig[0] ? `${nhlRankLink(elig[0].r)} · peak ${fmt(elig[0].peak, 0)}` : "")}
      ${statCard("Best past draft age", pLink(older[0]), pNote(older[0]))}
    </div>
    ${posBoard(und, "Best undrafted player at every position", "Top 3 by projected peak; draft eligible ones show their NHL list rank.",
      x => `${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}${x.r ? ` · ${nhlRankLink(x.r)}` : ""}`)}
    <div class="row three">
      ${box("el-h", "Top of the next draft", "Draft eligible, by our projected peak · NHL list rank", elig, x => `${nhlRankLink(x.r)} · ${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}`)}
      ${box("yg-h", "Not ranked yet", "19 or under and not on the NHL draft ranking: later drafts", young, x => `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}`)}
      ${box("od-h", "Never drafted, past draft age", `20–${PROSPECT_AGE}, never in an NHL draft, no NHL club, not on the ranking`, older, x => `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}`)}
    </div>
    ${filterBar([CTL.kind(), CTL.grp(), CTL.sort(), CTL.age()], rows.length)}
    <section class="card-box flush" aria-labelledby="ul-h"><h2 class="box-h" id="ul-h">Every undrafted prospect</h2>
      ${prospectTable(rows, { ownerLabel: "Draft status" })}
      <p class="sub pad">No NHL club: on no club's Top Prospects list${D.rights ? " and no club holds his draft rights" : ", not drafted in the last 5 drafts (draft rights not read yet: crawler --picks)"}.
        Draft eligible = on the latest NHL draft ranking.</p></section>`;
}
function prospectsSearch() {
  const q = fold(PR.q.trim());
  const rows = sortRows(prospectPool(PR.nhl).filter(x => x.p.age <= +PR.maxAge && (!PR.grp || x.p.grp === PR.grp) && (!q || x.p._n.includes(q))
    && (!PR.club || (PR.club === "__none" ? !x.o : x.o?.club === PR.club))));
  return `${filterBar([CTL.q(), CTL.grp(), CTL.sort(), CTL.club(), CTL.age(), CTL.nhl()], rows.length)}
    <section class="card-box flush" aria-label="Prospect list">${prospectTable(rows, { war: true })}
      <p class="sub pad">Proj. peak is the highest est. CA on his projected path; WAR / season at peak is the expected WAR at that ability.</p></section>`;
}
function renderProspects(tab = "overview") {
  markNav("prospects");
  if (!PROSPECT_TABS.some(t => t[0] === tab)) tab = "overview";
  const all = prospectPool();
  const lede = { overview: "The best players aged 23 or under who haven't played their way into the NHL, at a glance",
    drafted: "Prospects an NHL club owns: its Top Prospects list or draft rights", undrafted: "Prospects no NHL club owns yet: next draft, later drafts and the never drafted",
    search: "Every prospect, with every filter" }[tab];
  view.innerHTML = `
  <section class="band"><div class="wrap"><h1>Prospects</h1>
    <p class="lede">${lede} · snapshot ${fmtDate(D.dates.at(-1))}</p>
    ${tabBar("Prospect sections", PROSPECT_TABS, tab, "data-ptab")}
  </div></section>
  <div class="wrap page prospects">${tab === "drafted" ? prospectsDrafted(all) : tab === "undrafted" ? prospectsUndrafted(all) : tab === "search" ? prospectsSearch() : prospectsOverview(all)}</div>`;
  const rerender = () => { PR.limit = 100; renderProspects(tab); };
  view.querySelectorAll("[data-ptab]").forEach(b => b.onclick = () => { PR.limit = 100; location.hash = "#/prospects" + (b.dataset.ptab === "overview" ? "" : "/" + b.dataset.ptab); });
  view.querySelectorAll("#pf-grp button").forEach(b => b.onclick = () => { PR.grp = b.dataset.v; rerender(); });
  view.querySelectorAll("#pf-sort button").forEach(b => b.onclick = () => { PR.sort = b.dataset.v; rerender(); });
  view.querySelectorAll("#pf-kind button").forEach(b => b.onclick = () => { PR.kind = b.dataset.v; rerender(); });
  view.querySelector("#pf-club")?.addEventListener("change", e => { PR.club = e.target.value; rerender(); });
  view.querySelector("#pf-age")?.addEventListener("change", e => { PR.maxAge = e.target.value; rerender(); });
  view.querySelector("#pf-nhl")?.addEventListener("change", e => { PR.nhl = e.target.checked; rerender(); });
  const qi = view.querySelector("#pf-q");
  // re-render once typing pauses (not on every key: on a phone each re-render can close and reopen the keyboard),
  // keeping the cursor in the box
  let qt = 0;
  qi?.addEventListener("input", () => {
    clearTimeout(qt);
    qt = setTimeout(() => {
      PR.q = qi.value; const at = qi.selectionStart; rerender();
      const n = view.querySelector("#pf-q"); n.focus(); n.setSelectionRange(at, at);
    }, 250);
  });
  view.querySelector("#pf-more")?.addEventListener("click", () => { PR.limit += 200; renderProspects(tab); });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = route(tr.dataset.k); });
  makeSortable();
}

// ---------------------------------------------------------------- teams
const TEAM_TABS = ["roster", "players", "stats", "results", "contracts", "prospects", "drafts", "history", "hof"];
const tabHash = tab => (tab === "roster" ? "" : "/" + tab);
function renderTeams(club, tab = "roster", arg, arg2) {
  markNav("teams");
  const players = D.players.map(inSeason);
  if (!club) {
    const clubs = nhlClubs(), tbl = teamTable(SEASON);
    const others = {};
    players.forEach(p => { const c = clubOf(p), lg = c && clubLeagueOf(c); if (c && !NHL_TEAMS[c] && !hasLeague(lg)) (others[lg || p.lg || "No league"] ||= new Set()).add(c); });
    view.innerHTML = `<section class="band"><div class="wrap">${leagueNames().length ? leagueStrip("NHL") : ""}<h1>Teams</h1>
      <p class="lede">Every NHL club with its record${SEASON ? ` (${seasonLabel(SEASON)})` : ""}, listed payroll and best player.${leagueNames().length ? ` The tabs above open the other leagues (${leagueNames().join(", ")});` : ""} other clubs are below.</p></div></section>
      <div class="wrap page">
        <div class="team-grid">${clubs.map(c => {
          const ps = players.filter(p => clubOf(p) === c), r = tbl?.teams?.[abbrOf(c)];
          const best = ps.slice().sort((a, b) => b.ca - a.ca)[0];
          const pay = ps.reduce((s, p) => s + salaryNum(p.sal), 0);
          // the club name's link covers the card; the standings place and the best player are links of their own
          return `<div class="team-card">${logo(c, 44)}<span><a class="lname" href="${teamRoute(c)}"><b>${esc(c)}</b></a>
            <small>${r ? `${r.w}–${r.l}–${r.otl} · ${r.pts} pts (${rankLink(teamRankHref("pts", c), ordinal(r.place))})` : `${ps.length} players`}</small>
            <small>${pay ? money(pay) : ""}${best ? ` · <a href="${route(best.k)}">${esc(best.n)}</a> ${fmt(best.ca, 0)}` : ""}</small></span></div>`;
        }).join("")}</div>
        ${Object.entries(others).sort((a, b) => b[1].size - a[1].size).map(([lg, cs]) => `<details class="card-box"><summary><b>${esc(lg)}</b> <span class="muted">${cs.size} clubs</span></summary>
          <div class="club-list">${[...cs].sort((a, b) => a.localeCompare(b)).map(c => tname(c)).join("")}</div></details>`).join("")}
      </div>`;
    return;
  }
  const ps = players.filter(p => clubOf(p) === club);
  if (!ps.length) { view.innerHTML = `<div class="wrap page"><div class="panel">Unknown club. <a href="#/teams">All teams</a></div></div>`; return; }
  if (!NHL_TEAMS[club] && hasLeague(clubLeagueOf(club))) return renderLeagueTeam(club, clubLeagueOf(club), ps, tab, arg);
  const abbr = abbrOf(club), statSeasons = SEASONS.filter(s => teamTable(s)?.teams?.[abbr]);
  if (tab === "stats" && !statSeasons.length) tab = "roster";
  const hasDrafts = !!NHL_TEAMS[club] && draftValues().picks.some(x => x.club === club);
  if (["players", "results"].includes(tab) && !(NHL_TEAMS[club] && SEASONS.some(s => D.teamPlayers?.[s]?.[abbrOf(club)]))) tab = "roster";
  if ((["prospects", "history", "hof", "contracts"].includes(tab) && !NHL_TEAMS[club]) || (tab === "drafts" && !hasDrafts)) tab = "roster";
  const tbl = teamTable(SEASON), rec = tbl?.teams?.[abbr];
  const lgs = [...new Set(ps.map(p => p.lg).filter(Boolean))];
  const pay = ps.reduce((s, p) => s + salaryNum(p.sal), 0);
  const isNhl = !!NHL_TEAMS[club], hasPlayers = isNhl && !!abbr && SEASONS.some(s => D.teamPlayers?.[s]?.[abbr]);
  const strip = isNhl ? `<nav class="team-strip" aria-label="All NHL teams"><div class="wrap">${nhlClubs().map(c =>
    `<a href="${teamRoute(c)}${tabHash(tab)}" class="${c === club ? "on" : ""}" ${c === club ? 'aria-current="page"' : ""} aria-label="${esc(c)}">${logo(c, 32)}</a>`).join("")}</div></nav>` : "";
  view.innerHTML = `${strip}
  <section class="band"><div class="wrap">
    <div class="team-head">${logo(club, 72)}
      <div class="grow"><h1>${esc(club)}</h1><p class="lede">${lgs.map(lgLink).join(", ") || "No league"} · ${ps.length} players${rec ? ` · ${seasonLabel(SEASON)}: ${rec.w}–${rec.l}–${rec.otl}, ${rec.pts} points (${rankLink(teamRankHref("pts", club), ordinal(rec.place))})` : ""} · snapshot ${fmtDate(D.dates.at(-1))}</p></div>
      <span class="inline team-nav">${isNhl ? `<label class="inline">Team <select id="team-sel">${nhlClubs().map(c => `<option ${c === club ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : ""}<a href="#/teams">All teams</a></span>
    </div>
    ${tabBar("Team sections", [["roster", "Roster"], ...(hasPlayers ? [["players", "Player stats"]] : []), ...(statSeasons.length ? [["stats", "Team stats"]] : []),
      ...(hasPlayers ? [["results", "Results"]] : []), ...(isNhl ? [["contracts", "Contracts"], ["prospects", "Prospects & picks"]] : []), ...(hasDrafts ? [["drafts", "Draft history"]] : []),
      ...(isNhl ? [["history", "History"], ["hof", "Hall of Fame"]] : [])], tab)}
  </div></section>
  <div class="wrap page">${tab === "stats" ? teamStatsTab(club, abbr, statSeasons) : tab === "contracts" ? contractsTab(club, ps) : tab === "prospects" ? prospectsTab(club) : tab === "drafts" ? teamDraftsTab(club) : tab === "players" ? teamPlayersTab(club, arg, arg2) : tab === "results" ? teamResultsTab(club, arg, arg2) : tab === "history" ? (nhlPeople(), teamHistoryTab(club)) : tab === "hof" ? (nhlPeople(), hallOfFameTab(club)) : rosterTab(club, ps, pay)}</div>`;
  view.querySelector("#team-sel")?.addEventListener("change", e => (location.hash = teamRoute(e.target.value) + tabHash(tab)));
  view.querySelectorAll(".ptabs [data-tab]").forEach(b => b.onclick = () => (location.hash = teamRoute(club) + tabHash(b.dataset.tab)));
  view.querySelector("#t-season")?.addEventListener("change", e => { SEASON = e.target.value; renderTeams(club, tab); });
  if (tab === "roster") bindRoster(club, ps);
  else if (tab === "players") bindTeamPlayers(club, arg, arg2);
  else if (tab === "results") view.querySelector("#rs-season")?.addEventListener("change", e => (location.hash = `${teamRoute(club)}/results/${e.target.value}`));
  if (["prospects", "drafts", "contracts"].includes(tab)) makeSortable();
  if (!["roster", "players", "results"].includes(tab)) view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
}
/* Roster columns: [key, header, value for filter/sort, numeric, cell, width px]. The filters and sort are shared by
   the three position tables and kept when switching teams; fixed widths keep the three tables' columns in line. */
const ROSTER_COLS = [
  ["n", "Player", p => p.n, false, p => `<th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}"><span><b>${esc(p.n)}</b></span></a></th>`, 170],
  ["no", "No", p => (p.no === "" || p.no == null ? null : +p.no), true, p => `<td class="num">${esc(p.no || "")}</td>`, 52],
  ["pos", "Pos", p => p.pos, false, p => `<td>${esc(p.pos)}</td>`, 90],
  ["age", "Age", p => p.age, true, p => `<td class="num">${p.age}</td>`, 52],
  ["lg", "League", p => p.lg || "", false, p => `<td>${esc(p.lg || "")}</td>`, 72],
  ["ca", "Est. CA", p => p.ca, true, p => `<td class="num"><b>${fmt(p.ca, 0)}</b> ${stars(p.ca)}</td>`, 112],
  ["pa", "Est. PA", p => p.pa, true, p => `<td class="num">${fmt(p.pa, 0)}</td>`, 66],
  ["peak", "Proj. peak", p => sortVal(p, "peak"), true, p => `<td class="num">${fmt(sortVal(p, "peak"), 0)}</td>`, 90],
  ["war", "WAR", p => p.war?.war ?? null, true, p => `<td class="num">${p.war ? fmt(p.war.war, 1) : dash}</td>`, 58],
  ["imp", "Impact", p => p.card?.comp?.impact ?? null, true, p => `<td class="num">${impPill(p.card?.comp?.impact, pRankHref("c", "impact", p.grp, p.k))}</td>`, 70],
  ["sal", "Salary", p => (p.sal ? salaryNum(p.sal) / 1e6 : null), true, p => `<td class="num">${esc(p.sal || "")}</td>`, 126],
  ["exp", "Expires", p => p.exp || "", false, p => `<td class="nowrap">${esc(p.exp || "")}</td>`, 84],
  ["role", "Role", p => p.sc?.role || "", false, p => `<td class="small">${esc(p.sc?.role || "")}</td>`, 190],
];
const RF = { sort: "ca", dir: -1, f: {} };
function rosterRows(ps, g) {
  const [, , get, num] = ROSTER_COLS.find(c => c[0] === RF.sort);
  return ps.filter(p => p.grp === g && ROSTER_COLS.every(([k, , v, n]) => matchFilter(v(p), RF.f[k] || "", n)))
    .sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      return (num ? x - y : String(x).localeCompare(String(y))) * RF.dir || b.ca - a.ca;
    });
}
const rosterBody = rows => rows.map(p => `<tr class="link" data-k="${esc(p.k)}">${ROSTER_COLS.map(c => c[4](p)).join("")}</tr>`).join("")
  || `<tr><td colspan="${ROSTER_COLS.length}" class="muted small">No players match the filters.</td></tr>`;
const shortMoney = v => (v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? "$" + Math.round(v / 1e3) + "K" : "$" + Math.round(v));
const signedMoney = v => (Math.round(Math.abs(v) / 1e3) ? (v < 0 ? "−" : "+") : "") + shortMoney(Math.abs(v));
const war1 = v => fmt(Math.abs(v) < 0.05 ? 0 : v, 1);
function contractsTab(club, ps) {
  const M = market(), rows = ps.map(p => ({ p, c: contractValue(p) })).filter(x => x.c).sort((a, b) => b.c.surplus - a.c.surplus);
  const nhl = D.players.filter(p => p.lg === "NHL").map(p => ({ p, c: contractValue(p) })).filter(x => x.c).sort((a, b) => b.c.surplus - a.c.surplus);
  const sum = k => rows.reduce((s, x) => s + x.c[k], 0);
  const cls = v => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const line = ({ p, c }) => `<tr class="link" data-k="${esc(p.k)}"><th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}"><span><b>${esc(p.n)}</b></span></a></th>
    <td>${esc(p.pos)}</td><td class="num">${p.age}</td><td class="num">${money(c.sal)}</td><td>${esc(p.exp || "")}</td><td class="num">${c.seasons}</td>
    <td class="num">${war1(c.now)}</td><td class="num">${fmt(Math.abs(c.perM) < 0.005 ? 0 : c.perM, 2)}</td><td class="num ${cls(c.perSeason)}">${signedMoney(c.perSeason)}</td><td class="num ${cls(c.surplus)}"><b>${signedMoney(c.surplus)}</b></td></tr>`;
  const head = `<thead><tr><th class="pcol">Player</th><th>Pos</th><th class="num">Age</th><th class="num">Cap hit</th><th>Ends</th><th class="num">Seasons left</th>
    <th class="num">Exp. WAR this season</th><th class="num">WAR per $1M</th><th class="num">Value per season</th><th class="num">Surplus over the deal</th></tr></thead>`;
  const mini = list => `<ul class="plain">${list.map(({ p, c }) => `<li><a href="${route(p.k)}">${esc(p.n)}</a> <span class="muted small">${tname(clubOf(p))} · ${money(c.sal)} to ${esc(p.exp || "")}</span>
    <b class="${cls(c.surplus)}">${signedMoney(c.surplus)}</b></li>`).join("")}</ul>`;
  return `<div class="ctab"><div class="stat-cards">
      <div><span>Listed payroll</span><b>${money(sum("sal"))}</b></div>
      <div><span>Expected WAR this season</span><b>${fmt(sum("now"), 1)}</b></div>
      <div><span>Surplus over every deal</span><b class="${cls(sum("surplus"))}">${signedMoney(sum("surplus"))}</b></div>
      <div><span>Market price of 1 WAR</span><b>${money(M.perWar)}</b></div>
    </div>
    <section class="card-box flush" aria-label="Contracts"><h2 class="box-h">Contracts <span class="muted">${rows.length}</span></h2>
      <div class="tablewrap"><table class="rank sortable">${head}<tbody>${rows.map(line).join("") || `<tr><td colspan="10" class="muted">No listed salaries.</td></tr>`}</tbody></table></div></section>
    <div class="row two">
      <section class="card-box"><h2>Best value in the NHL</h2><p class="sub">Surplus over the whole deal</p>${mini(nhl.slice(0, 10))}</section>
      <section class="card-box"><h2>Least value in the NHL</h2><p class="sub">Surplus over the whole deal</p>${mini(nhl.slice(-10).reverse())}</section>
    </div>
    <p class="small muted">A season is worth the league minimum (${money(M.min)}, the 5th-percentile NHL salary) plus the expected WAR at the market
      price: NHL clubs pay ${money(M.perWar)} above the minimum per expected WAR (${M.n} NHL contracts). Expected WAR this season blends his own NHL
      record with his ability, later seasons follow his projected est. CA (as in the trade tool). Surplus = worth − cap hit for each season left on the
      deal, this one counted for the part of the regular season still to play. Salaries and expiry dates as listed on each profile; options,
      bonuses and the cap ceiling aren't visible to a client.</p></div>`;
}
function rosterTab(club, ps, pay) {
  const war = ps.reduce((s, p) => s + (p.war?.war || 0), 0);
  const expYear = String(nextDraftYear());
  const expiring = ps.filter(p => String(p.exp || "").includes(expYear)).length;
  const age = ps.reduce((s, p) => s + p.age, 0) / ps.length;
  const section = (g, title) => {
    if (!ps.some(p => p.grp === g)) return "";
    const rows = rosterRows(ps, g);
    return `<section class="card-box flush" aria-label="${title}"><h2 class="box-h">${title} <span class="muted" id="rc-${g}">${rows.length}</span></h2>
      <div class="tablewrap"><table class="rank roster"><colgroup>${ROSTER_COLS.map(c => `<col style="width:${c[5]}px">`).join("")}</colgroup><thead><tr>${ROSTER_COLS.map(([k, t, , n]) =>
        `<th class="sort ${n ? "num" : ""} ${k === "n" ? "pcol" : ""} ${RF.sort === k ? "on" : ""}" data-k="${k}" aria-sort="${RF.sort === k ? (RF.dir < 0 ? "descending" : "ascending") : "none"}"><button type="button">${t}${RF.sort === k ? (RF.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr>
        <tr class="frow">${ROSTER_COLS.map(([k, t, , n]) => `<th><input data-k="${k}" value="${esc(RF.f[k] || "")}" placeholder="${k === "sal" ? ">2 ($M)" : n ? ">0, 5-10" : "filter"}" aria-label="Filter ${esc(t)}"></th>`).join("")}</tr></thead>
      <tbody data-g="${g}">${rosterBody(rows)}</tbody></table></div></section>`;
  };
  return `<div class="stat-cards">
      <div><span>Team WAR · ${SEASON ? seasonLabel(SEASON) : ""}</span><b>${fmt(war, 1)}</b></div>
      <div><span>Listed payroll</span><b>${pay ? money(pay) : "–"}</b></div>
      <div><span>Average age</span><b>${fmt(age, 1)}</b></div>
      <div><span>Expiring ${expYear}</span><b>${expiring}</b></div>
    </div>
    <div class="cardbar"><span class="muted small">WAR and impact: ${SEASON ? seasonLabel(SEASON) : ""} regular season. Salaries as listed on each profile.</span>
      <button class="ghost small" id="r-clear" type="button">Clear filters</button>${seasonSelect("t-season")}</div>
    ${section("F", "Forwards")}${section("D", "Defence")}${section("G", "Goalies")}
    <p class="small muted">Filters apply to all three tables: text matches anywhere ("!" excludes); numbers accept &gt;, &lt;, &gt;=, &lt;=,
      ranges like 100-150, or an exact value. Salary is in millions. Click a column header to sort.</p>`;
}
function bindRoster(club, ps) {
  const refill = () => view.querySelectorAll("tbody[data-g]").forEach(tb => {
    const rows = rosterRows(ps, tb.dataset.g);
    tb.innerHTML = rosterBody(rows);
    view.querySelector("#rc-" + tb.dataset.g).textContent = rows.length;
  });
  view.querySelectorAll("table.roster tr.frow input").forEach(inp => inp.addEventListener("input", () => {
    RF.f[inp.dataset.k] = inp.value;
    // the same filter sits on every position table: keep them in step
    view.querySelectorAll(`table.roster tr.frow input[data-k="${CSS.escape(inp.dataset.k)}"]`).forEach(o => { if (o !== inp) o.value = inp.value; });
    refill();
  }));
  view.querySelectorAll("table.roster th.sort button").forEach(b => b.onclick = () => {
    const k = b.parentNode.dataset.k, col = ROSTER_COLS.find(c => c[0] === k);
    RF.dir = RF.sort === k ? -RF.dir : (col[3] && !["no", "age"].includes(k) ? -1 : 1);
    RF.sort = k; renderTeams(club, "roster");
  });
  view.querySelector("#r-clear").onclick = () => { RF.f = {}; renderTeams(club, "roster"); };
  // delegated: rows are replaced on every filter keystroke
  view.querySelectorAll("tbody[data-g]").forEach(tb => tb.onclick = e => {
    const tr = e.target.closest("tr.link");
    if (tr && !e.target.closest("a")) playerRow(tr);
  });
}
/* Prospect pool: the club's Top Prospects list as EHM shows it (12 per team, latest snapshot), plus players it drafted
   in the last 5 drafts who are on no team's list (their rights may have lapsed or been traded: clients can't see rights). */
const listedBy = club => D.players.filter(p => p.tp?.[0] === club).sort((a, b) => a.tp[1] - b.tp[1]);
const poolValue = ps => ps.reduce((s, p) => s + expWar(p.grp, sortVal(p, "peak")), 0);
// "New York Rangers" -> "NY Rangers", "Montreal Canadiens" -> "Montréal"
const draftClub = name => name && Object.keys(NHL_TEAMS).find(c => fold(name).startsWith(fold(c.replace(/^NY /, "New York "))));
/* The Top prospects box shows our ranking or EHM's list (kept while browsing clubs; no URL change). */
let PVIEW = "ours";
document.addEventListener("click", e => {
  const b = e.target.closest("[data-pview]");
  if (!b) return;
  PVIEW = b.dataset.pview;
  const box = b.closest(".card-box");
  box.querySelectorAll("[data-pview]").forEach(x => {
    const on = x === b;
    x.classList.toggle("on", on); x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1;
  });
  box.querySelectorAll("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== PVIEW));
  const n = box.querySelector(".box-h .muted");
  if (n) n.textContent = box.querySelector(`[data-pane="${PVIEW}"] tbody`)?.rows.length ?? "";
});
function prospectsTab(club) {
  const pool = listedBy(club);
  const clubs = nhlClubs(), values = clubs.map(c => [c, poolValue(listedBy(c))]).sort((a, b) => b[1] - a[1]);
  const rank = values.findIndex(([c]) => c === club) + 1, value = poolValue(pool);
  const yr = nextDraftYear();
  // with the crawl's Transactions read (--picks), the players whose rights the club holds now; else a guess from the draft record
  const held = D.rights ? new Set(D.rights.rows.filter(x => draftClub(x[6]) === club && x[4]).map(x => x[4])) : null;
  const drafted = D.players.filter(p => !p.tp && p.lg !== "NHL" && !nhlGraduated(p) && p.age <= 23
    && (held ? held.has(p.k) : p.dft?.pro?.year >= yr - 5 && draftClub(p.dft.pro.team) === club))
    .sort((a, b) => sortVal(b, "peak") - sortVal(a, "peak"));
  const dl = p => p.dft?.pro?.pick != null ? `${linkText(`${p.dft.pro.year} R${p.dft.pro.round} #${p.dft.pro.pick}`, draftHref(p.dft.pro))}${draftClub(p.dft.pro.team) !== club ? ` (${draftClub(p.dft.pro.team) ? tname(draftClub(p.dft.pro.team)) : esc(p.dft.pro.team)})` : ""}` : dash;
  const tier = p => (p.sc?.career || "").split(",").slice(1).join(",").trim();
  // our order of the club's whole pool (listed + also drafted): predicted true CA two years ahead (build_data.prospect_future)
  const ours = new Map([...pool, ...drafted].filter(p => p.fut != null).sort((a, b) => b.fut - a.fut).map((p, i) => [p.k, i + 1]));
  const PM = D.prospectModel;
  const whole = [...pool, ...drafted].filter(p => p.fut != null).sort((a, b) => b.fut - a.fut);
  const ourCol = ["Our rank", p => ours.get(p.k), `Our order of the whole pool: predicted true CA in ${PM?.months / 12} years`];
  const ehmCol = ["EHM rank", p => p.tp?.[1], "The club's own order on EHM's Top Prospects screen"];
  // lead = the two rank columns first: [header, value, title]
  const table = (rows, lead) => `<div class="tablewrap"><table class="rank sortable pool"><thead><tr>${lead.map(([h, , t]) => `<th class="num"${t ? ` title="${esc(t)}"` : ""}>${h}</th>`).join("")}<th class="pcol">Player</th><th>Pos</th><th class="num">Age</th>
      <th>Playing for</th>${PM ? `<th class="num">CA in ${PM.months / 12} yrs</th>` : ""}<th class="num">Est. CA</th><th class="num">Est. PA</th><th class="num">Proj. peak</th><th class="num" title="Expected WAR per season at his projected peak">WAR at peak</th><th>Drafted</th><th>Scout tier</th></tr></thead><tbody>
      ${rows.map((p, i) => `<tr class="link" data-k="${esc(p.k)}">${lead.map(([, f], j) => { const v = f(p, i); return `<td class="num" data-v="${v ?? 999}">${j ? (v ?? dash) : `<b>${v ?? dash}</b>`}</td>`; }).join("")}
        <th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}"><span><b>${esc(p.n)}</b></span></a></th><td>${esc(p.pos)}</td><td class="num">${p.age}</td>
        <td>${tname(clubOf(p))}${p.lg ? ` <span class="muted small">${esc(p.lg)}</span>` : ""}</td>${PM ? `<td class="num">${p.fut != null ? fmt(p.fut, 0) : dash}</td>` : ""}<td class="num">${fmt(p.ca, 0)}</td>
        <td class="num"><b>${fmt(p.pa, 0)}</b><br><span class="muted small nowrap">${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</span></td><td class="num">${fmt(sortVal(p, "peak"), 0)}</td>
        <td class="num">${fmt(expWar(p.grp, sortVal(p, "peak")), 2)}</td><td class="small">${dl(p)}</td><td class="small">${esc(tier(p)) || dash}</td></tr>`).join("")}
    </tbody></table></div>`;
  return `<div class="stat-cards">
      <div><span>Prospects listed</span><b>${pool.length}</b><small>EHM's Top Prospects list</small></div>
      <div><span>Pool value</span><b>${fmt(value, 1)}</b><small>${rank ? rankLink(teamRankHref("pool", club), `${ordinal(rank)} of ${values.length}`) : ""} · WAR / season at peak, summed</small></div>
      <div><span>Average est. PA</span><b>${pool.length ? fmt(pool.reduce((s, p) => s + p.pa, 0) / pool.length, 0) : "–"}</b></div>
      <div><span>Best prospect</span><b class="name">${pool.length ? (b => `<a href="${route(b.k)}">${esc(b.n)}</a>`)(pool.slice().sort((a, b) => b.pa - a.pa)[0]) : "–"}</b></div>
    </div>
    <section class="card-box flush" aria-labelledby="tp-h"><h2 class="box-h" id="tp-h">Top prospects <span class="muted">${PM && PVIEW === "ours" ? whole.length : pool.length}</span></h2>
      ${PM ? `<div class="pad pview">${tabBar("Top prospects", [["ours", "Our ranking"], ["ehm", "EHM's list"]], PVIEW, "data-pview")}</div>` : ""}
      <div data-pane="ehm"${PM && PVIEW !== "ehm" ? " hidden" : ""}>
      ${pool.length ? table(pool, PM ? [["Rank", p => p.tp[1]], ourCol] : [["Rank", p => p.tp[1]]]) : `<p class="pad muted small">No Top Prospects list for ${esc(club)} in the latest snapshot.</p>`}
      <p class="sub pad">Rank is the club's own order on EHM's Top Prospects screen (12 players at most). Proj. peak is the highest est. CA on his
        projected path; WAR / season at peak is the expected WAR at that ability (the curve the trade predictor uses).</p></div>
      ${PM ? `<div data-pane="ours"${PVIEW !== "ours" ? " hidden" : ""}>
      ${whole.length ? table(whole, [ourCol, ehmCol]) : `<p class="pad muted small">No prospects to rank.</p>`}
      <p class="sub pad">Every prospect ${esc(club)} owns: its Top Prospects list and the players below under "Also drafted", in our order.
        EHM rank is his place on the club's own list (– = not on it).</p>
      ${prospectModelNote(PM)}</div>` : ""}</section>
    ${drafted.length ? `<section class="card-box flush" aria-labelledby="dp-h"><h2 class="box-h" id="dp-h">Also drafted by ${esc(club)} <span class="muted">${drafted.length}</span></h2>
      ${table(drafted, PM ? [["#", (p, i) => i + 1], ourCol] : [["#", (p, i) => i + 1]])}
      <p class="sub pad">${held ? `Players ${esc(club)} holds the draft rights to (its Transactions tab, ${fmtDate(D.rights.date)}), aged 23 or under,
        outside the NHL and not on its Top Prospects list.` : `Drafted by ${esc(club)} in ${yr - 5}–${yr - 1}, aged 23 or under, outside the NHL and on no
        team's Top Prospects list. The crawl hasn't read draft rights yet (crawler --picks), so some may have been traded or released.`}</p></section>` : ""}
    ${club === MY_TEAM ? scoutNextSection(club) : ""}
    ${picksSection(club)}`;
}
/* Who to scout next (2026-10-27): players without a scout report, ranked by how much a report should sharpen his PA
   estimate. Gain = the drop in PA error when the same players' reports were added (Player Model/selection_bench.py, by age
   band x league group), times how relevant he is to the club, times how wide his PA range is now (vs the median). */
const SCOUT_WHY = [["Your player", 1], ["Your draft pick", 1], ["NHL draft list", 0.9], ["NHL, 25 or under", 0.6], ["Prospect, 21 or under", 0.4]];
function scoutNextSection(club) {
  const SV = D.scoutValue;
  if (!SV?.cells) return "";
  const lgGroup = lg => (lg === "NHL" || lg === "AHL" ? lg : ["OHL", "WHL", "QMJHL"].includes(lg) ? "CHL" : "other");
  const band = a => (a <= 18 ? "16-18" : a <= 21 ? "19-21" : a <= 25 ? "22-25" : "26+");
  const why = p => {
    const nhlRank = (p.drs || []).filter(d => d[0].includes("(NHL)")).map(d => d[1]).sort((a, b) => a - b)[0];
    if (clubOf(p) === club) return [SCOUT_WHY[0], ""];
    if (p.age <= 23 && draftClub(p.dft?.pro?.team) === club) return [SCOUT_WHY[1], ""];
    if (nhlRank != null && nhlRank <= 100) return [SCOUT_WHY[2], ` #${nhlRank}`];
    if (p.lg === "NHL" && p.age <= 25) return [SCOUT_WHY[3], ""];
    if (p.age <= 21) return [SCOUT_WHY[4], ""];
    return null;
  };
  const pool = D.players.filter(p => !p.sc && !p.seen && !p.left && p.pa_hi != null);
  const widths = pool.map(p => p.pa_hi - p.pa_lo).sort((a, b) => a - b), mid = widths[widths.length >> 1] || 1;
  const rows = pool.map(p => {
    const w = why(p);
    if (!w) return null;
    const cell = SV.cells[`${band(p.age)}|${lgGroup(p.lg)}`] || SV.all;
    return { p, why: w[0][0] + w[1], gain: cell.pa, score: w[0][1] * Math.max(0, cell.pa) * (p.pa_hi - p.pa_lo) / mid };
  }).filter(x => x && x.score > 0).sort((a, b) => b.score - a.score).slice(0, 25);
  if (!rows.length) return "";
  return `<section class="card-box flush" aria-labelledby="sn-h"><h2 class="box-h" id="sn-h">Who to scout next <span class="muted">${rows.length}</span></h2>
    <div class="tablewrap"><table class="rank sortable"><thead><tr><th class="pcol">Player</th><th>Pos</th><th class="num">Age</th><th>Playing for</th><th>Why</th>
      <th class="num">Est. PA</th><th class="num" title="Average drop in PA error when a report was added, for players of his age and league">Report cuts PA error by</th></tr></thead><tbody>
    ${rows.map(({ p, why, gain }) => `<tr class="link" data-k="${esc(p.k)}"><th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}"><span><b>${esc(p.n)}</b></span></a></th>
      <td>${esc(p.pos)}</td><td class="num">${p.age}</td><td>${tname(clubOf(p))}${p.lg ? ` <span class="muted small">${esc(p.lg)}</span>` : ""}</td><td class="small">${esc(why)}</td>
      <td class="num"><b>${fmt(p.pa, 0)}</b><br><span class="muted small nowrap">${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</span></td><td class="num">${fmt(gain, 1)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="sub pad">Players without a scout report, in order of how much a report should sharpen his estimate: the average drop in PA error when the
      same players' reports were added on the training save (${esc(SV.source)} model, by age and league), times how much he matters to ${esc(club)}
      (${SCOUT_WHY.map(([t, w]) => `${t.toLowerCase()} ×${w}`).join(", ")}), times how wide his PA range is now.</p></section>`;
}
/* How "our rank" was tested (Player Model/prospect_rank_bench.py): on every past training snapshot each club's Top Prospects
   list was ordered by EHM's rank and by ours, and compared with the players' true CA two years later. */
function prospectModelNote(PM) {
  const e = PM.eval || {}, ehm = e.ehm, m = e.model, yrs = PM.months / 12;
  return `<p class="sub pad"><b>Our rank</b> orders the club's whole pool by his predicted true CA in ${yrs} years, from our est. CA, est. PA,
    age and position.${ehm && m ? ` Tested on the training save: on ${(PM.lists || 0).toLocaleString()} past Top Prospects lists, it ordered the players by how good they
    actually were ${yrs} years later better than EHM's own order (rank correlation ${fmt(m.rho, 2)} vs ${fmt(ehm.rho, 2)}, ±${fmt(m.d_se, 2)}; pairs in the right order
    ${Math.round(m.pairs * 100)}% vs ${Math.round(ehm.pairs * 100)}%). Adding EHM's rank to the model didn't improve it.` : ""}</p>`;
}
/* Draft picks a club owns (crawler --picks: its Transactions > Draft Picks screen), by year and round. The slot is projected
   from this season's standings of the pick's original owner (worst record = 1st), so each pick gets the trade predictor's value. */
function picksSection(club) {
  if (!D.picks) return `<section class="card-box" aria-labelledby="pk-own-h"><h2 id="pk-own-h">Draft picks</h2>
      <p class="sub">Not read yet: the crawler reads each NHL team's picks with <code>--picks</code>. Pick values by slot are on the <a href="#/trade">trade predictor</a>.</p></section>`;
  const mine = D.picks.rows.filter(x => draftClub(x[5]) === club);
  const years = [...new Set(D.picks.rows.map(x => x[1]))].sort();
  const T = teamTable(SEASON), n = T?.n || 32;
  const slotOf = (orig, rnd, turn) => {
    if (turn) return (rnd - 1) * 32 + turn;
    const place = T?.teams?.[abbrOf(draftClub(orig))]?.place;
    return (rnd - 1) * 32 + (place ? n + 1 - place : 16);
  };
  let total = 0;
  const cell = (yr, rnd) => {
    const own = mine.filter(x => x[1] === yr && x[2] === rnd);
    if (!own.length) return `<td class="muted small">traded</td>`;
    return `<td>${own.map(x => {
      const from = draftClub(x[4]), v = pickValue(slotOf(x[4], rnd, x[3])).five;
      total += v;
      return `<span class="pick${from !== club ? " acq" : ""}" title="${esc(x[4])} pick${x[3] ? `, #${x[3]} in the round` : ""} · about ${fmt(v, 1)} WAR over 5 prime seasons">${from !== club ? tlink(from, `${logo(from, 16)} ${esc(NHL_TEAMS[from]?.[0] || x[4])}`) : "Own"}${x[3] ? ` #${x[3]}` : ""}</span>`;
    }).join(" ")}</td>`;
  };
  const rows = years.map(yr => `<tr><th scope="row">${yr}</th>${[1, 2, 3, 4, 5, 6, 7].map(rnd => cell(yr, rnd)).join("")}</tr>`).join("");
  return `<section class="card-box flush" aria-labelledby="pk-own-h"><h2 class="box-h" id="pk-own-h">Draft picks <span class="muted">${mine.length}</span></h2>
    <div class="tablewrap"><table class="picks-own"><thead><tr><th>Draft</th>${[1, 2, 3, 4, 5, 6, 7].map(r => `<th>Round ${r}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sub pad">From ${esc(club)}'s Transactions tab (${fmtDate(D.picks.date)}). "Own" = its own pick; a logo = acquired from that club; traded = it doesn't own one.
      Together worth about <b>${fmt(total, 1)} WAR</b> over 5 prime seasons each, valued like the <a href="#/trade">trade predictor</a> at the slot projected from
      this season's standings of the original owner (until the order is set).</p></section>`;
}
const STAT_GROUPS = [
  ["Scoring", "Per game unless marked", ["gf_gp", "ga_gp", "sf_gp", "sa_gp", "sh_pct", "sv_pct"]],
  ["Special teams", "Power-play goals per opportunity", ["pp_pct", "pk_pct", "pim_gp"]],
  ["Expected goals", "Games with a shot chart", ["xgf_gp", "xga_gp", "xg_pct"]],
  ["Puck battles", "Per game", ["fo", "hits_gp", "blk_gp", "tk_gp", "gv_gp"]],
];
function statFmt(k, v) {
  if (v == null) return "–";
  if (["sh_pct", "pp_pct", "pk_pct", "xg_pct"].includes(k)) return (100 * v).toFixed(1) + "%";
  if (k === "fo") return v.toFixed(1) + "%";
  if (k === "sv_pct" || k === "pts_pct") return v.toFixed(3).replace(/^0/, "");
  if (k === "gd") return signed(v, 0);
  if (k === "pts") return v.toFixed(0);
  return v.toFixed(["gf_gp", "ga_gp", "xgf_gp", "xga_gp"].includes(k) ? 2 : 1);
}
function teamStatsTab(club, abbr, seasons) {
  if (!seasons.includes(SEASON)) SEASON = seasons.at(-1);
  const T = teamTable(SEASON), r = T.teams[abbr], label = Object.fromEntries((D.teamStatKeys || []).map(([k, l]) => [k, l]));
  const rec = a => `${a[0]}–${a[1]}–${a[2]}`;
  const share = r.gp / 84;   // the league plays 84 games per team
  const maxG = Math.max(1, ...r.months.map(m => Math.max(m[4], m[5])));
  return `<div class="cardbar"><div><h2 class="flat">${seasonLabel(SEASON)} regular season</h2>
      <p class="sub">${r.gp} of ${esc(club)}'s games are in the box scores${share < 0.95 && share > 0.8 ? " (a few weren't captured)" : ""}. Ranks are out of ${T.n} teams; 1st is best.</p></div>
      ${seasons.length > 1 ? `<label class="inline">Season <select id="t-season">${seasons.slice().reverse().map(s => `<option value="${s}" ${s === SEASON ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>` : ""}</div>
    <div class="stat-cards">
      <div><span>Record (W–L–OTL)</span><b>${r.w}–${r.l}–${r.otl}</b><small>${r.gp} GP</small></div>
      <div><span>Points</span><b>${r.pts}</b><small>${rankLink(teamRankHref("pts", club), `${ordinal(r.place)} of ${T.n}`)} · league avg ${statFmt("pts", T.avg.pts)}</small></div>
      <div><span>Points %</span><b>${statFmt("pts_pct", r.stats.pts_pct[0])}</b><small>${rankLink(teamRankHref("pts_pct", club), ordinal(r.stats.pts_pct[1]))}</small></div>
      <div><span>Goal difference</span><b>${signed(r.gf - r.ga, 0)}</b><small>${rankLink(teamRankHref("gd", club), ordinal(r.stats.gd[1]))} · ${r.gf} GF, ${r.ga} GA</small></div>
      <div><span>Home</span><b>${rec(r.home)}</b><small>W–L–OTL</small></div>
      <div><span>Away</span><b>${rec(r.away)}</b><small>W–L–OTL</small></div>
      <div><span>Last 10</span><b>${rec(r.last10)}</b><small>to ${fmtDate(r.last)}</small></div>
    </div>
    <div class="row four">${STAT_GROUPS.map(([title, sub, keys]) => `<section class="card-box"><h3 class="box-h3">${title}</h3><p class="sub">${title === "Expected goals" ? `The ${r.xg_games} games with a shot chart` : sub}</p>
      <div class="srow head" aria-hidden="true"><span>Stat</span><span>${esc(abbr)}</span><span>League</span><span>Rank</span></div>
      ${keys.map(k => `<div class="srow"><span>${label[k] || k}</span><b>${statFmt(k, r.stats[k][0])}</b><span class="muted">${statFmt(k, T.avg[k])}</span><span>${rankChip(r.stats[k][1], T.n, teamRankHref(k, club))}</span></div>`).join("")}
    </section>`).join("")}</div>
    <section class="card-box flush"><h3 class="box-h">Month by month</h3><div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Record</th>
      <th class="num">GF</th><th class="num">GA</th><th class="num">Diff</th><th>Goals for vs against</th></tr></thead><tbody>
      ${r.months.map(([m, w, l, otl, gf, ga]) => `<tr><th scope="row">${new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</th>
        <td class="num">${w}–${l}–${otl}</td><td class="num">${gf}</td><td class="num">${ga}</td><td class="num ${gf > ga ? "up" : gf < ga ? "down" : ""}"><b>${signed(gf - ga, 0)}</b></td>
        <td><span class="gbars" role="img" aria-label="${gf} goals for, ${ga} against"><i style="width:${(100 * gf / maxG).toFixed(1)}%"></i><i class="ga" style="width:${(100 * ga / maxG).toFixed(1)}%"></i></span></td></tr>`).join("")}
    </tbody></table></div><p class="sub pad">Top bar: goals for. Bottom bar: goals against.</p></section>`;
}

// ---------------------------------------------------------------- head to head
const H2 = { home: MY_TEAM, away: RIVAL, hg: 0, ag: 0 };
function lineupOf(club) {
  const ps = D.players.filter(p => clubOf(p) === club && p.lg === "NHL");
  const avg = (g, n) => { const v = ps.filter(p => p.grp === g).map(p => p.ca).sort((a, b) => b - a).slice(0, n); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  return { f: avg("F", 6), d: avg("D", 4), goalies: ps.filter(p => p.grp === "G").sort((a, b) => b.ca - a.ca) };
}
function renderH2H() {
  markNav("h2h");
  const M = D.predict?.h2h;
  if (!M) { view.innerHTML = `<div class="wrap page"><div class="panel"><h2>Head to head</h2><p class="sub">Needs at least 200 NHL games with box-score lineups.</p></div></div>`; return; }
  const clubs = nhlClubs();
  if (!clubs.includes(H2.home)) H2.home = clubs[0];
  if (!clubs.includes(H2.away) || H2.away === H2.home) H2.away = clubs.find(c => c !== H2.home);
  const starters = clubs.map(c => lineupOf(c).goalies[0]?.ca).filter(Boolean);
  const avgG = starters.reduce((s, x) => s + x, 0) / starters.length;
  const L = { home: lineupOf(H2.home), away: lineupOf(H2.away) };
  const G = side => L[side].goalies[H2[side === "home" ? "hg" : "ag"]] || L[side].goalies[0] || null;
  const gh = G("home"), ga = G("away");
  // standings to date join in once both teams have enough games this season
  const cur = teamTable(SEASONS.at(-1)), th = cur?.teams?.[abbrOf(H2.home)], ta = cur?.teams?.[abbrOf(H2.away)];
  const useSt = th && ta && Math.min(th.gp, ta.gp) >= M.standings_min_gp;
  const B = useSt ? M.full : M.lineup;
  const parts = [
    ["Forwards", "Top 6 average est. CA", L.home.f, L.away.f, B.d_f],
    ["Defence", "Top 4 average est. CA", L.home.d, L.away.d, B.d_d],
    ["Goalie", "Starter's est. CA", gh ? gh.ca : avgG, ga ? ga.ca : avgG, B.d_g],
  ].map(([label, sub, h, a, b]) => ({ label, sub, h, a, z: b * ((h ?? 0) - (a ?? 0)) }));
  if (useSt) {
    const wr = t => t.w / t.gp, gd = t => (t.gf - t.ga) / t.gp;
    parts.push({ label: "Standings so far", sub: `Win rate and goal difference per game, ${seasonLabel(SEASONS.at(-1))}`, z: B.d_pts * (wr(th) - wr(ta)) + B.d_gd * (gd(th) - gd(ta)),
                 detail: `${esc(H2.home)} ${th.w}–${th.l}–${th.otl} (${signed(th.gf - th.ga, 0)}) · ${esc(H2.away)} ${ta.w}–${ta.l}–${ta.otl} (${signed(ta.gf - ta.ga, 0)})` });
  }
  const z = B.b0 + parts.reduce((s, x) => s + x.z, 0);
  const p = 1 / (1 + Math.exp(-z));
  const pct = v => (100 * v).toFixed(1) + "%";
  const maxZ = Math.max(0.6, ...parts.map(x => Math.abs(x.z)), Math.abs(B.b0));
  const bar = v => { const w = Math.min(50, Math.abs(v) / maxZ * 50); return `<span class="fbar"><i class="${v >= 0 ? "h" : "a"}" style="width:${w}%"></i></span>`; };
  const R2 = M.results, bands = M.bands;
  const gOpts = (side, list) => (list.length ? list : [null]).map((g, i) => `<option value="${i}" ${i === H2[side] ? "selected" : ""}>${g ? `${esc(g.n)} (${fmt(g.ca, 0)})` : `League-average starter (${fmt(avgG, 0)})`}</option>`).join("");
  const missing = [H2.home, H2.away].filter(c => !lineupOf(c).goalies.length);
  const teamPick = (side, id) => `<div class="tpick">${teamLogo(H2[side], 56)}<div>
      <label for="${id}">${side === "home" ? "Home" : "Away"}</label>
      <select id="${id}" class="big">${clubs.filter(c => c !== H2[side === "home" ? "away" : "home"]).map(c => `<option ${c === H2[side] ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <label for="${id}-g" class="small">Starting goalie</label>
      <select id="${id}-g">${gOpts(side === "home" ? "hg" : "ag", L[side].goalies)}</select></div></div>`;
  view.innerHTML = `
  <section class="band"><div class="wrap"><h1>Head to head</h1>
    <p class="lede">Pick two teams and each side's starting goalie. The chance to win (overtime and shootouts included) comes from both lineups' estimated ability and home ice${useSt ? ", plus the standings so far" : ""}, fitted on ${M.games.toLocaleString()} NHL games (${M.seasons.map(seasonLabel).join(", ")}). Lineups are each club's best current NHL players.</p></div></section>
  <div class="wrap page">
    <section class="card-box" aria-label="Matchup">
      <div class="matchup">${teamPick("home", "h-team")}<button type="button" id="swap" class="ghost pillbtn" aria-label="Swap home and away">⇄ Swap</button>${teamPick("away", "a-team")}</div>
      <div class="odds">
        <div><span>${esc(H2.home)} win</span><b>${pct(p)}</b></div>
        <div class="right"><span>${esc(H2.away)} win</span><b>${pct(1 - p)}</b></div>
      </div>
      <div class="pbar" role="img" aria-label="${esc(H2.home)} ${pct(p)}, ${esc(H2.away)} ${pct(1 - p)}"><i style="width:${(100 * p).toFixed(1)}%"></i></div>
      <div class="odds-foot"><span>Fair odds ${(1 / p).toFixed(2)}</span><span>${Math.abs(p - 0.5) < 0.1 ? "Close to a coin flip" : `${esc(p >= 0.5 ? H2.home : H2.away)} favoured`}</span><span>Fair odds ${(1 / (1 - p)).toFixed(2)}</span></div>
      ${missing.length ? `<p class="warn">${missing.map(esc).join(" and ")}: no NHL goalie is listed in the data, so a league-average starter (est. CA ${fmt(avgG, 0)}) is used.</p>` : ""}
    </section>
    <div class="row">
      <section class="card-box wide" aria-labelledby="why-h"><h2 id="why-h">Why</h2><p class="sub">Each factor's push towards one side.</p>
        ${parts.map(x => `<div class="factor"><div><b>${x.label}</b><small>${x.detail || `${x.sub}: ${esc(H2.home)} ${fmt(x.h, 1)} · ${esc(H2.away)} ${fmt(x.a, 1)}`}</small></div>${bar(x.z)}</div>`).join("")}
        <div class="factor"><div><b>Home ice</b><small>${esc(H2.home)} at home (home teams won ${(100 * M.home_rate).toFixed(1)}%)</small></div>${bar(B.b0)}</div>
        <div class="fscale" aria-hidden="true"><span>← ${esc(H2.home)}</span><span>${esc(H2.away)} →</span></div>
      </section>
      <section class="card-box" aria-labelledby="trust-h"><h2 id="trust-h">How far to trust it</h2>
        <p class="sub">Walk-forward test: each month predicted using only earlier games (${M.tested.toLocaleString()} games).</p>
        ${bands.slice().reverse().map(b => `<div class="srow2"><span>Favourite at ${Math.round(100 * b.lo)}${b.hi > 1 ? "%+" : `–${Math.round(100 * b.hi)}%`}</span><b>${b.won == null ? "–" : `won ${(100 * b.won).toFixed(0)}%`}</b></div>`).join("")}
        <div class="srow2"><span>Picked the winner</span><b>${(100 * R2.full.accuracy).toFixed(1)}%</b></div>
        <div class="srow2"><span>Lineups only</span><b>${(100 * R2.lineup.accuracy).toFixed(1)}%</b></div>
        <div class="srow2 muted"><span>Home team every time</span><b>${(100 * R2.home.accuracy).toFixed(1)}%</b></div>
        <p class="sub">${useSt ? "Standings so far are included: both teams have played" : `Standings so far join in once both teams have played ${M.standings_min_gp}+ games this season`}${useSt ? ` ${M.standings_min_gp}+ games.` : "."} Refitted at every build as games are added.</p>
      </section>
    </div>
  </div>`;
  view.querySelector("#h-team").onchange = e => { H2.home = e.target.value; H2.hg = 0; renderH2H(); };
  view.querySelector("#a-team").onchange = e => { H2.away = e.target.value; H2.ag = 0; renderH2H(); };
  view.querySelector("#h-team-g").onchange = e => { H2.hg = +e.target.value; renderH2H(); };
  view.querySelector("#a-team-g").onchange = e => { H2.ag = +e.target.value; renderH2H(); };
  view.querySelector("#swap").onclick = () => { [H2.home, H2.away, H2.hg, H2.ag] = [H2.away, H2.home, H2.ag, H2.hg]; renderH2H(); };
}

// ---------------------------------------------------------------- trade predictor
const TR = { a: MY_TEAM, b: RIVAL, give: { a: [], b: [] }, picks: { a: [], b: [] }, cap: "" };
try { TR.cap = localStorage.getItem(storeKey("ehm-cap")) || ""; } catch (e) { /* storage blocked */ }
/* Actual WAR per prime season of the players drafted in each pick range vs the model's value for that range. */
function pickCheck(pk) {
  if (!pk?.check) return "";
  return `<div class="tablewrap"><table class="fit-num"><thead><tr><th>Picks</th><th class="num">Prime seasons</th><th class="num">Actual WAR / season</th><th class="num">Model</th></tr></thead><tbody>
    ${pk.check.map(c => `<tr><td>#${c.lo}–${c.hi}</td><td class="num">${c.n.toLocaleString()}</td><td class="num">${fmt(c.actual, 2)}</td><td class="num">${fmt(c.model, 2)}</td></tr>`).join("")}
  </tbody></table></div><p class="sub">Reality check: what the players taken in each range actually produced per season, 4–11 seasons after their draft (busts and players outside the NHL count as 0).</p>`;
}
function renderTrade() {
  markNav("trade");
  const clubs = nhlClubs(), pk = D.predict?.picks, cw = D.predict?.carWar;
  if (!clubs.includes(TR.a)) TR.a = clubs[0];
  if (!clubs.includes(TR.b) || TR.b === TR.a) TR.b = clubs.find(c => c !== TR.a);
  const other = s => (s === "a" ? "b" : "a");
  const roster = c => D.players.filter(p => clubOf(p) === c).sort((x, y) => y.ca - x.ca);
  const payroll = c => roster(c).reduce((s, p) => s + salaryNum(p.sal), 0);
  const assets = s => [
    ...TR.give[s].map(k => byKey.get(k)).filter(Boolean).map(p => ({ kind: "p", p, v: playerValue(p), sal: salaryNum(p.sal) })),
    ...TR.picks[s].map((x, i) => ({ kind: "k", i, x, v: { last: 0, now: 0, ...pickValue(x.slot) }, sal: 0 })),
  ];
  const A = { a: assets("a"), b: assets("b") };
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  const tot = s => ({ last: sum(A[s], x => x.v.last), now: sum(A[s], x => x.v.now), five: sum(A[s], x => x.v.five), sal: sum(A[s], x => x.sal) });
  const send = { a: tot("a"), b: tot("b") };   // what each side sends; it receives the other side's
  const capNum = salaryNum(TR.cap);
  const yr = nextDraftYear();
  const assetRow = (s, x) => x.kind === "p"
    ? `<div class="asset">${teamLogo(clubOf(x.p), 30)}<div class="grow"><b><a href="${route(x.p.k)}">${esc(x.p.n)}</a></b>
        <small>${esc(x.p.pos)} · ${x.p.age} · est. CA ${fmt(x.p.ca, 0)}, PA ${fmt(x.p.pa, 0)} · ${esc(x.p.sal || "no salary listed")}${x.p.exp ? " to " + esc(x.p.exp) : ""} · ${fmt(x.v.last, 2)} WAR in ${seasonLabel(lastComplete())}</small>
        <small class="why">This season ${fmt(x.v.now, 1)} = ${x.v.gp ? `${Math.round(100 * x.v.weight)}% his own record (${fmt(x.v.own, 1)} per ${D.predict?.blend?.season_gp || 84} GP over ${x.v.gp} GP) + ${100 - Math.round(100 * x.v.weight)}% ability (${fmt(x.v.ability, 1)})` : `ability only (${fmt(x.v.ability, 1)}): no NHL games yet`}</small></div>
        <div class="aval"><b>${fmt(x.v.five, 1)}</b> WAR · 5 yrs<small>${fmt(x.v.now, 1)} this season</small></div>
        <button type="button" class="xbtn" data-rm="${s}:p:${esc(x.p.k)}" aria-label="Remove ${esc(x.p.n)}">×</button></div>`
    : `<div class="asset"><span class="pickbadge" aria-hidden="true">R${x.x.round}</span><div class="grow"><b>${x.x.year} round ${x.x.round} pick</b>
        <small>Projected #${x.x.slot} overall · valued on 5 prime seasons (about ${x.x.year + 4}-${String(x.x.year + 5).slice(2)} to ${x.x.year + 8}-${String(x.x.year + 9).slice(2)}) · ${fmt(x.v.season, 2)} WAR per season</small></div>
        <div class="aval"><b>${fmt(x.v.five, 1)}</b> WAR · 5 yrs<small>0.0 this season</small></div>
        <button type="button" class="xbtn" data-rm="${s}:k:${x.i}" aria-label="Remove ${x.x.year} round ${x.x.round} pick">×</button></div>`;
  const side = s => {
    const c = TR[s], have = new Set(TR.give[s]);
    return `<section class="card-box side" aria-label="${esc(c)} side">
      <div class="tpick">${teamLogo(c, 48)}<div class="grow"><label for="t-${s}">Team ${s.toUpperCase()}</label>
        <select id="t-${s}" class="big">${clubs.filter(x => x !== TR[other(s)]).map(x => `<option ${x === c ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div></div>
      <h2 class="h-small">${esc(c)} sends</h2>
      ${A[s].map(x => assetRow(s, x)).join("") || `<p class="muted small">Nothing yet: add players or picks.</p>`}
      <div class="adders">
        <label class="grow">Add player <select id="add-${s}"><option value="">Choose…</option>${roster(c).filter(p => !have.has(p.k)).map(p => `<option value="${esc(p.k)}">${esc(p.n)} · ${esc(p.pos)} · ${fmt(p.ca, 0)}${p.lg !== "NHL" ? " · " + esc(p.lg || "") : ""}</option>`).join("")}</select></label>
      </div>
      <div class="adders">
        <label>Draft <select id="py-${s}">${[yr, yr + 1, yr + 2].map(y => `<option>${y}</option>`).join("")}</select></label>
        <label>Round <select id="pr-${s}">${[1, 2, 3, 4, 5, 6, 7].map(r => `<option>${r}</option>`).join("")}</select></label>
        <label class="narrow">Proj. pick # <input id="ps-${s}" type="number" min="1" max="224" value="16"></label>
        <button type="button" class="ghost" id="addpick-${s}">+ Add pick</button>
      </div>
      <div class="paybox"><span>Payroll <b>${money(payroll(c))}</b> → <b>${money(payroll(c) - send[s].sal + send[other(s)].sal)}</b></span>
        <span class="delta ${send[other(s)].sal - send[s].sal > 0 ? "neg" : "pos"}">${send[other(s)].sal - send[s].sal >= 0 ? "+" : "−"}${money(Math.abs(send[other(s)].sal - send[s].sal))}</span></div>
    </section>`;
  };
  const edgeCell = (va, vb, d = 1) => {
    const e = va - vb;
    if (Math.abs(e) < 0.05) return `<span class="delta">Even</span>`;
    return `<span class="delta ${e > 0 ? "pos" : "neg"}">${esc(e > 0 ? TR.a : TR.b)} +${Math.abs(e).toFixed(d)}</span>`;
  };
  // the user's side (a) gets what b sends
  const rows = [
    [`${lastComplete() === SEASONS.at(-1) ? "Season so far" : "Last season"} (actual)`, `${seasonLabel(lastComplete())} WAR of the players moving`, send.b.last, send.a.last],
    ["This season (expected)", "From estimated ability", send.b.now, send.a.now],
    ["5 seasons (expected)", "Players: next 5 seasons with their projection. Picks: 5 seasons of his prime", send.b.five, send.a.five],
  ];
  const any = A.a.length || A.b.length;
  const fiveEdge = send.b.five - send.a.five, nowEdge = send.b.now - send.a.now;
  const verdict = !any ? "Add players or picks to both sides to compare them."
    : `<b>${Math.abs(fiveEdge) < 0.5 ? "Even over 5 seasons" : `${esc(fiveEdge > 0 ? TR.a : TR.b)} wins over 5 seasons`}</b> (${fiveEdge >= 0 ? esc(TR.a) : esc(TR.b)} +${Math.abs(fiveEdge).toFixed(1)} WAR). `
      + `<b>This season</b>: ${Math.abs(nowEdge) < 0.3 ? "about even" : `${esc(nowEdge > 0 ? TR.a : TR.b)} +${Math.abs(nowEdge).toFixed(1)} expected WAR`}.`;
  const S = [1, 5, 10, 16, 24, 32, 33, 64];
  view.innerHTML = `
  <section class="band"><div class="wrap"><h1>Trade predictor</h1>
    <p class="lede">Add players and draft picks to each side. Everything is valued in WAR: last season's actual WAR, the WAR expected this season from estimated ability, and expected WAR over 5 seasons. A pick is worth the WAR the player taken at that slot is expected to produce over 5 seasons of his prime.</p></div></section>
  <div class="wrap page">
    <div class="row">${side("a")}${side("b")}</div>
    <section class="card-box flush" aria-labelledby="res-h">
      <div class="pad"><h2 id="res-h">Who wins the trade</h2><p class="verdict">${verdict}</p></div>
      <div class="tablewrap"><table><thead><tr><th>WAR</th><th class="num">${tlink(TR.a, `${logo(TR.a, 20)} ${esc(TR.a)}`)} gets</th><th class="num">${tlink(TR.b, `${logo(TR.b, 20)} ${esc(TR.b)}`)} gets</th><th class="num">Edge</th></tr></thead>
        <tbody>${rows.map(([l, s, va, vb]) => `<tr><th scope="row">${l}<small class="block muted">${s}</small></th><td class="num big">${fmt(va, 1)}</td><td class="num big">${fmt(vb, 1)}</td><td class="num">${any ? edgeCell(va, vb) : "–"}</td></tr>`).join("")}
        <tr><th scope="row">Cap hit taken on<small class="block muted">Salaries received</small></th><td class="num big">${money(send.b.sal)}</td><td class="num big">${money(send.a.sal)}</td><td class="num">${any ? `<span class="delta">${money(Math.abs(send.b.sal - send.a.sal))} more to ${esc(send.b.sal >= send.a.sal ? TR.a : TR.b)}</span>` : "–"}</td></tr>
        </tbody></table></div>
    </section>
    <div class="row">
      <section class="card-box" aria-labelledby="cap-h"><h2 id="cap-h">Cap after the trade</h2>
        <p class="sub">Payroll = the listed salaries of every player at the club, as EHM shows them.</p>
        <label class="block-label" for="cap-in">Your league's salary cap (EHM league settings)</label>
        <input id="cap-in" type="text" inputmode="numeric" placeholder="e.g. $95,500,000" value="${esc(TR.cap)}">
        ${["a", "b"].map(s => { const c = TR[s], before = payroll(c), after = before - send[s].sal + send[other(s)].sal;
          return `<div class="caprow">${teamLogo(c, 28)}<b class="grow">${tlink(c)}</b><span>${money(before)} → <b>${money(after)}</b></span>${capNum ? `<span class="delta ${after > capNum ? "neg" : "pos"}">${after > capNum ? "over by " + money(after - capNum) : money(capNum - after) + " space"}</span>` : ""}</div>`; }).join("")}
        <p class="sub">The cap is a league setting a client can't read; it's remembered on this computer.</p>
      </section>
      <section class="card-box" aria-labelledby="pk-h"><h2 id="pk-h">How picks are valued</h2>
        ${pk ? `<p class="sub">Expected NHL WAR over 5 seasons of his prime (${D.predict.prime5[0]}–${D.predict.prime5.at(-1)} seasons after the draft) of the player taken at each slot in this save, the same 5-season length the players are valued on. Drafted players who never made it count as 0. Smoothed so an earlier pick is always worth more.</p>
        <div class="slot-grid">${S.map(k => `<div><span>Pick #${k}</span><b>${fmt(pickValue(k).five, 1)}</b></div>`).join("")}</div>
        <p class="small">Round averages: ${pk.rounds.map((v, i) => `R${i + 1} ${fmt(v, 2)}`).join(" · ")}</p>
        ${pickCheck(pk)}
        <p class="sub">From ${pk.seasons.map(seasonLabel).join(", ")} (draft classes ${pk.draft_years[0]}–${pk.draft_years[1]}). Leaving one draft year out at a time: error ${pk.validation.model} WAR per pick vs ${pk.validation.flat} for "every pick is average". Refitted at every build: more seasons sharpen it.</p>${borrowed(pk)}`
        : `<p class="sub">Needs a complete NHL season in the box scores.</p>`}
        ${cw ? `<p class="sub">Players' expected WAR comes from a curve of season WAR by pre-season est. CA (${cw.seasons.map(seasonLabel).join(", ")}; see <a href="#/about/expected-war-from-ability">How it works</a>).</p>${borrowed(cw)}` : ""}
      </section>
    </div>
  </div>`;
  ["a", "b"].forEach(s => {
    view.querySelector(`#t-${s}`).onchange = e => { TR[s] = e.target.value; TR.give[s] = []; TR.picks[s] = []; renderTrade(); };
    view.querySelector(`#add-${s}`).onchange = e => { if (e.target.value) { TR.give[s].push(e.target.value); renderTrade(); } };
    const rs = view.querySelector(`#pr-${s}`), sl = view.querySelector(`#ps-${s}`);
    rs.onchange = () => (sl.value = (rs.value - 1) * 32 + 16);
    view.querySelector(`#addpick-${s}`).onclick = () => {
      const slot = Math.max(1, Math.min(224, Math.round(+sl.value || (rs.value - 1) * 32 + 16)));
      TR.picks[s].push({ year: +view.querySelector(`#py-${s}`).value, round: +rs.value, slot });
      renderTrade();
    };
  });
  view.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => {
    const [s, kind, id] = b.dataset.rm.split(":");
    if (kind === "p") TR.give[s] = TR.give[s].filter(k => k !== id); else TR.picks[s].splice(+id, 1);
    renderTrade();
  });
  view.querySelector("#cap-in").onchange = e => {
    TR.cap = e.target.value;
    try { localStorage.setItem(storeKey("ehm-cap"), TR.cap); } catch (err) { /* storage blocked */ }
    renderTrade();
  };
}

/* Team Player stats tab (#/team/<club>/players[/<season>[/<player>]]): every player's box-score line for the club in one
   season (only games for this club), regular season or playoffs, with the team's season summary on top. Blocks come
   from the play-by-play; hits, takeaways and giveaways only exist as team totals (Team stats tab). */
const TPS = { mode: "R", sort: "p", dir: -1, view: "basic" };
/* The Player stats views: Basic fits the page; Advanced (model percentiles, xG, usage) and WAR parts read the player's
   season card (all his NHL clubs that season, like WAR). A percentile opens its full ranking for that season and game type. */
const TP_VIEWS = [["basic", "Basic"], ["adv", "Advanced"], ["war", "WAR parts"]];
const tpPct = (key, kind = "c") => [r => (kind === "c" ? r.c?.comp?.[key] : r.c?.pct?.[key]) ?? null,
  (v, r) => v == null ? dash : impPill(v, `#/rank/p/${kind}/${key}/${r.pl.grp}/${encodeURIComponent(r.k)}/${r.season}/${TPS.mode === "P" ? "po" : "rs"}`)];
const tpWar = key => [r => r.w?.comps?.[key] ?? null, v => v == null ? dash : signed(v, 2)];
const TP_COLS = [   // [key, header, value, format(v, row), tip, view]
  ["gp", "GP", r => r.gp, v => v, "", "basic war"], ["g", "G", r => r.g, v => v], ["a", "A", r => r.a, v => v],
  ["p", "P", r => r.p, v => `<b>${v}</b>`, "", "basic war"],
  ["pm", "+/−", r => r.pm, v => v == null ? dash : (v > 0 ? "+" : "") + v], ["pim", "PIM", r => r.pim, v => v],
  ["st", "SOG", r => r.st, v => v, "Shots on goal"],
  ["shp", "Sh%", r => (r.st ? r.g / r.st : null), v => v == null ? dash : (100 * v).toFixed(1), "Goals per shot on goal"],
  ["toi", "TOI", r => (r.gp ? r.toi / r.gp : null), v => v == null ? dash : rawFmt("toi_gp", v), "Average time on ice per game"],
  ["p60", "P/60", r => (r.toi ? r.p / r.toi * 60 : null), v => v == null ? dash : v.toFixed(2), "Points per 60 minutes"],
  ["rat", "Av R", r => r.rat, v => v == null ? dash : v.toFixed(2), "Average game rating"],
  ["imp", "Impact", ...tpPct("impact"), "NHL impact percentile (all his clubs this season)", "adv"],
  ["off", "Off", ...tpPct("offence"), "Offence percentile", "adv"],
  ["def", "Def", ...tpPct("defence"), "Defence percentile", "adv"],
  ["fin", "Fin", ...tpPct("finishing"), "Finishing percentile", "adv"],
  ["ply", "Play", ...tpPct("playmaking"), "Playmaking percentile", "adv"],
  ["ixg", "ixG", r => r.c?.totals?.ixg ?? null, v => v == null ? dash : v.toFixed(1), "Individual expected goals (all his clubs this season)", "adv"],
  ["gax", "G−xG", r => (r.c?.totals?.ixg != null ? r.c.totals.g - r.c.totals.ixg : null), v => v == null ? dash : signed(v, 1), "Goals minus individual xG", "adv"],
  ["pp", "PP TOI", r => r.c?.raw?.pp_toi ?? null, v => v == null ? dash : rawFmt("pp_toi", v), "Power-play time per game", "adv"],
  ["pk", "PK TOI", r => r.c?.raw?.pk_toi ?? null, v => v == null ? dash : rawFmt("pk_toi", v), "Penalty-kill time per game", "adv"],
  ["s", "Shots", r => r.s, v => v, "Shot attempts", "adv"],
  ["blk", "Blk", r => r.blk, v => v, "Shots blocked (play-by-play)", "adv"],
  ["ppg", "PPG", r => r.ppg, v => v, "Power-play goals", "adv"], ["shg", "SHG", r => r.shg, v => v, "Short-handed goals", "adv"],
  ["sht", "Shooting", ...tpWar("shooting"), "Goals above replacement from shot generation", "war"],
  ["wfin", "Finishing", ...tpWar("finishing"), "Goals above replacement from finishing", "war"],
  ["wply", "Playmaking", ...tpWar("playmaking"), "Goals above replacement from playmaking", "war"],
  ["wdef", "Defence", ...tpWar("defence"), "Goals above replacement from defence", "war"],
  ["wpen", "Penalties", ...tpWar("penalties"), "Goals above replacement from penalties drawn and taken", "war"],
  ["gar", "GAR", r => r.w?.gar ?? null, v => v == null ? dash : signed(v, 1), "Goals above replacement: the five parts added up", "war"],
  ["w82", "WAR/82", r => r.w?.war82 ?? null, v => v == null ? dash : v.toFixed(1), "WAR per 82 games", "war"],
  ["war", "WAR", r => r.war, v => v == null ? dash : `<b>${v.toFixed(1)}</b>`, "Season WAR (all his clubs that season)", "basic war"],
];
const tpCols = view => TP_COLS.filter(c => (c[5] || "basic").split(" ").includes(view));
// counting stats from the club's own box-score lines: the all-clubs total goes underneath for a player with 2+ clubs
const TP_OWN = new Set(["gp", "g", "a", "p", "pm", "pim", "st", "shp", "toi", "p60", "rat", "s", "blk", "ppg", "shg"]);
/* Season totals over every NHL club a player had lines with ({key: summed line}, only for players with 2+ clubs). */
const TP_SUM = ["gp", "g", "a", "p", "pm", "pim", "s", "st", "toi", "shf", "ppg", "shg", "blk"];
function teamPlayerTotals(season, mode) {
  const cols = D.teamPlayerCols || [], lines = {};
  Object.values(D.teamPlayers?.[season] || {}).forEach(t => (t[mode] || []).forEach(row => {
    const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    (lines[r.k] ||= []).push(r);
  }));
  const out = {};
  Object.entries(lines).filter(([, ls]) => ls.length > 1).forEach(([k, ls]) => {
    const t = { clubs: ls.length };
    TP_SUM.forEach(c => (t[c] = ls.some(r => r[c] != null) ? ls.reduce((a, r) => a + (r[c] || 0), 0) : null));
    const rated = ls.filter(r => r.rat != null && r.gp);
    t.rat = rated.length ? rated.reduce((a, r) => a + r.rat * r.gp, 0) / rated.reduce((a, r) => a + r.gp, 0) : null;
    out[k] = t;
  });
  return out;
}
/* The club a player is with: in the latest season his club now, in an earlier one the last club he played for that season
   (box-score teams in order; former players from the team history). null = unknown. */
function seasonClubAbbr(k, season) {
  const pl = byKey.get(k), cur = season === SEASONS.at(-1);
  // this season: the NHL club he is with now; one sent down to a farm club (no NHL code) counts for the NHL club he
  // last played for in the box scores, so a demoted player stays on his club's Player stats
  if (cur && pl && abbrOf(clubOf(pl))) return abbrOf(clubOf(pl));
  const teams = pl ? (cur ? pl.card : pl.ss?.[season]?.card)?.totals?.team : ALUMNI.get(k)?.war?.[season]?.[2];
  if (cur && !teams) return "";
  return teams ? String(teams).split("/").at(-1) : null;
}
function teamPlayerRows(abbr, season, mode) {
  const cols = D.teamPlayerCols || [];
  const tot = teamPlayerTotals(season, mode);
  return (D.teamPlayers?.[season]?.[abbr]?.[mode] || []).map(row => {
    const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const pl = byKey.get(r.k);
    const b = pl && (season === SEASONS.at(-1) ? (mode === "P" ? pl.po : pl) : (mode === "P" ? pl.ss?.[season]?.po : pl.ss?.[season]));
    const w = b?.war;
    // playoff lines are all with one club; in the regular season he belongs to the club he is with now / ended the season with
    const now = mode === "P" ? abbr : seasonClubAbbr(r.k, season);
    return { ...r, pl, season, c: b?.card || null, w: w || null, war: w ? w.war : null, isG: r.pos === "G" || pl?.grp === "G", tot: tot[r.k] || null, here: now == null || now === abbr, now };
  });
}
function teamPlayersTab(club, season, hlKey) {
  const abbr = abbrOf(club);
  const seasons = SEASONS.filter(s => D.teamPlayers?.[s]?.[abbr]);
  if (!seasons.length) return `<p class="muted">No box scores for ${esc(club)} yet.</p>`;
  if (!seasons.includes(season)) season = seasons.includes(SEASON) ? SEASON : seasons.at(-1);
  const modes = ["R", "P"].filter(m => D.teamPlayers[season][abbr][m]);
  if (!modes.includes(TPS.mode)) TPS.mode = modes[0];
  const all = teamPlayerRows(abbr, season, TPS.mode);
  // only the club's own players (a highlighted one, opened from his career table, stays even if he has moved on)
  const rows = all.filter(r => r.here || r.k === hlKey), gone = all.filter(r => !r.here && r.k !== hlKey);
  const sk = rows.filter(r => !r.isG), gk = rows.filter(r => r.isG);
  // "this club (all clubs)" for a player who also played for another club that season
  const both = (r, g, f) => { const v = f(g(r), r); return r.tot ? `${v}<small class="tot">${f(g(r.tot), r)}</small>` : v; };
  const movedTag = r => !r.here ? ` <span class="muted small">now ${r.now ? tname(clubOfAbbr(r.now)) : "elsewhere"}</span>` : "";
  const cols = tpCols(TPS.view);
  if (!cols.some(c => c[0] === TPS.sort)) { TPS.sort = { basic: "p", adv: "imp", war: "war" }[TPS.view]; TPS.dir = -1; }
  const [, , get] = cols.find(c => c[0] === TPS.sort);
  sk.sort((x, y) => ((get(y) ?? -1e9) - (get(x) ?? -1e9)) * -TPS.dir || y.p - x.p);
  gk.sort((x, y) => y.gp - x.gp);
  const T = teamTable(season), tr = T?.teams?.[abbr];
  const card = (label, key) => { const [v, rank] = tr.stats[key] || [];
    return `<div><span>${label}</span><b>${statFmt(key, v)}</b><small>${rank ? rankLink(teamRankHref(key, club, season), ordinal(rank)) : ""}</small></div>`; };
  const summary = TPS.mode === "R" && tr ? `<div class="stat-cards">
      <div><span>Record</span><b>${tr.w}–${tr.l}–${tr.otl}</b><small>${rankLink(teamRankHref("pts", club, season), `${ordinal(tr.place)}, ${tr.pts} pts`)}</small></div>
      ${card("Goals for / game", "gf_gp")}
      ${card("Goals against / game", "ga_gp")}
      ${card("Power play", "pp_pct")}
      ${card("Penalty kill", "pk_pct")}
      ${card("xG share", "xg_pct")}
    </div><p class="small"><a href="${teamRoute(club)}/stats" data-season="${season}">All ${esc(club)} team stats for ${seasonLabel(season)} →</a></p>` : "";
  const nameCell = r => `<th scope="row" class="pcol" title="${esc(r.n)}">${hasPage(r.k) ? `<a class="pcell" href="${route(r.k)}"><span><b>${esc(r.n)}</b></span></a>` : `<b>${esc(r.n)}</b>`}${movedTag(r)}</th>`;
  const rowOpen = r => `<tr class="${hasPage(r.k) ? "link" : ""}${r.k === hlKey ? " hl" : ""}"${hasPage(r.k) ? ` data-k="${esc(r.k)}"` : ""}>${nameCell(r)}`;
  const skTable = `<table class="rank tp"><thead><tr><th class="pcol">Player</th><th>Pos</th>${cols.map(([k, h, , , tip]) =>
      `<th class="num sort ${TPS.sort === k ? "on" : ""}" data-s="${k}"${tip ? ` title="${tip}"` : ""}><button type="button">${h}${TPS.sort === k ? (TPS.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead><tbody>
    ${sk.map(r => `${rowOpen(r)}<td>${esc(r.pl?.pos || r.pos || "")}</td>
      ${cols.map(([k, , g, f]) => `<td class="num" data-v="${g(r) ?? ""}">${TP_OWN.has(k) ? both(r, g, f) : f(g(r), r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  // goalies: few columns, so the basic and advanced numbers fit in one table
  const gTable = gk.length ? `<table class="rank tp"><thead><tr><th class="pcol">Goalie</th><th class="num">GP</th><th class="num" title="Average time on ice per game">TOI</th>
      <th class="num" title="Save percentage on charted shots">SV%</th><th class="num" title="Goals saved above expected">GSAx</th><th class="num">GSAx/60</th>
      <th class="num">Av R</th><th class="num" title="NHL impact percentile">Impact</th><th class="num">WAR/82</th><th class="num">WAR</th></tr></thead><tbody>
    ${gk.map(r => { const c = r.c;
      return `${rowOpen(r)}<td class="num">${both(r, x => x.gp, v => v)}</td><td class="num">${both(r, x => (x.gp ? x.toi / x.gp : null), v => v == null ? dash : rawFmt("toi_gp", v))}</td>
        <td class="num">${c?.raw?.svp != null ? c.raw.svp.toFixed(3).replace(/^0/, "") : dash}</td><td class="num">${c?.raw?.gsax != null ? signed(c.raw.gsax, 1) : dash}</td>
        <td class="num">${c?.raw?.gsax60 != null ? signed(c.raw.gsax60, 2) : dash}</td>
        <td class="num">${both(r, x => x.rat, v => v == null ? dash : v.toFixed(2))}</td><td class="num">${tpPct("impact")[1](c?.comp?.impact ?? null, r)}</td>
        <td class="num">${r.w?.war82 == null ? dash : r.w.war82.toFixed(1)}</td><td class="num">${r.war == null ? dash : `<b>${r.war.toFixed(1)}</b>`}</td></tr>`; }).join("")}</tbody></table>` : "";
  return `<div class="cardbar"><div><h2 class="flat">${seasonLabel(season)} ${TPS.mode === "P" ? "playoffs" : "regular season"}</h2>
      <p class="sub">${TPS.mode === "P" ? "Everyone who played for" : season === SEASONS.at(-1) ? "Players on" : "Players who ended the season with"} ${esc(club)}; the numbers are his games for ${esc(club)}.
        The small number under a value = his season total over all his NHL clubs, when he also played for another one. Click a header to sort.</p></div>
      <span class="inline">${modes.length > 1 ? `<span class="seg" id="tp-mode">${modes.map(m => `<button type="button" data-m="${m}" class="${TPS.mode === m ? "on" : ""}">${m === "R" ? "Regular season" : "Playoffs"}</button>`).join("")}</span>` : ""}
      ${seasons.length > 1 ? `<label class="inline">Season <select id="tp-season">${seasons.slice().reverse().map(s => `<option value="${s}" ${s === season ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>` : ""}</span></div>
    ${summary}
    <section class="card-box flush" aria-label="Skaters"><div class="box-h tp-head"><h2>Skaters <span class="muted">${sk.length}</span></h2>
      <span class="seg" id="tp-view" role="group" aria-label="Columns">${TP_VIEWS.map(([v, t]) => `<button type="button" data-v="${v}" class="${TPS.view === v ? "on" : ""}">${t}</button>`).join("")}</span></div>
      <div class="tablewrap">${skTable}</div>
      ${TPS.view !== "basic" ? `<p class="sub pad">${TPS.view === "adv" ? "Percentiles, ixG, G−xG and PP/PK time come from his season card (all his NHL clubs that season; percentiles need enough ice time). Each pill opens its full ranking." : "The parts are goals above replacement over his season (all his NHL clubs): shot generation, finishing, playmaking, defence and penalties add up to GAR, which becomes WAR at the league's goals per win. How it works explains each part."}</p>` : ""}</section>
    ${gTable ? `<section class="card-box flush" aria-label="Goalies"><h2 class="box-h">Goalies <span class="muted">${gk.length}</span></h2><div class="tablewrap">${gTable}</div>
      <p class="sub pad">SV%, GSAx, impact and WAR come from his season shot charts and card (all his clubs that season).</p></section>` : ""}
    ${gone.length ? `<p class="small muted">Not shown: ${gone.length} player${gone.length === 1 ? "" : "s"} who played for ${esc(club)} ${season === SEASONS.at(-1) ? "this season but" : "that season but ended it elsewhere"}${season === SEASONS.at(-1) ? " are with another club now" : ""}
      (${gone.slice().sort((x, y) => y.gp - x.gp).slice(0, 8).map(r => `${hasPage(r.k) ? `<a href="${route(r.k)}">${esc(r.n)}</a>` : esc(r.n)} ${r.gp} GP${r.now ? `, now ${tname(clubOfAbbr(r.now))}` : ""}`).join("; ")}${gone.length > 8 ? "; …" : ""}).</p>` : ""}
    <p class="small muted">From this save's box scores (about 2% of games missing). Shots = attempts, SOG = shots on goal. Blk = shots blocked,
      credited from the play-by-play; hits, takeaways and giveaways aren't given per player anywhere a client can see (team totals are on Team stats).</p>`;
}
function bindTeamPlayers(club, season, hlKey) {
  const go = s => (location.hash = `${teamRoute(club)}/players/${s}`);
  view.querySelector("#tp-season")?.addEventListener("change", e => go(e.target.value));
  view.querySelectorAll("#tp-mode button").forEach(b => b.onclick = () => { TPS.mode = b.dataset.m; renderTeams(club, "players", season, hlKey); });
  view.querySelectorAll("#tp-view button").forEach(b => b.onclick = () => { TPS.view = b.dataset.v; renderTeams(club, "players", season, hlKey); });
  view.querySelectorAll("th[data-s] button").forEach(b => b.onclick = () => {
    const k = b.parentNode.dataset.s;
    TPS.dir = TPS.sort === k ? -TPS.dir : -1; TPS.sort = k; renderTeams(club, "players", season, hlKey);
  });
  view.querySelector("a[data-season]")?.addEventListener("click", e => { SEASON = e.currentTarget.dataset.season; });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  const hl = view.querySelector("tr.hl");
  if (hl) setTimeout(() => hl.scrollIntoView({ block: "center" }), 0);
}

// ---------------------------------------------------------------- team History and Hall of Fame
/* Everyone with NHL history in this save: current players plus alumni (left the latest snapshot; build_data
   team_history). Each: NHL career rows, {season: [WAR, GP, box-score team(s)]} and NHL honours. */
let NHLP = null;
function nhlPeople() {
  if (NHLP && NHLP.data === D) return NHLP.list;
  const C = Object.fromEntries((D.careerCols || []).map((c, i) => [c, i]));
  const honours = a => (a || []).filter(x => "TCA".includes(x[3]) && /National Hockey League/.test(x[2]));
  const cur = D.players.map(p => {
    const war = {};
    SEASONS.forEach(s => {
      const w = s === SEASONS.at(-1) ? p.war : p.ss?.[s]?.war, t = s === SEASONS.at(-1) ? p.card?.totals?.team : p.ss?.[s]?.card?.totals?.team;
      if (w) war[s] = [w.war, w.gp, t];
    });
    return { k: p.k, n: p.n, pos: p.pos, grp: p.grp, p, war, ach: honours(p.ach), car: (p.car || []).filter(r => r[C.league] === "NHL") };
  });
  const alumni = (D.teamHist?.alumni || []).map(a => ({ ...a, car: a.car.filter(r => r[C.league] === "NHL"), p: null }));
  const list = [...cur, ...alumni].filter(x => x.car.length || Object.keys(x.war).length || x.ach.length);
  NHLP = { data: D, list, C };
  return list;
}
/* One player's record with a club: regular-season (R) and playoff (P) NHL career lines, WAR in seasons he played for
   it (shared evenly when the box scores show more than one team that season), honours won there. */
function withClub(x, club) {   // club null = the whole league (every NHL club)
  const C = NHLP.C, abbr = club && abbrOf(club), mine = r => !club || r[C.club] === club;
  const sum = (type, col) => x.car.filter(r => mine(r) && r[C.type] === type).reduce((s, r) => s + (+r[C[col]] || 0), 0);
  const seasons = new Set(x.car.filter(r => mine(r) && r[C.type] === "R").map(r => r[C.season]));
  let war = 0;
  const warBy = {};
  Object.entries(x.war).forEach(([s, [w, , t]]) => {
    const teams = String(t || "").split("/");
    if (!club || (abbr && teams.includes(abbr))) { warBy[s] = club ? w / teams.length : w; war += warBy[s]; seasons.add(s); }
  });
  // single seasons: that season's regular-season lines (all his NHL clubs for the league)
  const bySeason = {};
  x.car.filter(r => mine(r) && r[C.type] === "R").forEach(r => {
    const b = (bySeason[r[C.season]] ||= { gp: 0, g: 0, a: 0, p: 0, w: 0 });
    ["gp", "g", "a", "p", "w"].forEach(c => { b[c] += +r[C[c]] || 0; });
  });
  const ach = x.ach.filter(a => !club || a[1] === club);
  return { x, bySeason, gp: sum("R", "gp"), g: sum("R", "g"), a: sum("R", "a"), pts: sum("R", "p"), w: sum("R", "w"), so: sum("R", "so"),
           pogp: sum("P", "gp"), pop: sum("P", "p"), war, warBy, seasons: [...seasons].sort(), ach,
           trophies: ach.filter(a => a[3] === "T"), cups: ach.filter(a => a[3] === "C" && /National Hockey League winners$/.test(a[2])),
           allstar: ach.filter(a => a[3] === "A" && /(First|Second) All-Star/.test(a[2])) };
}
const personLink = x => hasPage(x.k) ? `<a href="${route(x.k)}">${esc(x.n)}</a>` : `<span title="No longer in the data">${esc(x.n)}</span>`;
const HOFC = {};
function clubPeople(club) {   // cached per club (null = league) for this data
  const id = club || "";
  if (HOFC[id]?.data !== D) HOFC[id] = { data: D, rows: nhlPeople().map(x => withClub(x, club)).filter(r => r.gp || r.war || r.ach.length || r.pogp) };
  return HOFC[id].rows;
}
const seasonsOfClub = club => {
  const th = D.teamHist || {}, abbr = abbrOf(club);
  return [...new Set([...SEASONS.filter(s => teamTable(s)?.teams?.[abbr]), ...Object.keys(th.seasons || {}).filter(s => th.seasons[s][club]),
    ...Object.keys(th.cups || {}).filter(s => (th.cups[s] || []).includes(club))])].sort().reverse();
};
function teamHistoryTab(club) {
  const th = D.teamHist || {}, abbr = abbrOf(club), people = clubPeople(club);
  const seasons = seasonsOfClub(club);
  const rounds = th.rounds || [];
  const po = s => {
    const cup = th.cups?.[s] || [];
    if (cup[0] === club) return `<b class="up">Stanley Cup champion</b>`;
    if (cup[1] === club) return `<b>Lost the Stanley Cup final</b>`;
    const r = th.seasons?.[s]?.[club]?.po;
    return r ? `Reached the ${rounds[r - 1].toLowerCase()}${r < 4 ? "" : ""}` : `<span class="muted">${teamTable(s)?.teams?.[abbr] ? "–" : ""}</span>`;
  };
  const C = NHLP.C;
  const leader = (s, f, fmtv) => {
    const best = people.map(r => [r, f(r, s)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    return best ? `${personLink(best[0].x)} <span class="muted small">${fmtv(best[1])}</span>` : dash;
  };
  const pointsIn = (r, s) => r.x.car.filter(c => c[C.club] === club && c[C.type] === "R" && c[C.season] === s).reduce((t, c) => t + (+c[C.p] || 0), 0);
  const award = (s, name) => (th.seasons?.[s]?.[club]?.awards || []).find(a => a[0] === name);
  const awardCell = a => !a ? dash : a[2] && hasPage(a[2]) ? `<a href="${route(a[2])}">${esc(a[1])}</a>` : esc(a[1]);
  const cups = seasons.filter(s => th.cups?.[s]?.[0] === club), finals = seasons.filter(s => th.cups?.[s]?.[1] === club);
  const poYears = seasons.filter(s => th.seasons?.[s]?.[club]?.po || (th.cups?.[s] || []).includes(club));
  const tables = seasons.map(s => [s, teamTable(s)?.teams?.[abbr]]).filter(([, r]) => r);
  const best = tables.slice().sort((a, b) => a[1].place - b[1].place)[0];
  const trophies = people.flatMap(r => r.trophies.map(a => [a, r])).sort((a, b) => b[0][0].localeCompare(a[0][0]));
  const allstars = people.flatMap(r => r.allstar.map(a => [a, r])).sort((a, b) => b[0][0].localeCompare(a[0][0]));
  const awardNames = [...new Set(seasons.flatMap(s => (th.seasons?.[s]?.[club]?.awards || []).map(a => a[0])))];
  return `<div class="stat-cards">
      <div><span>Seasons in this save</span><b>${seasons.length}</b><small>${seasons.length ? `${seasonLabel(seasons.at(-1))} to ${seasonLabel(seasons[0])}` : ""}</small></div>
      <div><span>Stanley Cups</span><b>${cups.length}</b><small>${cups.map(s => playoffSeasons().includes(s) ? `<a href="#/playoffs/${s}">${seasonLabel(s)}</a>` : seasonLabel(s)).join(", ") || "none yet"}${finals.length ? ` · ${finals.length} lost final${finals.length > 1 ? "s" : ""}` : ""}</small></div>
      <div><span>Playoff seasons</span><b>${poYears.length}</b><small>seen in the box scores</small></div>
      <div><span>Best finish</span><b>${best ? rankLink(teamRankHref("pts", club, best[0]), ordinal(best[1].place)) : "–"}</b><small>${best ? `${seasonLabel(best[0])}, ${best[1].pts} points` : ""}</small></div>
    </div>
    <section class="card-box flush" aria-label="Season by season"><h2 class="box-h">Season by season</h2>
      <div class="tablewrap"><table class="rank"><thead><tr><th>Season</th><th class="num">GP</th><th class="num">W–L–OTL</th><th class="num">Pts</th><th class="num">Place</th>
        <th class="num">GF</th><th class="num">GA</th><th>Playoffs</th><th>Top scorer</th><th>Top WAR</th><th>Biggest Star</th></tr></thead><tbody>
        ${seasons.map(s => { const r = teamTable(s)?.teams?.[abbr];
          // the season opens the club's Player stats for it (when there are box scores), the place that season's standings
          const hasStats = D.teamPlayers?.[s]?.[abbr];
          return `<tr><th scope="row">${hasStats ? `<a href="${teamRoute(club)}/players/${s}" title="${esc(club)} player stats, ${seasonLabel(s)}">${seasonLabel(s)}</a>` : seasonLabel(s)}</th><td class="num">${r ? r.gp : dash}</td><td class="num">${r ? `${r.w}–${r.l}–${r.otl}` : dash}</td><td class="num"><b>${r ? r.pts : "–"}</b></td>
            <td class="num">${r ? rankChip(r.place, teamTable(s).n, teamRankHref("pts", club, s)) : dash}</td><td class="num">${r ? r.gf : dash}</td><td class="num">${r ? r.ga : dash}</td>
            <td class="small">${playoffSeasons().includes(s) ? `<a href="#/playoffs/${s}">${po(s)}</a>` : po(s)}</td><td class="small">${leader(s, pointsIn, v => `${v} pts`)}</td>
            <td class="small">${leader(s, (q, ss) => q.warBy[ss] || 0, v => `${v.toFixed(1)} WAR`)}</td><td class="small">${awardCell(award(s, "Biggest Star"))}</td></tr>`; }).join("")}
      </tbody></table></div>
      <p class="sub pad">Records from this save's box scores (the place links to the standings). Playoffs: champion and finalist from the achievement log;
        otherwise the furthest round seen in the box scores, a lower bound, since EHM keeps other teams' box scores only ~44 days. Clicking a place opens that season's standings.</p></section>
    <div class="row">
      <section class="card-box" aria-labelledby="tr-h"><h2 id="tr-h">NHL trophies won here</h2>
        ${trophies.length ? `<ul class="plain">${trophies.map(([a, r]) => `<li>${achHref(a[0], a[2]) ? `<a class="small" href="${achHref(a[0], a[2])}" title="${seasonLabel(seasonOfDay(a[0]))} playoffs">${a[0].slice(0, 4)}</a>` : `<span class="muted small">${a[0].slice(0, 4)}</span>`} ${esc(achText(a[2]).replace(/^\d+\/\d+ /, "").replace(/^NHL /, ""))} · ${personLink(r.x)}</li>`).join("")}</ul>`
          : `<p class="muted small">None in the achievement log yet.</p>`}</section>
      <section class="card-box" aria-labelledby="as-h"><h2 id="as-h">NHL All-Star teams</h2>
        ${allstars.length ? `<ul class="plain">${allstars.map(([a, r]) => `<li>${esc(achText(a[2]).replace(/ National Hockey League/, " NHL"))} · ${personLink(r.x)}</li>`).join("")}</ul>`
          : `<p class="muted small">None in the achievement log yet.</p>`}</section>
    </div>
    ${awardNames.length ? `<section class="card-box flush" aria-label="Team awards"><h2 class="box-h">Team awards</h2>
      <div class="tablewrap"><table><thead><tr><th>Award</th>${seasons.filter(s => th.seasons?.[s]?.[club]?.awards).map(s => `<th>${seasonLabel(s)}</th>`).join("")}</tr></thead><tbody>
      ${awardNames.map(n => `<tr><th scope="row">${esc(n)}</th>${seasons.filter(s => th.seasons?.[s]?.[club]?.awards).map(s => `<td class="small">${awardCell(award(s, n))}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div><p class="sub pad">The club's own awards screen, from the last snapshot of each season (the current season so far).</p></section>` : ""}
    <p class="small muted">The save started in ${D.dates.length ? fmtDate(D.dates[0]).slice(-4) : ""}: the game's database has no earlier franchise history, so this page grows with every season simmed.</p>`;
}
/* Hall of Fame score: WAR + 3 per NHL trophy + 2 per Stanley Cup + 1 per First/Second All-Star team (with the club,
   or anywhere for the league Hall of Fame). */
const hofScore = r => r.war + 3 * r.trophies.length + 2 * r.cups.length + r.allstar.length;
/* Titles to win: [id, title, what, value, format, who counts, single season?]. The holder is #1 of the full ranking
   at #/hof/<club or "league">/<id> (every rank opens its whole list). */
const isSk = r => r.x.grp !== "G", isGk = r => r.x.grp === "G", anyone = () => true;
const HOF_TITLES = [
  ["gp", "Iron Man", "Most games played", r => r.gp, v => `${v} GP`, anyone],
  ["pts", "All-Time Scorer", "Most points", r => r.pts, v => `${v} pts`, isSk],
  ["g", "Sniper", "Most goals", r => r.g, v => `${v} G`, isSk],
  ["a", "Playmaker", "Most assists", r => r.a, v => `${v} A`, isSk],
  ["war", "Most Valuable", "Most WAR", r => r.war, v => `${v.toFixed(1)} WAR`, anyone],
  ["w", "Brick Wall", "Most goalie wins", r => r.w, v => `${v} W`, isGk],
  ["so", "Shutout King", "Most shutouts", r => r.so, v => `${v} SO`, isGk],
  ["pop", "Mr. Playoffs", "Most playoff points", r => r.pop, v => `${v} pts`, isSk],
  ["hon", "Silverware", "Most NHL honours (trophies, Cups, All-Star teams)", r => r.trophies.length + r.cups.length + r.allstar.length, v => `${v}`, anyone],
  ["seasons", "Lifer", "Most seasons", r => r.seasons.length, v => `${v} season${v > 1 ? "s" : ""}`, anyone],
  ["spts", "Season to Remember", "Most points in one season", l => l.p, v => `${v} pts`, isSk, true],
  ["sg", "Goal Rush", "Most goals in one season", l => l.g, v => `${v} G`, isSk, true],
  ["swar", "Peak Season", "Most WAR in one season", l => l.war, v => `${v.toFixed(1)} WAR`, anyone, true],
  ["sw", "Workhorse", "Most goalie wins in one season", l => l.w, v => `${v} W`, isGk, true],
];
const HOF_SCORE = ["score", "Hall of Fame score", "WAR + 3 per NHL trophy + 2 per Stanley Cup + 1 per All-Star team", hofScore, v => fmt(v, 1), anyone];
function hofRanking(club, id) {   // the full ranking behind a title: [{r, v, season}], best first; ties share a rank
  const t = id === "score" ? HOF_SCORE : HOF_TITLES.find(x => x[0] === id);
  if (!t) return null;
  const [, , , f, , who, single] = t;
  const people = clubPeople(club).filter(who);
  const rows = single
    ? people.flatMap(r => [...new Set([...Object.keys(r.bySeason), ...Object.keys(r.warBy)])].map(s =>
        ({ r, season: s, v: f({ ...(r.bySeason[s] || { gp: 0, g: 0, a: 0, p: 0, w: 0 }), war: r.warBy[s] || 0 }) })))
    : people.map(r => ({ r, v: f(r) }));
  const out = rows.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  out.forEach((x, i) => { x.rank = i && x.v === out[i - 1].v ? out[i - 1].rank : i + 1; });
  return { t, rows: out };
}
const hofHref = (club, id) => `#/hof/${club ? encodeURIComponent(club) : "league"}/${id}`;
function hofBody(club) {
  const where = club ? `for ${esc(club)}` : "in the NHL", min = club ? 2 : 4;
  const members = hofRanking(club, "score").rows.filter(x => x.v >= min);
  const titles = HOF_TITLES.map(t => [t, hofRanking(club, t[0])]).filter(([, R]) => R.rows.length);
  const span = r => r.seasons.length ? ` (${seasonLabel(r.seasons[0])}${r.seasons.length > 1 ? ` to ${seasonLabel(r.seasons.at(-1))}` : ""})` : "";
  const card = ({ r, v }) => `<div class="hof-card">${r.x.p ? logo(clubOf(r.x.p), 28) : ""}<div><b>${personLink(r.x)}</b>
      <small>${esc(r.x.pos || "")} · ${r.seasons.length} season${r.seasons.length === 1 ? "" : "s"}${span(r)}</small>
      <small>${r.gp ? `${r.gp} GP · ${r.x.grp === "G" ? `${r.w} W · ${r.so} SO` : `${r.pts} P`} · ` : ""}${fmt(r.war, 1)} WAR${r.trophies.length ? ` · ${r.trophies.length} troph${r.trophies.length > 1 ? "ies" : "y"}` : ""}${r.cups.length ? ` · ${r.cups.length} Cup${r.cups.length > 1 ? "s" : ""}` : ""}${r.allstar.length ? ` · ${r.allstar.length}× All-Star` : ""}</small>
      ${r.x.p ? (club && clubOf(r.x.p) === club ? `<small class="up">Still with ${esc(club)}</small>` : `<small class="muted">${club ? "Now " : ""}${esc(clubOf(r.x.p))}</small>`) : `<small class="muted">Left the data</small>`}</div>
      <a class="hof-score" href="${hofHref(club, "score")}" title="Hall of Fame score: see everyone's">${fmt(v, 1)}</a></div>`;
  const titleCard = ([t, R]) => {
    const top = R.rows.filter(x => x.rank === 1);
    return `<a class="hof-title" href="${hofHref(club, t[0])}"><span class="hof-k">${t[1]}</span><small>${t[2]}</small>
      <b>${top.length > 3 ? `${top.length} players tied` : top.map(x => esc(x.r.x.n)).join(", ")}</b>
      <small>${t[4](top[0].v)}${t[6] ? ` · ${seasonLabel(top[0].season)}` : ""}${top.length > 1 ? " (tied)" : ""}</small>
      <span class="hof-more">Full ranking (${R.rows.length}) →</span></a>`;
  };
  return `<section class="card-box" aria-labelledby="ti-h"><h2 id="ti-h">${club ? "Franchise titles" : "League record holders"}</h2>
      <p class="sub">Held ${where} in this save. Click a title for everyone ranked on it.</p>
      ${titles.length ? `<div class="hof-titles">${titles.map(titleCard).join("")}</div>` : `<p class="muted small">No records yet.</p>`}</section>
    <section class="card-box" aria-labelledby="hof-h"><h2 id="hof-h">Honoured members</h2>
      <p class="sub">Hall of Fame score: WAR ${where} + 3 per NHL trophy + 2 per Stanley Cup + 1 per First/Second All-Star team${club ? " (won with the club)" : ""}.
        Members need ${min} or more. <a href="${hofHref(club, "score")}">Everyone's score →</a></p>
      ${members.length ? `<div class="hof-grid">${members.slice(0, club ? 12 : 24).map(card).join("")}</div>` : `<p class="muted small">No one has reached ${min} yet.</p>`}</section>
    ${club ? hofFoot(club) : ""}`;
}
// the sources note: last on the page (the league page adds Cup champions and trophy winners after hofBody)
const hofFoot = club => `<p class="small muted">Counting stats: NHL regular-season and playoff lines from the players' History tabs; WAR: this save's box scores${club ? " (a season split between clubs is shared evenly)" : ""}.
      Players who left the database still count. The game's database has no history before the save started, so these grow with every season simmed.</p>`;
const hallOfFameTab = club => hofBody(club);
/* #/playoffs/<season>: the playoff tree. Series come from the playoff box scores (D.teamHist.playoffs: round, conference,
   both clubs, wins seen, games seen), built down from the final: each finalist's conference final, then the clubs in it
   and their earlier series. A club that played the next round won its series; champion and finalist come from the
   achievement log. Other teams' box scores are kept only ~44 days, so some games (rarely a whole series) are missing:
   a series score is exact when one side has 4 wins seen, otherwise it is the games seen (marked *). */
function playoffSeasons() {
  const th = D.teamHist || {};
  return [...new Set([...Object.keys(th.playoffs || {}), ...Object.keys(th.cups || {})])].sort().reverse();
}
function bracketOf(season) {
  const th = D.teamHist || {}, cup = th.cups?.[season] || [];
  const S = (th.playoffs?.[season] || []).map(([rnd, conf, a, b, wa, wb, n]) => ({ rnd, conf, a, b, wa, wb, n }));
  const find = (team, rnd) => team && S.find(s => s.rnd === rnd && (s.a === team || s.b === team));
  const playedFrom = (team, rnd) => S.some(s => s.rnd >= rnd && (s.a === team || s.b === team)) || (rnd === 4 && cup.includes(team));
  S.forEach(s => {
    s.win = s.wa >= 4 ? s.a : s.wb >= 4 ? s.b : s.rnd === 4 && cup[0] && [s.a, s.b].includes(cup[0]) ? cup[0]
      : playedFrom(s.a, s.rnd + 1) ? s.a : playedFrom(s.b, s.rnd + 1) ? s.b : null;
    s.exact = s.wa >= 4 || s.wb >= 4;
  });
  let final = S.find(s => s.rnd === 4);
  if (!final && cup[0] && cup[1]) final = { rnd: 4, a: cup[0], b: cup[1], wa: null, wb: null, win: cup[0], exact: false };
  const slot = (team, rnd) => find(team, rnd) || { rnd, a: team || null, b: null, missing: true };
  // one side of the tree from a conference finalist: [[cf], [r2, r2], [r1 x4]]
  const side = finalist => {
    const cf = slot(finalist, 3);
    const r2 = [slot(cf.a, 2), slot(cf.b, 2)];
    const r1 = r2.flatMap(s => [slot(s.a, 1), slot(s.b, 1)]);
    return [r1, r2, [cf]];
  };
  let east = final?.a, west = final?.b;
  const confOf = t => S.find(s => s.rnd < 4 && (s.a === t || s.b === t))?.conf;
  if (final && (confOf(east) === "West" || confOf(west) === "East")) [east, west] = [west, east];
  if (!final) {   // no final yet: take each conference's furthest series
    const top = c => S.filter(s => s.conf === c).sort((x, y) => y.rnd - x.rnd)[0];
    east = top("East")?.win || top("East")?.a; west = top("West")?.win || top("West")?.a;
  }
  return { final, east: side(east), west: side(west), cup, n: S.length };
}
const poRound = c => /Champ\. Final/.test(c) ? 4 : /Conference Final/.test(c) ? 3 : /Semi Final/.test(c) ? 2 : /Qtr Final/.test(c) ? 1 : 0;
const seriesKey = (x, y) => [x, y].sort().map(encodeURIComponent).join("~");
const poGames = season => (D.teamHist?.games?.[season] || []).map((g, i) => ({ ...g, i, rnd: poRound(g.c), sk: seriesKey(g.h, g.a) }));
const PO_TABS = [["bracket", "Bracket"], ["games", "Series & games"], ["leaders", "Leaders"]];
function seriesBox(s, season) {
  if (!s || (!s.a && !s.b)) return `<div class="series empty"><span class="muted small">not captured</span></div>`;
  const line = (t, w) => !t ? `<div class="st muted small">?</div>`
    : `<div class="st${s.win === t ? " win" : ""}">${logo(t, 20)}<span>${esc(NHL_TEAMS[t]?.[0] || t)}</span>
        <b title="${s.exact ? "Series wins" : "Wins seen in the captured box scores"}">${w == null ? "" : w}${w != null && !s.exact ? "*" : ""}</b></div>`;
  const inner = `${line(s.a, s.missing ? null : s.wa)}${line(s.b, s.missing ? null : s.wb)}`;
  return s.a && s.b ? `<a class="series" href="#/playoffs/${season}/games/${seriesKey(s.a, s.b)}" title="Games of this series">${inner}</a>`
    : `<div class="series partial">${inner}</div>`;
}
function bracketHtml(season) {
  const B = bracketOf(season), champ = B.cup[0] || B.final?.win;
  const col = (list, cls) => `<div class="bcol ${cls}">${list.map(s => seriesBox(s, season)).join("")}</div>`;
  return `<section class="card-box flush"><div class="tablewrap"><div class="bracket">
      <div class="bhead"><span>First round</span><span>Second round</span><span>Conference final</span><span>Stanley Cup final</span><span>Conference final</span><span>Second round</span><span>First round</span></div>
      <div class="bbody">${col(B.east[0], "r1")}${col(B.east[1], "r2")}${col(B.east[2], "r3")}
        <div class="bcol r4">${seriesBox(B.final, season)}${champ ? `<div class="champ">${teamLogo(champ, 56)}<b>${tlink(champ)}</b><small>Stanley Cup champion</small></div>` : ""}</div>
        ${col(B.west[2], "r3")}${col(B.west[1], "r2")}${col(B.west[0], "r1")}</div>
    </div></div>
    <p class="sub pad">Eastern Conference left, Western right. Click a series for its games and box scores. The winner of each series is in bold: a club that
      played the next round won it; champion and finalist come from the achievement log. EHM keeps other teams' box scores only ~44 days, so some games are
      missing: * = wins seen in the captured games, not the full series score.</p></section>`;
}
function gamesHtml(season, sel, sub) {
  const games = poGames(season), B = D.teamHist?.playoffs?.[season] || [];
  const series = B.map(([rnd, conf, x, y, wx, wy, n]) => ({ rnd, conf, x, y, wx, wy, n, sk: seriesKey(x, y) }))
    .filter(s => !sel || s.sk === sel).sort((p, q) => q.rnd - p.rnd || p.conf.localeCompare(q.conf));
  const names = ["", "First round", "Second round", "Conference final", "Stanley Cup final"];
  const score = g => g.hg == null ? "–" : `${g.ag}–${g.hg}`;
  const card = s => {
    const gs = games.filter(g => g.sk === s.sk && g.rnd === s.rnd).sort((p, q) => p.d.localeCompare(q.d));
    const head = `<h3 class="box-h3">${names[s.rnd]}${s.conf && s.rnd < 4 ? ` · ${esc(s.conf)}` : ""}</h3>
      <div class="sline">${teamLogo(s.x, 28)} <b>${tlink(s.x)}</b> <span class="big">${s.wx}–${s.wy}</span> <b>${tlink(s.y)}</b> ${teamLogo(s.y, 28)}
        <span class="muted small">${s.wx >= 4 || s.wy >= 4 ? "" : `wins in the ${s.n} captured game${s.n > 1 ? "s" : ""}`}</span>${sel ? "" : `<span class="open-sr small">Open series →</span>`}</div>`;
    // in the list of every series, the heading opens that series' own page (as from the bracket)
    return `<section class="card-box" id="sr-${s.sk}">${sel ? head : `<a class="series-head" href="#/playoffs/${season}/games/${s.sk}">${head}</a>`}
      <div class="tablewrap"><table class="fit"><thead><tr><th>Date</th><th>Game</th><th>Away</th><th class="num">Score</th><th>Home</th><th></th></tr></thead><tbody>
      ${gs.map(g => { const m = g.c.match(/(\d+)\s*\(/); return `<tr class="link" data-g="${g.i}"><td class="nowrap">${fmtDate(g.d)}</td><td>${m ? "Game " + m[1] : ""}</td>
        <td class="nowrap">${tlink(g.a, `${logo(g.a, 20)} ${esc(g.a)}`)}</td><td class="num"><b>${score(g)}</b>${/OT|overtime/i.test(g.c) || (g.c.match(/\(([^)]*)\)/)?.[1].split(",").length || 0) > 3 ? " <span class='muted small'>OT</span>" : ""}</td>
        <td class="nowrap">${tlink(g.h, `${logo(g.h, 20)} ${esc(g.h)}`)}</td><td><a href="#/playoffs/${season}/game/${g.i}">Box score →</a></td></tr>`; }).join("")
        || `<tr><td colspan="6" class="muted small">No box scores captured for this series.</td></tr>`}</tbody></table></div></section>`;
  };
  const gsOf = s => games.filter(g => g.sk === s.sk && g.rnd === s.rnd);
  if (sel && series.length === 1 && sub === "players") return seriesPlayersHtml(season, series[0], gsOf(series[0]));
  const block = s => `<div class="series-page"><div>${card(s)}</div><div class="series-side">${seriesBoards(gsOf(s), sel ? `#/playoffs/${season}/games/${s.sk}/players` : null)}</div></div>`;
  return `${sel ? `<p><a href="#/playoffs/${season}/games">← All series</a></p>` : ""}
    ${series.map(block).join("") || `<p class="muted">No series in the box scores for this season.</p>`}
    <p class="small muted">Scores are away–home. Games missing from a series weren't captured (EHM keeps other teams' box scores ~44 days).</p>`;
}
function boxScoreHtml(season, i) {
  const games = poGames(season), g = games[+i];
  if (!g) return `<p class="muted">Unknown game. <a href="#/playoffs/${season}/games">All series</a></p>`;
  const same = games.filter(x => x.sk === g.sk && x.rnd === g.rnd).sort((p, q) => p.d.localeCompare(q.d)), j = same.indexOf(g);
  return `<p class="yearnav"><a class="ghost${j > 0 ? "" : " disabled"}" ${j > 0 ? `href="#/playoffs/${season}/game/${same[j - 1].i}"` : 'aria-disabled="true"'}>← Previous game</a>
      <a class="ghost" href="#/playoffs/${season}/games/${g.sk}">This series</a>
      <a class="ghost${j < same.length - 1 ? "" : " disabled"}" ${j < same.length - 1 ? `href="#/playoffs/${season}/game/${same[j + 1].i}"` : 'aria-disabled="true"'}>Next game →</a></p>
    ${gameBox(g)}`;
}
/* A goalie's shots and goals against in one game. The shot chart misses some shots, so a goalie who was his side's only
   goalie gets the box score's official count (the other side's shots on goal and goals); when two goalies split a game,
   each gets his charted numbers, else the side's shared by minutes. xGA (post-shot xG) only exists in the chart. */
function goalieGame(g, x) {
  const sd = x[0], opp = sd === "home" ? "away" : "home";
  const mates = g.pl.filter(y => y[0] === sd && y[3] === "G" && y[11] > 0), alone = mates.length === 1;
  const sog = +(g.ts?.["Shots On Goal"] || [])[opp === "home" ? 0 : 1] || null, goals = opp === "home" ? g.hg : g.ag;
  const gToi = mates.reduce((s, y) => s + y[11], 0), share = gToi ? x[11] / gToi : 0;
  if (alone && sog != null && goals != null) return { sa: sog, ga: goals, xga: x[20], official: true };
  if (x[18] != null) return { sa: x[18], ga: x[19], xga: x[20], official: false };
  return { sa: sog == null ? null : sog * share, ga: goals == null ? null : goals * share, xga: null, official: false };
}
/* Game Score card (after Dom Luszczyszyn's Game Score and the HockeyStatCards breakdown). Each part is measured against
   an average forward / defenceman with the same ice time (league rates per minute from every regular-season box score
   in the data), so a quiet game is negative: production (0.75 G + 0.7 A1 + 0.55 A2), shots (0.075 x SOG), blocks
   (0.05 each), penalties (0.15 per minor; fewer than average is positive) and on-ice goals (0.15 x +/-, average 0).
   Goalies: saves = 0.75 x the goals an average goalie allows on his shots against (league save %), goals against =
   -0.75 x the goals he allowed; the sum is goals saved above average. On-ice shot share, faceoffs, penalties drawn and
   usage aren't recorded per player anywhere a client can see. */
const GS_PARTS = [
  ["prod", "Production", "Goals and assists vs average for his ice time", "var(--gs-prod)"],
  ["shots", "Shots", "Shots on goal vs average", "var(--gs-shots)"],
  ["ice", "On-ice goals", "+/−: on the ice for goals for (right) or against (left)", "var(--gs-ice)"],
  ["blk", "Blocks", "Shots blocked vs average", "var(--gs-blk)"],
  ["pen", "Penalties", "Minors taken vs average (fewer is right)", "var(--gs-pen)"],
  ["save", "Goaltending +", "Goals saved above an average goalie on his shots", "var(--gs-save)"],
  ["ga", "Goaltending −", "Goals allowed above an average goalie", "var(--gs-ga)"],
];
const GS_GRADES = [["A", 1.31], ["B", 0.16], ["C", -0.92], ["D", -2.72], ["F", -Infinity]];
const gsGrade = v => GS_GRADES.find(([, lo]) => v >= lo)[0];
let GSR = null;   // league rates per minute of ice time, F and D (all regular-season box scores)
function gsRates() {
  if (GSR?.data === D) return GSR;
  const cols = D.teamPlayerCols || [], t = { F: {}, D: {} };
  Object.values(D.teamPlayers || {}).forEach(teams => Object.values(teams).forEach(m => (m.R || []).forEach(row => {
    const x = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    if (x.pos === "G" || !x.toi) return;
    const s = t[/D/.test(x.pos || "") ? "D" : "F"];
    ["g", "a", "st", "blk", "pim", "toi"].forEach(k => { s[k] = (s[k] || 0) + (x[k] || 0); });
  })));
  const per = s => s.toi ? { prod: (0.75 * s.g + 0.625 * s.a) / s.toi, shots: 0.075 * s.st / s.toi, blk: 0.05 * s.blk / s.toi, pen: 0.15 * (s.pim / 2) / s.toi }
    : { prod: 0, shots: 0, blk: 0, pen: 0 };
  GSR = { data: D, F: per(t.F), D: per(t.D) };
  return GSR;
}
function gameScores(g, side) {
  const lines = g.pl.filter(x => x[0] === side && (x[3] !== "G" || x[11] > 0));
  const sur = x => String(x[2]).split(" ").pop();
  const a1 = {};
  (g.gl || []).filter(x => x[2] === side).forEach(x => {
    const hit = x[5] ? lines.filter(y => sur(y) === x[5] || String(y[2]).endsWith(" " + x[5])) : [];
    if (hit.length === 1) a1[hit[0][1]] = (a1[hit[0][1]] || 0) + 1;
  });
  const R = gsRates(), svAvg = teamTable(seasonOfDay(g.d))?.avg?.sv_pct || 0.905;
  return lines.map(x => {
    const parts = {}, toi = x[11] || 0, grp = x[3] === "G" ? "G" : /D/.test(x[3] || "") ? "D" : "F";
    if (grp === "G") {
      const q = goalieGame(g, x);
      // one net bar: green when he beat an average goalie (league save %) on the shots he faced, red when he didn't
      if (q.sa != null) { const net = 0.75 * (q.sa * (1 - svAvg) - q.ga); parts[net >= 0 ? "save" : "ga"] = net; }
      return { x, parts, total: Object.values(parts).reduce((s, v) => s + v, 0), grp, q };
    } else {
      const r = R[grp], A = x[5] || 0, A1 = Math.min(A, a1[x[1]] || 0), A2 = A - A1;
      parts.prod = 0.75 * (x[4] || 0) + 0.7 * A1 + 0.55 * A2 - r.prod * toi;
      parts.shots = 0.075 * (x[8] || 0) - r.shots * toi;
      parts.ice = 0.15 * (x[7] || 0);
      parts.blk = 0.05 * (x[14] || 0) - r.blk * toi;
      parts.pen = r.pen * toi - 0.15 * Math.floor((x[10] || 0) / 2);
    }
    const total = Object.values(parts).reduce((s, v) => s + v, 0);
    return { x, parts, total, grp };
  });
}
/* One PNG of the game: both teams' Game Score cards side by side under the score (same html2canvas route as the
   player card's export). The sheet is built off-screen from copies of the two cards, then removed. */
function exportGameScore(btn) {
  const cards = [...btn.closest(".boxscore").querySelectorAll(".gs-card")];
  if (!cards.length) return;
  if (!window.html2canvas) { alert("PNG export needs an internet connection (html2canvas loads from cdnjs)."); return; }
  const sheet = document.createElement("div");
  sheet.className = "gs-sheet";
  // data-head is plain text (club names, the game's competition line): dataset decodes the attribute, so escape it again
  sheet.innerHTML = `<div class="gs-sheet-head">${esc(btn.dataset.head)}</div><div class="gs-sheet-cards"></div>`;
  cards.forEach(c => { const k = c.cloneNode(true); k.hidden = false; sheet.querySelector(".gs-sheet-cards").appendChild(k); });
  document.body.appendChild(sheet);
  html2canvas(sheet, { scale: 2, backgroundColor: css("--page"), windowWidth: 1900 }).then(canvas => {
    const a = document.createElement("a");
    a.download = btn.dataset.file + ".png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  }).catch(e => alert("PNG export failed: " + e.message)).finally(() => sheet.remove());
}
// box-score controls, wired here rather than as inline onclick / onchange attributes (the Content-Security-Policy in _headers
// allows no inline script): the PNG button, and the two Team selects that switch every side-specific block together
view.addEventListener("click", e => { const b = e.target.closest(".boxscore .gs-export"); if (b) exportGameScore(b); });
view.addEventListener("change", e => {
  const sel = e.target.closest?.(".boxscore select.bx-team");
  if (!sel) return;
  const b = sel.closest(".boxscore");
  b.querySelectorAll("select.bx-team").forEach(s => (s.value = sel.value));
  b.querySelectorAll("[data-side]").forEach(s => (s.hidden = s.dataset.side !== sel.value));
});
function gameScoreCard(g, side) {
  const rows = gameScores(g, side), club = side === "home" ? g.h : g.a, opp = side === "home" ? g.a : g.h;
  if (!rows.length) return "";
  // the scale fits the skaters (and the goalies' net): a goalie's two big bars are cut at the edge, not shrinking everyone
  const reach = (r, sgn) => r.grp === "G" ? (sgn > 0 ? Math.max(0, r.total) : Math.min(0, r.total))
    : Object.values(r.parts).filter(v => sgn > 0 ? v > 0 : v < 0).reduce((s, v) => s + v, 0);
  const lo = Math.min(-1, ...rows.map(r => reach(r, -1))) - 0.25, hi = Math.max(2, ...rows.map(r => reach(r, 1))) + 0.25;
  const span = hi - lo, pct = v => (100 * v / span).toFixed(2), zero = pct(-lo);
  const bar = r => {
    let pos = 0, neg = 0;
    const segs = GS_PARTS.map(([k, label, , color]) => {
      const v = r.parts[k];
      if (!v) return "";
      let from = v > 0 ? pos : neg + v, to = v > 0 ? pos + v : neg;
      if (v > 0) pos += v; else neg += v;
      const cut = from < lo || to > hi;
      from = Math.max(lo, from); to = Math.min(hi, to);
      return `<i class="${cut ? (v > 0 ? "cut-r" : "cut-l") : ""}" style="left:${pct(from - lo)}%;width:${pct(to - from)}%;background:${color}" title="${label}: ${signed(v, 2)}"></i>`;
    }).join("");
    return `<span class="gs-track"><b class="gs-zero" style="left:${zero}%"></b>${segs}</span>`;
  };
  const group = (grp, title) => {
    const rs = rows.filter(r => r.grp === grp).sort((p, q) => q.total - p.total);
    return rs.length ? `<div class="gs-group"><div class="gs-gh">${title}</div>${rs.map(r => `<div class="gs-row">
      <span class="gs-name">${hasPage(r.x[1]) ? `<a href="${route(r.x[1])}">${esc(r.x[2])}</a>` : esc(r.x[2])}${r.q?.sa != null ? `<small class="gs-sub">${Math.round(r.q.ga)} GA on ${Math.round(r.q.sa)} shots</small>` : ""}</span>
      <span class="gs-val">${r.total.toFixed(2)}</span><span class="gs-grade g${gsGrade(r.total)}">${gsGrade(r.total)}</span>${bar(r)}</div>`).join("")}</div>` : "";
  };
  const gf = side === "home" ? g.hg : g.ag, ga = side === "home" ? g.ag : g.hg;
  const ticks = [];
  for (let t = Math.ceil(lo); t <= Math.floor(hi); t++) ticks.push(`<span style="left:${pct(t - lo)}%">${t}</span>`);
  return `<section class="card-box gs-card" data-side="${side}" data-file="${esc(`Game Score ${club} ${g.d}`.replace(/[^\w\- ]+/g, ""))}">
    <div class="gs-head">${tlink(club, logo(club, 56))}<div><h2 class="flat">${tlink(club)}</h2>
      <p class="sub">${tname(g.a)} @ ${tname(g.h)} · ${fmtDate(g.d)} · ${gf ?? "–"}–${ga ?? "–"} ${gf > ga ? "win" : gf < ga ? "loss" : ""} vs ${tname(opp)}</p></div>
      <div class="gs-title">Game Score breakdown</div></div>
    ${group("F", "Forwards")}${group("D", "Defence")}${group("G", "Goalies")}
    <div class="gs-row gs-axis"><span></span><span></span><span></span><span class="gs-ticks">${ticks.join("")}</span></div>
    <div class="gs-legend">${GS_PARTS.map(([, label, what, color]) => `<span><i style="background:${color}"></i><b>${label}</b> <small>${what}</small></span>`).join("")}</div>
    <p class="sub">Each part is compared with an average forward or defenceman playing the same minutes, so 0 is an average game and a quiet one is negative.
      Goalies: goals saved above an average goalie on the shots he faced (league save %), green when better, red when worse. Grades: A ≥ 1.31 · B 0.16 to 1.31 · C −0.92 to 0.16 ·
      D −2.72 to −0.92 · F below. After Dom Luszczyszyn's Game Score, from the parts a box score holds (on-ice shot share, faceoffs, penalties drawn and
      usage aren't recorded per player).</p></section>`;
}
/* One game's box score (playoff pages and the team Results tab): line score with OT / shootout, goals, team stats,
   both teams' player lines. g = a box score from build_data.playoff_games. */
function gameBox(g, focus = "away") {   // focus: whose player stats show first (the dropdown switches)
  const periods = (g.c.match(/\(([^)]*)\)/)?.[1] || "").split(", ").filter(Boolean).map(x => x.split("-"));
  const pname = k => k < 3 ? ["1st", "2nd", "3rd"][k] : k === 3 ? "OT" : `${k - 2}OT`;
  const so = g.c.match(/SO (\d+)-(\d+)/);   // shootout: home-away
  const statRows = Object.entries(g.ts || {}).filter(([, v]) => v[0] != null || v[1] != null);
  // player line: [side, key, name, pos, G, A, P, +/-, SOG, shots, PIM, TOI, rating, shifts, blocks, PPG, SHG, ixG, SA, GA, xGA]
  const v = (x, k, f = n => n) => x[k] == null ? dash : f(x[k]);
  const nameCell = x => `<th scope="row" class="pcol">${hasPage(x[1]) ? `<a href="${route(x[1])}">${esc(x[2])}</a>` : esc(x[2])}</th>`;
  const rowAttr = x => hasPage(x[1]) ? ` class="link" data-k="${esc(x[1])}"` : "";
  const players = side => {
    const club = side === "home" ? g.h : g.a, rows = g.pl.filter(x => x[0] === side);
    const sk = rows.filter(x => x[3] !== "G"), gk = rows.filter(x => x[3] === "G" && x[11] > 0);
    const skTable = `<table class="rank sortable"><thead><tr><th class="pcol">Player</th><th>Pos</th><th class="num">G</th><th class="num">A</th><th class="num">P</th>
        <th class="num">+/−</th><th class="num" title="Shots on goal">SOG</th><th class="num" title="Shot attempts">Shots</th><th class="num" title="Shots blocked (play-by-play)">Blk</th>
        <th class="num" title="Power-play goals">PPG</th><th class="num" title="Short-handed goals">SHG</th><th class="num" title="Expected goals of his charted shots">ixG</th>
        <th class="num">PIM</th><th class="num">TOI</th><th class="num">Shifts</th><th class="num">Rating</th></tr></thead><tbody>
      ${sk.map(x => `<tr${rowAttr(x)}>${nameCell(x)}<td>${esc(x[3] || "")}</td><td class="num">${v(x, 4)}</td><td class="num">${v(x, 5)}</td><td class="num"><b>${v(x, 6)}</b></td>
        <td class="num">${v(x, 7, n => (n > 0 ? "+" + n : n))}</td><td class="num">${v(x, 8)}</td><td class="num">${v(x, 9)}</td><td class="num">${v(x, 14)}</td>
        <td class="num">${v(x, 15)}</td><td class="num">${v(x, 16)}</td><td class="num">${v(x, 17, n => n.toFixed(2))}</td><td class="num">${v(x, 10)}</td>
        <td class="num">${v(x, 11, n => rawFmt("toi_gp", n))}</td><td class="num">${v(x, 13)}</td><td class="num">${v(x, 12)}</td></tr>`).join("")}</tbody></table>`;
    const gTable = gk.length ? `<table class="rank sortable"><thead><tr><th class="pcol">Goalie</th><th class="num" title="Shots against">SA</th><th class="num">Saves</th>
        <th class="num">GA</th><th class="num">SV%</th><th class="num" title="Post-shot expected goals faced">xGA</th><th class="num" title="Goals saved above expected">GSAx</th>
        <th class="num">TOI</th><th class="num">Rating</th></tr></thead><tbody>
      ${gk.map(x => { const q = goalieGame(g, x), r1 = n => Math.round(n);
        return `<tr${rowAttr(x)}>${nameCell(x)}<td class="num">${q.sa == null ? dash : r1(q.sa)}</td><td class="num">${q.sa == null ? dash : r1(q.sa - q.ga)}</td>
        <td class="num">${q.ga == null ? dash : r1(q.ga)}</td><td class="num">${q.sa ? (1 - q.ga / q.sa).toFixed(3).replace(/^0/, "") : dash}</td>
        <td class="num">${q.xga == null ? dash : q.xga.toFixed(2)}</td><td class="num">${q.xga == null || x[19] == null ? dash : signed(q.xga - x[19], 2)}</td>
        <td class="num">${v(x, 11, n => rawFmt("toi_gp", n))}</td><td class="num">${v(x, 12)}</td></tr>`; }).join("")}</tbody></table>` : "";
    return `<section class="card-box flush" data-side="${side}" ${side === focus ? "" : "hidden"}><h3 class="box-h">${tlink(club, `${logo(club, 24)} ${esc(club)}`)}</h3><div class="tablewrap">${skTable}</div>
      ${gTable ? `<div class="tablewrap">${gTable}</div>` : ""}</section>`;
  };
  const gsCards = ["away", "home"].map(s => gameScoreCard(g, s).replace(`data-side="${s}"`, `data-side="${s}" ${s === focus ? "" : "hidden"}`)).join("");
  return `<div class="boxscore">

    <section class="card-box"><div class="scoreline">
      <div>${tlink(g.a, logo(g.a, 56))}<b>${tlink(g.a)}</b><small>Away</small></div><div class="sc">${g.ag ?? "–"} – ${g.hg ?? "–"}${so ? `<small>shootout ${so[2]}–${so[1]}</small>` : ""}</div><div>${tlink(g.h, logo(g.h, 56))}<b>${tlink(g.h)}</b><small>Home</small></div></div>
      <p class="sub center">${esc(g.c.replace(/\s*\(.*$/, ""))} · ${fmtDate(g.d)}${g.v ? " · " + esc(g.v) : ""}</p>
      ${periods.length ? `<div class="tablewrap"><table class="fit center-table"><thead><tr><th></th>${periods.map((_, k) => `<th class="num">${pname(k)}</th>`).join("")}${so ? '<th class="num">SO</th>' : ""}<th class="num">T</th></tr></thead><tbody>
        <tr><th scope="row">${tname(g.a)}</th>${periods.map(x => `<td class="num">${x[0]}</td>`).join("")}${so ? `<td class="num">${so[2]}</td>` : ""}<td class="num"><b>${g.ag ?? ""}</b></td></tr>
        <tr><th scope="row">${tname(g.h)}</th>${periods.map(x => `<td class="num">${x[1]}</td>`).join("")}${so ? `<td class="num">${so[1]}</td>` : ""}<td class="num"><b>${g.hg ?? ""}</b></td></tr></tbody></table></div>` : ""}</section>

    <div class="row">
      <section class="card-box" aria-label="Goals"><h3 class="box-h3">Goals</h3>
        ${g.gl.length ? `<ul class="plain">${g.gl.map(x => { const [mm] = String(x[0]).split(":"); const per = Math.floor(+mm / 20);
          // assists are surnames only: link one when exactly one player line of the scoring side matches (as gameScores does)
          const assist = n => { const hit = n ? g.pl.filter(y => y[0] === x[2] && (String(y[2]).split(" ").pop() === n || String(y[2]).endsWith(" " + n))) : [];
            return hit.length === 1 && hasPage(hit[0][1]) ? `<a href="${route(hit[0][1])}">${esc(n)}</a>` : esc(n); };
          return `<li><span class="muted small">${pname(per)} ${String(Math.floor(+mm % 20)).padStart(2, "0")}:${String(x[0]).split(":")[1] || "00"}</span>
            ${x[2] ? teamLogo(x[2] === "home" ? g.h : g.a, 18) : ""} <b>${hasPage(x[4]) ? `<a href="${route(x[4])}">${esc(x[3])}</a>` : esc(x[3])}</b>
            ${x[5] ? `<span class="muted small">(${assist(x[5])}${x[6] ? ", " + assist(x[6]) : ""})</span>` : `<span class="muted small">(unassisted)</span>`}
            ${x[7] ? `<span class="chip">${esc(x[7])}</span>` : ""} <span class="muted small">${esc(String(x[1]).replace("-", "–"))}</span></li>`; }).join("")}</ul>`
          : `<p class="muted small">No goal log for this game.</p>`}</section>
      <section class="card-box flush" aria-label="Team stats"><h3 class="box-h">Team stats</h3><div class="tablewrap"><table><thead><tr><th>${tname(g.a)}</th><th class="center"></th><th class="num">${tname(g.h)}</th></tr></thead><tbody>
        ${statRows.map(([k, v]) => `<tr><td><b>${v[1] ?? "–"}</b></td><td class="center muted small">${esc(k)}</td><td class="num"><b>${v[0] ?? "–"}</b></td></tr>`).join("") || `<tr><td colspan="3" class="muted small">Not captured.</td></tr>`}
      </tbody></table></div></section>
    </div>
    ${gsCards ? `<div class="cardbar"><h2 class="flat">Game Score</h2><button class="btn gs-export" type="button" data-file="${esc(`Game Score ${g.a} at ${g.h} ${g.d}`.replace(/[^\w\- ]+/g, ""))}"
      data-head="${esc(`${g.a} ${g.ag ?? ""} – ${g.hg ?? ""} ${g.h} · ${fmtDate(g.d)}${g.c ? " · " + g.c.replace(/\s*\(.*$/, "") : ""}`)}">Download both cards as PNG</button><label class="inline">Team <select class="bx-team">
      ${[["away", g.a], ["home", g.h]].map(([s, c]) => `<option value="${s}" ${s === focus ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>${gsCards}` : ""}
    <div class="cardbar"><h2 class="flat">Player stats</h2><label class="inline">Team <select class="bx-team">
      ${[["away", g.a], ["home", g.h]].map(([s, c]) => `<option value="${s}" ${s === focus ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>
    ${players("away")}${players("home")}
    <p class="small muted">Blk = shots blocked, credited from the play-by-play. ixG, xGA and GSAx come from the shot chart (blank when the game has none);
      a goalie who played the whole game gets the box score's official shots and goals against. Takeaways, giveaways, hits and faceoffs only exist as team totals (Team stats above).</p></div>`;
}
const PO_GROUPS = [["all", "Skaters"], ["F", "Forwards"], ["D", "Defence"], ["G", "Goalies"]];
let PO_GROUP = "all";
function leadersHtml(season, full) {
  PO_GROUP = PO_GROUPS.some(g => g[0] === full) ? full : "all";
  const cols = D.teamPlayerCols || [], by = {}, SUM = ["gp", "g", "a", "p", "pm", "pim", "st", "toi", "blk", "ppg"];
  Object.entries(D.teamPlayers?.[season] || {}).forEach(([abbr, m]) => (m.P || []).forEach(row => {
    const x = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
    const t = (by[x.k] ||= { k: x.k, n: x.n, pos: x.pos, clubs: [], ...Object.fromEntries(SUM.map(c => [c, 0])) });
    SUM.forEach(c => { t[c] += x[c] || 0; });   // a player traded at the deadline can have lines with two clubs
    t.clubs.push(clubOfAbbr(abbr));
  }));
  // position group: the player's card group (F / D / G), else his box-score position
  const grpOf = x => byKey.get(x.k)?.grp || (x.pos === "G" ? "G" : /D/.test(x.pos || "") ? "D" : "F");
  const all = Object.values(by).filter(x => x.gp > 0);
  const sk = all.filter(x => grpOf(x) !== "G" && (PO_GROUP === "all" || grpOf(x) === PO_GROUP)).sort((p, q) => q.p - p.p || q.g - p.g);
  const gk = all.filter(x => grpOf(x) === "G").sort((p, q) => q.gp - p.gp);
  const pwar = k => { const pl = byKey.get(k); const w = pl && (season === SEASONS.at(-1) ? pl.po?.war : pl.ss?.[season]?.po?.war); return w ? w.war : null; };
  const pcard = k => { const pl = byKey.get(k); return pl && (season === SEASONS.at(-1) ? pl.po?.card : pl.ss?.[season]?.po?.card); };
  const name = x => hasPage(x.k) ? `<a href="${route(x.k)}">${esc(x.n)}</a>` : esc(x.n);
  if (!all.length) return `<p class="muted">No playoff box scores for this season.</p>`;
  if (!PO_GROUPS.some(g => g[0] === full)) return leaderBoards(season, all, grpOf, pwar, pcard);
  const seg = `<p><a href="#/playoffs/${season}/leaders">← All leaders</a></p>`;
  const skTitle = { all: "Skaters", F: "Forwards", D: "Defence", G: "Goalies" }[PO_GROUP];
  return `${seg}
    ${PO_GROUP !== "G" ? `<section class="card-box flush" aria-label="Playoff ${skTitle}"><h2 class="box-h">${skTitle} <span class="muted">${sk.length}</span></h2><div class="tablewrap"><table class="rank sortable">
      <thead><tr><th class="num" data-nosort>#</th><th class="pcol">Player</th><th>Team</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num" aria-sort="descending">P</th><th class="num">+/−</th>
        <th class="num">PPG</th><th class="num">PIM</th><th class="num">SOG</th><th class="num">Blk</th><th class="num">TOI/GP</th><th class="num">WAR</th></tr></thead><tbody>
      ${sk.map((x, i) => `<tr class="link" data-k="${esc(x.k)}"><td class="num">${i + 1}</td><th scope="row" class="pcol">${name(x)}</th><td class="nowrap">${x.clubs.map(c => tlink(c, `${logo(c, 20)} ${tabbr(c)}`)).join(" / ")}</td>
        <td class="num">${x.gp}</td><td class="num">${x.g}</td><td class="num">${x.a}</td><td class="num"><b>${x.p}</b></td><td class="num">${x.pm > 0 ? "+" : ""}${x.pm}</td><td class="num">${x.ppg}</td>
        <td class="num">${x.pim}</td><td class="num">${x.st}</td><td class="num">${x.blk}</td><td class="num" data-v="${x.gp ? x.toi / x.gp : ""}">${x.gp ? rawFmt("toi_gp", x.toi / x.gp) : dash}</td>
        <td class="num">${pwar(x.k) == null ? dash : pwar(x.k).toFixed(1)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
    ${gk.length && PO_GROUP === "G" ? `<section class="card-box flush" aria-label="Playoff goalies"><h2 class="box-h">Goalies</h2><div class="tablewrap"><table class="rank sortable">
      <thead><tr><th class="pcol">Goalie</th><th>Team</th><th class="num" aria-sort="descending">GP</th><th class="num">TOI</th><th class="num">SV% (charted)</th><th class="num">GSAx</th><th class="num">WAR</th></tr></thead><tbody>
      ${gk.map(x => { const c = pcard(x.k); return `<tr class="link" data-k="${esc(x.k)}"><th scope="row" class="pcol">${name(x)}</th><td class="nowrap">${x.clubs.map(c => tlink(c, `${logo(c, 20)} ${tabbr(c)}`)).join(" / ")}</td><td class="num">${x.gp}</td><td class="num">${Math.round(x.toi)}</td>
        <td class="num">${c?.raw?.svp != null ? c.raw.svp.toFixed(3).replace(/^0/, "") : dash}</td><td class="num">${c?.raw?.gsax != null ? c.raw.gsax.toFixed(1) : dash}</td>
        <td class="num">${pwar(x.k) == null ? dash : pwar(x.k).toFixed(1)}</td></tr>`; }).join("")}</tbody></table></div></section>` : ""}
    <p class="small muted">Playoff games in this save's box scores (some games missing, see the bracket). Click a header to sort.</p>`;
}
/* Team Results tab (#/team/<club>/results[/<season>[/<game index>]]): the club's game log for a season from
   data/games_<season>.js (loaded on demand: every box score would double the main data file), each game opening the
   same box-score screen as the playoffs. */
const GAMES_LOADING = {};
function loadGames(season) {
  window.EHM_GAMES ||= {};
  if (window.EHM_GAMES[season]) return Promise.resolve(window.EHM_GAMES[season]);
  return (GAMES_LOADING[season] ||= new Promise(resolve => {
    const s = document.createElement("script");
    const base = [...document.scripts].map(x => x.getAttribute("src") || "").find(x => /ehm_data(_\d+)?\.js$/.test(x));
    s.src = (base ? base.replace(/ehm_data(_\d+)?\.js$/, "") : "data/") + `games_${season}.js`;
    s.onload = () => resolve(window.EHM_GAMES[season] || []);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  }));
}
function gameResult(g, club) {   // [W / L / OTL / SOW / SOL / OTW, goals for, against]
  const home = g.h === club, gf = home ? g.hg : g.ag, ga = home ? g.ag : g.hg;
  if (gf == null || ga == null) return ["", gf, ga];
  const so = g.c.match(/SO (\d+)-(\d+)/), ot = (g.c.match(/\(([^)]*)\)/)?.[1].split(",").length || 3) > 3;
  if (so) { const w = home ? +so[1] > +so[2] : +so[2] > +so[1]; return [w ? "SOW" : "SOL", gf, ga]; }
  if (gf > ga) return [ot ? "OTW" : "W", gf, ga];
  return [ot && g.t === "R" ? "OTL" : "L", gf, ga];
}
function teamResultsTab(club, season, gi) {
  const abbr = abbrOf(club), seasons = SEASONS.filter(s => D.teamPlayers?.[s]?.[abbr]);
  if (!seasons.includes(season)) season = seasons.includes(SEASON) ? SEASON : seasons.at(-1);
  setTimeout(() => loadGames(season).then(list => {
    const box = view.querySelector("#results-body");
    if (!box || box.dataset.season !== season) return;
    box.innerHTML = list ? resultsBody(club, season, list, gi) : `<p class="muted">Box scores for ${seasonLabel(season)} aren't in this build (rebuild the site).</p>`;
    bindResults(club, season);
  }), 0);
  return `<div class="cardbar"><div><h2 class="flat">${seasonLabel(season)} results</h2><p class="sub">Every game in this save's box scores. Click a game for its box score.</p></div>
      ${seasons.length > 1 ? `<label class="inline">Season <select id="rs-season">${seasons.slice().reverse().map(s => `<option value="${s}" ${s === season ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>` : ""}</div>
    <div id="results-body" data-season="${season}"><p class="muted">Loading the ${seasonLabel(season)} box scores…</p></div>`;
}
function resultsBody(club, season, list, gi) {
  const mine = list.map((g, i) => ({ ...g, i })).filter(g => g.h === club || g.a === club);
  const base = `${teamRoute(club)}/results/${season}`;
  if (gi != null && gi !== "") {
    const k = mine.findIndex(g => g.i === +gi), g = mine[k];
    if (!g) return `<p class="muted">Unknown game. <a href="${base}">All results</a></p>`;
    const [res, gf, ga] = gameResult(g, club), prev = mine[k - 1], next = mine[k + 1];
    return `<p class="yearnav"><a class="ghost${prev ? "" : " disabled"}" ${prev ? `href="${base}/${prev.i}"` : 'aria-disabled="true"'}>← Previous game</a>
        <a class="ghost" href="${base}">All results</a>
        <a class="ghost${next ? "" : " disabled"}" ${next ? `href="${base}/${next.i}"` : 'aria-disabled="true"'}>Next game →</a>
        <span class="muted small">${esc(club)}: <b>${res}</b> ${gf}–${ga}</span></p>${gameBox(g, g.h === club ? "home" : "away")}`;
  }
  let w = 0, l = 0, o = 0;
  const rows = mine.map(g => {
    const home = g.h === club, opp = home ? g.a : g.h, [res, gf, ga] = gameResult(g, club);
    if (g.t === "R") { if (/W/.test(res)) w++; else if (res === "OTL" || res === "SOL") o++; else if (res) l++; }
    const sog = g.ts?.["Shots On Goal"], pp = g.ts?.["Powerplay"];
    const top = g.pl.filter(x => x[0] === (home ? "home" : "away")).sort((x, y) => (y[6] || 0) - (x[6] || 0) || (y[4] || 0) - (x[4] || 0))[0];
    // the date is the game's link (keyboard and middle click); the rest of the row opens it too
    return `<tr class="glink" data-g="${g.i}"><td class="nowrap" data-v="${g.d}"><a href="${teamRoute(club)}/results/${season}/${g.i}" title="Box score">${fmtDate(g.d)}</a></td><td>${g.t === "P" ? '<span class="chip">Playoffs</span>' : ""}</td>
      <td class="nowrap">${home ? "vs" : "@"} ${tlink(opp, `${logo(opp, 20)} ${esc(opp)}`)}</td>
      <td class="${/W/.test(res) ? "up" : res ? "down" : ""}"><b>${res}</b></td><td class="num" data-v="${gf - ga}">${gf ?? "–"}–${ga ?? "–"}</td>
      <td class="num" data-v="${sog?.[home ? 0 : 1] ?? ""}">${sog ? `${sog[home ? 0 : 1] ?? "–"}–${sog[home ? 1 : 0] ?? "–"}` : dash}</td>
      <td class="num">${pp?.[home ? 0 : 1] ?? dash}</td><td class="nowrap">${w}–${l}–${o}</td>
      <td class="small">${top && top[6] ? `${hasPage(top[1]) ? `<a href="${route(top[1])}">${esc(top[2])}</a>` : esc(top[2])} ${top[4]}G ${top[5]}A` : dash}</td></tr>`;
  });
  return `<section class="card-box flush" aria-label="Game log"><div class="tablewrap"><table class="rank sortable"><thead><tr><th>Date</th><th></th><th>Opponent</th><th>Result</th>
      <th class="num">Score</th><th class="num">SOG</th><th class="num">PP</th><th data-nosort>Record</th><th>Top scorer</th></tr></thead><tbody>${rows.join("")
      || `<tr><td colspan="9" class="muted small">No games captured.</td></tr>`}</tbody></table></div>
    <p class="sub pad">Score and shots: ${esc(club)} first. Record = regular-season W–L–OTL after that game (counting the games captured). OTL / SOL = overtime / shootout loss.
      EHM keeps other teams' box scores ~44 days and the crawl reads two months, so about 2% of games are missing.</p></section>`;
}
function bindResults(club, season) {
  view.querySelectorAll("tr.glink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = `${teamRoute(club)}/results/${season}/${tr.dataset.g}`; });
  view.querySelectorAll("#results-body tr.link[data-k]").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  makeSortable(view.querySelector("#results-body"));
}
/* A series' top scorers and its goalies, from the captured games of the series. A box score doesn't say which goalie
   faced which shot, so each side's shots and goals against are shared between its goalies by time on ice. */
function seriesStats(gs) {
  const sk = {}, gk = {}, add = (t, k, v) => { if (v != null) t[k] = (t[k] || 0) + v; };
  gs.forEach(g => {
    const side = s => (s === "home" ? g.h : g.a);
    const shots = g.ts?.["Shots On Goal"] || [];
    const goals = { home: g.hg, away: g.ag }, won = { home: g.hg > g.ag, away: g.ag > g.hg };
    ["home", "away"].forEach(sd => {
      const opp = sd === "home" ? "away" : "home", lines = g.pl.filter(x => x[0] === sd);
      const goalies = lines.filter(x => x[3] === "G" && x[11] > 0), gToi = goalies.reduce((s, x) => s + x[11], 0);
      lines.filter(x => x[3] !== "G").forEach(x => {
        const t = (sk[x[1]] ||= { k: x[1], n: x[2], pos: x[3], club: side(sd), gp: 0 });
        t.gp++;
        [["g", 4], ["a", 5], ["p", 6], ["pm", 7], ["st", 8], ["s", 9], ["pim", 10], ["toi", 11], ["blk", 14], ["ppg", 15], ["shg", 16], ["ixg", 17]]
          .forEach(([k, i]) => add(t, k, x[i] ?? (["g", "a", "p"].includes(k) ? 0 : null)));
      });
      const starter = goalies.slice().sort((p, q) => q[11] - p[11])[0];
      goalies.forEach(x => {
        const share = gToi ? x[11] / gToi : 0, t = (gk[x[1]] ||= { k: x[1], n: x[2], club: side(sd), gp: 0, w: 0, l: 0, toi: 0, ga: 0, sa: 0 });
        t.gp++; t.toi += x[11];
        // shots and goals against: his own charted numbers when the game has a chart, else the side's, shared by minutes
        const q = goalieGame(g, x);
        t.ga += q.ga || 0; t.sa += q.sa || 0;
        if (q.xga != null && x[19] != null) { add(t, "xga", q.xga); add(t, "cga", x[19]); }   // GSAx: charted goals vs charted xG
        if (x === starter) { if (won[sd]) t.w++; else t.l++; }   // the decision goes to the goalie with the most minutes
      });
    });
  });
  const svOf = x => (x.sa ? 1 - x.ga / x.sa : -1);
  return { sk: Object.values(sk).sort((p, q) => q.p - p.p || q.g - p.g), gk: Object.values(gk).sort((p, q) => svOf(q) - svOf(p) || q.toi - p.toi) };
}
const sname = x => hasPage(x.k) ? `<a href="${route(x.k)}">${esc(x.n)}</a>` : esc(x.n);
const tabbr = c => esc(NHL_TEAMS[c]?.[0] || c);
/* A series' top scorers and its goalies (the full list opens from the Points board). */
/* Compact one-line rows, as many as fit next to the series card (it grows with the games captured); allHref = the
   "all players" link, shown only on a single series' page. */
function seriesBoards(gs, allHref) {
  const { sk, gk } = seriesStats(gs);
  // room next to the card grows with its games; points get it first: a 3rd goalie only once 5 scorers fit with space left
  const nPts = Math.max(2, Math.min(5, gs.length)), nG = Math.min(gs.length >= 7 ? 3 : 2, gk.length);
  const li = (x, i, right, sub) => `<li><span class="lbn">${i + 1}</span>${teamLogo(x.club, 18)}<span class="lbp">${sname(x)} <small>${sub}</small></span><b>${right}</b></li>`;
  return `<section class="card-box lboard compact" aria-label="Series points"><h3 class="box-h3">Points</h3>
      ${sk.length ? `<ol class="lb">${sk.slice(0, nPts).map((x, i) => li(x, i, x.p, `${tlink(x.club, tabbr(x.club))} · ${x.g}G ${x.a}A`)).join("")}</ol>` : `<p class="muted small">No games captured.</p>`}
      ${sk.length && allHref ? `<a class="more-link" href="${allHref}">All players in this series →</a>` : ""}</section>
    <section class="card-box lboard compact" aria-label="Series goalies"><h3 class="box-h3">Goalies <span class="muted small">SV% · record · GAA</span></h3>
      ${gk.length ? `<ol class="lb">${gk.slice(0, nG).map((x, i) => li(x, i, x.sa ? (1 - x.ga / x.sa).toFixed(3).replace(/^0/, "") : "–",
        `${tlink(x.club, tabbr(x.club))} · ${x.w}–${x.l} · ${x.toi ? (x.ga * 60 / x.toi).toFixed(2) : "–"}`)).join("")}</ol>` : `<p class="muted small">No games captured.</p>`}</section>`;
}
/* Every player of one series with all his stats in it. */
function seriesPlayersHtml(season, s, gs) {
  const { sk, gk } = seriesStats(gs);
  const d = (v, f = n => n) => v == null ? dash : f(v);
  return `<p><a href="#/playoffs/${season}/games/${s.sk}">← Back to the series</a></p>
    <section class="card-box flush" aria-label="Skaters"><h2 class="box-h">${teamLogo(s.x, 24)} ${tlink(s.x)} ${s.wx}–${s.wy} ${tlink(s.y)} ${teamLogo(s.y, 24)} <span class="muted">· skaters ${sk.length}</span></h2>
      <div class="tablewrap"><table class="rank sortable"><thead><tr><th class="pcol">Player</th><th>Team</th><th>Pos</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th>
        <th class="num" aria-sort="descending">P</th><th class="num">+/−</th><th class="num" title="Shots on goal">SOG</th><th class="num" title="Shot attempts">Shots</th><th class="num" title="Shots blocked">Blk</th>
        <th class="num">PPG</th><th class="num">SHG</th><th class="num" title="Expected goals of his charted shots">ixG</th><th class="num">PIM</th><th class="num">TOI/GP</th></tr></thead><tbody>
      ${sk.map(x => `<tr${hasPage(x.k) ? ` class="link" data-k="${esc(x.k)}"` : ""}><th scope="row" class="pcol">${sname(x)}</th><td class="nowrap">${tlink(x.club, `${logo(x.club, 20)} ${tabbr(x.club)}`)}</td><td>${esc(x.pos || "")}</td>
        <td class="num">${x.gp}</td><td class="num">${x.g}</td><td class="num">${x.a}</td><td class="num"><b>${x.p}</b></td><td class="num">${d(x.pm, n => (n > 0 ? "+" + n : n))}</td>
        <td class="num">${d(x.st)}</td><td class="num">${d(x.s)}</td><td class="num">${d(x.blk)}</td><td class="num">${d(x.ppg)}</td><td class="num">${d(x.shg)}</td>
        <td class="num">${d(x.ixg, n => n.toFixed(2))}</td><td class="num">${d(x.pim)}</td><td class="num" data-v="${x.toi ? x.toi / x.gp : ""}">${x.toi ? rawFmt("toi_gp", x.toi / x.gp) : dash}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card-box flush" aria-label="Goalies"><h2 class="box-h">Goalies</h2><div class="tablewrap"><table class="rank sortable"><thead><tr><th class="pcol">Goalie</th><th>Team</th>
        <th class="num">GP</th><th class="num">W–L</th><th class="num" title="On-target shots against">SA</th><th class="num">Saves</th><th class="num">GA</th><th class="num" aria-sort="descending">SV%</th>
        <th class="num">GAA</th><th class="num" title="Goals saved above expected (charted games)">GSAx</th><th class="num">TOI</th></tr></thead><tbody>
      ${gk.map(x => `<tr${hasPage(x.k) ? ` class="link" data-k="${esc(x.k)}"` : ""}><th scope="row" class="pcol">${sname(x)}</th><td class="nowrap">${tlink(x.club, `${logo(x.club, 20)} ${tabbr(x.club)}`)}</td>
        <td class="num">${x.gp}</td><td class="num" data-v="${x.w}">${x.w}–${x.l}</td><td class="num">${Math.round(x.sa)}</td><td class="num">${Math.round(x.sa - x.ga)}</td><td class="num">${Math.round(x.ga)}</td>
        <td class="num">${x.sa ? (1 - x.ga / x.sa).toFixed(3).replace(/^0/, "") : dash}</td><td class="num">${x.toi ? (x.ga * 60 / x.toi).toFixed(2) : dash}</td>
        <td class="num">${x.xga != null ? signed(x.xga - x.cga, 1) : dash}</td><td class="num">${Math.round(x.toi)}</td></tr>`).join("")}</tbody></table></div></section>
    <p class="small muted">From the series' captured box scores. Goalies: the box score's shots and goals against when he was his team's only goalie in a game;
      when two split a game, the shot chart's (or the team's, shared by minutes). GSAx compares charted goals with charted expected goals.</p>`;
}
/* The leaders dashboard: top-5 boards, each opening its full table. */
function leaderBoards(season, all, grpOf, pwar, pcard) {
  const sk = all.filter(x => grpOf(x) !== "G"), gk = all.filter(x => grpOf(x) === "G");
  const name = x => hasPage(x.k) ? `<a href="${route(x.k)}">${esc(x.n)}</a>` : esc(x.n);
  const board = (title, list, val, fmtv, full, sub) => {
    const rows = list.map(x => [x, val(x)]).filter(([, v]) => v != null).sort((p, q) => q[1] - p[1]).slice(0, 5);
    return `<section class="card-box lboard" aria-label="${esc(title)}"><h3 class="box-h3">${esc(title)}</h3>${sub ? `<p class="sub">${sub}</p>` : ""}
      ${rows.length ? `<ol class="lb">${rows.map(([x, v], i) => `<li><span class="lbn">${i + 1}</span>${teamLogo(x.clubs[0], 22)}<span class="lbp">${name(x)}<small>${x.clubs.map(c => tlink(c, tabbr(c))).join("/")} · ${x.gp} GP</small></span><b>${fmtv(v)}</b></li>`).join("")}</ol>`
        : `<p class="muted small">No one yet.</p>`}
      <a class="more-link" href="#/playoffs/${season}/leaders/${full}">Full list →</a></section>`;
  };
  const n = v => `${v}`, s1 = v => v.toFixed(1), pm = v => (v > 0 ? "+" : "") + v;
  const sv = v => v.toFixed(3).replace(/^0/, "");
  const regular = x => x.toi >= 240;   // save %: 4+ games' worth of minutes, so one good game doesn't lead
  return `<div class="row four lboards">
      ${board("Points", sk, x => x.p, n, "all")}
      ${board("Goals", sk, x => x.g, n, "all")}
      ${board("Assists", sk, x => x.a, n, "all")}
      ${board("Goalies · save %", gk.filter(regular), x => pcard(x.k)?.raw?.svp ?? null, sv, "G", "Charted shots, 240+ minutes")}
      ${board("Forwards · points", sk.filter(x => grpOf(x) === "F"), x => x.p, n, "F")}
      ${board("Defence · points", sk.filter(x => grpOf(x) === "D"), x => x.p, n, "D")}
      ${board("Skater WAR", sk, x => pwar(x.k), s1, "all")}
      ${board("Goalies · GSAx", gk, x => pcard(x.k)?.raw?.gsax ?? null, s1, "G", "Goals saved above expected")}
      ${board("Plus / minus", sk, x => x.pm, pm, "all")}
      ${board("Shots blocked", sk, x => x.blk, n, "all")}
      ${board("Power-play goals", sk, x => x.ppg, n, "all")}
      ${board("Goalies · WAR", gk, x => pwar(x.k), s1, "G", "Above replacement level")}
    </div>
    <p class="small muted">Playoff games in this save's box scores (some games missing, see the bracket). Ties are broken by list order.
      Goalie WAR compares with a replacement-level goalie; in the playoffs only about 25 goalies play, so replacement is set by the weakest
      quarter of them and even a below-average goalie can show a small positive WAR. For goalies, goals saved above expected is the fairer playoff measure.</p>`;
}
/* #/playoffs/<season>[/bracket|games[/<series>]|game/<i>|leaders[/<all|F|D|G>]] */
function renderPlayoffs(path) {
  markNav("playoffs");
  const [season0, tab0, arg, sub] = String(path || "").split("/");
  const seasons = playoffSeasons();
  if (!seasons.length) { view.innerHTML = `<div class="wrap page"><div class="panel">No playoff data yet. <a href="#/hof">Hall of Fame</a></div></div>`; return; }
  const season = seasons.includes(season0) ? season0 : seasons[0];
  const tab = tab0 === "game" ? "games" : PO_TABS.some(t => t[0] === tab0) ? tab0 : "bracket";
  const i = seasons.indexOf(season), older = seasons[i + 1], newer = seasons[i - 1];
  const B = bracketOf(season), champ = B.cup[0] || B.final?.win;
  const tabHref = t => `#/playoffs/${season}${t === "bracket" ? "" : "/" + t}`;
  const body = tab0 === "game" ? boxScoreHtml(season, arg) : tab === "games" ? gamesHtml(season, arg, sub) : tab === "leaders" ? leadersHtml(season, arg) : bracketHtml(season);
  view.innerHTML = `<section class="band"><div class="wrap"><div class="cardbar">${backLink()}<span></span></div>
      <h1>${seasonLabel(season)} playoffs</h1>
      <p class="lede">${champ ? `${teamLogo(champ, 28)} <b>${tlink(champ)}</b> won the Stanley Cup${B.cup[1] ? `, beating ${tlink(B.cup[1])} in the final` : ""}.` : "No champion yet."}</p>
      ${tabBar("Playoff sections", PO_TABS, tab, "data-ptab")}</div></section>
    <div class="wrap page">
      <div class="cardbar"><span></span><span class="inline yearnav"><a class="ghost${older ? "" : " disabled"}" ${older ? `href="#/playoffs/${older}${tab === "bracket" ? "" : "/" + tab}"` : 'aria-disabled="true"'}>← ${older ? seasonLabel(older) : ""}</a>
        <label class="inline">Season <select id="po-season">${seasons.map(s => `<option value="${s}" ${s === season ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>
        <a class="ghost${newer ? "" : " disabled"}" ${newer ? `href="#/playoffs/${newer}${tab === "bracket" ? "" : "/" + tab}"` : 'aria-disabled="true"'}>${newer ? seasonLabel(newer) : ""} →</a></span></div>
      ${body}</div>`;
  view.querySelector("#po-season").onchange = e => (location.hash = `#/playoffs/${e.target.value}${tab === "bracket" ? "" : "/" + tab}`);
  view.querySelectorAll("[data-ptab]").forEach(b => b.onclick = () => (location.hash = tabHref(b.dataset.ptab)));
  view.querySelectorAll("tr[data-g]").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = `#/playoffs/${season}/game/${tr.dataset.g}`; });
  view.querySelectorAll("tr.link[data-k]").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  makeSortable();
}
/* #/hof: the league Hall of Fame (record holders, honoured members, Cup champions, trophy winners);
   #/hof/<club or league>/<title id>: the full ranking behind a title. */
function renderHof(raw) {
  const [scope, id] = (raw || "").split("/").map(decodePart);
  const club = scope && scope !== "league" ? scope : null;
  markNav(club ? "teams" : "hof");
  if (club && !NHL_TEAMS[club]) { view.innerHTML = `<div class="wrap page"><div class="panel">Unknown club. <a href="#/hof">Hall of Fame</a></div></div>`; return; }
  if (club && !id) { location.replace(teamRoute(club) + "/hof"); return; }
  if (id) { renderHofRanking(club, id); return; }
  const cups = Object.entries(D.teamHist?.cups || {}).sort((a, b) => b[0].localeCompare(a[0]));
  const trophies = clubPeople(null).flatMap(r => r.trophies.map(a => [a, r])).sort((a, b) => b[0][0].localeCompare(a[0][0]));
  view.innerHTML = `<section class="band"><div class="wrap"><h1>Hall of Fame</h1>
      <p class="lede">League-wide record holders and the best careers of this save. Each club's own Hall of Fame is on its team page.</p></div></section>
    <div class="wrap page">${hofBody(null)}
      <div class="row">
        <section class="card-box" aria-labelledby="cup-h"><h2 id="cup-h">Stanley Cup champions</h2><p class="sub">Click a season for its playoff tree.</p>
          ${cups.length ? cups.map(([s, [w, l]]) => `<div class="lrow">${w ? teamLogo(w, 30) : ""}<span class="lmain"><b><a href="#/playoffs/${s}">${seasonLabel(s)}</a>: ${w ? `<a href="${teamRoute(w)}/history">${esc(w)}</a>` : "?"}</b>
            <small>${l ? `beat ${tname(l)} in the final` : ""}</small></span></div>`).join("") : `<p class="muted small">None in the achievement log yet.</p>`}</section>
        <section class="card-box" aria-labelledby="tw-h"><h2 id="tw-h">NHL trophy winners</h2>
          ${trophies.length ? `<ul class="plain">${trophies.map(([a, r]) => `<li>${achHref(a[0], a[2]) ? `<a class="small" href="${achHref(a[0], a[2])}" title="${seasonLabel(seasonOfDay(a[0]))} playoffs">${a[0].slice(0, 4)}</a>` : `<span class="muted small">${a[0].slice(0, 4)}</span>`} ${esc(achText(a[2]).replace(/^\d+\/\d+ /, "").replace(/^NHL /, ""))} · ${personLink(r.x)} <span class="muted small">${tname(a[1])}</span></li>`).join("")}</ul>`
            : `<p class="muted small">None in the achievement log yet.</p>`}</section>
      </div>${hofFoot(null)}</div>`;
}
function renderHofRanking(club, id) {
  const R = hofRanking(club, id);
  const back = `<a href="${club ? teamRoute(club) + "/hof" : "#/hof"}">← ${club ? esc(club) + " Hall of Fame" : "Hall of Fame"}</a>`;
  if (!R) { view.innerHTML = `<div class="wrap page"><div class="panel">Unknown title. ${back}</div></div>`; return; }
  const [, title, what, , f, , single] = R.t;
  view.innerHTML = `<section class="band"><div class="wrap"><div class="cardbar">${back}<span></span></div>
      <h1>${esc(title)}</h1><p class="lede">${esc(what)} ${club ? `for ${esc(club)}` : "in the NHL"} in this save · ${R.rows.length} ${single ? "seasons" : "players"}.</p></div></section>
    <div class="wrap page"><section class="card-box flush"><div class="tablewrap"><table class="rank"><thead><tr><th class="num">Rank</th><th class="pcol">Player</th><th>Pos</th>
      <th>${single ? "Season" : "Seasons"}</th><th>Now</th><th class="num">${single || id === "score" ? "Value" : esc(what.replace(/^Most /, "").replace(/^./, c => c.toUpperCase()))}</th></tr></thead><tbody>
      ${R.rows.map(x => `<tr${hasPage(x.r.x.k) ? ` class="link" data-k="${esc(x.r.x.k)}"` : ""}><td class="num">${x.rank}</td><th scope="row" class="pcol">${personLink(x.r.x)}</th><td>${esc(x.r.x.pos || "")}</td>
        <td class="small">${single ? seasonLabel(x.season) : x.r.seasons.length ? `${seasonLabel(x.r.seasons[0])}${x.r.seasons.length > 1 ? ` to ${seasonLabel(x.r.seasons.at(-1))}` : ""}` : ""}</td>
        <td class="small">${x.r.x.p ? tname(clubOf(x.r.x.p)) : '<span class="muted">left the data</span>'}</td><td class="num"><b>${f(x.v)}</b></td></tr>`).join("")
        || `<tr><td colspan="6" class="muted small">No one yet.</td></tr>`}</tbody></table></div></section></div>`;
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
}

// ---------------------------------------------------------------- rankings behind every rank / percentile
/* Every rank or percentile on the site links here (user rule: a ranked stat opens the whole ranking).
   #/rank/team/<stat>/<club>: all NHL teams on one team stat (season stats in SEASON, "pts" = standings, "pool" =
   prospect pool value). #/rank/p/<kind>/<key>/<F|D|G>/<player>: every player of that group on one card number,
   in the card's season and game type; kind m = rate stat, c = impact tile, g = attribute group, ca = est. CA, war = WAR/82. */
/* Rank links carry the season (and for players the regular season / playoffs choice) they were shown for, so a shared or
   bookmarked link opens the same list, not whatever season the site last had selected. */
const teamRankHref = (key, club, season = key === "pool" ? null : SEASON) => `#/rank/team/${key}/${encodeURIComponent(club)}${season ? "/" + season : ""}`;
const pRankHref = (kind, key, grp, k) => `#/rank/p/${kind}/${encodeURIComponent(key)}/${grp}/${encodeURIComponent(k)}`
  + (["m", "c", "war"].includes(kind) && SEASON ? `/${SEASON}/${PMODE}` : "");
const rankLink = (href, html) => `<a class="ranklink" href="${href}">${html}</a>`;
function cardOf(p0, kind) {   // the card the player page shows: season, then playoffs when PMODE is on (not for CA / attributes)
  const b = inSeason(p0);
  if (kind === "ca" || kind === "g" || PMODE !== "po") return b;
  return b.po ? { ...b, card: { ...b.po.card, ca_pct: b.card?.ca_pct }, war: b.po.war, _po: true } : null;
}
function teamRankRows(key) {
  if (key === "pool") {
    const rows = nhlClubs().map(c => ({ club: c, v: poolValue(listedBy(c)), txt: null })).sort((a, b) => b.v - a.v);
    rows.forEach((r, i) => { r.rank = i + 1; r.txt = fmt(r.v, 1); });
    return { rows, title: "Prospect pool value", sub: "Expected WAR per season at projected peak, summed over each club's Top Prospects list", seasonal: false };
  }
  const T = teamTable(SEASON);
  if (!T) return null;
  const label = Object.fromEntries((D.teamStatKeys || []).map(([k, l]) => [k, l]));
  const rows = Object.entries(T.teams).map(([abbr, r]) => {
    const club = clubOfAbbr(abbr);
    if (key === "pts") return { club, v: r.pts, rank: r.place, txt: `${r.pts}`, extra: `${r.w}–${r.l}–${r.otl} · ${r.gp} GP` };
    const s = r.stats[key];
    return s ? { club, v: s[0], rank: s[1], txt: statFmt(key, s[0]) } : null;
  }).filter(Boolean).sort((a, b) => a.rank - b.rank);
  if (!rows.length) return null;
  return { rows, title: key === "pts" ? "Standings points" : label[key] || key, seasonal: true,
           sub: `${seasonLabel(SEASON)} regular season · league average ${key === "pts" ? statFmt("pts", T.avg.pts) : statFmt(key, T.avg[key])} · 1st is best` };
}
function playerRankRows(kind, key, grp) {
  if (kind === "po") {
    const rows = playoffForms().map((x, i) => ({ p: x.p, pct: x.pct, ca: x.p.ca, rank: i + 1,
      txt: `${signed(x.f.delta, 2)} (playoffs ${x.f.po82.toFixed(1)} vs ${x.f.rs82.toFixed(1)}, ${x.f.gp} GP)` }));
    return { rows, title: "Playoff performer", ranked: true,
             sub: "Playoff WAR/82 minus the same seasons' regular-season WAR/82, recent seasons weighted more, pulled toward 0 for small samples · every player with NHL playoff games" };
  }
  const val = {
    m: p => p.card?.pct?.[key] == null ? null : [p.card.pct[key], rawFmt(key, p.card.raw?.[key])],
    c: p => p.card?.comp?.[key] == null ? null : [p.card.comp[key], null],
    g: p => { const g = (p.grpS || []).find(x => x[0] === key); return g ? [g[2], g[1].toFixed(1) + "/20"] : null; },
    ca: p => p.card?.ca_pct == null ? null : [p.card.ca_pct, fmt(p.ca, 0)],
    war: p => p.war?.pct == null ? null : [p.war.pct, `${p.war.war82.toFixed(1)} per 82 · ${p.war.war.toFixed(1)} in ${p.war.gp} GP`],
  }[kind];
  if (!val) return null;
  const rows = D.players.filter(p => p.grp === grp).map(p0 => {
    const p = cardOf(p0, kind), x = p && val(p);
    return x ? { p, pct: x[0], txt: x[1], ca: p.ca } : null;
  }).filter(Boolean).sort((a, b) => b.pct - a.pct || b.ca - a.ca);
  rows.forEach((r, i) => { r.rank = i && r.pct === rows[i - 1].pct ? rows[i - 1].rank : i + 1; });
  const metric = [...(D.skaterMetrics || []), ...(D.goalieMetrics || [])].find(m => m[0] === key);
  const title = { m: metric?.[1] || key, c: COMP_LABELS[key] || key, g: key, ca: "Est. current ability", war: "WAR per 82 GP" }[kind];
  const grpName = { F: "forwards", D: "defence", G: "goalies" }[grp];
  const games = kind === "ca" || kind === "g" ? "whole database" : `${SEASON ? seasonLabel(SEASON) : ""} ${PMODE === "po" ? "playoffs" : "regular season"}, NHL players with a big enough sample`;
  return { rows, title, sub: `Every ${grpName.replace(/s$/, "")} with a value · ${games} · percentile vs this list` };
}
function renderRank(raw) {
  // ["team", key, club, season?] or ["p", kind, key, grp, player, season?, rs|po?]
  const parts = raw.split("/").map(decodePart);
  const isTeam = parts[0] === "team";
  markNav(isTeam ? "teams" : "players");
  if (isTeam && SEASONS.includes(parts[3])) SEASON = parts[3];
  if (!isTeam && SEASONS.includes(parts[5])) SEASON = parts[5];
  if (!isTeam && ["rs", "po"].includes(parts[6])) PMODE = parts[6];
  const R = isTeam ? teamRankRows(parts[1]) : parts[0] === "p" ? playerRankRows(parts[1], parts[2], parts[3]) : null;
  if (!R || !R.rows.length) { view.innerHTML = `<div class="wrap page"><div class="panel">No ranking here. <a href="#/teams">Teams</a> · <a href="#/players">Players</a></div></div>`; return; }
  const me = isTeam ? parts[2] : parts[4];
  // a team in a team ranking opens the tab the ranking is about: prospect pool -> Prospects, standings -> Roster, stats -> Team stats
  const tabFor = !isTeam ? "" : parts[1] === "pool" ? "/prospects" : parts[1] === "pts" ? "" : "/stats";
  const back = isTeam ? (hasClub(me) ? `<a href="${teamRoute(me)}${parts[1] === "pool" ? "/prospects" : parts[1] === "pts" ? "" : "/stats"}">← ${esc(me)}</a>` : "")
    : (me && byKey.get(me) ? `<a href="${route(me)}">← ${esc(byKey.get(me).n)}</a>` : "");
  const seasons = isTeam && R.seasonal ? SEASONS.filter(s => teamTable(s)?.teams) : !isTeam && !["ca", "g", "po"].includes(parts[1]) ? SEASONS : [];
  const body = isTeam
    ? `<table class="rank"><thead><tr><th class="num">Rank</th><th>Team</th><th class="num">${esc(R.title)}</th>${R.rows[0].extra ? "<th>Record</th>" : ""}</tr></thead><tbody>
        ${R.rows.map(r => `<tr class="tlink${r.club === me ? " hl" : ""}" data-club="${esc(r.club)}"><td class="num">${rankChip(r.rank, R.rows.length)}</td>
          <th scope="row" class="nowrap"><a href="${teamRoute(r.club)}${tabFor}">${logo(r.club, 24)} ${esc(r.club)}</a></th><td class="num"><b>${r.txt}</b></td>${r.extra ? `<td class="small muted">${r.extra}</td>` : ""}</tr>`).join("")}</tbody></table>`
    : `<table class="rank"><thead><tr><th class="num">Rank</th><th class="pcol">Player</th><th>Club</th><th class="num">Age</th><th class="num">Est. CA</th>${R.rows.some(r => r.txt) ? `<th class="num">${esc(R.title)}</th>` : ""}<th class="num">Percentile</th></tr></thead><tbody>
        ${R.rows.map(r => `<tr class="link${r.p.k === me ? " hl" : ""}" data-k="${esc(r.p.k)}"><td class="num">${r.rank}</td>
          <th scope="row" class="pcol"><a class="pcell" href="${route(r.p.k)}"><span><b>${esc(r.p.n)}</b></span></a></th>
          <td class="nowrap">${tlink(clubOf(r.p), `${logo(clubOf(r.p), 22)} ${esc(clubOf(r.p))}`)}${r.p.lg && r.p.lg !== "NHL" ? ` <span class="muted small">${esc(r.p.lg)}</span>` : ""}</td>
          <td class="num">${r.p.age}</td><td class="num">${fmt(r.p.ca, 0)}</td>${R.rows.some(x => x.txt) ? `<td class="num">${esc(r.txt || "")}</td>` : ""}<td class="num">${impPill(r.pct)}</td></tr>`).join("")}</tbody></table>`;
  view.innerHTML = `<section class="band"><div class="wrap"><div class="cardbar">${back}<span></span></div><h1>${esc(R.title)}</h1>
      <p class="lede">${R.sub}. ${R.rows.length} ${isTeam ? "teams" : "players"}.</p></div></section>
    <div class="wrap page">
      ${seasons.length > 1 ? `<div class="cardbar"><span></span><label class="inline">Season <select id="rk-season">${seasons.slice().reverse().map(s => `<option value="${s}" ${s === SEASON ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label></div>` : ""}
      <section class="card-box flush"><div class="tablewrap">${body}</div></section></div>`;
  view.querySelector("#rk-season")?.addEventListener("change", e => {
    SEASON = e.target.value;
    location.hash = isTeam ? teamRankHref(parts[1], parts[2] || "", SEASON) : pRankHref(parts[1], parts[2], parts[3], parts[4] || "");
  });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  view.querySelectorAll("tr.tlink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = teamRoute(tr.dataset.club) + tabFor; });
  const hl = view.querySelector("tr.hl");
  if (hl) setTimeout(() => hl.scrollIntoView({ block: "center" }), 0);
}

// ---------------------------------------------------------------- back: one level up
/* The "←" link always goes up, never sideways, so it can't loop (2026-10-27, user's choice; it used to follow a stack
   of visited pages that could disagree with the browser's history). A player page goes back to the page he was opened
   from (ORIGIN: the last non-player page before entering, kept through his tabs and any players opened from him), or
   Players when opened directly. Every other page goes to its parent (parentOf), ending at Home. The browser's own
   Back is untouched. Going to the back target, either way, restores that page's scroll position. */
const SCROLL = new Map();
let ORIGIN = null;
const pkeyOf = h => (h.startsWith("#/p/") ? h.slice(4).split("/")[0] : null);
function parentOf(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return "#/";
  if ((parts[0] === "team" || parts[0] === "league") && parts.length === 2) return "#/teams";
  if (parts[0] === "playoffs" && !playoffSeasons().includes(parts[1])) return "#/playoffs";   // a made-up season
  if (parts[0] === "playoffs" && parts[2] === "game") return `#/playoffs/${parts[1]}/games`;
  if (parts[0] === "rank") return "#/players";
  return "#/" + parts.slice(0, -1).join("/");
}
const backTarget = hash => (pkeyOf(hash) ? ORIGIN ?? "#/players" : parentOf(hash));
const TEAM_TAB_LABEL = { players: "Player stats", results: "Results", contracts: "Contracts", prospects: "Prospects & picks", drafts: "Draft history", stats: "Team stats", history: "History", hof: "Hall of Fame" };
function routeLabel(hash) {
  const parts = hash.slice(2).split("/").map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  switch (parts[0]) {
    case "p": { const p = byKey.get(parts[1]) || ALUMNI.get(parts[1]); return p ? p.n : "Player"; }
    case "players": return "Players";
    case "prospects": return "Prospects" + (parts[1] ? " · " + (PROSPECT_TABS.find(t => t[0] === parts[1])?.[1] || parts[1]) : "");
    case "draft": return parts[1] === "past" ? "Past drafts" : parts[1] === "scores" ? "Drafters" : "Draft board";
    case "teams": return "Teams";
    case "team": return parts[1] + (TEAM_TAB_LABEL[parts[2]] ? " · " + TEAM_TAB_LABEL[parts[2]] : "");
    case "rank": return "Ranking";
    case "hof": return "Hall of Fame";
    case "playoffs": return parts[2] === "game" ? "Playoff box score" : parts[2] === "games" ? (parts[3] ? "Playoff series" : "Playoff games") : "Playoffs" + (parts[1] ? " " + seasonLabel(parts[1]) : "");
    case "league": return parts[1] || "League";
    case "h2h": return "Head to head";
    case "trade": return "Trade predictor";
    case "about": return "How it works";
    default: return "Home";
  }
}
/* "← one level up" from the current page (backTarget). */
function backLink() {
  const h = backTarget(location.hash) || "#/";
  return `<a href="${esc(h)}">← ${esc(routeLabel(h))}</a>`;
}
function onHashChange(e) {
  const from = new URL(e.oldURL).hash, to = location.hash;
  SCROLL.set(from || "#/", scrollY);
  const restore = (to || "#/") === (backTarget(from) || "#/");
  if (pkeyOf(to) && !pkeyOf(from)) ORIGIN = from || "#/";   // entering players; player-to-player keeps the origin
  render();
  const y = restore && SCROLL.get(to || "#/");
  if (y) { scrollTo(0, y); setTimeout(() => scrollTo(0, y), 0); }   // again after charts that draw late
}

// ---------------------------------------------------------------- other leagues
/* Leagues without box scores (build_data.league_pages): every club's player lines per season and game type, from the
   players' History tabs, and standings estimated from them (goalies' W / L / OTL and goals against, skaters' goals). */
const LGD = D.leagues?.leagues || {};
const LG_COLS = D.leagues?.cols || [];
const leagueRoute = lg => "#/league/" + encodeURIComponent(lg);
const hasLeague = lg => !!lg && !!LGD[lg];
const leagueNames = () => Object.keys(LGD);   // biggest first
const lgLink = lg => hasLeague(lg) ? `<a href="${leagueRoute(lg)}">${esc(lg)}</a>` : esc(lg);
// a club's home league (build_data.club_leagues: the league most of its players were in over every snapshot)
const clubLeagueOf = club => D.clubLeague?.[club] || clubLeague(club);
const lgSeasons = lg => Object.keys(LGD[lg]?.seasons || {}).filter(s => LGD[lg].seasons[s].R || LGD[lg].seasons[s].P).sort();
const lgSeason = (lg, s) => (lgSeasons(lg).includes(s) ? s : lgSeasons(lg).filter(x => LGD[lg].table[x] && Object.keys(LGD[lg].table[x]).length).at(-1) || lgSeasons(lg).at(-1));
const lgPeople = lg => D.players.filter(p => clubOf(p) ? clubLeagueOf(clubOf(p)) === lg : p.lg === lg);
const LS = { kind: "R", view: "basic", sort: "p", dir: -1, club: "", grp: "", limit: 100 };
const LG_SUM = ["gp", "g", "a", "p", "pm", "pim", "s", "w", "l", "t", "min", "ga"];
// one line (or a player's summed lines) with its rates
function lgDerive(r) {
  const gp = r.gp || 0;
  return { ...r, pl: byKey.get(r.k) || null, isG: r.w != null || r.pos === "G",
    p_gp: gp ? r.p / gp : null, g_gp: gp ? r.g / gp : null, a_gp: gp ? r.a / gp : null, s_gp: gp && r.s != null ? r.s / gp : null,
    pim_gp: gp && r.pim != null ? r.pim / gp : null, shp: r.s ? r.g / r.s : null, gaa: r.min ? r.ga * 60 / r.min : null };
}
const lgRow = (row, club) => lgDerive({ ...Object.fromEntries(LG_COLS.map((c, i) => [c, row[i]])), club, clubs: [club] });
const LGC = {};
/* Every player of a league-season (R or P), his lines at its clubs summed; skaters with enough games get percentiles of
   their per-game rates (vs the league's skaters with at least a third of the most games played). */
function lgPlayers(lg, season, kind) {
  const id = `${lg}|${season}|${kind}`;
  if (LGC[id]?.data === D) return LGC[id].rows;
  const by = new Map();
  Object.entries(LGD[lg]?.seasons?.[season]?.[kind] || {}).forEach(([club, rows]) => rows.forEach(row => {
    const r = Object.fromEntries(LG_COLS.map((c, i) => [c, row[i]]));
    const o = by.get(r.k);
    if (!o) { by.set(r.k, { ...r, club, clubs: [club], _avr: r.avr != null ? [[r.avr, r.gp]] : [] }); return; }
    o.clubs.push(club);
    if ((r.gp || 0) > (o._big || 0)) { o.club = club; o._big = r.gp; }
    LG_SUM.forEach(c => { if (r[c] != null) o[c] = (o[c] || 0) + r[c]; });
    if (r.avr != null) o._avr.push([r.avr, r.gp]);
  }));
  const rows = [...by.values()].map(o => {
    const n = o._avr.reduce((s, x) => s + x[1], 0);
    if (o._avr.length > 1 && n) o.avr = o._avr.reduce((s, x) => s + x[0] * x[1], 0) / n;
    if (o.clubs.length > 1 && o.min && o.svp != null) o.svp = null;   // can't be summed without shots against
    return lgDerive(o);
  });
  const sk = rows.filter(r => !r.isG), min = Math.max(5, Math.round(Math.max(0, ...sk.map(r => r.gp || 0)) / 3));
  const elig = sk.filter(r => r.gp >= min);
  ["p_gp", "g_gp", "a_gp", "s_gp", "shp", "avr"].forEach(k => {
    const vals = elig.map(r => r[k]).filter(v => v != null).sort((a, b) => a - b);
    elig.forEach(r => {
      if (r[k] == null || !vals.length) return;
      const lo = vals.filter(v => v < r[k]).length, eq = vals.filter(v => v === r[k]).length;
      (r.pct ||= {})[k] = Math.round(100 * (lo + eq / 2) / vals.length);
    });
  });
  rows.minGp = min;
  LGC[id] = { data: D, rows };
  return rows;
}
const lgName = r => r.pl ? `<a class="pcell" href="${route(r.k)}"><span><b>${esc(r.n)}</b></span></a>` : `<b title="No longer in the data">${esc(r.n)}</b>`;
const lgHref = (lg, tab, season, key) => `${leagueRoute(lg)}/${tab}/${season}${key ? "/" + key : ""}`;
const n2 = (v, d = 2) => v == null ? dash : v.toFixed(d);
const pctCell = (lg, season, key) => r => r.pct?.[key] == null ? dash : impPill(r.pct[key], lgHref(lg, "players", season, key));
/* Skater columns per view: [key, header, value, cell, tip]. Percentile pills open the league table sorted by that rate. */
function lgSkCols(lg, season, view) {
  const basic = [["gp", "GP", r => r.gp, r => r.gp ?? dash], ["g", "G", r => r.g, r => r.g ?? dash], ["a", "A", r => r.a, r => r.a ?? dash],
    ["p", "P", r => r.p, r => r.p == null ? dash : `<b>${r.p}</b>`], ["pm", "+/−", r => r.pm, r => r.pm == null ? dash : (r.pm > 0 ? "+" : "") + r.pm],
    ["pim", "PIM", r => r.pim, r => r.pim ?? dash], ["s", "SOG", r => r.s, r => r.s ?? dash, "Shots on goal"],
    ["shp", "Sh%", r => r.shp, r => r.shp == null ? dash : (100 * r.shp).toFixed(1), "Goals per shot on goal"],
    ["avr", "Av R", r => r.avr, r => n2(r.avr), "Average game rating"]];
  const adv = [["gp", "GP", r => r.gp, r => r.gp ?? dash], ["p_gp", "P/GP", r => r.p_gp, r => n2(r.p_gp)], ["g_gp", "G/GP", r => r.g_gp, r => n2(r.g_gp)],
    ["a_gp", "A/GP", r => r.a_gp, r => n2(r.a_gp)], ["s_gp", "SOG/GP", r => r.s_gp, r => n2(r.s_gp, 1)], ["pim_gp", "PIM/GP", r => r.pim_gp, r => n2(r.pim_gp)],
    ["pp", "Points", r => r.pct?.p_gp, pctCell(lg, season, "p_gp"), "Points per game: percentile in the league"],
    ["pg", "Goals", r => r.pct?.g_gp, pctCell(lg, season, "g_gp"), "Goals per game: percentile in the league"],
    ["pa", "Assists", r => r.pct?.a_gp, pctCell(lg, season, "a_gp"), "Assists per game: percentile in the league"],
    ["ps", "Shots", r => r.pct?.s_gp, pctCell(lg, season, "s_gp"), "Shots on goal per game: percentile in the league"],
    ["pr", "Rating", r => r.pct?.avr, pctCell(lg, season, "avr"), "Average game rating: percentile in the league"],
    ["ca", "Est. CA", r => r.pl?.ca, r => r.pl ? fmt(r.pl.ca, 0) : dash], ["pk", "Proj. peak", r => r.pl ? sortVal(r.pl, "peak") : null, r => r.pl ? fmt(sortVal(r.pl, "peak"), 0) : dash]];
  return view === "adv" ? adv : basic;
}
function lgSort(rows, cols) {
  const col = cols.find(c => c[0] === LS.sort) || cols.find(c => c[0] === "p" || c[0] === "p_gp");
  return rows.slice().sort((x, y) => ((col[2](y) ?? -1e9) - (col[2](x) ?? -1e9)) * -LS.dir || (y.p || 0) - (x.p || 0));
}
const lgViewSeg = () => `<span class="seg" id="lg-view" role="group" aria-label="Columns">${[["basic", "Basic"], ["adv", "Advanced"]].map(([v, t]) =>
  `<button type="button" data-v="${v}" class="${LS.view === v ? "on" : ""}">${t}</button>`).join("")}</span>`;
function lgSkTable(lg, season, rows, withClub) {
  const cols = lgSkCols(lg, season, LS.view);
  if (!cols.some(c => c[0] === LS.sort)) { LS.sort = LS.view === "adv" ? "p_gp" : "p"; LS.dir = -1; }
  return `<table class="rank tp"><thead><tr><th class="num">#</th><th class="pcol">Player</th>${withClub ? "<th>Club</th>" : ""}<th>Pos</th><th class="num">Age</th>${cols.map(([k, h, , , tip]) =>
    `<th class="num sort ${LS.sort === k ? "on" : ""}" data-s="${k}"${tip ? ` title="${tip}"` : ""}><button type="button">${h}${LS.sort === k ? (LS.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${r.pl ? "link" : ""}"${r.pl ? ` data-k="${esc(r.k)}"` : ""}><td class="num muted">${i + 1}</td><th scope="row" class="pcol" title="${esc(r.n)}">${lgName(r)}</th>
      ${withClub ? `<td>${r.clubs.map(c => tname(c)).join(" / ")}</td>` : ""}<td>${esc(r.pl?.pos || r.pos || "")}</td><td class="num">${r.pl ? r.pl.age : dash}</td>
      ${cols.map(([, , , cell]) => `<td class="num">${cell(r)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function lgGoalieTable(rows, withClub) {
  return `<table class="rank tp"><thead><tr><th class="pcol">Goalie</th>${withClub ? "<th>Club</th>" : ""}<th class="num">Age</th><th class="num">GP</th><th class="num">W</th><th class="num">L</th>
    <th class="num" title="Overtime / shootout losses">OTL</th><th class="num">GA</th><th class="num">GAA</th><th class="num">SV%</th><th class="num">Av R</th><th class="num">Est. CA</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.pl ? "link" : ""}"${r.pl ? ` data-k="${esc(r.k)}"` : ""}><th scope="row" class="pcol" title="${esc(r.n)}">${lgName(r)}</th>${withClub ? `<td>${r.clubs.map(c => tname(c)).join(" / ")}</td>` : ""}
      <td class="num">${r.pl ? r.pl.age : dash}</td><td class="num">${r.gp ?? dash}</td><td class="num">${r.w ?? dash}</td><td class="num">${r.l ?? dash}</td><td class="num">${r.t ?? dash}</td>
      <td class="num">${r.ga ?? dash}</td><td class="num">${n2(r.gaa)}</td><td class="num">${r.svp != null ? r.svp.toFixed(3).replace(/^0/, "") : dash}</td><td class="num">${n2(r.avr)}</td>
      <td class="num">${r.pl ? fmt(r.pl.ca, 0) : dash}</td></tr>`).join("")}</tbody></table>`;
}
/* Estimated standings: [{club, gp, w, l, otl, pts, gf, ga, place, ...rates}] with a rank per sortable stat. */
const LG_STAND = [["pts", "Pts", 1], ["pts_pct", "Pts%", 1], ["gf_gp", "GF/GP", 1], ["ga_gp", "GA/GP", -1], ["gd", "Diff", 1]];
function lgTable(lg, season) {
  const T = LGD[lg]?.table?.[season] || {};
  const rows = Object.entries(T).map(([club, t]) => ({ club, ...t, pts_pct: t.gp ? t.pts / (2 * t.gp) : null,
    gf_gp: t.gp ? t.gf / t.gp : null, ga_gp: t.gp ? t.ga / t.gp : null, gd: t.gf - t.ga, rank: {} }));
  LG_STAND.forEach(([k, , dir]) => rows.slice().sort((a, b) => ((b[k] ?? -1e9) - (a[k] ?? -1e9)) * dir).forEach((r, i) => (r.rank[k] = i + 1)));
  rows.forEach(r => (r.rank.pts = r.place));
  return rows.sort((a, b) => a.place - b.place);
}
const lgStandHref = (lg, season, k = "") => lgHref(lg, "standings", season, k);
function standingsTable(lg, season, rows, sort = "", hl = "") {
  const key = LG_STAND.some(s => s[0] === sort) ? sort : "";
  const shown = key && key !== "pts" ? rows.slice().sort((a, b) => a.rank[key] - b.rank[key]) : rows;
  const head = (k, t) => `<th class="num ${key === k || (!key && k === "pts") ? "on" : ""}"><a href="${lgStandHref(lg, season, k)}">${t}</a></th>`;
  return `<table class="rank tp"><thead><tr><th class="num">#</th><th class="pcol">Team</th><th class="num">GP</th><th class="num">W</th><th class="num">L</th><th class="num">OTL</th>
    ${head("pts", "Pts")}${head("pts_pct", "Pts%")}<th class="num">GF</th><th class="num">GA</th>${head("gd", "Diff")}${head("gf_gp", "GF/GP")}${head("ga_gp", "GA/GP")}</tr></thead><tbody>
    ${shown.map((r, i) => `<tr class="${hasClub(r.club) ? "tlink" : ""}${r.club === hl ? " hl" : ""}"${hasClub(r.club) ? ` data-club="${esc(r.club)}"` : ""}><td class="num muted">${key && key !== "pts" ? r.rank[key] : i + 1}</td>
      <th scope="row" class="pcol">${tname(r.club, 20)}</th><td class="num">${r.gp}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.otl}</td>
      <td class="num"><b>${r.pts}</b></td><td class="num">${r.pts_pct == null ? dash : r.pts_pct.toFixed(3).replace(/^0/, "")}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td>
      <td class="num ${r.gd > 0 ? "up" : r.gd < 0 ? "down" : ""}">${signed(r.gd, 0)}</td><td class="num">${n2(r.gf_gp)}</td><td class="num">${n2(r.ga_gp)}</td></tr>`).join("")}</tbody></table>`;
}
function standingsNote(lg) {
  const c = D.leagues?.check;
  return `<p class="sub pad">Estimated: EHM shows a client no ${esc(lg)} standings or box scores, so each club's record is its goalies' wins, losses
    and overtime losses added up from their History tabs, goals for its skaters' goals and goals against its goalies'. A player's games before the last
    snapshot that showed him at a club he has since left are missing.${c ? ` Tested on the NHL's complete seasons (${(c.seasons || []).map(seasonLabel).join(", ")}), where box scores give the real
    record: points were off by ${c.pts_mae} on average (90% of clubs within ${c.pts_p90}), the exact record for ${c.exact} of ${c.teams}.` : ""}</p>`;
}
const seasonSel = (id, seasons, cur) => seasons.length > 1 ? `<label class="inline">Season <select id="${id}">${seasons.slice().reverse().map(s =>
  `<option value="${s}" ${s === cur ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>` : "";
const kindSeg = (lg, season) => {
  const kinds = ["R", "P"].filter(k => LGD[lg]?.seasons?.[season]?.[k]);
  if (!kinds.includes(LS.kind)) LS.kind = kinds[0] || "R";
  return kinds.length > 1 ? `<span class="seg" id="lg-kind">${kinds.map(k => `<button type="button" data-k="${k}" class="${LS.kind === k ? "on" : ""}">${k === "R" ? "Regular season" : "Playoffs"}</button>`).join("")}</span>` : "";
};
const lgLeaders = (rows, title, cell, n = 5) => `<section class="card-box"><h3 class="box-h3">${title}</h3><ol class="lead-list">${rows.slice(0, n).map(r =>
  `<li>${r.pl ? `<a href="${route(r.k)}">${esc(r.n)}</a>` : esc(r.n)} <span class="muted small">${r.clubs.map(c => esc(NHL_TEAMS[c]?.[0] || c)).join(" / ")}</span><b>${cell(r)}</b></li>`).join("") || '<li class="muted">No games yet</li>'}</ol></section>`;
const leagueStrip = cur => `<nav class="lgtabs" aria-label="Leagues"><a href="#/teams" class="${cur === "NHL" ? "on" : ""}">NHL</a>${leagueNames().map(l =>
  `<a href="${leagueRoute(l)}" class="${l === cur ? "on" : ""}"${l === cur ? ' aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;

function renderLeague(lg, tab = "overview", season, arg) {
  markNav("teams");
  if (!hasLeague(lg)) { view.innerHTML = `<div class="wrap page"><div class="panel">No page for this league. <a href="#/teams">Teams</a></div></div>`; return; }
  const L = LGD[lg], seasons = lgSeasons(lg);
  season = lgSeason(lg, season);
  if (!["overview", "standings", "players", "teams", "prospects"].includes(tab)) tab = "overview";
  // a percentile pill's link: the league in the Advanced view, sorted by that rate
  if (tab === "players" && arg) { LS.view = "adv"; LS.sort = { avr: "pr" }[arg] || arg; LS.dir = -1; LS.limit = 100; }
  const people = lgPeople(lg), table = lgTable(lg, season);
  const stale = L.read && L.read !== D.dates.at(-1);
  const head = `<section class="band"><div class="wrap">${leagueStrip(lg)}
    <h1>${esc(lg)}</h1><p class="lede">${L.clubs.length} clubs · ${people.length.toLocaleString()} players in the data${stale ? ` · last read ${fmtDate(L.read)} (the latest crawl skipped this league)` : ` · snapshot ${fmtDate(D.dates.at(-1))}`}.
      No box scores outside the NHL: stats come from each player's History tab, standings are estimated from them.</p>
    ${tabBar("League sections", [["overview", "Overview"], ["standings", "Standings"], ["players", "Player stats"], ["teams", "Teams"], ["prospects", "Prospects"]], tab)}</div></section>`;
  let body = "";
  if (tab === "overview") {
    const pl = lgPlayers(lg, season, "R"), sk = pl.filter(r => !r.isG), gk = pl.filter(r => r.isG);
    const minG = Math.max(3, Math.round(Math.max(0, ...gk.map(r => r.gp || 0)) / 3));
    const by = (rows, k, dir = -1) => rows.filter(r => r[k] != null).sort((a, b) => (a[k] - b[k]) * dir);
    const best = people.slice().sort((a, b) => b.ca - a.ca).slice(0, 8);
    const young = people.filter(p => p.age <= 21).sort((a, b) => sortVal(b, "peak") - sortVal(a, "peak")).slice(0, 8);
    body = `<div class="cardbar"><h2 class="flat">${seasonLabel(season)}</h2>${seasonSel("lg-season", seasons, season)}</div>
      ${table.length ? `<section class="card-box flush"><h2 class="box-h">Standings <span class="muted">estimated</span></h2><div class="tablewrap">${standingsTable(lg, season, table.slice(0, 10))}</div>
        <p class="pad small">${moreLink(lgStandHref(lg, season), `All ${table.length} clubs and how the standings are estimated`)}</p></section>` : ""}
      <div class="row four">
        ${lgLeaders(by(sk, "p"), "Points", r => r.p)}
        ${lgLeaders(by(sk, "g"), "Goals", r => r.g)}
        ${lgLeaders(by(sk, "a"), "Assists", r => r.a)}
        ${lgLeaders(by(gk.filter(r => r.gp >= minG && r.svp != null), "svp"), `Save % <span class="muted small">${minG}+ GP</span>`, r => r.svp.toFixed(3).replace(/^0/, ""))}
      </div>
      <p class="small">${moreLink(lgHref(lg, "players", season), "Every player's stats")}</p>
      <div class="row">
        <section class="card-box grow"><h2 class="box-h3">Best players now</h2><p class="sub">By est. CA, latest snapshot</p>
          ${best.map(p => listRow(p, `<span class="lnum"><b>${fmt(p.ca, 0)}</b></span>`)).join("")}</section>
        <section class="card-box grow"><h2 class="box-h3">Top prospects</h2><p class="sub">Aged 21 or under, by projected peak</p>
          ${young.map(p => listRow(p, `<span class="lnum stack"><b>${fmt(sortVal(p, "peak"), 0)}</b><small>PA ${fmt(p.pa, 0)}</small></span>`)).join("")}
          ${moreLink(`${leagueRoute(lg)}/prospects`, "All prospects")}</section>
      </div>`;
  } else if (tab === "standings") {
    body = `<div class="cardbar"><h2 class="flat">${seasonLabel(season)} standings <span class="muted">estimated</span></h2>${seasonSel("lg-season", seasons, season)}</div>
      ${table.length ? `<section class="card-box flush"><div class="tablewrap">${standingsTable(lg, season, table, arg)}</div>${standingsNote(lg)}</section>` : `<p class="muted">No regular-season lines for ${seasonLabel(season)}.</p>`}`;
  } else if (tab === "players") {
    const kinds = kindSeg(lg, season);
    const all = lgPlayers(lg, season, LS.kind);
    const clubs = [...new Set(all.flatMap(r => r.clubs))].sort((a, b) => a.localeCompare(b));
    if (!clubs.includes(LS.club)) LS.club = "";
    let sk = all.filter(r => !r.isG && (!LS.club || r.clubs.includes(LS.club)) && (!LS.grp || r.pl?.grp === LS.grp));
    if (LS.view === "adv" && !LS.club) sk = sk.filter(r => r.gp >= all.minGp);
    sk = lgSort(sk, lgSkCols(lg, season, LS.view));
    const gk = all.filter(r => r.isG && (!LS.club || r.clubs.includes(LS.club))).sort((a, b) => (b.min || 0) - (a.min || 0));
    body = `<form class="filters card-box" aria-label="Filters">
        ${seasonSel("lg-season", seasons, season)}${kinds}
        <fieldset><legend>Position</legend><div class="seg" id="lg-grp">${[["", "All"], ["F", "Forwards"], ["D", "Defence"]].map(([v, t]) => `<button type="button" data-v="${v}" class="${v === LS.grp ? "on" : ""}">${t}</button>`).join("")}</div></fieldset>
        <label>Club <select id="lg-club"><option value="">All clubs</option>${clubs.map(c => `<option ${c === LS.club ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        <span class="count">${sk.length.toLocaleString()} skaters</span></form>
      <section class="card-box flush" aria-label="Skaters"><div class="box-h tp-head"><h2>Skaters <span class="muted">${sk.length}</span></h2>${lgViewSeg()}</div>
        <div class="tablewrap">${lgSkTable(lg, season, sk.slice(0, LS.limit), true)}</div>
        ${sk.length > LS.limit ? `<div class="more"><button class="ghost" id="lg-more" type="button">Show more (${(sk.length - LS.limit).toLocaleString()} left)</button></div>` : ""}
        <p class="sub pad">${LS.view === "adv" ? `Per-game rates and their percentile among the league's skaters with ${all.minGp}+ games (fewer games: not ranked${LS.club ? "" : ", not listed"}). Each pill opens the league sorted by that rate.` : "Season totals over his clubs in this league. Click a header to sort."}</p></section>
      ${gk.length ? `<section class="card-box flush" aria-label="Goalies"><h2 class="box-h">Goalies <span class="muted">${gk.length}</span></h2><div class="tablewrap">${lgGoalieTable(gk, true)}</div>
        <p class="sub pad">SV% for a goalie with lines at two clubs can't be combined (no shots against), so it is left out.</p></section>` : ""}`;
  } else if (tab === "teams") {
    const recOf = Object.fromEntries(table.map(r => [r.club, r]));
    body = `<div class="team-grid">${L.clubs.filter(c => hasClub(c) || recOf[c]).map(c => {
      const ps = people.filter(p => clubOf(p) === c), r = recOf[c];
      const best = ps.slice().sort((a, b) => b.ca - a.ca)[0], pay = ps.reduce((s, p) => s + salaryNum(p.sal), 0);
      return `<div class="team-card">${logo(c, 44)}<span>${hasClub(c) ? `<a class="lname" href="${teamRoute(c)}"><b>${esc(c)}</b></a>` : `<b>${esc(c)}</b>`}
        <small>${r ? `${r.w}–${r.l}–${r.otl} · ${r.pts} pts (${rankLink(lgStandHref(lg, season), ordinal(r.place))})` : `${ps.length} players`}</small>
        <small>${pay ? money(pay) : ""}${best ? `${pay ? " · " : ""}<a href="${route(best.k)}">${esc(best.n)}</a> ${fmt(best.ca, 0)}` : ""}</small></span></div>`;
    }).join("")}</div><p class="small muted">Records: ${seasonLabel(season)}, estimated (see Standings).</p>`;
  } else if (tab === "prospects") {
    body = lgProspects(people, lg, true);
  }
  view.innerHTML = head + `<div class="wrap page">${body}</div>`;
  bindLeague(() => renderLeague(lg, tab, season), s => (location.hash = lgHref(lg, tab, s)));
}
/* A league's (or club's) young players by projected peak, with their CHL / NHL draft-list ranks. */
function lgProspects(people, lg, withClub) {
  const rows = people.filter(p => p.age <= 21).sort((a, b) => sortVal(b, "peak") - sortVal(a, "peak"));
  const listRank = (p, tag) => (p.drs || []).filter(d => d[0].includes(`(${tag})`)).map(d => `${esc(d[0].replace(` (${tag})`, ""))} #${d[1]}`).join("<br>") || dash;
  const chl = (rows.some(p => (p.drs || []).some(d => d[0].includes(`(${lg})`))));
  const dl = p => p.dft?.pro?.pick != null ? linkText(`${p.dft.pro.year} R${p.dft.pro.round} #${p.dft.pro.pick}`, draftHref(p.dft.pro)) + (draftClub(p.dft.pro.team) ? ` ${esc(NHL_TEAMS[draftClub(p.dft.pro.team)][0])}` : "") : dash;
  const shown = rows.slice(0, LS.limit);
  return rows.length ? `<section class="card-box flush"><h2 class="box-h">Prospects <span class="muted">${rows.length}</span></h2><div class="tablewrap"><table class="rank tp"><thead><tr><th class="num">#</th><th class="pcol">Player</th>
      ${withClub ? "<th>Club</th>" : ""}<th>Pos</th><th class="num">Age</th><th class="num">Est. CA</th><th class="num">Est. PA</th><th class="num">Proj. peak</th>${chl ? `<th>${esc(lg)} draft list</th>` : ""}<th>NHL draft list</th><th>NHL draft</th></tr></thead><tbody>
    ${shown.map((p, i) => `<tr class="link" data-k="${esc(p.k)}"><td class="num muted">${i + 1}</td><th scope="row" class="pcol" title="${esc(p.n)}"><a class="pcell" href="${route(p.k)}"><span><b>${esc(p.n)}</b></span></a></th>
      ${withClub ? `<td>${tname(clubOf(p))}</td>` : ""}<td>${esc(p.pos)}</td><td class="num">${p.age}</td><td class="num">${fmt(p.ca, 0)}</td><td class="num">${fmt(p.pa, 0)}</td>
      <td class="num"><b>${fmt(sortVal(p, "peak"), 0)}</b></td>${chl ? `<td class="small">${listRank(p, lg)}</td>` : ""}<td class="small">${listRank(p, "NHL")}</td><td class="small">${dl(p)}</td></tr>`).join("")}
    </tbody></table></div>${rows.length > LS.limit ? `<div class="more"><button class="ghost" id="lg-more" type="button">Show more (${(rows.length - LS.limit).toLocaleString()} left)</button></div>` : ""}
    <p class="sub pad">Proj. peak is the highest est. CA on his projected path. Draft lists: EHM's ranking lists of the latest snapshot.</p></section>` : `<p class="muted">No players aged 21 or under.</p>`;
}
// the controls every league / league-club page shares
function bindLeague(rerender, goSeason) {
  view.querySelector("#lg-season")?.addEventListener("change", e => { LS.limit = 100; goSeason(e.target.value); });
  view.querySelectorAll("#lg-kind button").forEach(b => b.onclick = () => { LS.kind = b.dataset.k; rerender(); });
  view.querySelectorAll("#lg-view button").forEach(b => b.onclick = () => { LS.view = b.dataset.v; rerender(); });
  view.querySelectorAll("#lg-grp button").forEach(b => b.onclick = () => { LS.grp = b.dataset.v; LS.limit = 100; rerender(); });
  view.querySelector("#lg-club")?.addEventListener("change", e => { LS.club = e.target.value; LS.limit = 100; rerender(); });
  view.querySelector("#lg-more")?.addEventListener("click", () => { LS.limit += 200; rerender(); });
  view.querySelectorAll("th[data-s] button").forEach(b => b.onclick = () => {
    const k = b.parentNode.dataset.s;
    LS.dir = LS.sort === k ? -LS.dir : -1; LS.sort = k; rerender();
  });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  view.querySelectorAll("tr.tlink[data-club]").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = teamRoute(tr.dataset.club); });
}

/* Team page of a club in a league with a page: Roster as for every club, plus Player stats, Team stats, History and
   Prospects from the league data. */
const LG_TEAM_TABS = [["roster", "Roster"], ["players", "Player stats"], ["stats", "Team stats"], ["history", "History"], ["prospects", "Prospects"]];
function renderLeagueTeam(club, lg, ps, tab, arg) {
  if (!LG_TEAM_TABS.some(t => t[0] === tab)) tab = "roster";
  const seasons = lgSeasons(lg).filter(s => Object.values(LGD[lg].seasons[s]).some(kd => kd[club]));
  if (!seasons.length && !["roster", "prospects"].includes(tab)) tab = "roster";
  const season = seasons.includes(arg) ? arg : seasons.at(-1);
  const table = season ? lgTable(lg, season) : [], rec = table.find(r => r.club === club);
  const pay = ps.reduce((s, p) => s + salaryNum(p.sal), 0);
  const mates = LGD[lg].clubs.filter(hasClub);
  view.innerHTML = `<section class="band"><div class="wrap">
    <div class="team-head">${logo(club, 72)}
      <div class="grow"><h1>${esc(club)}</h1><p class="lede">${lgLink(lg)} · ${ps.length} players${rec ? ` · ${seasonLabel(season)}: ${rec.w}–${rec.l}–${rec.otl}, ${rec.pts} points (${rankLink(lgStandHref(lg, season), ordinal(rec.place))}, estimated)` : ""} · snapshot ${fmtDate(D.dates.at(-1))}</p></div>
      <span class="inline team-nav"><label class="inline">Team <select id="team-sel">${mates.map(c => `<option ${c === club ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label><a href="${leagueRoute(lg)}">${esc(lg)}</a></span>
    </div>
    ${tabBar("Team sections", LG_TEAM_TABS.filter(([k]) => k === "roster" || k === "prospects" || seasons.length), tab)}
  </div></section>
  <div class="wrap page">${tab === "players" ? lgTeamPlayers(club, lg, season, seasons) : tab === "stats" ? lgTeamStats(club, lg, season, seasons, table)
    : tab === "history" ? lgTeamHistory(club, lg, seasons) : tab === "prospects" ? lgProspects(ps, lg, false) : rosterTab(club, ps, pay)}</div>`;
  view.querySelector("#team-sel")?.addEventListener("change", e => (location.hash = teamRoute(e.target.value) + tabHash(tab)));
  view.querySelectorAll(".ptabs [data-tab]").forEach(b => b.onclick = () => (location.hash = teamRoute(club) + tabHash(b.dataset.tab)));
  if (tab === "roster") { bindRoster(club, ps); view.querySelector("#t-season")?.closest("label")?.remove(); }
  else bindLeague(() => renderLeagueTeam(club, lg, ps, tab, season), s => (location.hash = `${teamRoute(club)}/${tab}/${s}`));
}
function lgTeamPlayers(club, lg, season, seasons) {
  const kinds = kindSeg(lg, season);
  const league = new Map(lgPlayers(lg, season, LS.kind).map(r => [r.k, r]));
  const rows = (LGD[lg].seasons[season][LS.kind]?.[club] || []).map(row => {
    const r = lgRow(row, club);
    r.pct = league.get(r.k)?.clubs.length === 1 ? league.get(r.k).pct : null;   // percentiles of a one-club season only
    return r;
  });
  const sk = lgSort(rows.filter(r => !r.isG), lgSkCols(lg, season, LS.view)), gk = rows.filter(r => r.isG).sort((a, b) => (b.min || 0) - (a.min || 0));
  return `<div class="cardbar"><div><h2 class="flat">${seasonLabel(season)} ${LS.kind === "P" ? "playoffs" : "regular season"}</h2>
      <p class="sub">His games for ${esc(club)}, from the History tab of the last snapshot that showed him here.</p></div>
      <span class="inline">${kinds}${seasonSel("lg-season", seasons, season)}</span></div>
    <section class="card-box flush" aria-label="Skaters"><div class="box-h tp-head"><h2>Skaters <span class="muted">${sk.length}</span></h2>${lgViewSeg()}</div>
      <div class="tablewrap">${lgSkTable(lg, season, sk, false)}</div>
      ${LS.view === "adv" ? `<p class="sub pad">Percentiles: his per-game rates against the ${esc(lg)}'s skaters with enough games; each pill opens that league ranking.</p>` : ""}</section>
    ${gk.length ? `<section class="card-box flush" aria-label="Goalies"><h2 class="box-h">Goalies <span class="muted">${gk.length}</span></h2><div class="tablewrap">${lgGoalieTable(gk, false)}</div></section>` : ""}`;
}
function lgTeamStats(club, lg, season, seasons, table) {
  const r = table.find(x => x.club === club);
  const sel = `<div class="cardbar"><h2 class="flat">${seasonLabel(season)} regular season <span class="muted">estimated</span></h2>${seasonSel("lg-season", seasons, season)}</div>`;
  if (!r) return sel + `<p class="muted">No regular-season record for ${esc(club)} in ${seasonLabel(season)}.</p>`;
  const card = (label, value, k, note = "") => `<div><span>${label}</span><b>${value}</b><small>${rankLink(lgStandHref(lg, season, k === "pts" ? "" : k), `${ordinal(r.rank[k])} of ${table.length}`)}${note}</small></div>`;
  const rows = lgPlayers(lg, season, "R").filter(x => x.clubs.includes(club));
  const lines = (LGD[lg].seasons[season].R?.[club] || []).map(row => lgRow(row, club));
  const top = lines.filter(x => !x.isG).sort((a, b) => (b.p || 0) - (a.p || 0)).slice(0, 5);
  return `${sel}
    <div class="stat-cards">
      <div><span>Record (W–L–OTL)</span><b>${r.w}–${r.l}–${r.otl}</b><small>${r.gp} GP</small></div>
      ${card("Points", r.pts, "pts")}
      ${card("Points %", r.pts_pct.toFixed(3).replace(/^0/, ""), "pts_pct")}
      ${card("Goals for / game", n2(r.gf_gp), "gf_gp", ` · ${r.gf} GF`)}
      ${card("Goals against / game", n2(r.ga_gp), "ga_gp", ` · ${r.ga} GA`)}
      ${card("Goal difference", signed(r.gd, 0), "gd")}
    </div>
    <section class="card-box"><h3 class="box-h3">Top scorers</h3>${top.map(x => `<div class="srow"><span>${x.pl ? `<a href="${route(x.k)}">${esc(x.n)}</a>` : esc(x.n)}</span><b>${x.p} P</b><span class="muted">${x.g} G, ${x.a} A</span><span class="muted">${x.gp} GP</span></div>`).join("") || '<p class="muted">No skater lines.</p>'}</section>
    <section class="card-box flush">${standingsNote(lg)}</section>
    <p class="small muted">${rows.length} players had games for ${esc(club)} this season.</p>`;
}
function lgTeamHistory(club, lg, seasons) {
  const rows = seasons.slice().reverse().map(s => {
    const t = lgTable(lg, s), r = t.find(x => x.club === club);
    const lines = (LGD[lg].seasons[s].R?.[club] || []).map(row => lgRow(row, club));
    const top = lines.filter(x => !x.isG).sort((a, b) => (b.p || 0) - (a.p || 0))[0];
    const g = lines.filter(x => x.isG).sort((a, b) => (b.min || 0) - (a.min || 0))[0];
    const po = (LGD[lg].seasons[s].P?.[club] || []).length;
    const nm = x => x.pl ? `<a href="${route(x.k)}">${esc(x.n)}</a>` : esc(x.n);
    return `<tr><th scope="row">${seasonLabel(s)}</th><td class="num">${r ? r.gp : dash}</td><td class="num">${r ? `${r.w}–${r.l}–${r.otl}` : dash}</td><td class="num">${r ? `<b>${r.pts}</b>` : dash}</td>
      <td class="num">${r ? rankLink(lgStandHref(lg, s), ordinal(r.place)) : dash}</td><td class="num">${r ? `${r.gf}–${r.ga}` : dash}</td><td>${po ? "Yes" : '<span class="muted">–</span>'}</td>
      <td>${top ? `${nm(top)} <span class="muted small">${top.p} P</span>` : dash}</td><td>${g ? `${nm(g)} <span class="muted small">${g.svp != null ? g.svp.toFixed(3).replace(/^0/, "") : n2(g.gaa)}</span>` : dash}</td></tr>`;
  }).join("");
  return `<section class="card-box flush"><h2 class="box-h">Season by season <span class="muted">estimated records</span></h2><div class="tablewrap"><table class="rank tp"><thead><tr><th>Season</th><th class="num">GP</th>
    <th class="num">W–L–OTL</th><th class="num">Pts</th><th class="num">Place</th><th class="num">GF–GA</th><th>Playoffs</th><th>Top scorer</th><th>Main goalie (SV%)</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sub pad">Seasons inside this save only, as far as the snapshots saw them; the current season is to date. ${esc(lg)} records are estimated from players' History lines (see the league's Standings).</p></section>`;
}

// ---------------------------------------------------------------- router
let keepScroll = false;   // set for a re-render that shouldn't jump to the top (theme toggle)
function render() {
  const raw = location.hash.slice(1), h = decodePart(raw);
  tip.hidden = true;
  if (raw.startsWith("/p/")) {
    markNav("players");
    // #/p/<encoded key>[/<tab>]: the key is URI-encoded, so a raw "/" only separates the tab
    const [k, tab] = raw.slice(3).split("/");
    renderPlayer(decodePart(k), tab || "overview");
    return;
  }
  if (h === "/players") renderRankings();
  else if (h === "/prospects" || raw.startsWith("/prospects/")) renderProspects(raw.slice(11) || "overview");
  else if (h === "/about" || raw.startsWith("/about/")) renderAbout(raw.slice(7));
  else if (h === "/draft" || raw.startsWith("/draft/")) { const [t, y, pk] = raw.slice(7).split("/"); renderDraft(t || "board", y, pk); }
  else if (h === "/teams") renderTeams(null);
  else if (raw.startsWith("/league/")) {
    const [lg, tab, s, k] = raw.slice(8).split("/").map(decodePart);
    renderLeague(lg, tab || "overview", s, k);
  }
  else if (raw.startsWith("/team/")) {
    const [c, tab, x, y] = raw.slice(6).split("/");
    renderTeams(decodePart(c), TEAM_TABS.includes(tab) ? tab : "roster", x && decodePart(x), y && decodePart(y));
  }
  else if (raw.startsWith("/rank/")) renderRank(raw.slice(6));
  else if (h === "/hof" || raw.startsWith("/hof/")) { nhlPeople(); renderHof(raw.slice(5)); }
  else if (h === "/playoffs" || raw.startsWith("/playoffs/")) renderPlayoffs(raw.slice(10));
  else if (h === "/h2h") renderH2H();
  else if (h === "/trade") renderTrade();
  else {
    renderHome();
    if (h && h !== "/") view.insertAdjacentHTML("afterbegin", `<div class="wrap"><p class="warn notfound" role="status">There's no page at <code>#${esc(h)}</code>, so here is the home page.</p></div>`);
  }
  if (!keepScroll) window.scrollTo(0, 0);
  keepScroll = false;
  if (FOCUS_TAB != null) { view.querySelector('[role="tablist"] [role="tab"].on')?.focus(); FOCUS_TAB = null; }
}
{
  D.players.forEach(p => { p._n = fold(p.n); byKey.set(p.k, p); });
  (D.teamHist?.alumni || []).forEach(a => { if (!byKey.has(a.k)) ALUMNI.set(a.k, a); });
  if (!document.title.startsWith(D.title)) document.title += " · " + D.title;
  const snap = document.getElementById("foot-snap");
  if (snap) snap.textContent = `· ${D.title} · ${D.players.length.toLocaleString()} players · snapshot ${fmtDate(D.dates.at(-1))}`;
  addEventListener("hashchange", onHashChange);
  render();
}
