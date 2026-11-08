"use strict";

// ---------------------------------------------------------------- value page
const VALUE_TABS = [["contracts", "Contracts (NHL)"], ["gems", "Hidden gems"], ["outperf", "Outperforming ability"]];
const VAL = { grp: "" };
/* NHL replacement level per position group: the 25th-percentile est. CA of NHL players with 20+ games on record
   (all players of the group when fewer than 10 qualify). */
function replacementCA() {
  const out = {};
  ["F", "D", "G"].forEach(g => {
    const nhl = D.players.filter(p => p.lg === "NHL" && p.grp === g);
    let cas = nhl.filter(p => ownRecord(p).gp >= 20).map(p => p.ca);
    if (cas.length < 10) cas = nhl.map(p => p.ca);
    cas.sort((a, b) => a - b);
    out[g] = cas.length ? cas[Math.floor(0.25 * (cas.length - 1))] : null;
  });
  return out;
}
const MIN_GP_OUTPERF = 40;   // games on record before a player can show up as out- or underperforming
// a numeric cell: the raw number in data-v (sorting and filters read it), the formatted text shown
const vcell = (v, shown, cls = "") => `<td class="num ${cls}" data-v="${v == null || Number.isNaN(v) ? "" : v}">${shown}</td>`;
const vplayer = p => `<th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}"><span><b>${esc(p.n)}</b></span></a></th>`;
const sgn = v => (v > 0 ? "pos" : v < 0 ? "neg" : "");
const capCell = x => vcell(salaryNum(x.p.sal) / 1e6 || null, x.p.sal ? money(salaryNum(x.p.sal)) : dash);
/* cols: [header, numeric, cell(row)]; the first column is always the player. Rows carry data-g for the position buttons. */
function valueTable(cols, rows) {
  return `<div class="tablewrap"><table class="rank sortable vtab"><thead><tr><th class="pcol">Player</th>${cols.map(([h, n]) => `<th class="${n ? "num" : ""}">${h}</th>`).join("")}</tr>
    <tr class="frow"><th><input data-c="0" aria-label="Filter Player" placeholder="filter"></th>${cols.map(([h, n], i) =>
      `<th><input data-c="${i + 1}" ${n ? 'data-n="1"' : ""} aria-label="Filter ${esc(h)}" placeholder="${n ? ">0, 5-10" : "filter"}"></th>`).join("")}</tr></thead>
    <tbody>${rows.map(x => `<tr class="link" data-k="${esc(x.p.k)}" data-g="${x.p.grp}">${vplayer(x.p)}${cols.map(c => c[2](x)).join("")}</tr>`).join("")
      || `<tr><td colspan="${cols.length + 1}" class="muted">Nothing to show.</td></tr>`}</tbody></table></div>`;
}
function valueTabData(tab) {
  const club = x => `<td>${tname(clubOf(x.p))}</td>`, pos = x => `<td>${esc(x.p.pos)}</td>`;
  const age = x => vcell(x.p.age, x.p.age), ca = x => vcell(x.p.ca, fmt(x.p.ca, 0));
  const ends = x => `<td class="nowrap">${esc(contractEnds(x.p))}</td>`;
  if (tab === "gems") {
    const repl = replacementCA();
    const rows = D.players.filter(p => p.lg && p.lg !== "NHL" && repl[p.grp] != null && (p.ca >= repl[p.grp] || (p.fut ?? 0) >= repl[p.grp]))
      .map(p => ({ p, peak: sortVal(p, "peak"), wNow: expWar(p.grp, p.ca), wFut: p.fut == null ? null : expWar(p.grp, p.fut), repl: repl[p.grp] }))
      .sort((a, b) => Math.max(b.wNow, b.wFut ?? 0) - Math.max(a.wNow, a.wFut ?? 0));
    return { rows, repl, cols: [
      ["Club", false, club], ["League", false, x => `<td>${esc(x.p.lg)}</td>`], ["Pos", false, pos], ["Age", true, age], ["Est. CA", true, ca],
      ["CA vs NHL replacement", true, x => vcell(x.p.ca - x.repl, signed(x.p.ca - x.repl, 0), sgn(x.p.ca - x.repl))],
      ["Proj. CA in 2 years", true, x => vcell(x.p.fut, x.p.fut == null ? dash : fmt(x.p.fut, 0))],
      ["Proj. peak", true, x => vcell(x.peak, fmt(x.peak, 0))],
      ["Exp. NHL WAR now", true, x => vcell(x.wNow, war1(x.wNow))],
      ["Exp. NHL WAR in 2 years", true, x => vcell(x.wFut, x.wFut == null ? dash : war1(x.wFut))],
      ["Cap hit", true, capCell], ["Ends", false, ends],
      ["Scout ★", true, x => vcell(x.p.sc?.fut, x.p.sc?.fut != null ? `<span class="stars">${"★".repeat(x.p.sc.fut)}</span>` : dash)]] };
  }
  if (tab === "outperf") {
    const rows = D.players.filter(p => p.lg === "NHL").map(p => ({ p, v: playerValue(p) })).filter(x => x.v.gp >= MIN_GP_OUTPERF && x.v.own != null)
      .sort((a, b) => (b.v.now - b.v.ability) - (a.v.now - a.v.ability));
    return { rows, cols: [
      ["Club", false, club], ["Pos", false, pos], ["Age", true, age], ["Est. CA", true, ca],
      ["Games on record", true, x => vcell(x.v.gp, x.v.gp)],
      ["Actual WAR / season", true, x => vcell(x.v.own, war1(x.v.own))],
      ["Expected from CA", true, x => vcell(x.v.ability, war1(x.v.ability))],
      ["Raw difference", true, x => vcell(x.v.own - x.v.ability, signed(x.v.own - x.v.ability), sgn(x.v.own - x.v.ability))],
      ["After shrinkage", true, x => vcell(x.v.now - x.v.ability, `<b>${signed(x.v.now - x.v.ability)}</b>`, sgn(x.v.now - x.v.ability))],
      ["Weight of his record %", true, x => vcell(Math.round(100 * x.v.weight), Math.round(100 * x.v.weight) + "%")],
      ["Role", false, x => `<td class="small">${esc(x.p.sc?.role || "")}</td>`],
      ["Cap hit", true, capCell]] };
  }
  const rows = D.players.filter(p => p.lg === "NHL").map(p => ({ p, c: contractValue(p) })).filter(x => x.c).sort((a, b) => b.c.surplus - a.c.surplus);
  return { rows, cols: [
    ["Club", false, club], ["Pos", false, pos], ["Age", true, age], ["Est. CA", true, ca],
    ["Cap hit", true, x => vcell(x.c.sal / 1e6, money(x.c.sal))], ["Ends", false, ends],
    ["Seasons left", true, x => vcell(x.c.seasons, x.c.seasons)],
    ["Exp. WAR this season", true, x => vcell(x.c.now, war1(x.c.now))],
    ["WAR per $1M", true, x => vcell(x.c.perM, fmt(Math.abs(x.c.perM) < 0.005 ? 0 : x.c.perM, 2))],
    ["Value per season", true, x => vcell(x.c.perSeason / 1e6, signedMoney(x.c.perSeason), sgn(x.c.perSeason))],
    ["Surplus over the deal", true, x => vcell(x.c.surplus / 1e6, `<b>${signedMoney(x.c.surplus)}</b>`, sgn(x.c.surplus))]] };
}
function renderValue(tab = "contracts") {
  markNav("value");
  if (!VALUE_TABS.some(t => t[0] === tab)) tab = "contracts";
  const M = market(), T = valueTabData(tab), B = D.predict?.blend;
  const notes = {
    contracts: () => `Every NHL player with a listed salary and expiry. A season is worth the league minimum (${money(M.min)}, the 5th-percentile NHL salary) plus the expected WAR at the
      market price (${money(M.perWar)} above the minimum per expected WAR, ${M.n} NHL contracts); surplus = worth − cap hit for each season left with a known cap hit, this one counted for the part of the
      regular season still to play. Expected WAR blends his own NHL record with his ability, later seasons follow his projected est. CA (as in the trade tool).
      Options, bonuses and the cap ceiling aren't visible to a client.`,
    gems: () => `Players outside the NHL whose est. CA is at or above NHL replacement level for their position (the 25th percentile of NHL players with 20+ games on record:
      forwards ${fmt(T.repl.F, 0)}, defence ${fmt(T.repl.D, 0)}, goalies ${fmt(T.repl.G, 0)}), or whose projected CA in 2 years (age 25 and under) reaches it. Expected NHL WAR is the
      ability curve at that CA: what a season in the NHL would be worth, not a forecast that he'll be called up. Sorted by the better of "now" and "in 2 years".`,
    outperf: () => `NHL players with ${MIN_GP_OUTPERF}+ games on record. Actual WAR per ${B?.season_gp || 84}-game season against what his est. CA predicts (the same curve as the trade tool). The raw difference of
      a small sample is noise, so "after shrinkage" is the blended number the site uses (his record weighs games / (games + K), K = ${B?.K ?? "–"}); sorted by it, so the
      underperformers are at the bottom. Some of the gap is role: see the role-effect table on <a href="#/about">How it works</a>.`,
  };
  view.innerHTML = `<section class="band"><div class="wrap"><h1>Value</h1>
      <p class="lede">Who is worth more, or less, than his contract, his league or his ratings suggest.</p>
      ${tabBar("Value sections", VALUE_TABS, tab, "data-vtab")}</div></section>
    <div class="wrap page">
      <form class="filters card-box" aria-label="Filters">${segCtl("v-grp", "Position", [["", "All"], ["F", "Forwards"], ["D", "Defence"], ["G", "Goalies"]], VAL.grp)}<span class="count" id="v-count"></span></form>
      <section class="card-box flush" aria-label="${esc(VALUE_TABS.find(t => t[0] === tab)[1])}">${valueTable(T.cols, T.rows)}</section>
      <p class="small muted">Click a header to sort; filters under it: text matches anywhere ("!" excludes), numbers accept &gt;, &lt;, ranges like 5-10. ${notes[tab]()}</p></div>`;
  view.querySelectorAll("[data-vtab]").forEach(b => b.onclick = () => (location.hash = "#/value" + (b.dataset.vtab === "contracts" ? "" : "/" + b.dataset.vtab)));
  const rows = [...view.querySelectorAll("table.vtab tbody tr.link")], inputs = [...view.querySelectorAll("table.vtab tr.frow input")];
  const apply = () => {
    let n = 0;
    rows.forEach(tr => {
      const ok = (!VAL.grp || tr.dataset.g === VAL.grp) && inputs.every(inp => {
        const td = tr.cells[+inp.dataset.c];
        return matchFilter(inp.dataset.n ? cellValue(td) : td.textContent, inp.value, !!inp.dataset.n);
      });
      tr.hidden = !ok; n += ok;
    });
    view.querySelector("#v-count").textContent = `${n.toLocaleString()} of ${rows.length.toLocaleString()} shown`;
  };
  inputs.forEach(inp => inp.addEventListener("input", apply));
  view.querySelectorAll("#v-grp button").forEach(b => b.onclick = () => {
    VAL.grp = b.dataset.v;
    view.querySelectorAll("#v-grp button").forEach(o => { o.classList.toggle("on", o === b); o.setAttribute("aria-pressed", o === b); });
    apply();
  });
  rows.forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  makeSortable();
  apply();
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
        <small>${esc(x.p.pos)} · ${x.p.age} · est. CA ${fmt(x.p.ca, 0)}, PA ${fmt(x.p.pa, 0)} · ${esc(x.p.sal || "no salary listed")}${x.p.exp ? " to " + esc(contractEnds(x.p)) : ""} · ${fmt(x.v.last, 2)} WAR in ${seasonLabel(lastComplete())}</small>
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
