"use strict";

/* GM pages: #/gms[/<part>] (the greatest GM ranking) and #/gm/<name> (one GM). D.gms comes from ehm/site/gms.py: who ran
   each club when (read off the game's GM Status screen at login; the first GM seen at a club is assumed to have run it
   since the earliest date in the data), each GM's record in the months he was in charge, and each club's lineup strength per
   snapshot. Trades and drafts are valued here with the trades page's and the draft pages' formulas, so every page agrees.
   Composite = weighted mean of each part's z-score across GMs; a part with no data yet (no draft inside the save) drops out
   and the other weights are renormalised. */
const GM_PARTS = [
  ["results", "Results", "Points above .500 (one per game) in the months in charge, plus 4 for making the playoffs, 4 per round won after that and 8 for the Cup"],
  ["trades", "Trades", "Net 5-season expected WAR of every trade: what the club received minus what it sent, with today's ratings (as on the trades page)"],
  ["growth", "Growth", "Change in the club's lineup strength while in charge: expected season WAR of its best 12 forwards, 6 defencemen and 1 goalie by est. CA"],
  ["drafts", "Drafting", "Each pick made in charge (drafts held during this save): the player's 5-season value now minus the average for that slot"],
];
const gmRoute = gm => "#/gm/" + encodeURIComponent(gm);
const gmLink = gm => gm ? `<a href="${gmRoute(gm)}">${esc(gm)}</a>` : `<span class="muted">No GM listed</span>`;
const gmNow = () => D.dates.at(-1);
const gmOf = (club, day = gmNow()) => (D.gms?.tenures || []).find(t => t.club === club && t.from <= day && (!t.to || day <= t.to))?.gm || null;
const gmDays = t => Math.max(1, (new Date((t.to || gmNow()) + "T00:00:00") - new Date(t.from + "T00:00:00")) / 864e5 + 1);
const gmResultPts = r => (2 * r.w + r.otl - r.gp) + (r.po ? 4 + 4 * (r.po - 1) : 0) + (r.cup ? 8 : 0);
const gmSigned = (v, d = 1) => v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const gmCls = v => (v > 0.05 ? "pos" : v < -0.05 ? "neg" : "");

/* The trades a GM made: [{t, i, mine, other, net}], i = his side. */
function gmTrades(gm) {
  return (D.trades || []).flatMap(t => (t.g || []).map((g, i) => [g, i]).filter(([g]) => g === gm).map(([, i]) => {
    const v = tradeValues(t), mine = v.sides[i]?.war || 0, other = v.sides[1 - i]?.war || 0;
    return { t, i, mine, other, net: mine - other };
  }));
}
/* The picks a GM made: draft rights rows of drafts held after the save's first snapshot, while he ran the club. */
function gmDrafts(gm) {
  const first = D.gms?.first || D.dates[0];
  return (D.rights?.rows || []).filter(r => `${r[1]}-06-30` >= first && gmOf(r[0], `${r[1]}-06-30`) === gm).map(r => {
    const p = r[4] ? byKey.get(r[4]) : null, slot = pickValue(r[3]).five;
    return { club: r[0], year: r[1], round: r[2], overall: r[3], key: r[4], name: r[5], p, value: p ? playerValue(p).five - slot : null, slot };
  });
}
/* A club's lineup strength between two dates: [[date, value]]. */
const gmStrength = (club, a, b) => (D.gms?.strength?.[club] || []).filter(([d]) => d >= a && (!b || d <= b));
function gmTable() {
  if (D._gmTable) return D._gmTable;
  const G = D.gms, by = {};
  for (const t of G.tenures) {
    const s = (by[t.gm] ||= { gm: t.gm, tenures: [], rows: [], days: 0, growth: 0 });
    s.tenures.push(t);
    s.days += gmDays(t);
    const st = gmStrength(t.club, t.from, t.to);
    if (st.length > 1) s.growth += st.at(-1)[1] - st[0][1];
  }
  for (const r of G.results) by[r.gm]?.rows.push(r);
  const list = Object.values(by);
  for (const s of list) {
    const cur = s.tenures.find(t => !t.to);
    s.club = cur?.club || s.tenures.at(-1).club;
    s.seasons = s.days / 365.25;
    s.results = s.rows.reduce((n, r) => n + gmResultPts(r), 0);
    s.gp = s.rows.reduce((n, r) => n + r.gp, 0);
    s.pts = s.rows.reduce((n, r) => n + 2 * r.w + r.otl, 0);
    s.po = s.rows.filter(r => r.po).length;
    s.cups = s.rows.filter(r => r.cup).length;
    s.tr = gmTrades(s.gm);
    s.trades = s.tr.reduce((n, x) => n + x.net, 0);
    s.dr = gmDrafts(s.gm);
    s.drafts = s.dr.reduce((n, x) => n + (x.value || 0), 0);
  }
  // z-scores per part; a part where every GM is 0 (nothing to judge yet) is left out
  const live = GM_PARTS.filter(([k]) => list.some(s => Math.abs(s[k]) > 1e-9));
  const wsum = live.reduce((n, [k]) => n + (G.weights[k] || 0), 0) || 1;
  for (const [k] of live) {
    const vals = list.map(s => s[k]), m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    list.forEach(s => { (s.z ||= {})[k] = (s[k] - m) / sd; });
  }
  list.forEach(s => { s.score = 50 + 10 * live.reduce((n, [k]) => n + (G.weights[k] || 0) * (s.z?.[k] || 0), 0) / wsum; });
  const rank = (k, desc = true) => [...list].sort((a, b) => desc ? b[k] - a[k] : a[k] - b[k]).forEach((s, i) => { (s.rank ||= {})[k] = i + 1; });
  rank("score");
  GM_PARTS.forEach(([k]) => rank(k));
  return (D._gmTable = { list, live, wsum });
}
const gmRankHref = part => `#/gms/${part}`;

