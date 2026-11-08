"use strict";

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
  return `<table class="rank tp"><thead><tr><th class="num">#</th><th class="pcol">Player</th>${withClub ? "<th>Club</th>" : ""}<th>Pos</th><th class="num">Age</th>${cols.map(([k, h, , , tip]) => sortTh(LS, k, h, tip)).join("")}</tr></thead><tbody>
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
    body = `<div class="cardbar"><h2 class="flat">${seasonLabel(season)}</h2>${seasonSelect("lg-season", seasons, season)}</div>
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
    body = `<div class="cardbar"><h2 class="flat">${seasonLabel(season)} standings <span class="muted">estimated</span></h2>${seasonSelect("lg-season", seasons, season)}</div>
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
        ${seasonSelect("lg-season", seasons, season)}${kinds}
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
  bindSortHeads(LS, rerender);
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
      <span class="inline">${kinds}${seasonSelect("lg-season", seasons, season)}</span></div>
    <section class="card-box flush" aria-label="Skaters"><div class="box-h tp-head"><h2>Skaters <span class="muted">${sk.length}</span></h2>${lgViewSeg()}</div>
      <div class="tablewrap">${lgSkTable(lg, season, sk, false)}</div>
      ${LS.view === "adv" ? `<p class="sub pad">Percentiles: his per-game rates against the ${esc(lg)}'s skaters with enough games; each pill opens that league ranking.</p>` : ""}</section>
    ${gk.length ? `<section class="card-box flush" aria-label="Goalies"><h2 class="box-h">Goalies <span class="muted">${gk.length}</span></h2><div class="tablewrap">${lgGoalieTable(gk, false)}</div></section>` : ""}`;
}
function lgTeamStats(club, lg, season, seasons, table) {
  const r = table.find(x => x.club === club);
  const sel = `<div class="cardbar"><h2 class="flat">${seasonLabel(season)} regular season <span class="muted">estimated</span></h2>${seasonSelect("lg-season", seasons, season)}</div>`;
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
