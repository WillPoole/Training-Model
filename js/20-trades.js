"use strict";

/* NHL trades (crawler --trades: the league's Trade Center), one hockey year per page: #/trades/<season>/<filters>, and a club's
   own on its Trades tab. D.trades = [{d: date, s: [[abbr, club, assets], [abbr, club, assets]]}], asset =
   [kind, name, player key, round, pick year, from abbr]; a side's assets are what that team receives. Each side is valued like
   the trade predictor (5-season expected WAR, pick value, contract surplus) with today's ratings, not those on trade day. */
const tradeSeason = d => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 7 ? y : y - 1; return `${String(s % 100).padStart(2, "0")}-${String((s + 1) % 100).padStart(2, "0")}`; };
const tradeSeasons = () => [...new Set((D.trades || []).map(t => tradeSeason(t.d)))].sort().reverse();
const TRADE_SORTS = [["new", "Newest"], ["old", "Oldest"], ["big", "Biggest"], ["gap", "Most lopsided"], ["n", "Most assets"]];
const TRADE_HAS = [["", "Anything"], ["players", "Players"], ["picks", "Picks"], ["first", "1st-round picks"]];
const tradePlayer = a => (a[2] ? byKey.get(a[2]) : null) || null;
/* A pick's slot before its draft: the middle of its round, the order isn't known this far ahead. */
const tradePickValue = a => pickValue((a[3] - 1) * 32 + 16).five;
function tradeValues(t) {
  if (t._v) return t._v;
  const sides = t.s.map(([, , assets]) => {
    let war = 0, surplus = 0, known = 0, missing = 0;
    for (const a of assets) {
      if (a[0] === "pick") { war += tradePickValue(a); known++; continue; }
      const p = a[0] === "player" ? tradePlayer(a) : null;
      if (!p) { missing++; continue; }
      war += playerValue(p).five; known++;
      const c = p.lg === "NHL" ? contractValue(p) : null;
      if (c) surplus += c.surplus;
    }
    return { war, surplus, known, missing };
  });
  const [a, b] = [sides[0], sides[1] || { war: 0 }];
  return (t._v = { sides, total: a.war + b.war, gap: Math.abs(a.war - b.war), n: t.s.reduce((n, x) => n + x[2].length, 0) });
}
const tradeInvolves = (t, club) => t.s.some(x => clubOfAbbr(x[0]) === club);
function tradeAsset(a) {
  if (a[0] === "pick") {
    const from = clubOfAbbr(a[5]);
    return `<li class="ta-pick">${tlink(from, logo(from, 18))} <span>${esc(a[1])}</span> <small class="muted" title="At the middle of the round, 5 prime seasons">${fmt(tradePickValue(a), 1)} WAR</small></li>`;
  }
  const p = a[0] === "player" ? tradePlayer(a) : null;
  if (!p) return `<li>${esc(a[1])}</li>`;
  const c = p.lg === "NHL" ? contractInfo(p) : null;
  return `<li><a href="${route(p.k)}"><b>${esc(p.n)}</b></a> <small class="muted">${esc(p.pos)} · ${p.age} · est. CA ${fmt(p.ca, 0)}${c?.cur?.sal ? ` · ${money(c.cur.sal)}` : ""} · ${fmt(playerValue(p).five, 1)} WAR</small></li>`;
}
/* Trade trees: what a team got, what it later turned that into, and so on. An asset is the same asset when it's the same
   player or the same pick (round, year, original team); it continues when the team sends it away in a later trade. A traded
   player can come back, so a trade appears once per branch. */
