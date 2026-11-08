"use strict";

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
/* Real-life NHL alignment: conferences agree with the playoff box scores; divisions are assumed (the crawl reads none). */
const NHL_DIVISIONS = {
  Atlantic: ["Boston", "Buffalo", "Detroit", "Florida", "Montréal", "Ottawa", "Tampa Bay", "Toronto"],
  Metropolitan: ["Carolina", "Columbus", "New Jersey", "NY Islanders", "NY Rangers", "Philadelphia", "Pittsburgh", "Washington"],
  Central: ["Chicago", "Colorado", "Dallas", "Minnesota", "Nashville", "St. Louis", "Utah", "Winnipeg"],
  Pacific: ["Anaheim", "Calgary", "Edmonton", "Los Angeles", "San Jose", "Seattle", "Vancouver", "Vegas"],
};
const NHL_CONFERENCES = { Eastern: ["Atlantic", "Metropolitan"], Western: ["Central", "Pacific"] };
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
/* Every other club's logo was downloaded once into logos/ (fetch_logos.py writes logos/logos.js, club name -> file).
   The folder is found from this script's own URL: shared/js/ here and js/ in the published copy, both with logos/
   next to them, so "../logos/". */
const LOGOS = window.EHM_LOGOS || {};
const LOGO_BASE = document.currentScript?.src ? new URL("../logos/", document.currentScript.src).href : "logos/";
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
  // a section can have several header links (Draft board, Underrated): only the one for this page lights up
  const links = [...document.querySelectorAll(".top nav a")].filter(a => a.dataset.nav === section);
  const best = links.filter(a => location.hash.startsWith(a.getAttribute("href"))).sort((a, b) => b.getAttribute("href").length - a.getAttribute("href").length)[0] || links[0];
  document.querySelectorAll(".top nav a, .site-foot a[data-nav]").forEach(a => {
    const on = a.closest(".site-foot") ? a.dataset.nav === section : a === best;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // a menu button is lit while one of its pages is open
  document.querySelectorAll(".navmenu").forEach(m => m.querySelector(".navmenu-btn").classList.toggle("on", !!m.querySelector("a.on")));
  closeNavMenus();
}
/* Header menus (Draft, League, Tools): a button and a list, closed by a click elsewhere or Escape.
   On narrow screens the lists' links sit in the scrolling nav row instead (styles.css). */
function setNavMenu(menu, open) {
  menu.classList.toggle("open", open);
  menu.querySelector(".navmenu-btn").setAttribute("aria-expanded", open);
}
const closeNavMenus = except => document.querySelectorAll(".navmenu.open").forEach(m => { if (m !== except) setNavMenu(m, false); });
document.querySelectorAll(".navmenu-btn").forEach(b => b.addEventListener("click", e => {
  e.stopPropagation();
  const menu = b.closest(".navmenu");
  closeNavMenus(menu);
  setNavMenu(menu, !menu.classList.contains("open"));
}));
document.addEventListener("click", e => closeNavMenus(e.target.closest(".navmenu")));
document.addEventListener("keydown", e => {
  const open = document.querySelector(".navmenu.open");
  if (e.key === "Escape" && open) { setNavMenu(open, false); open.querySelector(".navmenu-btn").focus(); }
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