function renderGms(part) {
  markNav("gms");
  if (!D.gms) {
    view.innerHTML = `<div class="wrap page"><h1>GMs</h1><p class="muted">No GM list yet: the crawler saves it from the GM Status screen at login (<code>gms_&lt;date&gt;.csv</code>), from the next snapshot on.</p></div>`;
    return;
  }
  const { list, live, wsum } = gmTable(), G = D.gms;
  const sortKey = GM_PARTS.some(([k]) => k === part) ? part : "score";
  const rows = [...list].sort((a, b) => b[sortKey] - a[sortKey]);
  const wtxt = GM_PARTS.map(([k, label]) => live.some(([x]) => x === k) ? `${label} ${Math.round(100 * G.weights[k] / wsum)}%` : `${label} (no data yet)`).join(" · ");
  const th = (k, label, tip) => `<th class="num${k === sortKey ? " on" : ""}" title="${esc(tip)}"${k === sortKey ? ` aria-sort="descending"` : ""}>${label}</th>`;
  const fmtPart = (k, v) => k === "results" ? gmSigned(v, 0) : gmSigned(v, 1);
  const body = rows.map((s, i) => `<tr class="link" data-gm="${esc(s.gm)}"><td class="num">${i + 1}</td>
      <th scope="row" class="pcol"><a href="${gmRoute(s.gm)}"><b>${esc(s.gm)}</b></a></th>
      <td>${tlink(s.club, `${logo(s.club, 18)} ${esc(s.club)}`)}${s.tenures.length > 1 ? ` <small class="muted">+${s.tenures.length - 1}</small>` : ""}</td>
      <td class="num">${fmt(s.seasons, 1)}</td><td class="num"><b>${fmt(s.score, 1)}</b></td>
      <td class="num">${s.gp ? `${fmt(s.pts / (2 * s.gp), 3).replace(/^0/, "")}` : "–"}</td><td class="num">${s.po}${s.cups ? ` <small title="Cups">🏆${s.cups > 1 ? s.cups : ""}</small>` : ""}</td>
      ${GM_PARTS.map(([k]) => `<td class="num ${gmCls(s[k])}" data-v="${s[k]}">${fmtPart(k, s[k])}</td>`).join("")}
      <td class="num">${s.tr.length}</td></tr>`).join("");
  view.innerHTML = `<section class="band"><div class="wrap"><h1>Greatest SHA GM</h1>
      <p class="lede">Every GM ranked on what their clubs did while they were in charge: results, trades, lineup growth and drafting. The GM score is 50 for an
      average GM; each 10 points is one standard deviation. Weights: ${esc(wtxt)}.</p></div></section>
    <div class="wrap page">
      <div class="segbar" role="tablist" aria-label="Rank GMs by">${[["score", "GM score"], ...GM_PARTS].map(([k, label]) => `<a role="tab" class="seg ${k === sortKey ? "on" : ""}" aria-selected="${k === sortKey}" href="${k === "score" ? "#/gms" : gmRankHref(k)}">${esc(label)}</a>`).join("")}</div>
      <section class="card-box flush" aria-label="GM ranking"><div class="tablewrap"><table class="rank gm-table">
        <thead><tr><th class="num">#</th><th class="pcol">GM</th><th>Club</th><th class="num" title="Seasons in charge, all clubs">Seasons</th>${th("score", "GM score", "Weighted z-score of the parts, 50 = average")}
          <th class="num" title="Points % in the months in charge">Pts%</th><th class="num" title="Seasons in the playoffs">Playoffs</th>
          ${GM_PARTS.map(([k, label, tip]) => th(k, label, tip)).join("")}<th class="num">Trades made</th></tr></thead>
        <tbody>${body}</tbody></table></div></section>
      ${gmNote()}
    </div>`;
  view.querySelectorAll("tr.link[data-gm]").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = gmRoute(tr.dataset.gm); });
}
function gmNote() {
  const G = D.gms, bd = G.tenures.filter(t => t.bd).length;
  return `<div class="gm-note small muted">
    <p><b>How each part is scored.</b> ${GM_PARTS.map(([, label, tip]) => `<b>${label}:</b> ${esc(tip)}.`).join(" ")}</p>
    <p><b>Who ran each club.</b> Read off the game's GM Status screen each time the crawler logs in (latest ${fmtDate(G.asOf)}).
      ${bd ? `${bd} club${bd > 1 ? "s are" : " is"} assumed to have had the same GM since ${fmtDate(G.first)}, the earliest date in the data (first snapshot or trade), as the list was first read on ${fmtDate(G.firstRead)}.` : ""}
      Known changes go in <code>gm_overrides.csv</code>${G.overrides ? ` (${G.overrides} row${G.overrides > 1 ? "s" : ""} applied)` : ""}.
      Results only count months with box scores; the playoffs and the Cup count for the GM in charge at the season's end.</p></div>`;
}