const tradeAssetId = a => a[0] === "pick" ? `pick|${a[3]}|${a[4]}|${a[5]}` : a[0] === "player" ? `player|${a[2] || a[1]}` : null;
const tradesOldest = () => (D._tradesOld ??= [...(D.trades || [])].reverse());
function nextTradeOf(team, asset, t) {
  const id = tradeAssetId(asset), all = tradesOldest();
  for (let i = all.indexOf(t) + 1; i < all.length; i++) {
    const x = all[i], mine = x.s.find(y => y[0] === team), other = x.s.find(y => y[0] !== team);
    if (mine && other?.[2].some(a => tradeAssetId(a) === id)) return { t: x, back: mine[2] };
  }
  return null;
}
/* What became of an asset that wasn't traded on: a chip on its card. */
function treeEnd(team, a) {
  const club = clubOfAbbr(team);
  if (a[0] === "player") {
    const p = tradePlayer(a);
    if (!p) return `<span class="tt-out muted">no longer in the player list</span>`;
    return clubOf(p) === club ? `<span class="tt-out keep">still with ${esc(club)}</span>` : `<span class="tt-out gone">left · now ${clubOf(p) ? esc(clubOf(p)) : "no club"}</span>`;
  }
  if (a[0] === "pick") {
    const made = (D.rights?.rows || []).filter(r => r[0] === club && r[1] === a[4] && r[2] === a[3]);
    if (made.length === 1) { const p = made[0][4] ? byKey.get(made[0][4]) : null; return `<span class="tt-out keep">drafted ${p ? `<a href="${route(p.k)}">${esc(p.n)}</a>` : esc(made[0][5])} #${made[0][3]}</span>`; }
    return made.length ? `<span class="tt-out muted">used in the ${a[4]} draft</span>` : `<span class="tt-out keep">still held</span>`;
  }
  return "";
}
/* One asset as a card: a player (position, age, est. CA, value) or a pick (original team's logo). */
function treeAsset(a, end = "") {
  if (a[0] === "pick") {
    const from = clubOfAbbr(a[5]);
    return `<div class="tt-card tt-asset">${logo(from, 24)}<div><b>${esc(a[1])}</b><small class="muted">${fmt(tradePickValue(a), 1)} WAR value</small></div>${end}</div>`;
  }
  const p = a[0] === "player" ? tradePlayer(a) : null;
  if (!p) return `<div class="tt-card tt-asset"><span class="tt-pos">?</span><div><b>${esc(a[1])}</b></div>${end}</div>`;
  return `<div class="tt-card tt-asset"><span class="tt-pos">${esc((p.pos || "").split("/")[0])}</span><div><a href="${route(p.k)}"><b>${esc(p.n)}</b></a>
    <small class="muted">${p.age} · est. CA ${fmt(p.ca, 0)} · ${fmt(playerValue(p).five, 1)} WAR</small></div>${end}</div>`;
}
/* A small chip for the "sent" row of a later trade; tree = this asset is the one the tree follows. */
function treeChip(a, tree) {
  const p = a[0] === "player" ? tradePlayer(a) : null;
  const name = p ? `<a href="${route(p.k)}">${esc(p.n)}</a>` : esc(a[1]);
  const icon = a[0] === "pick" ? logo(clubOfAbbr(a[5]), 16) : "";
  return `<span class="tt-chip${tree ? " tree" : " also"}" title="${tree ? "Followed by this tree" : "Also in this trade, not from this tree"}">${icon}${name}</span>`;
}
/* A later trade: who it went to, when, everything the team sent (the tree's assets highlighted, the rest marked "also")
   and, below it, everything that came back, each followed on in turn. */
