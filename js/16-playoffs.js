"use strict";

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
    const gs = games.filter(g => g.sk === s.sk && g.rnd === s.rnd).sort((p, q) => q.d.localeCompare(p.d));   // newest first
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
  if (!pngReady()) return;
  const sheet = document.createElement("div");
  sheet.className = "gs-sheet";
  // data-head is plain text (club names, the game's competition line): dataset decodes the attribute, so escape it again
  sheet.innerHTML = `<div class="gs-sheet-head">${esc(btn.dataset.head)}</div><div class="gs-sheet-cards"></div>`;
  cards.forEach(c => { const k = c.cloneNode(true); k.hidden = false; sheet.querySelector(".gs-sheet-cards").appendChild(k); });
  sheetToPng(sheet, 1900, btn.dataset.file + ".png");
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
      ${seasonSelect("rs-season", seasons, season)}</div>
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
  const gapNote = resultsGaps(club, season, mine);
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
  return `${gapNote}<section class="card-box flush" aria-label="Game log"><div class="tablewrap"><table class="rank sortable"><thead><tr><th aria-sort="descending">Date</th><th></th><th>Opponent</th><th>Result</th>
      <th class="num">Score</th><th class="num">SOG</th><th class="num">PP</th><th data-nosort>Record</th><th>Top scorer</th></tr></thead><tbody>${rows.reverse().join("")
      || `<tr><td colspan="9" class="muted small">No games captured.</td></tr>`}</tbody></table></div>
    <p class="sub pad">Score and shots: ${esc(club)} first. Record = regular-season W–L–OTL after that game (counting the games captured). OTL / SOL = overtime / shootout loss.
      EHM keeps other teams' box scores only ~44 days, so games a snapshot didn't reach in time are missing.</p></section>`;
}
/* Box scores missing for a club: official regular-season GP (D.teamGp, from the team Statistics tab) minus the games
   captured, and the stretches of 8+ days without a captured game while games are missing (a snapshot that read nothing). */
function resultsGaps(club, season, mine) {
  const official = D.teamGp?.[season]?.[club], reg = mine.filter(g => g.t === "R");
  const missing = official ? official - reg.length : 0;
  if (missing <= 0) return "";
  const days = reg.map(g => g.d).sort(), gaps = [];
  for (let i = 1; i < days.length; i++) {
    if ((new Date(days[i]) - new Date(days[i - 1])) / 864e5 >= 8) gaps.push([days[i - 1], days[i]]);
  }
  const where = gaps.length ? ` No box scores between ${gaps.map(([a, b]) => `${fmtDate(a)} and ${fmtDate(b)}`).join(", ")}.` : "";
  return `<div class="note warnnote">${reg.length} of ${esc(club)}'s ${official} regular-season games have a box score here; ${missing} ${missing === 1 ? "is" : "are"} missing (EHM had deleted ${missing === 1 ? "it" : "them"} before a snapshot read ${missing === 1 ? "it" : "them"}).${where}</div>`;
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
      ${board("Goalies · WAR", gk, x => pwar(x.k), s1, "G", D.warInfo?.replacement?.G?.baseline === "average" ? "Above an average playoff goalie" : "Above replacement level")}
    </div>
    <p class="small muted">Playoff games in this save's box scores (some games missing, see the bracket). Ties are broken by list order.
      ${D.warInfo?.replacement?.G?.baseline === "average" ? "Goalie WAR compares with the average goalie of these playoffs, so it adds up to 0 across them."
        : `Goalie WAR compares with a replacement-level goalie; in the playoffs only about 25 goalies play, so replacement is set by the weakest
      quarter of them and even a below-average goalie can show a small positive WAR. For goalies, goals saved above expected is the fairer playoff measure.`}</p>`;
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
        ${seasonSelect("po-season", seasons, season, { single: "show", oldestFirst: true })}
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
