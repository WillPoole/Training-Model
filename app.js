/* EHM Player Cards: static site over data/ehm_data.js (built by build_data.py). */
"use strict";

const D = window.EHM_DATA;
const MY_TEAM = D.myTeam || "Montréal";  // the user's club (build_data --my-team): default side in head to head / trades
const RIVAL = MY_TEAM === "Toronto" ? "Montréal" : "Toronto";
// every file:// page shares one localStorage: keep a league's own settings (cap, home team) apart
const storeKey = k => D.siteKey ? `${k}-${D.siteKey}` : k;
const view = document.getElementById("view");
const tip = document.getElementById("tip");
const byKey = new Map();
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
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return { bg: `rgb(${rgb})`, fg: lum > 0.55 ? "#0b0b0b" : "#ffffff" };
}

function addMonths(iso, m) {
  const d = new Date(iso + "T00:00:00");
  const whole = Math.floor(m);
  d.setMonth(d.getMonth() + whole);
  d.setDate(d.getDate() + Math.round((m - whole) * 30.44));
  return d;
}
const monthsBetween = (a, b) => (new Date(b) - new Date(a)) / 864e5 / 30.44;
const fmtDate = d => (d instanceof Date ? d : new Date(d + "T00:00:00"))
  .toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// ---------------------------------------------------------------- projection
/* First months: the near-term model's path (p.nr, est CA after 1, 2 ... months; it already uses
   the player's own trend). After that, monthly dCA = a(age)*(PA-CA) + b(age).
   The bands use the PA model's 10th/90th percentile error and the growth curve's noise. */