function treeTrade(team, mine, next, seen, drawn) {
  const other = next.t.s.find(y => y[0] !== team), club = clubOfAbbr(team), to = clubOfAbbr(other[0]);
  // assets from different branches can meet in one later trade: draw it (and what came back) once, then point to it
  if (drawn.has(next.t)) return `<li class="tt-tradeli"><div class="tt-card tt-trade tt-ref">${logo(to, 18)}<span>Also went into the trade to <b>${esc(to)}</b>, ${fmtDate(next.t.d)}: shown above</span></div></li>`;
  drawn.add(next.t);
  const ids = new Set(mine.map(tradeAssetId)), sent = other[2];
  const href = `#/trades/${tradeSeason(next.t.d)}/${tradeQuery({ team: club, from: next.t.d, to: next.t.d })}`;
  const branch = new Set(seen).add(next.t);
  return `<li class="tt-tradeli"><div class="tt-card tt-trade">
      <div class="tt-head">${logo(club, 18)}<span class="tt-arrow" aria-hidden="true">⇄</span>${logo(to, 18)}<b>Traded to ${esc(to)}</b><time datetime="${next.t.d}">${fmtDate(next.t.d)}</time><a class="small" href="${href}">open trade →</a></div>
      <div class="tt-row"><span class="tt-lbl">Sent</span>${sent.map(a => treeChip(a, ids.has(tradeAssetId(a)))).join("")}</div>
      <div class="tt-row"><span class="tt-lbl">Got</span>${next.back.length ? next.back.map(a => treeChip(a, false).replace(" also", " got")).join("") : `<span class="muted">nothing listed</span>`}</div>
    </div>${next.back.length ? treeBranch(team, next.back, next.t, branch, drawn) : ""}</li>`;
}
/* The assets a team holds at one step: those it kept end the branch; those it traded on are grouped by the trade they went
   in, so a trade that sent two of them is drawn once. */
function treeBranch(team, assets, t, seen, drawn = new Set()) {
  const ends = [], groups = new Map();
  for (const a of assets) {
    const next = nextTradeOf(team, a, t);
    if (!next || seen.has(next.t)) ends.push(a);
    else { if (!groups.has(next.t)) groups.set(next.t, { next, mine: [] }); groups.get(next.t).mine.push(a); }
  }
  const moved = [...groups.values()].sort((a, b) => (a.next.t.d < b.next.t.d ? -1 : 1));
  const items = [
    ...ends.map(a => `<li>${treeAsset(a, treeEnd(team, a))}</li>`),
    ...moved.map(g => `<li>${g.mine.map(a => treeAsset(a, `<span class="tt-out moved">traded on</span>`)).join("")}<ul class="tt">${treeTrade(team, g.mine, g.next, seen, drawn)}</ul></li>`),
  ];
  return items.length ? `<ul class="tt">${items.join("")}</ul>` : `<p class="muted small">Nothing listed</p>`;
}
function tradeTree(t) {
  return `<div class="ttree">${t.s.map(x => { const club = clubOfAbbr(x[0]);
    return `<section class="tt-side"><h4>${logo(club, 22)} ${esc(club)} <span class="muted">received</span></h4>${treeBranch(x[0], x[2], t, new Set([t]))}</section>`; }).join("")}
    <p class="tt-key small muted"><span class="tt-chip tree">Highlighted</span> = the asset this tree follows · <span class="tt-chip also">dashed</span> = also in that trade, not from this tree · each later trade lists everything sent and received.</p></div>`;
}
/* The trade tree PNG: a top-down tree like a TV trade-tree graphic (the trade at the top, each side's haul below it, every
   later trade as a "to X for" box with what came back under it, assets that moved together joined with "+"), drawn in the
   site's own style. Same grouping and once-per-side rule as the page's tree. */
