"use strict";

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
/* A player's deals (p.ct from ehm/site/contracts.py: the game's Contract tab, or worked out from his snapshots; without it,
   the one deal his profile shows). A season is its end year, 2030 = 2029-30. The next deal's cap hit is null until known. */
const seasonEndNow = () => { const d = new Date(D.dates.at(-1) + "T00:00:00"); return d.getFullYear() + (d.getMonth() >= 6 ? 1 : 0); };
const seasonName = e => `${e - 1}-${String(e % 100).padStart(2, "0")}`;
function expSeason(text) {
  const t = String(text || "").trim();
  let m = t.match(/^([A-Z][a-z]{2}) (\d{4})$/);
  if (m) return +m[2] + ("Sep Oct Nov Dec".includes(m[1]) ? 1 : 0);
  m = t.match(/^(\d{1,2})\.\d{1,2}\.(\d{2})$/);
  return m ? 2000 + +m[2] + (+m[1] >= 9 ? 1 : 0) : null;
}
function dealsOf(p) {
  const o = byKey.get(p.k) || p;
  return (o._deals ??= o.ct?.deals?.length ? o.ct.deals : o.sal || o.exp ? [{ s: null, e: expSeason(o.exp), sal: salaryNum(o.sal) || null }] : []);
}
function contractInfo(p) {
  const now = seasonEndNow(), deals = dealsOf(p);
  const cur = deals.findLast(d => (d.s == null || d.s <= now) && (d.e == null || d.e >= now)) || null;
  const next = deals.find(d => d !== cur && d.s != null && d.s > now) || null;
  return { now, deals, cur, next, past: deals.filter(d => d.e != null && d.e < now), last: deals.at(-1) || null };
}
const dealIn = (p, season) => dealsOf(p).find(d => (d.s == null || d.s <= season) && d.e != null && d.e >= season) || null;
/* When the deal in force runs out: the game's own expiry text when he has one deal, else the season's June. */
function contractEnds(p) {
  const { cur, next } = contractInfo(byKey.get(p.k) || p);
  if (!cur) return p.exp || "";
  return next || expSeason(p.exp) !== cur.e ? `Jun ${cur.e}` : p.exp || "";
}
/* RFA or UFA when his last deal ends: the game's words if the Contract tab was read, else by age at expiry (marked *). */
function faStatus(p) {
  const o = byKey.get(p.k) || p, st = o.ct?.st || "", last = dealsOf(o).at(-1);
  if (/unrestricted/i.test(st)) return { t: "UFA", full: st };
  if (/restricted/i.test(st)) return { t: "RFA", full: st };
  if (!last?.e) return null;
  const age = o.age + (last.e - seasonEndNow());
  return { t: (age < 27 ? "RFA" : "UFA") + "*", full: "Estimated from his age at expiry" };
}
function contractSeasons(p) {
  const { now, cur, next } = contractInfo(p), today = new Date(D.dates.at(-1) + "T00:00:00");
  const lastSeason = next?.e ?? cur?.e;
  if (lastSeason == null) return [];
  const start = new Date(now - 1, 9, 1), stop = new Date(now, 3, 15);
  const frac0 = Math.max(0, Math.min(1, (stop - today) / (stop - start)));
  const out = [];
  for (let k = 0; now + k <= lastSeason; k++) {
    if (k === 0 && !frac0) continue;
    const deal = dealIn(p, now + k);
    if (deal) out.push({ k, frac: k ? 1 : frac0, season: now + k, deal, pay: deal.sal ?? null, ext: deal !== cur });
  }
  return out;
}
/* One row per season left: what he's worth against what he's paid. A season whose pay isn't known yet has no surplus. */
function contractYears(p) {
  const M = market(), v = playerValue(p), pr = p._proj, pull = v.now - v.ability;
  return contractSeasons(p).map(y => {
    const war = y.k === 0 ? v.now : expWar(p.grp, pr[Math.min(12 * y.k, pr.length - 1)].mid) + pull;
    const worth = M.min + war * M.perWar;
    return { ...y, war, worth, surplus: y.pay == null ? null : worth - y.pay };
  });
}
function contractValue(p) {
  const info = contractInfo(p), sal = info.cur?.sal ?? salaryNum(p.sal), M = market();
  const years = contractSeasons(p).length ? contractYears(p) : [];
  if (!sal || !years.length || !M.perWar) return null;
  let war = 0, surplus = 0, n = 0;
  for (const y of years) {
    if (y.pay == null) continue;
    war += y.war * y.frac; surplus += y.surplus * y.frac; n += y.frac;
  }
  const v = playerValue(p), seasons = years.filter(y => !y.ext).length;
  return { sal, seasons, extSeasons: years.length - seasons, next: info.next, now: v.now, perM: v.now / (sal / 1e6), war, surplus, perSeason: n ? surplus / n : 0 };
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
// Home opens on All NHL teams for every visitor; the Team dropdown choice lasts until the page is reloaded
let HOME_TEAM = "";
function renderHome() {
  markNav("home");
  const n = D.dates.length, last = D.dates[n - 1], prev = MOVE_BASE == null ? null : D.dates[MOVE_BASE];
  const days = prev ? Math.round((new Date(last + "T00:00:00") - new Date(prev + "T00:00:00")) / 864e5) : 0;
  const nhl = D.players.filter(p => p.lg === "NHL").map(inSeason);
  const clubs = nhlClubs();
  if (HOME_TEAM && !clubs.includes(HOME_TEAM)) HOME_TEAM = "";
  const T = HOME_TEAM;
  const top = (T ? nhl.filter(p => clubOf(p) === T) : nhl).sort((a, b) => b.ca - a.ca).slice(0, T ? 8 : 10);
  const moves = D.players.map(p => ({ p, d: lastMove(p) })).filter(x => x.d != null);
  const up = list => list.slice().sort((a, b) => b.d - a.d), down = list => list.slice().sort((a, b) => a.d - b.d);
  const warTop = g => nhl.filter(p => p.war && (g === "G") === (p.grp === "G")).sort((a, b) => b.war.war - a.war.war).slice(0, 5);
  const impTop = nhl.filter(p => p.card?.comp?.impact != null).sort((a, b) => b.card.comp.impact - a.card.comp.impact || (b.war?.war || 0) - (a.war?.war || 0)).slice(0, 5);
  const prospects = D.players.filter(p => p.age <= 20).sort((a, b) => sortVal(b, "peak") - sortVal(a, "peak")).slice(0, 6);
  const ranked = draftBoard("mid").rows.slice(0, 6);
  const chips = [...leagueList().slice(0, 6).map(l => [l, `${esc(l)} <span class="muted">${leagueCount(l)}</span>`]), ["u20", "Prospects ≤ 20"], ["G", "Goalies"]];
  const mv = d => `<span class="delta ${d > 0 ? "pos" : "neg"}">${signed(d)}</span>`;
  const mvRow = x => listRow(x.p, mv(x.d), `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))} · ${fmt(x.p.ca - x.d, 0)} → ${fmt(x.p.ca, 0)}`);
  const leaderRow = p => listRow(p, `<span class="lnum">${rankLink(pRankHref("war", "war", p.grp, p.k), `<b>${fmt(p.war.war, 1)}</b>`)}</span>`, `${esc(p.pos)} · ${esc(clubOf(p))}`);
  const since = prev ? `${fmtDate(prev)} → ${fmtDate(last)} (${days} days)` : "";
  const partial = hasShotData() ? "" : " Skater WAR is partial: this build has no shot data.";
  const rec = T && teamTable(SEASON)?.teams?.[abbrOf(T)];
  const roster = T ? D.players.filter(p => clubOf(p) === T).map(inSeason) : [];
  const expYear = String(nextDraftYear());
  const pay = roster.reduce((s, p) => s + salaryNum(p.sal), 0), expiring = roster.filter(p => String(p.exp || "").includes(expYear)).length;
  const summary = T ? `<div class="keynums">
      <div class="kn"><div class="lab">Record · ${SEASON ? seasonLabel(SEASON) : ""}</div>${rec ? `<div class="val">${rec.w}–${rec.l}–${rec.otl}</div><div class="note">${rec.pts} points · ${rankLink(teamRankHref("pts", T), ordinal(rec.place))}</div>` : `<div class="val muted">–</div>`}</div>
      <div class="kn"><div class="lab">Team WAR</div><div class="val">${fmt(roster.reduce((s, p) => s + (p.war?.war || 0), 0), 1)}</div>${hasShotData() ? "" : `<div class="note warnnote">Partial: no shot data in this build</div>`}</div>
      <div class="kn"><div class="lab">Listed payroll</div><div class="val">${pay ? money(pay) : "–"}</div><div class="note"><a href="${teamRoute(T)}/contracts">Contracts →</a></div></div>
      <div class="kn"><div class="lab">Expiring ${expYear}</div><div class="val">${expiring}</div><div class="note">${roster.length} players on the club</div></div>
    </div>` : "";
  const topBox = `<section class="card-box wide" aria-labelledby="top-h"><h2 id="top-h">${T ? "Top players" : "Top players · NHL"}</h2>
      <p class="sub">${T ? `Top ${top.length} by est. CA` : "By estimated current ability"} · WAR and impact: ${SEASON ? seasonLabel(SEASON) : ""} regular season</p>
      <div class="lhead" aria-hidden="true"><span>Player</span><span>Est. CA</span><span>WAR</span><span>Impact</span></div>
      ${top.map((p, i) => listRow(p, `<span class="lnum"><b>${fmt(p.ca, 0)}</b></span><span class="lnum">${p.war ? fmt(p.war.war, 1) : "–"}</span><span class="lnum">${impPill(p.card?.comp?.impact, pRankHref("c", "impact", p.grp, p.k))}</span>`,
        `${i + 1}. ${esc(p.pos)} · ${p.age}${T ? "" : " · " + esc(clubOf(p))} · PA ${fmt(p.pa, 0)} · peak ${fmt(sortVal(p, "peak"), 0)}`)).join("")}
      <a class="more-link" href="${T ? teamRoute(T) : "#/players"}">${T ? `Full ${esc(T)} roster →` : "All players →"}</a></section>`;
  const movesBox = (title, id, list, nUp, nDown, empty) => {
    const r = up(list.filter(x => x.d > 0)).slice(0, nUp), f = down(list.filter(x => x.d < 0)).slice(0, nDown);
    return `<section class="card-box" aria-labelledby="${id}"><h2 id="${id}">${title}</h2><p class="sub">Est. CA${since ? `, ${since}` : ""}. Part of any jump can be estimation noise.</p>
      ${r.length ? `<h3 class="pos">Risers</h3>${r.map(mvRow).join("")}` : ""}${f.length ? `<h3 class="neg">Fallers</h3>${f.map(mvRow).join("")}` : ""}${r.length || f.length ? "" : `<p class="muted small">${empty}</p>`}</section>`;
  };
  const mine = T ? listedBy(T).map(p => ({ p, peak: sortVal(p, "peak") })).sort((a, b) => b.peak - a.peak).slice(0, 4) : [];
  const teamSide = T ? `<div class="sidecol">${movesBox(`${esc(T)} moves`, "tm-h", moves.filter(x => clubOf(x.p) === T), 3, 3, "No moves since the last snapshot.")}
      <section class="card-box" aria-labelledby="tp-h"><h2 id="tp-h">${T === MY_TEAM ? "Our top prospects" : `${esc(T)} prospects`}</h2><p class="sub">By projected peak (est. PA below it)</p>
        ${mine.map(x => prospectRow(x, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}`)).join("") || `<p class="muted small">None on the club's list.</p>`}
        <a class="more-link" href="${teamRoute(T)}/prospects">Prospects &amp; picks →</a></section></div>` : movesBox("Biggest moves", "mv-h", moves, 5, 4, "Needs two snapshots.");
  view.innerHTML = `
  <section class="band"><div class="wrap">
    <div class="team-head">${T ? teamLogo(T, 56) : ""}
      <div class="grow"><h1>${T ? esc(T) : esc(D.title)}</h1>
        <p class="lede">Snapshot ${fmtDate(last)}${prev ? ` · changes since ${fmtDate(prev)}` : ""} · ${D.players.length.toLocaleString()} players in ${n} snapshot${n === 1 ? "" : "s"}</p></div>
      <label class="inline">Team <select id="home-team"><option value="">All NHL teams</option>${clubs.map(c => `<option ${c === T ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
    </div>
  </div></section>
  <div class="wrap page home">
    ${summary}
    <div class="row">${topBox}${teamSide}</div>
    <h2 class="sec-title">Around the league</h2>
    <div class="row three">
      ${T ? movesBox("Biggest moves", "mv-h", moves, 3, 3, "Needs two snapshots.") : ""}
      <section class="card-box" aria-labelledby="dr-h"><h2 id="dr-h">Top of the draft</h2><p class="sub">${ranked.length ? `Our rank on the ${esc(ranked[0].stage)} NHL list, with projected peak` : "Our rank, with projected peak"}</p>
        ${ranked.map(s => listRow(s.p, `<span class="lnum"><b>${fmt(s.mid, 0)}</b></span>`, `${s.ours}. ${rankLink("#/draft", "NHL #" + s.nhl)} · ${esc(s.p.pos)} · ${tname(clubOf(s.p))}${s.p.lg ? ` (${esc(s.p.lg)})` : ""}`)).join("") || `<p class="muted small">No NHL draft ranking in the latest snapshot.</p>`}
        <a class="more-link" href="#/draft">Draft →</a></section>
      <section class="card-box" aria-labelledby="pr-h"><h2 id="pr-h">Top prospects</h2><p class="sub">Age 20 and under, by projected peak (est. PA below it)</p>
        ${prospects.map(p => listRow(p, `<span class="lnum stack"><b>${fmt(sortVal(p, "peak"), 0)}</b><small>PA ${fmt(p.pa, 0)}</small></span>`)).join("")}
        <a class="more-link" href="#/prospects/search" data-chip="u20">All prospects →</a></section>
    </div>
    <div class="row three">
      <section class="card-box" aria-labelledby="ws-h"><h2 id="ws-h">Skater WAR</h2><p class="sub">${SEASON ? seasonLabel(SEASON) : ""} regular season.${partial}</p>
        ${warTop("S").map(leaderRow).join("") || `<p class="muted small">No NHL box scores for this season yet.</p>`}</section>
      <section class="card-box" aria-labelledby="wg-h"><h2 id="wg-h">Goalie WAR</h2><p class="sub">${SEASON ? seasonLabel(SEASON) : ""} regular season</p>
        ${warTop("G").map(leaderRow).join("") || `<p class="muted small">No NHL box scores for this season yet.</p>`}</section>
      <section class="card-box" aria-labelledby="im-h"><h2 id="im-h">Overall impact</h2><p class="sub">${SEASON ? seasonLabel(SEASON) : ""} regular season, percentile</p>
        ${impTop.map(p => listRow(p, `<span class="lnum">${rankLink(pRankHref("c", "impact", p.grp, p.k), `<b>${p.card.comp.impact}</b>`)}</span>`, `${esc(p.pos)} · ${esc(clubOf(p))}`)).join("") || `<p class="muted small">No NHL box scores for this season yet.</p>`}</section>
    </div>
    <nav class="jumps" aria-label="Browse players"><span class="small muted">Browse:</span>${chips.map(([k, t]) => `<button type="button" data-chip="${esc(k)}">${t}</button>`).join("")}</nav>
  </div>`;
  view.querySelector("#home-team").onchange = e => {
    HOME_TEAM = e.target.value;
    renderHome();
  };
  view.querySelectorAll("[data-chip]").forEach(b => b.onclick = e => {
    e.preventDefault();
    const c = b.dataset.chip;
    Object.assign(R, { lg: "", grp: "", team: "", maxAge: "", sort: "", dir: -1 });
    if (c === "u20") { Object.assign(PR, { grp: "", club: "", q: "", maxAge: "20", sort: "pa", nhl: true, limit: 100 }); location.hash = "#/prospects/search"; return; }
    else if (c === "G") { R.grp = "G"; location.hash = "#/players/goalies"; return; }
    else R.lg = c;
    location.hash = "#/players";
  });
}
