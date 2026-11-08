"use strict";

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
// draft-eligible players in the board's order
const byDraftRank = list => { const o = new Map(draftBoard("mid").rows.map(s => [s.p.k, s.ours])); return list.slice().sort((a, b) => o.get(a.p.k) - o.get(b.p.k)); };
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
  const elig = byDraftRank(und.filter(x => x.r)).slice(0, 5);
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
      <section class="card-box" aria-labelledby="next-h"><h2 id="next-h">Top of the next draft</h2><p class="sub">Draft eligible, in our rank (NHL list + projected peak) · NHL list rank</p>
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
  const elig = byDraftRank(group("elig")), young = group("young"), older = group("older");
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
      ${box("el-h", "Top of the next draft", "Draft eligible, in our rank (NHL list + projected peak) · NHL list rank", elig, x => `${nhlRankLink(x.r)} · ${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}`)}
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
  // our order of the club's whole pool (listed + also drafted): projected peak, as everywhere else outside the NHL list
  // (draft_rank_bench: predicted CA in 2 years only wins near term); the 2-year number stays as a column
  const whole = [...pool, ...drafted].sort((a, b) => sortVal(b, "peak") - sortVal(a, "peak"));
  const ours = new Map(whole.map((p, i) => [p.k, i + 1]));
  const PM = D.prospectModel;
  const ourCol = ["Our rank", p => ours.get(p.k), "Our order of the whole pool: projected peak"];
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
  const r = EV_DATA?.ranking, e = PM.eval || {}, yrs = PM.months / 12;
  return `<p class="sub pad"><b>Our rank</b> orders the club's whole pool by projected peak: the highest est. CA on his projected path.
    <b>CA in ${yrs} yrs</b> is a separate near-term prediction from our est. CA, est. PA, age and position.${e.ehm && e.model ? ` On ${(PM.lists || 0).toLocaleString()} past Top Prospects lists it
    ordered players by true CA ${yrs} years later better than EHM's order (rank correlation ${fmt(e.model.rho, 2)} vs ${fmt(e.ehm.rho, 2)}).` : ""}${r?.ca_48 ? ` It fades with time, though: on past NHL draft lists at 48 months,
    it scored ${fmt(r.ca_48.fut.rho, 2)} against ${fmt(r.ca_48.peak_mid.rho, 2)} for projected peak, on few lists.` : ""}</p>`;
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