function growthAt(age, grp) {
  const g = D.growth, c = grp === "G" && g.G ? g.G : g;
  const i = Math.max(0, Math.min(g.ages.length - 1, Math.floor(age) - g.ages[0]));
  return { a: c.a[i], b: c.b[i], noise: c.noise[i] };
}
function ageAt(p, iso) {
  return p.dob ? (new Date(iso) - new Date(p.dob)) / 864e5 / 365.25 : p.age;
}
function project(p) {
  const last = D.dates[D.dates.length - 1];
  const age0 = ageAt(p, last);
  const near = p.nr || [];
  const out = [];
  let mid = p.ca, lo = p.ca, hi = p.ca, noiseVar = 0;
  for (let m = 0; m <= D.projectionMonths; m++) {
    const age = age0 + m / 12;
    out.push({ m, date: addMonths(last, m), age, mid, lo: Math.max(1, lo - 1.28 * Math.sqrt(noiseVar)),
               hi: Math.min(Math.max(p.pa_hi, hi), hi + 1.28 * Math.sqrt(noiseVar)) });
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
    noiseVar += g.noise ** 2;
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
  render();
});
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
function logo(club, size = 28) {
  const t = NHL_TEAMS[club];
  const abbr = t ? t[0] : (String(club || "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "–");
  const badge = `<b style="background:${t ? t[1] : "var(--surface-2)"};color:${t ? t[2] : "var(--ink-2)"}">${esc(abbr)}</b>`;
  const img = t ? `<img src="https://assets.nhle.com/logos/nhl/svg/${t[0]}_${isDark() ? "dark" : "light"}.svg" alt="" loading="lazy" onerror="this.parentNode.classList.add('nologo')">` : "";
  return `<span class="logo${t ? "" : " nologo"}" style="--s:${size}px" role="img" aria-label="${esc(club || "no club")}" title="${esc(club || "")}">${img}${badge}</span>`;
}
// a logo that opens the club's team page (only where it isn't already inside another link)
const teamLogo = (club, size) => club ? `<a class="logo-link" href="${teamRoute(club)}" title="${esc(club)}">${logo(club, size)}</a>` : logo(club, size);
const nhlClubs = () => Object.keys(NHL_TEAMS).filter(c => D.players.some(p => clubOf(p) === c && p.lg === "NHL"))
  .sort((a, b) => a.localeCompare(b));
const abbrOf = club => (D.clubAbbr || {})[club];
const clubOfAbbr = abbr => Object.keys(D.clubAbbr || {}).find(c => D.clubAbbr[c] === abbr) || abbr;
const signed = (v, d = 1) => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const money = v => v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v).toLocaleString();
const salaryNum = s => { const m = String(s || "").replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : 0; };
const dash = '<span class="muted">–</span>';
const impPill = v => { if (v == null) return dash; const c = pctColor(v); return `<span class="pill" style="background:${c.bg};color:${c.fg}">${v}</span>`; };
const rankChip = (rank, n = 32) => rank == null ? dash
  : `<span class="rank r${rank <= n / 4 ? 1 : rank <= n / 2 ? 2 : rank <= 3 * n / 4 ? 3 : 4}">${ordinal(rank)}</span>`;
/* The page header shows the current section. */
function markNav(section) {
  document.querySelectorAll(".top nav a").forEach(a => {
    const on = a.dataset.nav === section;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
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
  const b = p.h.at(-1), a = p.h.filter(h => h[0] <= MOVE_BASE).at(-1);
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
  cl: p => `<td>${clubOf(p) ? `<a href="${teamRoute(clubOf(p))}">${esc(clubOf(p))}</a>` : dash}</td>`,
  lg: p => `<td>${esc(p.lg || "")}</td>`,
  ca: p => `<td class="num"><b>${fmt(p.ca, 0)}</b> ${stars(p.ca)}</td>`,
  pa: p => `<td class="num">${fmt(p.pa, 0)}</td>`,
  peak: p => `<td class="num">${fmt(sortVal(p, "peak"), 0)}</td>`,
  war: p => `<td class="num">${p.war ? fmt(p.war.war, 1) : dash}</td>`,
  imp: p => `<td class="num">${impPill(p.card?.comp?.impact)}</td>`,
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
const leagueList = () => [...new Set(D.players.map(p => p.lg))].filter(Boolean)
  .sort((a, b) => D.players.filter(p => p.lg === b).length - D.players.filter(p => p.lg === a).length);
function renderRankings() {
  markNav("players");
  const leagues = leagueList();
  const count = lg => D.players.filter(p => p.lg === lg).length;
  let rows = D.players.map(inSeason).map(rankRow).filter(p => (!R.lg || p.lg === R.lg) && (!R.grp || p.grp === R.grp)
    && (!R.team || clubOf(p) === R.team) && (!R.maxAge || p.age <= +R.maxAge));
  rows.sort((a, b) => {
    const x = sortVal(a, R.sort), y = sortVal(b, R.sort);
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * R.dir;
  });
  const total = rows.length;
  rows = rows.slice(0, R.limit);
  const clubs = [...new Set(D.players.filter(p => !R.lg || p.lg === R.lg).map(clubOf))].filter(Boolean).sort((a, b) => a.localeCompare(b));
  view.innerHTML = `
  <section class="band"><div class="wrap">
    <h1>Players</h1>
    <p class="lede">${D.players.length.toLocaleString()} players · snapshot ${fmtDate(D.dates.at(-1))} · est. CA and PA come from visible attributes only (see <a href="#/about">How it works</a>)</p>
    <nav class="lgtabs" aria-label="Leagues">${["", ...leagues].map(l =>
      `<button type="button" data-lg="${esc(l)}" class="${l === R.lg ? "on" : ""}" ${l === R.lg ? 'aria-current="page"' : ""}>${l ? esc(l) : "All leagues"}${l ? ` <span>${count(l)}</span>` : ""}</button>`).join("")}</nav>
  </div></section>
  <div class="wrap page">
    <form class="filters card-box" aria-label="Filters" onsubmit="return false">
      <fieldset><legend>Position</legend><div class="seg" id="f-grp">${[["", "All"], ["F", "Forwards"], ["D", "Defence"], ["G", "Goalies"]]
        .map(([v, t]) => `<button type="button" data-v="${v}" class="${v === R.grp ? "on" : ""}" aria-pressed="${v === R.grp}">${t}</button>`).join("")}</div></fieldset>
      <label>Club <select id="f-team"><option value="">All clubs</option>${clubs.map(c => `<option ${c === R.team ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
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
function barRow(label, raw, pct, title) {
  const c = pctColor(pct);
  return `<div class="bar" title="${esc(title || TIP_PCT)}">
    <div class="l">${esc(label)}${raw != null ? `<span>${esc(raw)}</span>` : ""}</div>
    <div class="track"><div class="fill" style="width:${Math.max(2, pct ?? 0)}%;background:${c.bg}"></div></div>
    <div class="v">${pct ?? "–"}</div></div>`;
}
function tile(label, pct, big) {
  const c = pctColor(pct);
  return `<div class="tile ${big ? "big" : ""}" style="background:${c.bg};color:${c.fg}" title="${TIP_PCT}">
    <div class="t">${esc(label)}</div><div class="p">${pct ?? "–"}</div></div>`;
}
function rawFmt(key, v) {
  if (v == null) return null;
  if (["toi_gp", "pp_toi", "pk_toi"].includes(key)) return `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;
  if (key === "svp") return v.toFixed(3).replace(/^0/, "");
  return v.toFixed(2);
}

let PMODE = "rs";  // player page: regular season (rs) or playoffs (po)
/* Important Matches (big-game) range from the scout report snippets, if any phrase pins it down. */
function bigGame(p) {
  const r = (p.sc?.ranges || []).find(x => x[0] === "Important Matches");
  return r ? (r[1] === r[2] ? `${r[1]}` : `${r[1]}–${r[2]}`) : null;
}
let PTAB = "overview";  // Prospect Profile layout: open tab
function renderPlayer(key, tab = "overview") {
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

  const comps = card.comp ? Object.keys(COMP_LABELS).filter(k => card.comp[k] != null) : [];
  const metricsDef = isG ? D.goalieMetrics : D.skaterMetrics;
  const metricRows = card.pct ? metricsDef.map(([k, label]) => barRow(label, rawFmt(k, card.raw?.[k]), card.pct[k])).join("") : "";
  const t = card.totals;
  const tags = [p.sc?.role ? "Role: " + p.sc.role : null,
    bigGame(p) ? `Big games (Important Matches): ${bigGame(p)}/20` : (p._po ? "Big-game rating unknown (no scout phrase)" : null), p.pr, p.dr, t ? `NHL: ${t.gp} GP · ${t.g} G · ${t.a} A · ${t.p} P` : null,
    p.dft?.pro?.pick != null ? `Drafted ${p.dft.pro.year} · #${p.dft.pro.pick} overall` : null,
    ...achTags(p)].filter(Boolean);
  const tagsHtml = tags.map(x => `<span class="tag">${esc(x)}</span>`).join("");

  const S = {};
  S.controls = `
  <div class="cardbar">
    <a href="#/players">← Players</a>
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
        <div class="meta">${p.no ? "#" + esc(p.no) + " · " : ""}${esc(p.pos)} · Age ${p.age} · ${esc(p.cl || p.tm)}${p.lg ? ` (${esc(p.lg)})` : ""}
          ${p.sh ? " · Shoots " + esc(p.sh[0]) : ""} · ${esc(p.ht)} · ${esc(p.wt)}</div>
        <div class="meta">${esc(p.nat)}${p.sal ? " · " + esc(p.sal) : ""}${p.exp ? " through " + esc(p.exp) : ""}</div>
        <div class="tags">${tagsHtml}</div>
      </div>
      <div class="badge"><b>EHM card</b>${fmtDate(D.dates.at(-1))}</div>
    </div>
    <div class="hero">
      <div><div class="lab">Est. current ability</div><div class="val">${fmt(p.ca, 0)}</div>
        <div class="note">${stars(p.ca)} · ${ordinal(card.ca_pct)} pct of ${grpName}</div></div>
      <div><div class="lab">Est. potential ability</div><div class="val">${fmt(p.pa, 0)}</div>
        <div class="note">${stars(p.pa)} · likely ${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</div></div>
      <div><div class="lab">Projected peak (${D.projectionMonths / 12} yrs)</div><div class="val">${fmt(peak.mid, 0)}</div>
        <div class="note">${peak.m === 0 ? "at or past peak now" : `around age ${Math.floor(peak.age)} · ${fmtDate(peak.date)}`}</div></div>
      <div><div class="lab">Change since ${fmtDate(D.dates[first[0]])}</div>
        <div class="val ${caChange > 0.5 ? "up" : caChange < -0.5 ? "down" : ""}">${caChange == null ? "–" : (caChange > 0 ? "+" : "") + caChange.toFixed(1)}</div>
        <div class="note">est. CA over ${p.h.length} snapshot${p.h.length > 1 ? "s" : ""}</div></div>
    </div>
    <div class="cols">
      <section>
        <h3>${isG ? "Goaltending" : "Impact profile"}</h3>
        ${comps.length ? `<div class="tiles">${comps.map(k => tile(COMP_LABELS[k], card.comp[k], k === "impact")).join("")}</div>`
          : `<div class="empty">No NHL box-score sample (needs ${isG ? 300 : D.minToi}+ minutes in the snapshots' NHL games).</div>`}
      </section>
      <section>
        <h3>${isG ? "Goalie rates" : "Rates & usage"}</h3>
        ${metricRows ? `<div class="bars">${metricRows}</div>` : `<div class="empty">No NHL rate stats for this player yet.</div>`}
      </section>
      <section>
        <h3>Attribute profile</h3>
        <div class="bars">${p.grpS.map(([name, avg, pct]) => barRow(name, avg.toFixed(1) + "/20", pct,
          `Average of the ${name.toLowerCase()} attributes; percentile vs all ${grpName} in the database`)).join("")}</div>
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
  view.querySelectorAll(".attr-grid tr[data-i]").forEach(tr => tr.onclick = () => {
    sel.value = tr.dataset.i; drawChart(p, proj, sel.value);
    reveal(view.querySelector("#chartpanel"));
  });
  view.querySelector("#png").onclick = () => exportCard(p, proj, X);
  view.querySelector("#pmode").onchange = e => { PMODE = e.target.value; renderPlayer(key, PTAB); };
  view.querySelector("#pseason").onchange = e => { SEASON = e.target.value; renderPlayer(key, PTAB); };
  view.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => reveal(view.querySelector("#" + b.dataset.jump)));
  drawChart(p, proj, "ca");
  renderAttrProjection(p, proj, 12);
  drawComps(p, proj, view.querySelector("#comps-mode button.on").dataset.m);
  drawCareer(p);
  view.querySelectorAll("#car-type button").forEach(b => b.onclick = () => { CTYPE = b.dataset.t; drawCareer(p); });
  view.querySelectorAll("#comps-mode button").forEach(b => b.onclick = () => drawComps(p, proj, b.dataset.m));
  initShotMaps(p);
  wireTabs(key, tab);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- player page layout
const PTABS = [["overview", "Overview"], ["stats", "Stats"], ["dev", "Development"], ["scout", "Scouting"],
               ["shots", "Shots"], ["comps", "Comparables"], ["awards", "Draft & awards"]];
function wireTabs(key, tab) {
  const btns = [...view.querySelectorAll(".ptabs [data-tab]")];
  if (!btns.length) return;
  const show = (t, focus) => {
    if (!view.querySelector(`.tabpane[data-tab="${t}"]`)) t = "overview";
    PTAB = t;
    btns.forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    view.querySelectorAll(".tabpane").forEach(s => (s.hidden = s.dataset.tab !== t));
    // replaceState doesn't fire hashchange, so switching tabs doesn't re-render the page
    history.replaceState(null, "", route(key) + (t === "overview" ? "" : "/" + t));
  };
  btns.forEach((b, i) => {
    b.onclick = () => show(b.dataset.tab);
    b.onkeydown = e => {   // arrow keys move between tabs
      const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (j == null) return;
      e.preventDefault(); show(btns[(j + btns.length) % btns.length].dataset.tab, true);
    };
  });
  show(tab);
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
function factRows(p, X) {
  const pro = draftLine(p.dft?.pro), jr = draftLine(p.dft?.junior);
  return [
    ["Age", p.age], ["Born", bornText(p)], ["Birthplace", p.bp], ["Nationality", p.nat], ["Position", p.pos],
    ["Number", p.no ? "#" + p.no : null], ["Shoots", p.sh], ["Height", p.ht], ["Weight", p.wt],
    ["Club", clubOf(p) ? `<a href="${teamRoute(clubOf(p))}">${esc(clubOf(p))}</a>` : null, true], ["League", p.lg],
    ["Contract", p.sal], ["Expires", p.exp], ["Condition", p.inj],
    ["Drafted", pro], ["Junior draft", jr], ["Role", p.sc?.role], ["Career role", p.sc?.career],
    ["Big games", bigGame(p) ? bigGame(p) + "/20" : null], ["Top prospect", p.pr], ["Draft ranking", p.dr],
    ["Est. CA", `${fmt(p.ca, 0)} ${stars(p.ca)}`, true], ["Est. PA", `${fmt(p.pa, 0)} ${stars(p.pa)} <span class="muted small">${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</span>`, true],
    ["Proj. peak", `${fmt(X.peak.mid, 0)}${X.peak.m ? ` <span class="muted small">age ${Math.floor(X.peak.age)}</span>` : ""}`, true],
  ].filter(r => r[1] != null && r[1] !== "");
}
const factList = rows => `<dl class="facts">${rows.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(v)}</dd>`).join("")}</dl>`;

function composePlayer(S, p, X) {
  const statsTab = `${S.career}
    <div class="panel"><h2>NHL box-score totals</h2><p class="sub">Games in this save's box scores (the source of the card's percentiles and WAR).</p>${totalsTable(p, X.t)}</div>`;
  const awards = S.ach || `<div class="panel"><h2>Draft &amp; achievements</h2><p class="sub">No draft or achievements recorded for this player.</p></div>`;
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
    <nav class="ptabs" role="tablist" aria-label="Player sections">${PTABS.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}">${t}</button>`).join("")}</nav>
  </div></section>
  <div class="wrap page player">
    <aside class="factbox card-box" aria-label="Player facts"><h2>Player facts</h2>${factList(factRows(p, X))}</aside>
    <div class="pmain">
      ${pane("overview", S.card)}${pane("stats", statsTab)}${pane("dev", S.attrs + S.chart)}${pane("scout", S.scout)}
      ${pane("shots", S.shots)}${pane("comps", S.comps)}${pane("awards", awards)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- career stats
/* Season-by-season lines like an NHL stats site, from the player's History tab: one line per club he played for
   in each season of the save (EHM shows nothing from before it), in any league. A finished NHL stint whose History
   line stopped early is completed from the box scores (src "box", marked †). NHL lines add PP/SH points, GWG, TOI
   and shutouts from the team's Statistics tab. Totals per league once he has two lines in it. */
const CAR_TYPES = [["R", "Regular season"], ["P", "Playoffs"], ["O", "Preseason & other"]];
let CTYPE = "R";
const careerLines = p => (byKey.get(p.k)?.car || []).map(r => Object.fromEntries((D.careerCols || []).map((c, i) => [c, r[i]])));
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
  const row = r => `<tr class="${r.total ? "total" : ""}"><th scope="row" class="nowrap">${r.total ? esc(r.season) : seasonLabel(r.season)}</th>
    <td class="nowrap">${team(r)}</td><td>${r.total ? "" : esc(r.league || "")}</td>${cols.map(([, f]) => `<td class="num">${f(r)}</td>`).join("")}</tr>`;
  box.innerHTML = `<table class="career"><thead><tr><th>Season</th><th>Team</th><th>League</th>${cols.map(([h]) =>
    `<th class="num"${tips[h] ? ` title="${tips[h]}"` : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row).join("")}</tbody>${totals.length ? `<tfoot>${totals.map(row).join("")}</tfoot>` : ""}</table>
    ${rows.some(r => r.src === "box") ? `<p class="small muted">† ${BOX}; the box scores miss about 2% of games.</p>` : ""}`;
}

// ---------------------------------------------------------------- draft + achievements
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
function achTags(p) {
  return (p.ach || []).filter(([, , t, k]) => k === "T" || k === "C" || (k === "A" && /National Hockey League (First|Second)/.test(t)))
    .map(([d, , t]) => `${achText(t).replace(/^\d+\/\d+ /, "")} (${d.slice(0, 4)})`);
}
function achievementsPanel(p) {
  const a = p.ach || [], pro = draftLine(p.dft?.pro), jr = draftLine(p.dft?.junior);
  if (!a.length && !pro && !jr) return "";
  const of = k => a.filter(x => k.includes(x[3]));
  const row = ([d, team, text]) => `<tr><td class="nowrap muted">${fmtDate(d)}</td><td>${esc(achText(text))}</td><td class="muted nowrap">${esc(team)}</td></tr>`;
  const table = rows => `<div class="tablewrap"><table class="fit"><tbody>${rows.map(row).join("")}</tbody></table></div>`;
  const counts = {};
  of("m").forEach(([, , text]) => { const t = achText(text).replace(/ for \w+$/, ""); counts[t] = (counts[t] || 0) + 1; });
  const sections = [["Trophies &amp; awards", of("T")], ["Award finalist", of("F")], ["Championships", of("Cc")], ["All-Star teams", of("A")]]
    .filter(([, r]) => r.length);
  return `<div class="panel" id="achpanel">
    <h2>Draft &amp; achievements</h2>
    <p class="sub">Draft from the player's Information tab. Achievements are the save's own log (History tab), so they
      start when the save started; real-life trophies from before then aren't in the game's database.</p>
    <div class="tags-plain">
      <div><span class="muted small">Drafted (pro)</span> <b>${esc(pro || "None recorded")}</b>${pro ? "" : ` <span class="muted small">(undrafted, or a pick the game's database lacks, e.g. some Arizona picks)</span>`}</div>
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
      <td class="num">${q.age}</td><td>${esc(q.pos)}</td><td>${esc(q.cl || q.tm || "")}${q.lg ? ` <span class="muted small">${esc(q.lg)}</span>` : ""}</td>
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
      ${w.pct != null ? `<span class="pill" style="background:${c.bg};color:${c.fg}" title="${TIP_PCT}">${ordinal(w.pct)} pct WAR/82 of ${grpName}</span>` : ""}
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
const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
function seqColor(t) {
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
  for (let i = 0; i < k.nu; i++) for (let j = 0; j < k.nv; j++) {
    const t = k.grid[i * k.nv + j] / k.max;
    if (t < 0.06) continue;
    out += `<rect x="${toX(u0 + i * step).toFixed(1)}" y="${toY(v0 + j * step).toFixed(1)}" width="${cellW + 0.6}" height="${cellH + 0.6}" fill="${seqColor(t)}" fill-opacity="${(0.25 + 0.7 * t).toFixed(2)}"/>`;
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
      <div class="seg" role="tablist">${modes.map(([k, t], i) => `<button type="button" data-m="${k}" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
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
    legend = `<span class="legend-scale">fewer <i style="background:linear-gradient(90deg,${SEQ.join(",")})"></i> more ${mode === "goals" ? "goals" : "shots"}</span>
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
  tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = (e.clientY + 14) + "px";
}

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
    (sections[sec] ||= []).push(`<tr data-i="${i}"><td>${esc(name)}</td><td class="num"><b>${v}</b></td>
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

  const W = 1000, H = 340, m = { l: 44, r: 70, t: 14, b: 30 };
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
  // month ticks: every 3 months for the CA chart, every month for attributes
  const tickEvery = isCA ? 6 : 1;
  const t = new Date(x0.getFullYear(), x0.getMonth() + 1, 1);
  for (let i = 0; t <= x1; i++, t.setMonth(t.getMonth() + 1)) {
    if (t.getMonth() % tickEvery !== (isCA ? 0 : t.getMonth() % tickEvery)) continue;
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
    tip.innerHTML = `<b>${fmtDate(best.date)}</b>${best.html}`;
    tip.hidden = false;
    const tx = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = tx + "px"; tip.style.top = (e.clientY + 14) + "px";
  });
  svg.querySelector("#hit").addEventListener("mouseleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
  // click a projected month: show the projected attributes for that date
  svg.querySelector("#hit").style.cursor = isCA ? "pointer" : "default";
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
function scoutPanel(p) {
  const s = p.sc;
  if (!s) return `<div class="panel" id="scoutpanel"><h2>Scout report &amp; hidden values</h2>
    <p class="sub">No scout report captured for this player yet. Run the crawler with <code>--scout</code> to read every
    player's Scout Report tab (stars, report text and role); the report phrases are then decoded into hidden-value ranges.</p></div>`;
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
function renderDraft() {
  markNav("draft");
  const ep = false;
  const { rows, stage } = draftBoard(DR.mode);
  const steals = rows.filter(s => s.ours <= 60).sort((a, b) => (b.nhl - b.ours) - (a.nhl - a.ours)).slice(0, 5);
  const fades = rows.filter(s => s.nhl <= 30).sort((a, b) => (a.nhl - a.ours) - (b.nhl - b.ours)).slice(0, 5);
  const line = s => `<li><a href="${route(s.p.k)}">${esc(s.p.n)}</a> <span class="muted">${esc(s.p.pos)}, ${esc(s.p.cl || "")}</span>
    · ours #${s.ours}, NHL #${s.nhl} <span class="muted">(${s.nhl - s.ours > 0 ? "+" : ""}${s.nhl - s.ours})</span></li>`;
  const modeName = { lo: "Safe (10th percentile outcome)", mid: "Balanced (expected outcome)", hi: "Upside (90th percentile outcome)" };
  view.innerHTML = `<div class="panel draftpage">
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
      Move = places gained since the previous NHL ranking. Safe / Upside = projected peak at the 10th / 90th percentile.${ep ? " Click a row to show its scout line; the name opens the card." : ""}</p>
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
        <td>${ep ? `<a href="${route(p.k)}"><b>${esc(p.n)}</b></a>${p.nat ? ` <span class="chip">${esc(p.nat)}</span>` : ""}` : `<b>${esc(p.n)}</b>`}</td><td>${esc(p.pos)}</td><td class="num">${p.age}</td><td>${esc(p.lg || "")}</td><td>${esc(p.cl || p.tm || "")}</td>
        <td class="num">${fmt(p.ca, 0)}</td><td class="num">${fmt(p.pa, 0)}</td>
        <td class="num"><b>${fmt(s.mid, 0)}</b> <span class="rangebar" title="${s.lo.toFixed(0)} – ${s.hi.toFixed(0)}"><i style="left:${W(s.lo)}%;width:${(W(s.hi) - W(s.lo)).toFixed(1)}%"></i><b style="left:${W(s.mid)}%"></b></span></td>
        <td class="num">${fmt(s.lo, 0)}</td><td class="num">${fmt(s.hi, 0)}</td>
        <td class="num">${p.sc?.fut != null ? `<span class="stars">${"★".repeat(p.sc.fut)}</span>` : '<span class="muted">–</span>'}</td>
        <td class="small">${esc(tierOf(s)) || '<span class="muted">–</span>'}</td>
        <td class="small">${esc(p.sc?.role || "") || '<span class="muted">–</span>'}</td>
        <td class="small">${esc(s.other) || '<span class="muted">–</span>'}</td></tr>${ep ? `
        <tr class="xrow" hidden><td colspan="${DRAFT_COLS.length}"><div class="xline">
          <span>Scout <span class="stars">${p.sc?.cur != null ? "★".repeat(p.sc.cur) : "–"}</span> now · <span class="stars">${p.sc?.fut != null ? "★".repeat(p.sc.fut) : "–"}</span> future</span>
          <span>Career role <b>${esc(p.sc?.career || "–")}</b></span><span>Preferred role <b>${esc(p.sc?.role || "–")}</b></span>
          <span>Previous NHL rank <b>${esc(s.prevTxt || "none")}</b></span><span>Other lists <b>${esc(s.other || "–")}</b></span>
          <span>${esc(p.bp || "")}</span><a href="${route(p.k)}">Open card →</a></div></td></tr>` : ""}`;
    }).join("");
    view.querySelector("#d-more-wrap").innerHTML = shown.length > DR.limit
      ? `<button class="ghost" id="d-more">Show more (${shown.length - DR.limit} left)</button>` : "";
    view.querySelector("#d-more")?.addEventListener("click", () => { DR.limit += 200; body(); });
    // Prospect Profile: a row click opens the scout line under it; the name links to the card
    view.querySelectorAll("#d-body tr.link").forEach(tr => tr.onclick = e => {
      if (e.target.closest("a")) return;
      if (ep) { const x = tr.nextElementSibling; x.hidden = !x.hidden; tr.classList.toggle("open", !x.hidden); }
      else playerRow(tr);
    });
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
  body();
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
    <svg class="chart" viewBox="0 0 ${W} ${H}" style="max-width:${W}px">${g}</svg>`;
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

function renderAbout() {
  markNav("about");
  const r = D.report, g = D.growth, G0 = seasonInfo().games || {};
  const bandRows = Object.entries(r.pa_by_age).map(([k, s]) =>
    `<tr><td>${k}</td><td class="num">${s.mae}</td><td class="num">${s.p90}</td><td class="num">${s.r2}</td>
     <td class="num">${r.pa_band_by_age[k][0]} / +${r.pa_band_by_age[k][1]}</td></tr>`).join("");
  view.innerHTML = `<div class="panel about">
  <h2>How it works</h2>
  <p class="sub">Built ${esc(D.built)} from ${D.dates.length} snapshots (${D.dates.map(fmtDate).join(", ")}).</p>

  <h3>Estimated CA and PA</h3>
  <p>EHM never sends current or potential ability to a client, so both are <b>estimated from what a client can see</b>:
  every profile attribute, position, age, height/weight, league, Top-Prospect rank and draft ranking, plus how fast the
  attributes have moved over the last 1-12 months. The models are trained on the hosted training save, where the true
  CA/PA can be read for scoring. The true values are never inputs and never shown here.</p>
  <p><b>This build used the ${esc(r.model_label || "fast model: gradient-boosted trees on the CPU")}.</b>
  Regular builds use the fast model; the accurate one is a separate, much slower build
  (Build Website - Accurate (GPU).bat): in the benchmark it cut the CA error from 3.29 to 2.51 and the PA error from 8.91 to 8.28.</p>
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
  The 80% band uses the PA range above plus the month-to-month noise of real growth.</p>
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
  <p>After a new snapshot run <code>Build Website.bat</code> (or <code>python build_data.py</code>), then refresh the page.
  For league data: <code>python build_data.py --data "../player data"</code>.</p>
  </div>`;
  // Stats Hub: sticky table of contents (buttons, not #anchors: the hash is the page route)
  {
    const panel = view.querySelector(".about"), hs = [...panel.querySelectorAll("h3")];
    hs.forEach((h, i) => (h.id = "ab-" + i));
    view.innerHTML = `<div class="about-wrap"><nav class="toc"><b>Contents</b>${hs.map((h, i) =>
      `<button type="button" data-i="${i}">${esc(h.textContent)}</button>`).join("")}</nav></div>`;
    view.querySelector(".about-wrap").append(panel);
    view.querySelectorAll(".toc button").forEach(b => b.onclick = () => view.querySelector("#ab-" + b.dataset.i).scrollIntoView({ behavior: "smooth" }));
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
const listRow = (p, right, meta) => `<a class="lrow" href="${route(p.k)}">${logo(clubOf(p), 30)}
  <span class="lmain"><b>${esc(p.n)}</b><small>${meta ?? `${esc(p.pos)} · ${p.age} · ${esc(clubOf(p))}${p.lg && p.lg !== "NHL" ? ` (${esc(p.lg)})` : ""}`}</small></span>${right}</a>`;

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
  const prospects = D.players.filter(p => p.age <= 20).sort((a, b) => b.pa - a.pa).slice(0, 5);
  const ranked = D.players.map(p => ({ p, r: nhlRanks(p) })).filter(x => x.r).sort((a, b) => a.r.rank - b.r.rank).slice(0, 5);
  const warTop = nhl.filter(p => p.war).sort((a, b) => b.war.war - a.war.war).slice(0, 5);
  const impTop = nhl.filter(p => p.card?.comp?.impact != null).sort((a, b) => b.card.comp.impact - a.card.comp.impact || (b.war?.war || 0) - (a.war?.war || 0)).slice(0, 5);
  const lgCount = lg => D.players.filter(p => p.lg === lg).length;
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
      <input id="home-q" type="search" placeholder="e.g. Demidov, Hutson, Cripps" autocomplete="off">
      <ul id="home-sug" class="sug" role="listbox" hidden></ul>
      <div class="hchips">${chips.map(([k, t]) => `<button type="button" data-chip="${esc(k)}">${t}</button>`).join("")}</div>
    </div>
  </div></section>
  <div class="wrap page home">
    <div class="row">
      <section class="card-box wide" aria-labelledby="top-h">
        <div class="box-head">
          <div class="box-title">${HOME_TEAM ? teamLogo(HOME_TEAM, 40) : ""}<div><h2 id="top-h">${HOME_TEAM ? esc(HOME_TEAM) : "Top players · NHL"}</h2>
            <p class="sub">${HOME_TEAM ? `Top ${top.length} by est. CA${rec ? ` · ${seasonLabel(SEASON)}: ${rec.w}–${rec.l}–${rec.otl}, ${rec.pts} points (${ordinal(rec.place)})` : ""}` : `By estimated current ability · WAR and impact: ${SEASON ? seasonLabel(SEASON) : ""} regular season`}</p></div></div>
          <label class="inline">Team <select id="home-team"><option value="">All NHL teams</option>${clubs.map(c => `<option ${c === HOME_TEAM ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
        </div>
        <div class="lhead" aria-hidden="true"><span>Player</span><span>Est. CA</span><span>WAR</span><span>Impact</span></div>
        ${top.map((p, i) => listRow(p, `<span class="lnum"><b>${fmt(p.ca, 0)}</b></span><span class="lnum">${p.war ? fmt(p.war.war, 1) : "–"}</span><span class="lnum">${impPill(p.card?.comp?.impact)}</span>`,
          `${i + 1}. ${esc(p.pos)} · ${p.age}${HOME_TEAM ? "" : " · " + esc(clubOf(p))} · PA ${fmt(p.pa, 0)} · peak ${fmt(sortVal(p, "peak"), 0)}`)).join("")}
        <a class="more-link" href="${HOME_TEAM ? teamRoute(HOME_TEAM) : "#/players"}">${HOME_TEAM ? `Full ${esc(HOME_TEAM)} roster →` : "All players →"}</a>
      </section>
      <section class="card-box" aria-labelledby="mv-h">
        <h2 id="mv-h">Biggest moves</h2>
        <p class="sub">Est. CA${prev ? `, ${fmtDate(prev)} → ${fmtDate(last)} (${days} days)` : ""}. Part of any jump can be estimation noise.</p>
        <h3 class="pos">Risers</h3>${risers.map(x => listRow(x.p, mv(x.d), `${esc(x.p.pos)} · ${x.p.age} · ${esc(clubOf(x.p))} · ${fmt(x.p.ca - x.d, 0)} → ${fmt(x.p.ca, 0)}`)).join("") || `<p class="muted small">Needs two snapshots.</p>`}
        ${fallers.length ? `<h3 class="neg">Fallers</h3>${fallers.map(x => listRow(x.p, mv(x.d), `${esc(x.p.pos)} · ${x.p.age} · ${esc(clubOf(x.p))} · ${fmt(x.p.ca - x.d, 0)} → ${fmt(x.p.ca, 0)}`)).join("")}` : ""}
      </section>
    </div>
    <div class="row three">
      <section class="card-box" aria-labelledby="pr-h"><h2 id="pr-h">Top prospects</h2><p class="sub">Age 20 and under, by est. PA (likely range)</p>
        ${prospects.map(p => listRow(p, `<span class="lnum stack"><b>${fmt(p.pa, 0)}</b><small>${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</small></span>`)).join("")}
        <a class="more-link" href="#/players" data-chip="u20">All prospects →</a></section>
      <section class="card-box" aria-labelledby="dr-h"><h2 id="dr-h">NHL draft ranking</h2><p class="sub">${ranked.length ? `${esc(ranked[0].r.stage)} list · official rank, est. PA` : "Official rank, est. PA"}</p>
        ${ranked.map(({ p, r }) => listRow(p, `<span class="lnum"><b>${fmt(p.pa, 0)}</b></span>`, `#${r.rank} · ${esc(p.pos)} · ${esc(clubOf(p))}${p.lg ? ` (${esc(p.lg)})` : ""}`)).join("") || `<p class="muted small">No NHL draft ranking in the latest snapshot.</p>`}
        <a class="more-link" href="#/draft">Draft board →</a></section>
      <section class="card-box" aria-labelledby="ld-h"><h2 id="ld-h">NHL leaders</h2><p class="sub">${SEASON ? seasonLabel(SEASON) : ""} regular season</p>
        ${warTop.length || impTop.length ? `<div class="split">
          <div><h3>WAR</h3>${warTop.map(p => listRow(p, `<span class="lnum"><b>${fmt(p.war.war, 1)}</b></span>`, esc(p.pos))).join("")}</div>
          <div><h3>Impact</h3>${impTop.map(p => listRow(p, `<span class="lnum"><b>${p.card.comp.impact}</b></span>`, esc(p.pos))).join("")}</div>
        </div>` : `<p class="muted small">No NHL box scores for this season yet.</p>`}</section>
    </div>
    <p class="foot-note">Est. CA and PA are estimated from what an EHM client can see; the training save's true values are only used to train and test the models. <a href="#/about">How it works</a></p>
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
    if (c === "u20") Object.assign(R, { maxAge: "20", sort: "pa" });
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

// ---------------------------------------------------------------- teams
function renderTeams(club, tab = "roster") {
  markNav("teams");
  const players = D.players.map(inSeason);
  if (!club) {
    const clubs = nhlClubs(), tbl = teamTable(SEASON);
    const others = {};
    players.forEach(p => { const c = clubOf(p); if (c && !NHL_TEAMS[c]) (others[p.lg || "No league"] ||= new Set()).add(c); });
    view.innerHTML = `<section class="band"><div class="wrap"><h1>Teams</h1>
      <p class="lede">Every NHL club with its record${SEASON ? ` (${seasonLabel(SEASON)})` : ""}, listed payroll and best player. Other clubs are below.</p></div></section>
      <div class="wrap page">
        <div class="team-grid">${clubs.map(c => {
          const ps = players.filter(p => clubOf(p) === c), r = tbl?.teams?.[abbrOf(c)];
          const best = ps.slice().sort((a, b) => b.ca - a.ca)[0];
          const pay = ps.reduce((s, p) => s + salaryNum(p.sal), 0);
          return `<a class="team-card" href="${teamRoute(c)}">${logo(c, 44)}<span><b>${esc(c)}</b>
            <small>${r ? `${r.w}–${r.l}–${r.otl} · ${r.pts} pts (${ordinal(r.place)})` : `${ps.length} players`}</small>
            <small>${pay ? money(pay) : ""}${best ? ` · ${esc(best.n)} ${fmt(best.ca, 0)}` : ""}</small></span></a>`;
        }).join("")}</div>
        ${Object.entries(others).sort((a, b) => b[1].size - a[1].size).map(([lg, cs]) => `<details class="card-box"><summary><b>${esc(lg)}</b> <span class="muted">${cs.size} clubs</span></summary>
          <div class="club-list">${[...cs].sort((a, b) => a.localeCompare(b)).map(c => `<a href="${teamRoute(c)}">${esc(c)}</a>`).join("")}</div></details>`).join("")}
      </div>`;
    return;
  }
  const ps = players.filter(p => clubOf(p) === club);
  if (!ps.length) { view.innerHTML = `<div class="wrap page"><div class="panel">Unknown club. <a href="#/teams">All teams</a></div></div>`; return; }
  const abbr = abbrOf(club), statSeasons = SEASONS.filter(s => teamTable(s)?.teams?.[abbr]);
  if (tab === "stats" && !statSeasons.length) tab = "roster";
  const tbl = teamTable(SEASON), rec = tbl?.teams?.[abbr];
  const lgs = [...new Set(ps.map(p => p.lg).filter(Boolean))];
  const pay = ps.reduce((s, p) => s + salaryNum(p.sal), 0);
  const isNhl = !!NHL_TEAMS[club];
  const strip = isNhl ? `<nav class="team-strip" aria-label="All NHL teams"><div class="wrap">${nhlClubs().map(c =>
    `<a href="${teamRoute(c)}${tab === "stats" ? "/stats" : ""}" class="${c === club ? "on" : ""}" ${c === club ? 'aria-current="page"' : ""} aria-label="${esc(c)}">${logo(c, 32)}</a>`).join("")}</div></nav>` : "";
  view.innerHTML = `${strip}
  <section class="band"><div class="wrap">
    <div class="team-head">${logo(club, 72)}
      <div class="grow"><h1>${esc(club)}</h1><p class="lede">${esc(lgs.join(", ") || "No league")} · ${ps.length} players${rec ? ` · ${seasonLabel(SEASON)}: ${rec.w}–${rec.l}–${rec.otl}, ${rec.pts} points (${ordinal(rec.place)})` : ""} · snapshot ${fmtDate(D.dates.at(-1))}</p></div>
      ${isNhl ? `<label class="inline">Team <select id="team-sel">${nhlClubs().map(c => `<option ${c === club ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : `<a href="#/teams">All teams</a>`}
    </div>
    <nav class="ptabs" role="tablist" aria-label="Team sections">
      <button type="button" role="tab" data-tab="roster" class="${tab === "roster" ? "on" : ""}" aria-selected="${tab === "roster"}">Roster</button>
      ${statSeasons.length ? `<button type="button" role="tab" data-tab="stats" class="${tab === "stats" ? "on" : ""}" aria-selected="${tab === "stats"}">Team stats</button>` : ""}
    </nav>
  </div></section>
  <div class="wrap page">${tab === "stats" ? teamStatsTab(club, abbr, statSeasons) : rosterTab(club, ps, pay)}</div>`;
  view.querySelector("#team-sel")?.addEventListener("change", e => (location.hash = teamRoute(e.target.value) + (tab === "stats" ? "/stats" : "")));
  view.querySelectorAll(".ptabs [data-tab]").forEach(b => b.onclick = () => (location.hash = teamRoute(club) + (b.dataset.tab === "stats" ? "/stats" : "")));
  view.querySelector("#t-season")?.addEventListener("change", e => { SEASON = e.target.value; renderTeams(club, tab); });
  if (tab === "roster") bindRoster(club, ps);
  else view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
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
  ["imp", "Impact", p => p.card?.comp?.impact ?? null, true, p => `<td class="num">${impPill(p.card?.comp?.impact)}</td>`, 70],
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
    view.querySelectorAll(`table.roster tr.frow input[data-k="${inp.dataset.k}"]`).forEach(o => { if (o !== inp) o.value = inp.value; });
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
      <p class="sub">${r.gp} of ${club}'s games are in the box scores${share < 0.95 && share > 0.8 ? " (a few weren't captured)" : ""}. Ranks are out of ${T.n} teams; 1st is best.</p></div>
      ${seasons.length > 1 ? `<label class="inline">Season <select id="t-season">${seasons.slice().reverse().map(s => `<option value="${s}" ${s === SEASON ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>` : ""}</div>
    <div class="stat-cards">
      <div><span>Record (W–L–OTL)</span><b>${r.w}–${r.l}–${r.otl}</b><small>${r.gp} GP</small></div>
      <div><span>Points</span><b>${r.pts}</b><small>${ordinal(r.place)} of ${T.n} · league avg ${statFmt("pts", T.avg.pts)}</small></div>
      <div><span>Points %</span><b>${statFmt("pts_pct", r.stats.pts_pct[0])}</b><small>${ordinal(r.stats.pts_pct[1])}</small></div>
      <div><span>Goal difference</span><b>${signed(r.gf - r.ga, 0)}</b><small>${ordinal(r.stats.gd[1])} · ${r.gf} GF, ${r.ga} GA</small></div>
      <div><span>Home</span><b>${rec(r.home)}</b><small>W–L–OTL</small></div>
      <div><span>Away</span><b>${rec(r.away)}</b><small>W–L–OTL</small></div>
      <div><span>Last 10</span><b>${rec(r.last10)}</b><small>to ${fmtDate(r.last)}</small></div>
    </div>
    <div class="row four">${STAT_GROUPS.map(([title, sub, keys]) => `<section class="card-box"><h3 class="box-h3">${title}</h3><p class="sub">${title === "Expected goals" ? `The ${r.xg_games} games with a shot chart` : sub}</p>
      <div class="srow head" aria-hidden="true"><span>Stat</span><span>${esc(abbr)}</span><span>League</span><span>Rank</span></div>
      ${keys.map(k => `<div class="srow"><span>${label[k] || k}</span><b>${statFmt(k, r.stats[k][0])}</b><span class="muted">${statFmt(k, T.avg[k])}</span><span>${rankChip(r.stats[k][1], T.n)}</span></div>`).join("")}
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
                 detail: `${H2.home} ${th.w}–${th.l}–${th.otl} (${signed(th.gf - th.ga, 0)}) · ${H2.away} ${ta.w}–${ta.l}–${ta.otl} (${signed(ta.gf - ta.ga, 0)})` });
  }
  const z = B.b0 + parts.reduce((s, x) => s + x.z, 0);
  const p = 1 / (1 + Math.exp(-z));
  const pct = v => (100 * v).toFixed(1) + "%";
  const maxZ = Math.max(0.6, ...parts.map(x => Math.abs(x.z)), Math.abs(B.b0));
  const bar = v => { const w = Math.min(50, Math.abs(v) / maxZ * 50); return `<span class="fbar"><i class="${v >= 0 ? "h" : "a"}" style="width:${w}%"></i></span>`; };
  const R2 = M.results, bands = M.bands;
  const gOpts = (side, list) => (list.length ? list : [null]).map((g, i) => `<option value="${i}" ${i === H2[side] ? "selected" : ""}>${g ? `${esc(g.n)} (${fmt(g.ca, 0)})` : `League-average starter (${fmt(avgG, 0)})`}</option>`).join("");
  const missing = [H2.home, H2.away].filter(c => !lineupOf(c).goalies.length);
  const teamPick = (side, id) => `<div class="tpick">${logo(H2[side], 56)}<div>
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
    ? `<div class="asset">${logo(clubOf(x.p), 30)}<div class="grow"><b><a href="${route(x.p.k)}">${esc(x.p.n)}</a></b>
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
      <div class="tpick">${logo(c, 48)}<div class="grow"><label for="t-${s}">Team ${s.toUpperCase()}</label>
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
      <div class="tablewrap"><table><thead><tr><th>WAR</th><th class="num">${logo(TR.a, 20)} ${esc(TR.a)} gets</th><th class="num">${logo(TR.b, 20)} ${esc(TR.b)} gets</th><th class="num">Edge</th></tr></thead>
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
          return `<div class="caprow">${logo(c, 28)}<b class="grow">${esc(c)}</b><span>${money(before)} → <b>${money(after)}</b></span>${capNum ? `<span class="delta ${after > capNum ? "neg" : "pos"}">${after > capNum ? "over by " + money(after - capNum) : money(capNum - after) + " space"}</span>` : ""}</div>`; }).join("")}
        <p class="sub">The cap is a league setting a client can't read; it's remembered on this computer.</p>
      </section>
      <section class="card-box" aria-labelledby="pk-h"><h2 id="pk-h">How picks are valued</h2>
        ${pk ? `<p class="sub">Expected NHL WAR over 5 seasons of his prime (${D.predict.prime5[0]}–${D.predict.prime5.at(-1)} seasons after the draft) of the player taken at each slot in this save, the same 5-season length the players are valued on. Drafted players who never made it count as 0. Smoothed so an earlier pick is always worth more.</p>
        <div class="slot-grid">${S.map(k => `<div><span>Pick #${k}</span><b>${fmt(pickValue(k).five, 1)}</b></div>`).join("")}</div>
        <p class="small">Round averages: ${pk.rounds.map((v, i) => `R${i + 1} ${fmt(v, 2)}`).join(" · ")}</p>
        ${pickCheck(pk)}
        <p class="sub">From ${pk.seasons.map(seasonLabel).join(", ")} (draft classes ${pk.draft_years[0]}–${pk.draft_years[1]}). Leaving one draft year out at a time: error ${pk.validation.model} WAR per pick vs ${pk.validation.flat} for "every pick is average". Refitted at every build: more seasons sharpen it.</p>${borrowed(pk)}`
        : `<p class="sub">Needs a complete NHL season in the box scores.</p>`}
        ${cw ? `<p class="sub">Players' expected WAR comes from a curve of season WAR by pre-season est. CA (${cw.seasons.map(seasonLabel).join(", ")}; see How it works).</p>${borrowed(cw)}` : ""}
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

// ---------------------------------------------------------------- router
function render() {
  const raw = location.hash.slice(1), h = decodeURIComponent(raw);
  tip.hidden = true;
  if (raw.startsWith("/p/")) {
    markNav("players");
    // #/p/<encoded key>[/<tab>]: the key is URI-encoded, so a raw "/" only separates the tab
    const [k, tab] = raw.slice(3).split("/");
    renderPlayer(decodeURIComponent(k), tab || "overview");
    return;
  }
  if (h === "/players") renderRankings();
  else if (h === "/about") renderAbout();
  else if (h === "/draft") renderDraft();
  else if (h === "/teams") renderTeams(null);
  else if (raw.startsWith("/team/")) {
    const [c, tab] = raw.slice(6).split("/");
    renderTeams(decodeURIComponent(c), tab === "stats" ? "stats" : "roster");
  }
  else if (h === "/h2h") renderH2H();
  else if (h === "/trade") renderTrade();
  else renderHome();
  window.scrollTo(0, 0);
}
if (!D) {
  view.innerHTML = `<div class="wrap page"><div class="panel">No data found. Run <code>python build_data.py</code> in the website folder first.</div></div>`;
} else {
  D.players.forEach(p => { p._n = fold(p.n); byKey.set(p.k, p); });
  if (!document.title.startsWith(D.title)) document.title += " · " + D.title;
  addEventListener("hashchange", render);
  render();
}