function ocAsset(a) {
  if (a[0] === "pick") {
    const from = clubOfAbbr(a[5]);
    return `<div class="oc-a">${logo(from, 26)}<div><b>${esc(a[1].replace(/ Round Pick in /, " round "))}</b><small>${fmt(tradePickValue(a), 1)} WAR value</small></div></div>`;
  }
  const p = a[0] === "player" ? tradePlayer(a) : null;
  if (!p) return `<div class="oc-a"><span class="tt-pos">?</span><div><b>${esc(a[1])}</b></div></div>`;
  return `<div class="oc-a"><span class="tt-pos">${esc((p.pos || "").split("/")[0])}</span><div><b>${esc(p.n)}</b><small>${p.age} · est. CA ${fmt(p.ca, 0)} · ${fmt(playerValue(p).five, 1)} WAR</small></div></div>`;
}
function ocBranch(team, assets, t, seen, drawn) {
  const ends = [], groups = new Map();
  for (const a of assets) {
    const next = nextTradeOf(team, a, t);
    if (!next || seen.has(next.t)) ends.push(a);
    else { if (!groups.has(next.t)) groups.set(next.t, { next, mine: [] }); groups.get(next.t).mine.push(a); }
  }
  const moved = [...groups.values()].sort((a, b) => (a.next.t.d < b.next.t.d ? -1 : 1));
  return [
    // the assets that went no further share one box (stacked), so a big haul doesn't make the image very wide
    ...(ends.length ? [`<li><div class="oc-node oc-stack">${ends.map(a => `<div class="oc-row">${ocAsset(a)}${treeEnd(team, a)}</div>`).join("")}</div></li>`] : []),
    ...moved.map(g => `<li><div class="oc-node oc-moved">${g.mine.map(ocAsset).join(`<span class="oc-plus">+</span>`)}</div><ul>${ocTrade(team, g.mine, g.next, seen, drawn)}</ul></li>`),
  ];
}
function ocTrade(team, mine, next, seen, drawn) {
  const other = next.t.s.find(y => y[0] !== team), to = clubOfAbbr(other[0]);
  if (drawn.has(next.t)) return `<li><div class="oc-ref">Also went into the trade to ${esc(to)}, ${fmtDate(next.t.d)}: shown elsewhere</div></li>`;
  drawn.add(next.t);
  const ids = new Set(mine.map(tradeAssetId)), also = other[2].filter(a => !ids.has(tradeAssetId(a)));
  const name = a => a[0] === "player" && tradePlayer(a) ? tradePlayer(a).n : a[1];
  const kids = next.back.length ? ocBranch(team, next.back, next.t, new Set(seen).add(next.t), drawn) : [`<li><div class="oc-ref">nothing listed</div></li>`];
  return `<li><div class="oc-trade">${logo(to, 22)}<div><b>To ${esc(to)} for</b><small>${fmtDate(next.t.d)}${also.length ? ` · with ${also.map(a => esc(name(a))).join(", ")}` : ""}</small></div></div><ul>${kids.join("")}</ul></li>`;
}
function exportTradeTree(t) {
  if (!t || !pngReady()) return;
  const v = tradeValues(t), drawn = new Set();
  const side = (x, i) => {
    const club = clubOfAbbr(x[0]), col = NHL_TEAMS[club]?.[1] || "var(--navy)";
    const kids = x[2].length ? ocBranch(x[0], x[2], t, new Set([t]), new Set()) : [`<li><div class="oc-ref">nothing listed</div></li>`];
    return `<li><div class="oc-side" style="--tc:${col}">${logo(club, 30)}<div><b>${esc(club)} acquires</b><small>${fmt(v.sides[i].war, 1)} WAR over 5 seasons</small></div></div><ul>${kids.join("")}</ul></li>`;
  };
  const sheet = document.createElement("div");
  sheet.className = "oc-sheet";
  sheet.innerHTML = `<header class="oc-band"><div><span class="oc-kicker">Trade tree</span><h1>${t.s.map(x => esc(clubOfAbbr(x[0]))).join(" ⇄ ")}</h1></div>
      <div class="oc-meta"><b>${fmtDate(t.d)}</b><span>Difference ${fmt(v.gap, 1)} WAR</span></div></header>
    <div class="oc"><ul><li><div class="oc-root">${t.s.map(x => logo(clubOfAbbr(x[0]), 44)).join(`<span>⇄</span>`)}</div><ul>${t.s.map(side).join("")}</ul></li></ul></div>
    <div class="oc-key"><span class="tt-out keep">still with / still held / drafted</span><span class="tt-out gone">left</span><span class="oc-trade mini"><b>To X for</b></span> a later trade: what came back is below it, "with" = also sent</div>
    <div class="xfoot"><span>${esc(D.title || "EHM Player Cards")} · NHL Trade Center · values with today's ratings</span><span>Snapshot ${fmtDate(D.dates.at(-1))}</span></div>`;
  sheet.querySelectorAll(".logo").forEach(l => { l.querySelector("img")?.remove(); l.classList.add("nologo"); });
  // the tree is as wide as it needs to be: measure it, then keep the image under ~15,000 px wide
  document.body.appendChild(sheet);
  const width = Math.max(1600, sheet.querySelector(".oc").scrollWidth + 80);
  sheet.remove();
  sheet.style.width = width + "px";
  const name = `Trade tree ${t.d} ${t.s.map(x => x[0]).join("-")}`.replace(/[^\w\- ]+/g, "");
  sheetToPng(sheet, width + 100, name + ".png", null, Math.min(3, 15000 / width));
}
/* Does anything from this trade go on to another trade? Trees that end at once are still shown, but this marks the long ones. */
const tradeBranches = t => t.s.reduce((n, x) => n + x[2].filter(a => nextTradeOf(x[0], a, t)).length, 0);
/* Trees are drawn when opened: a whole season's would be slow and most are never looked at. */
function wireTradeTrees(box) {
  box.addEventListener("toggle", e => {
    const d = e.target;
    if (d.tagName !== "DETAILS" || !d.classList.contains("ttree-box") || !d.open || d.dataset.done) return;
    d.dataset.done = "1";
    d.insertAdjacentHTML("beforeend", `<button type="button" class="linkbtn tt-png" data-t="${d.dataset.t}">Download PNG</button>` + tradeTree(tradesOldest()[+d.dataset.t]));
  }, true);
  box.addEventListener("click", e => { const b = e.target.closest(".tt-png"); if (b) exportTradeTree(tradesOldest()[+b.dataset.t]); });
}
function tradeCard(t) {
  const v = tradeValues(t), more = tradeBranches(t);
  const side = (x, i) => {
    const club = clubOfAbbr(x[0]), sv = v.sides[i], other = v.sides[1 - i];
    return `<div class="tside"><h3>${tname(club, 22)} <small class="muted">receives</small></h3>
      <ul class="plain tassets">${x[2].map(tradeAsset).join("") || `<li class="muted">Nothing listed</li>`}</ul>
      <p class="tvalue small"><b class="${other && sv.war > other.war ? "pos" : ""}">${fmt(sv.war, 1)} WAR</b> over 5 seasons${sv.surplus ? ` · <span class="${sv.surplus > 0 ? "pos" : "neg"}">${signedMoney(sv.surplus)}</span> contract surplus` : ""}${sv.missing ? ` · ${sv.missing} not valued` : ""}</p></div>`;
  };
  return `<article class="trade"><header><time datetime="${t.d}">${fmtDate(t.d)}</time><span class="small muted">Difference ${fmt(v.gap, 1)} WAR</span></header>
    <div class="tsides">${t.s.map(side).join("")}</div>
    <details class="ttree-box" data-t="${tradesOldest().indexOf(t)}"><summary>Trade tree${more ? ` <span class="chip">${more} went on to another trade</span>` : ""}</summary></details></article>`;
}
/* The trades a draft pick went through ("2027-1-Ottawa": year, round, original club), oldest first, and a link to them. */
const isPick = (a, y, r, club) => a[0] === "pick" && +a[4] === +y && +a[3] === +r && clubOfAbbr(a[5]) === club;
const pickTrades = (y, r, club) => (D.trades || []).filter(t => t.s.some(x => x[2].some(a => isPick(a, y, r, club)))).sort((a, b) => (a.d < b.d ? -1 : 1));
function pickTradeHref(y, r, club) {
  const ts = pickTrades(y, r, club);
  return ts.length ? `#/trades/${tradeSeason(ts.at(-1).d)}/${tradeQuery({ pick: `${y}-${r}-${club}`, tree: true })}` : null;
}
function tradeFilter(list, f) {
  const q = fold(f.q || "");
  const pk = f.pick ? f.pick.split("-") : null;   // year-round-club: the pick's trades, in every season
  const rows = list.filter(t => {
    if (pk && !t.s.some(x => x[2].some(a => isPick(a, pk[0], pk[1], pk.slice(2).join("-"))))) return false;
    if (f.team && !tradeInvolves(t, f.team)) return false;
    if (f.mine && !tradeInvolves(t, MY_TEAM)) return false;
    if (f.from && t.d < f.from) return false;
    if (f.to && t.d > f.to) return false;
    const assets = t.s.flatMap(x => x[2]);
    if (f.has === "players" && !assets.some(a => a[0] === "player")) return false;
    if (f.has === "picks" && !assets.some(a => a[0] === "pick")) return false;
    if (f.has === "first" && !assets.some(a => a[0] === "pick" && a[3] === 1)) return false;
    return !q || assets.some(a => fold(a[1]).includes(q));
  });
  const by = { new: (a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0), old: (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0),
               big: (a, b) => tradeValues(b).total - tradeValues(a).total, gap: (a, b) => tradeValues(b).gap - tradeValues(a).gap,
               n: (a, b) => tradeValues(b).n - tradeValues(a).n };
  return rows.sort(by[f.sort] || by.new);
}
const tradeNote = () => `<p class="small muted">From the game's NHL Trade Center. WAR is the trade predictor's: 5-season expected WAR with today's ratings, not those on the day
  of the trade, and a pick at the middle of its round. Contract surplus uses the deals as they stand now.</p>`;
