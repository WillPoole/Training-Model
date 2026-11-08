"use strict";

// ---------------------------------------------------------------- players (rankings)
/* Players page state (the page itself is in 04b-players-page.js): filters, sort, rows shown, the topic tab (set by the router),
   the Development switch (future / movers) and the chosen trait on the Traits tab. A sort the tab doesn't show falls back to its default. */
const R = { lg: "NHL", grp: "", team: "", maxAge: "", sort: "", dir: -1, limit: 100, tab: "overview", dev: "future", trait: "", fopen: false };
function sortVal(p, k) {
  if (k === "imp") return p.card?.comp?.impact ?? -1;
  if (k === "war") return p.war?.war ?? -99;
  if (k === "peak") return peakInfo(p).mid;
  return p[k];
}
/* The projection's peak: its value (the site's own project()), the age he reaches it and the 80% range there. Cached on the
   live player (inSeason / rankRow make spread copies). */
function peakInfo(p) {
  const o = byKey.get(p.k) || p;
  if (!o._pk) {
    const path = project(o);
    let i = 0;
    path.forEach((x, j) => { if (x.mid > path[i].mid) i = j; });
    o._pk = { mid: path[i].mid, lo: path[i].lo, hi: path[i].hi, age: path[i].age };
    o._peak = o._pk.mid;
  }
  return o._pk;
}
const liveContract = p => { const o = byKey.get(p.k) || p; return o._cv === undefined ? (o._cv = contractValue(o)) : o._cv; };
const capHit = p => salaryNum(p.sal) || null;
const tint = v => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const chgCell = v => `<td class="num ${tint(Math.abs(v ?? 0) < 0.05 ? 0 : v)}">${v == null ? dash : signed(v, 1)}</td>`;
/* Column library [header, sort value, numeric, cell, tooltip] the Players tabs pick from (plRC). Values may be null (a dash, sorted last either way). */
const RC = {
  pos: ["Pos", p => p.pos, false, p => `<td>${esc(p.pos)}</td>`],
  age: ["Age", p => p.age, true, p => `<td class="num">${p.age}</td>`],
  lg: ["League", p => p.lg || "", false, p => `<td>${esc(p.lg || "")}</td>`],
  ca: ["Est. CA", p => p.ca, true, p => `<td class="num"><b>${fmt(p.ca, 0)}</b></td>`, "Current ability, estimated from visible attributes"],
  pa: ["Est. PA", p => p.pa, true, p => `<td class="num">${fmt(p.pa, 0)}</td>`, "Potential ability, estimated"],
  peak: ["Proj. peak", p => peakInfo(p).mid, true, p => { const k = peakInfo(p); return `<td class="num"><b>${fmt(k.mid, 0)}</b> <span class="muted small">${fmt(k.lo, 0)}–${fmt(k.hi, 0)}</span></td>`; }, "Best est. CA on his projected path, with the 80% range at that point"],
  left: ["Growth left", p => peakInfo(p).mid - p.ca, true, p => chgCell(peakInfo(p).mid - p.ca), "Projected peak minus est. CA now"],
  pkage: ["Peak age", p => peakInfo(p).age, true, p => `<td class="num">${fmt(peakInfo(p).age, 0)}</td>`, "Age at which the projection first reaches its peak"],
  war: ["WAR", p => p.war?.war ?? null, true, p => `<td class="num">${p.war ? fmt(p.war.war, 1) : dash}</td>`, "Wins above replacement in the chosen season and game type"],
  war82: ["WAR/82", p => p.war?.war82 ?? null, true, p => `<td class="num">${p.war?.war82 == null ? dash : fmt(p.war.war82, 1)}</td>`, "WAR per 82 games"],
  imp: ["NHL impact", p => p.card?.comp?.impact ?? null, true, p => `<td class="num">${impPill(p.card?.comp?.impact, pRankHref("c", "impact", p.grp, p.k))}</td>`, "Overall impact percentile"],
  cap: ["Cap hit", p => capHit(p), true, p => `<td class="num">${capHit(p) ? money(capHit(p)) : dash}</td>`, "Listed salary"],
  seas: ["Seasons left", p => (p.lg === "NHL" ? liveContract(p)?.seasons ?? null : null), true, p => { const c = p.lg === "NHL" ? liveContract(p) : null; return `<td class="num">${c ? c.seasons : dash}</td>`; }, "Seasons left on the deal in force, this one included; a signed extension isn't counted (NHL)"],
  ewar: ["Exp. WAR", p => (p.lg === "NHL" ? liveContract(p)?.now ?? null : null), true, p => { const c = p.lg === "NHL" ? liveContract(p) : null; return `<td class="num">${c ? war1(c.now) : dash}</td>`; }, "Expected WAR this season (NHL)"],
  surplus: ["Surplus", p => (p.lg === "NHL" ? liveContract(p)?.surplus ?? null : null), true, p => { const c = p.lg === "NHL" ? liveContract(p) : null; return `<td class="num ${c ? tint(c.surplus) : ""}">${c ? `<b>${signedMoney(c.surplus)}</b>` : dash}</td>`; }, "Worth over the deal minus cap hit (NHL), see Team > Contracts"],
  chg: ["Last change", p => lastMove(p), true, p => chgCell(lastMove(p)), "Change in est. CA since the latest snapshot at least 28 days old"],
  chg4: ["~4 months", p => lastMove4(p), true, p => chgCell(lastMove4(p)), "Change in est. CA over about 4 months; blank when the history is shorter"],
};
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
/* The season <select> of every page. single = what a single season shows: "hide" nothing, "disable" a disabled select,
   "show" an ordinary one. Newest season first unless oldestFirst. */
function seasonSelect(id, seasons, cur, { cls = "inline", single = "hide", oldestFirst = false } = {}) {
  if (seasons.length < 2 && single === "hide") return "";
  const list = oldestFirst ? seasons : seasons.slice().reverse();
  return `<label class="${cls}">Season <select id="${id}"${seasons.length < 2 && single === "disable" ? " disabled" : ""}>${list.map(s =>
    `<option value="${s}" ${s === cur ? "selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label>`;
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