function renderGm(gm) {
  markNav("gms");
  if (!D.gms) return renderGms();
  const { list, live } = gmTable(), s = list.find(x => x.gm === gm);
  if (!s) { view.innerHTML = `<div class="wrap page"><p class="warn">No GM called ${esc(gm)}. <a href="#/gms">All GMs</a></p></div>`; return; }
  const n = list.length, card = (label, v, k, f = x => gmSigned(x, 1)) => `<div><span>${esc(label)}</span><b class="${k === "score" ? "" : gmCls(v)}">${f(v)}</b>
      <small>${k !== "score" && !live.some(([x]) => x === k) ? `<span class="muted">no data yet</span>` : rankLink(k === "score" ? "#/gms" : gmRankHref(k), `${ordinal(s.rank[k])} of ${n}`)}</small></div>`;
  const runs = s.tenures.map(t => {
    const rs = s.rows.filter(r => r.club === t.club && r.from >= t.from && (!t.to || r.to <= t.to)), st = gmStrength(t.club, t.from, t.to);
    const w = rs.reduce((a, r) => a + r.w, 0), l = rs.reduce((a, r) => a + r.l, 0), o = rs.reduce((a, r) => a + r.otl, 0);
    const g = st.length > 1 ? st.at(-1)[1] - st[0][1] : null;
    return `<tr><th scope="row">${tlink(t.club, `${logo(t.club, 18)} ${esc(t.club)}`)}</th><td>${fmtDate(t.from)}${t.bd ? ` <small class="muted" title="Assumed: the GM list was first read later">*</small>` : ""}</td><td>${t.to ? fmtDate(t.to) : "now"}</td>
      <td class="num">${w}–${l}–${o}</td><td class="num">${rs.filter(r => r.po).length}</td><td class="num ${gmCls(g)}">${gmSigned(g)}</td></tr>`;
  }).join("");
  const seasons = s.rows.map(r => `<tr><th scope="row">${seasonLabel(r.season)}</th><td>${tlink(r.club, `${logo(r.club, 18)} ${esc(r.club)}`)}</td>
      <td class="num">${r.gp}</td><td class="num">${r.w}–${r.l}–${r.otl}</td><td class="num">${r.gp ? fmt((2 * r.w + r.otl) / (2 * r.gp), 3).replace(/^0/, "") : "–"}</td>
      <td class="num">${r.gf}–${r.ga}</td><td>${r.cup ? "Won the Cup" : r.fin ? "Lost the final" : r.po ? (D.teamHist?.rounds?.[r.po - 1] || `Round ${r.po}`) : "–"}</td>
      <td class="num ${gmCls(gmResultPts(r))}">${gmSigned(gmResultPts(r), 0)}</td></tr>`).join("");
  const trades = [...s.tr].sort((a, b) => b.t.d.localeCompare(a.t.d)).map(x => {
    const other = x.t.s[1 - x.i], oc = other ? clubOfAbbr(other[0]) : null, og = x.t.g?.[1 - x.i];
    return `<tr><td>${fmtDate(x.t.d)}</td><td>${oc ? tlink(oc, `${logo(oc, 18)} ${esc(oc)}`) : "–"}${og ? ` <small class="muted">${gmLink(og)}</small>` : ""}</td>
      <td class="gm-recv">${esc(x.t.s[x.i][2].map(a => a[1]).join(", ") || "Nothing listed")}</td><td class="num">${fmt(x.mine, 1)}</td><td class="num">${fmt(x.other, 1)}</td>
      <td class="num ${gmCls(x.net)}"><b>${gmSigned(x.net)}</b></td></tr>`;
  }).join("");
  const drafts = s.dr.sort((a, b) => a.overall - b.overall).map(x => `<tr><td>${x.year}</td><td class="num">${x.round}</td><td class="num">${x.overall}</td>
      <td>${x.p ? `<a href="${route(x.key)}">${esc(x.name)}</a>` : esc(x.name)}</td><td class="num">${x.p ? fmt(x.value + x.slot, 1) : "–"}</td><td class="num">${fmt(x.slot, 1)}</td>
      <td class="num ${gmCls(x.value)}">${gmSigned(x.value)}</td></tr>`).join("");
  // lineup strength over every tenure, one line per club
  const firstMs = new Date(D.gms.first + "T00:00:00");
  const months = d => Math.round((new Date(d + "T00:00:00") - firstMs) / (864e5 * 30.44) * 10) / 10;
  const cols = [css("--s1"), css("--s2"), "#1baf7a", "#6250d6"];
  const series = s.tenures.map((t, i) => ({ name: `${t.club} (${fmtDate(t.from)} – ${t.to ? fmtDate(t.to) : "now"})`, color: cols[i % cols.length],
    pts: gmStrength(t.club, t.from, t.to).map(([d, v]) => [months(d), v]) })).filter(x => x.pts.length > 1);
  const chart = series.length ? lineChart(series, `Months since ${fmtDate(D.gms.first)}`, "Lineup exp. WAR", { xfmt: (shown => x => { const m = Math.round(x); return shown.has(m) ? "" : (shown.add(m), m); })(new Set()), ymin: Math.min(...series.flatMap(x => x.pts.map(q => q[1]))) }) : `<p class="muted">Needs two snapshots.</p>`;
  const tblBox = (title, head, rows, empty) => `<section class="card-box flush" aria-label="${esc(title)}"><h2 class="box-h">${esc(title)}</h2>
      ${rows ? `<div class="tablewrap"><table class="rank sortable">${head}<tbody>${rows}</tbody></table></div>` : `<p class="muted">${empty}</p>`}</section>`;
  view.innerHTML = `<section class="band"><div class="wrap"><div class="team-head">${logo(s.club, 56)}<div class="grow"><h1>${esc(s.gm)}</h1>
      <p class="lede">GM of ${tlink(s.club)} · ${fmt(s.seasons, 1)} seasons in charge · ${rankLink("#/gms", `${ordinal(s.rank.score)} of ${n} GMs`)}</p></div>
      <span class="inline team-nav"><a href="#/gms">All GMs</a></span></div></div></section>
    <div class="wrap page">
      <div class="stat-cards">${card("GM score", s.score, "score", x => fmt(x, 1))}${card("Results", s.results, "results", x => gmSigned(x, 0))}${card("Trades (net WAR)", s.trades, "trades")}
        ${card("Lineup growth", s.growth, "growth")}${card("Drafting", s.drafts, "drafts")}</div>
      ${tblBox("Clubs run", `<thead><tr><th>Club</th><th>From</th><th>To</th><th class="num">Record</th><th class="num">Playoffs</th><th class="num" title="Lineup exp. WAR, end minus start">Growth</th></tr></thead>`, runs, "")}
      ${tblBox("Season by season", `<thead><tr><th>Season</th><th>Club</th><th class="num">GP</th><th class="num">Record</th><th class="num">Pts%</th><th class="num">GF–GA</th><th>Playoffs</th><th class="num" title="${esc(GM_PARTS[0][2])}">Results</th></tr></thead>`, seasons, "No games in charge yet.")}
      <section class="card-box" aria-label="Lineup strength"><h2>Lineup strength</h2><p class="small muted">${esc(GM_PARTS[2][2])}, at each snapshot.</p>${chart}</section>
      ${tblBox("Trades", `<thead><tr><th>Date</th><th>With</th><th>Received</th><th class="num" title="5-season expected WAR received">WAR in</th><th class="num" title="5-season expected WAR sent">WAR out</th><th class="num">Net</th></tr></thead>`,
        trades, D.trades ? "No trades in charge." : "Not read yet: the crawler reads the NHL Trade Center with <code>--trades</code>.")}
      ${tblBox("Draft picks made", `<thead><tr><th>Draft</th><th class="num">Round</th><th class="num">Overall</th><th>Player</th><th class="num">Value now</th><th class="num">Slot average</th><th class="num">vs slot</th></tr></thead>`,
        drafts, "No draft held during this save while in charge yet (the first is June 2027).")}
      ${gmNote()}
    </div>`;
  makeSortable();
}