/* The controls and list, shared by the Trades page and a club's tab. onChange(f) keeps the URL in step. */
function tradeBrowser(box, list, f, opts = {}) {
  const clubs = [...new Set(list.flatMap(t => t.s.map(x => clubOfAbbr(x[0]))))].sort((a, b) => a.localeCompare(b));
  const options = (rows, cur) => rows.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
  box.innerHTML = `<form class="filters tfilters" aria-label="Sort and filter trades">
      <label>Sort <select id="tf-sort">${options(TRADE_SORTS, f.sort || "new")}</select></label>
      ${opts.club ? "" : `<label>Team <select id="tf-team">${options([["", "All teams"], ...clubs.map(c => [c, c])], f.team || "")}</select></label>`}
      <label>Contains <select id="tf-has">${options(TRADE_HAS, f.has || "")}</select></label>
      <label>Player or pick <input id="tf-q" type="search" value="${esc(f.q || "")}" placeholder="name or round"></label>
      <label>From <input id="tf-from" type="date" value="${esc(f.from || "")}"></label>
      <label>To <input id="tf-to" type="date" value="${esc(f.to || "")}"></label>
      ${opts.club ? "" : `<label class="check"><input id="tf-mine" type="checkbox"${f.mine ? " checked" : ""}> ${esc(MY_TEAM)} only</label>`}
      <button type="button" id="tf-clear" class="linkbtn">Clear</button>
    </form>
    ${f.pick ? (([y, r, ...c]) => `<p class="pickfilter">Trades of <b>${esc(c.join("-"))}'s ${y} round ${r} pick</b> <button type="button" class="linkbtn" id="tf-nopick">Show every trade</button></p>`)(f.pick.split("-")) : ""}
    <p class="small muted" id="tf-count" role="status"></p><div id="tf-list"></div>${tradeNote()}`;
  const draw = () => {
    const rows = tradeFilter(list, f);
    box.querySelector("#tf-count").textContent = `${rows.length} of ${list.length} trades`;
    box.querySelector("#tf-list").innerHTML = rows.map(tradeCard).join("") || `<p class="muted">No trades match the filters.</p>`;
    if (f.tree) box.querySelectorAll("#tf-list .ttree-box").forEach(d => { d.open = true; });   // a link can open the trees
    opts.onChange?.(f);
  };
  const bind = (id, key, get = e => e.target.value) => box.querySelector(id)?.addEventListener(id === "#tf-q" ? "input" : "change", e => { f[key] = get(e); draw(); });
  bind("#tf-sort", "sort"); bind("#tf-team", "team"); bind("#tf-has", "has"); bind("#tf-q", "q"); bind("#tf-from", "from"); bind("#tf-to", "to");
  bind("#tf-mine", "mine", e => e.target.checked);
  wireTradeTrees(box.querySelector("#tf-list"));
  box.querySelector("#tf-nopick")?.addEventListener("click", () => { delete f.pick; tradeBrowser(box, list, f, opts); opts.onChange?.(f); });
  box.querySelector("#tf-clear").onclick = () => { for (const k of Object.keys(f)) delete f[k]; tradeBrowser(box, list, f, opts); opts.onChange?.(f); };
  draw();
}
const tradeQuery = f => new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, v === true ? "1" : v])).toString();
function renderTrades(season, query) {
  markNav("trades");
  const seasons = tradeSeasons();
  if (!seasons.length) {
    view.innerHTML = `<div class="wrap page"><h1>Trades</h1><p class="muted">Not read yet: the crawler reads the NHL Trade Center with <code>--trades</code>.</p></div>`;
    return;
  }
  if (!seasons.includes(season)) season = seasons[0];
  const f = Object.fromEntries(new URLSearchParams(query || ""));
  if (f.mine) f.mine = true;
  const list = f.pick ? D.trades.slice() : D.trades.filter(t => tradeSeason(t.d) === season);   // a pick's trades can span seasons
  view.innerHTML = `<div class="wrap page"><div class="box-head"><div><h1>NHL trades</h1><p class="lede">Every trade of a season, what each team received and how it looks today.</p></div>
      <label class="inline small muted">Year <select id="tr-season">${seasons.map(s => `<option value="${s}"${s === season ? " selected" : ""}>${seasonLabel(s)}</option>`).join("")}</select></label></div>
    <div id="tr-box"></div></div>`;
  view.querySelector("#tr-season").onchange = e => { location.hash = `#/trades/${e.target.value}`; };
  tradeBrowser(view.querySelector("#tr-box"), list, f, { onChange: x => {
    const q = tradeQuery(x), url = `#/trades/${season}${q ? "/" + q : ""}`;
    if (location.hash !== url) history.replaceState(null, "", url);
  } });
}
/* A club's Trades tab: its html first, then wireTeamTrades once it's on the page. */
const teamTradesTab = () => `<div id="tr-box"></div>`;
function wireTeamTrades(club) {
  const box = view.querySelector("#tr-box");
  if (!box) return;
  const list = (D.trades || []).filter(t => tradeInvolves(t, club));
  if (!list.length) { box.innerHTML = `<p class="muted">${D.trades ? `${esc(club)} hasn't made a trade in this league's Trade Center.` : `Not read yet: the crawler reads the NHL Trade Center with <code>--trades</code>.`}</p>`; return; }
  tradeBrowser(box, list, { }, { club });
}
/* A player's trades, for his Contract & record tab. */
function playerTrades(p) {
  const rows = (D.trades || []).flatMap(t => t.s.filter(x => x[2].some(a => a[0] === "player" && (a[2] === p.k || (!a[2] && a[1] === p.n)))).map(x => {
    const from = t.s.find(y => y !== x);
    return `<li><time datetime="${t.d}">${fmtDate(t.d)}</time> ${from ? `${tname(clubOfAbbr(from[0]))} to ` : "To "}${tname(clubOfAbbr(x[0]))}
      <details class="ttree-box" open><summary>Trade tree</summary>${tradeTree(t)}</details></li>`;
  }));
  return rows.length ? `<div class="panel"><h2>Trade history</h2><ul class="plain thist">${rows.join("")}</ul></div>` : "";
}
