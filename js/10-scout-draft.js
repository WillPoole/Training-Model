"use strict";

// ---------------------------------------------------------------- about
// ---------------------------------------------------------------- scout report + hidden values
let SCOUTED = null;
function scoutPanel(p) {
  const s = p.sc;
  if (!s) {
    // with reports in the data, a missing one means the crawled club's scouts have none (his Scout Report tab is greyed out)
    SCOUTED ??= D.players.filter(q => q.sc).length;
    return `<div class="panel" id="scoutpanel"><h2>Scout report &amp; hidden values</h2>
    <p class="sub">${SCOUTED ? `No scout report on him: the scouts of the club the crawler logs in as haven't covered him, so his Scout Report
      tab was greyed out when the crawler read it (${SCOUTED.toLocaleString()} of ${D.players.length.toLocaleString()} players have one). Scouting him in the game
      (or a scout assignment that covers him) brings it in with the next scout pass.` : `No scout reports in this data yet. Run the crawler with <code>--scout</code>
      to read every player's Scout Report tab (stars, report text and role).`} The report phrases are decoded into hidden-value ranges.</p></div>`;
  }
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
const DR = { mode: "mid", sort: "ours", dir: 1, f: {}, limit: 150, grp: "", lg: "", scouted: "", open: new Set() };
const STAGE_ORDER = ["Preliminary", "Mid-Season", "Final"];
/* [key, label, value getter, numeric] */
const DRAFT_COLS = [
  ["ours", "Ours", s => s.ours, true],
  ["nhl", "NHL", s => s.nhl, true],
  ["move", "Change", s => s.move, true],
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
const DRAFT_MAIN = ["ours", "nhl", "n", "peak", "ca", "fut", "move"];   // the columns the board opens with
const DRAFT_TIP = { ours: "Average of the NHL rank and the rank by projected peak", nhl: "The NHL's rank, and how far ours differs", move: "Places gained since the NHL's previous list",
  peak: "Highest est. CA on his projected path, with his likely range", ca: "Estimated current ability", fut: "Future rating in his scout report" };
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
/* The scout report in brief, for the expandable draft-board row: stars, tier, preferred role, hidden-value ranges. */
function scoutBrief(p) {
  const s = p.sc, link = `<a href="${route(p.k)}/scout">Open his scouting report →</a>`;
  if (!s) return `<span class="muted">No scout report on him (his Scout Report tab was greyed out when the crawler read it).</span> ${link}`;
  const stars = (lab, n) => (n == null ? "" : `<span>${lab} <span class="stars">${"★".repeat(n)}<span class="off">${"★".repeat(5 - n)}</span></span></span>`);
  const hidden = s.ranges.filter(r => r[3]);
  return `<div class="scout-head">${stars("Current", s.cur)}${stars("Future", s.fut)}
      ${s.career ? `<span>Career role <b>${esc(s.career)}</b></span>` : ""}${s.role ? `<span>Preferred role <b>${esc(s.role)}</b></span>` : ""}</div>
    ${hidden.length ? `<p class="small">Hidden values: ${hidden.map(([n, lo, hi]) => `<span class="chip">${esc(n)} <b>${lo === hi ? lo : lo + "–" + hi}</b></span>`).join(" ")}</p>` : ""}
    <p class="small">${link} <span class="muted">· ${esc(s.scout || "Scout")}, ${fmtDate(s.date)}</span></p>`;
}
/* The evidence file ehm.studies.draft_rank_bench writes: its test results and the slot curve of the underrated flag. */
const EV_DATA = typeof DRAFT_EVIDENCE !== "undefined" ? DRAFT_EVIDENCE : null;
const EV_SLOT = EV_DATA?.slot || null;
/* What a player at this NHL rank usually projects to (training save, log-rank quadratic + a goalie term). */
function draftSlotPeak(rank, grp) {
  const c = EV_SLOT.coef, l = Math.log(rank);
  return c[0] + c[1] * l + c[2] * l * l + c[3] * (grp === "G" ? 1 : 0);
}
/* Players on the latest NHL draft ranking. "ours" = the average of the NHL rank and the rank by projected peak under the
   chosen outcome, the ordering the user chose after draft_rank_bench (ties: the better NHL rank). The flag always uses the
   expected peak: that's the rule that was tested. Tiers follow the expected peak in our order. */
function draftBoard(mode) {
  const pool = D.players.map(p => ({ p, r: nhlRanks(p) })).filter(x => x.r);
  const rows = pool.map(({ p, r }) => {
    const pr = p._proj || (p._proj = project(p));
    const peak = k => Math.max(...pr.map(x => x[k]));
    const other = (p.drs || []).filter(d => !d[0].includes("(NHL)"))
      .map(d => `${d[0].replace(/^(\S+) \((\w+)\)$/, "$2 $1")} #${d[1]}`).join(", ");
    const mid = peak("mid"), gap = EV_SLOT ? mid - draftSlotPeak(r.rank, p.grp) : 0;
    return { p, stage: r.stage, nhl: r.rank, move: r.move, prevTxt: r.prevTxt, lo: peak("lo"), mid, hi: peak("hi"), other, gap, under: !!EV_SLOT && gap >= EV_SLOT.threshold };
  });
  const byMode = rows.slice().sort((a, b) => b[mode] - a[mode]);
  byMode.forEach((s, i) => (s.blend = (s.nhl + i + 1) / 2));
  rows.sort((a, b) => a.blend - b.blend || a.nhl - b.nhl).forEach((s, i) => (s.ours = i + 1));
  const step = EV_SLOT ? EV_SLOT.threshold * 2 : Infinity;
  const smooth = i => { const w = rows.slice(i, i + 5).map(s => s.mid).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; };
  let tier = 1, base = rows.length ? smooth(0) : 0;
  rows.forEach((s, i) => { const v = smooth(i); if (base - v >= step) { tier++; base = v; } s.tier = tier; });
  return { rows };
}
/* Any table with class "sortable": clicking a header sorts the rows by that column (numbers high to low first, text A to Z;
   again to reverse). A cell's data-v overrides its text; "–" sorts last. */
function cellValue(td) {
  const raw = (td?.dataset.v ?? td?.textContent ?? "").trim().replace(/−/g, "-").replace(/,/g, "");
  if (!raw || raw === "–" || raw === "-") return null;
  const m = raw.match(/^([+-]?\d+(?:\.\d+)?)%?(?:\s|$)/);
  return m ? +m[1] : raw.toLowerCase();
}
function makeSortable(root = view) {
  root.querySelectorAll("table.sortable").forEach(tbl => {
    const ths = [...(tbl.tHead?.rows[0]?.cells || [])];
    ths.forEach((th, i) => {
      if (th.dataset.nosort != null) return;
      th.classList.add("sort");
      th.tabIndex = 0;
      if (!th.hasAttribute("aria-sort")) th.setAttribute("aria-sort", "none");
      const go = () => {
        const body = tbl.tBodies[0], rows = [...body.rows];
        const vals = rows.map(tr => cellValue(tr.cells[i]));
        const numeric = vals.some(v => typeof v === "number");
        const cur = th.getAttribute("aria-sort");
        const dir = cur === "none" ? (numeric ? -1 : 1) : cur === "descending" ? 1 : -1;
        const order = rows.map((tr, j) => [tr, vals[j], j]).sort((x, y) => {
          if (x[1] == null) return y[1] == null ? x[2] - y[2] : 1;
          if (y[1] == null) return -1;
          const c = typeof x[1] === "number" && typeof y[1] === "number" ? x[1] - y[1] : String(x[1]).localeCompare(String(y[1]));
          return c * dir || x[2] - y[2];
        });
        order.forEach(([tr]) => body.appendChild(tr));
        ths.forEach(h => { if (h.dataset.nosort == null) { h.setAttribute("aria-sort", "none"); h.classList.remove("on"); } });
        th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
        th.classList.add("on");
      };
      th.onclick = e => { if (!e.target.closest("a")) go(); };
      th.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    });
  });
}
/* Draft value of a pick = expected WAR per season at the player's projected peak (best est. CA on his projected path,
   through the expected-WAR curve the trade predictor uses), so every draft year can be compared, not only the ones
   with NHL seasons in the box scores. The slot expectation is the average value at that slot: one decreasing slot
   shape pooled over every draft year, scaled to each year's average, so a draft's known picks add up to zero above
   slot and every pick is compared with picks of the same class. Slots without a draft record (players who left the
   database, or weren't crawled) are left out of both. */
let DV = null;
function draftValues() {
  if (DV && DV.data === D) return DV;
  const picks = (D.draftHist || []).map(([year, round, pick, team, k, n, w, last]) => {
    const p = byKey.get(k) || null, seasons = Object.values(w || {});
    // a player no longer in the data keeps the value of his last estimate (no projection)
    return { year, round, pick, team, club: draftClub(team) || team, k, n: p ? p.n : n, p, last,
             v: p ? expWar(p.grp, sortVal(p, "peak")) : last ? expWar(last[2], last[1]) : 0,
             war: seasons.reduce((s, x) => s + x[0], 0), gp: seasons.reduce((s, x) => s + x[1], 0) };
  });
  const years = [...new Set(picks.map(x => x.year))].sort((a, b) => b - a);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const yMean = Object.fromEntries(years.map(y => [y, mean(picks.filter(x => x.year === y).map(x => x.v))]));
  const rel = Array.from({ length: 224 }, () => []);
  picks.forEach(x => { if (yMean[x.year] > 0 && x.pick <= 224) rel[x.pick - 1].push(x.v / yMean[x.year]); });
  let raw = rel.map(a => a.length ? mean(a) : null);
  raw = raw.map((v, i) => v ?? raw.slice(0, i).reverse().find(x => x != null) ?? raw.find(x => x != null) ?? 1);
  const W = 9;   // smoothed over 9 picks, then made to fall (an earlier pick is never expected to be worth less)
  const shape = raw.map((_, i) => mean(raw.slice(Math.max(0, i - (W >> 1)), i + (W >> 1) + 1)));
  for (let i = 1; i < shape.length; i++) shape[i] = Math.min(shape[i], shape[i - 1]);
  years.forEach(y => {   // scale the shape so the year's known picks average out to the year's mean value
    const own = picks.filter(x => x.year === y), m = mean(own.map(x => shape[Math.min(224, x.pick) - 1]));
    own.forEach(x => { x.exp = m > 0 ? yMean[y] * shape[Math.min(224, x.pick) - 1] / m : 0; x.above = x.v - x.exp; });
  });
  const cover = Object.fromEntries(years.map(y => [y, picks.filter(x => x.year === y).length]));
  DV = { data: D, picks, years, cover, slots: y => (y >= 2021 ? 224 : y >= 2017 ? 217 : 211) };
  return DV;
}
/* Per club over the chosen draft years: picks, value, expected, above slot, hits (picks above their slot). */
function drafterTable(from, to) {
  const by = {};
  draftValues().picks.filter(x => x.year >= from && x.year <= to).forEach(x => {
    const t = (by[x.club] ||= { club: x.club, n: 0, v: 0, exp: 0, above: 0, hits: 0, gp: 0, war: 0, nhl: 0, best: null });
    t.n++; t.v += x.v; t.exp += x.exp; t.above += x.above; t.hits += x.above > 0; t.gp += x.gp; t.war += x.war; t.nhl += x.gp > 0;
    if (!t.best || x.above > t.best.above) t.best = x;
  });
  return Object.values(by).filter(t => NHL_TEAMS[t.club]).sort((a, b) => b.above - a.above);
}
const aboveCell = v => `<td class="num ${v > 0.05 ? "up" : v < -0.05 ? "down" : ""}"><b>${signed(v, 2)}</b></td>`;
// a pick whose player has left the data still opens his former-player page (hasPage)
const pickRows = (rows, withClub, hl) => rows.map(x => `<tr id="pick-${x.pick}" class="${hasPage(x.k) ? "link" : ""}${x.pick === hl ? " hl" : ""}"${hasPage(x.k) ? ` data-k="${esc(x.k)}"` : ""}>
    <td class="num">${x.pick}</td><td class="num">${x.round}</td>${withClub ? `<td class="nowrap">${tlink(x.club, `${logo(x.club, 22)} ${esc(NHL_TEAMS[x.club]?.[0] || x.club)}`)}</td>` : ""}
    <th scope="row" class="pcol">${hasPage(x.k) ? `<a class="pcell" href="${route(x.k)}"><span><b class="${x.p ? "" : "muted"}">${esc(x.n)}</b></span></a>` : `<span class="muted">${esc(x.n)}</span>`}</th>
    <td>${x.p ? esc(x.p.pos) : ""}</td><td class="num">${x.p ? x.p.age : ""}</td>
    <td class="now">${x.p ? `${tname(clubOf(x.p))}${x.p.lg ? ` <span class="muted small">${esc(x.p.lg)}</span>` : ""}` : `<span class="muted small">${x.last ? `last seen ${fmtDate(x.last[0])}` : "never in a snapshot"}</span>`}</td>
    <td class="num">${x.p ? fmt(x.p.ca, 0) : x.last ? `<span class="muted">${fmt(x.last[1], 0)}</span>` : dash}</td><td class="num">${x.p ? fmt(sortVal(x.p, "peak"), 0) : dash}</td>
    <td class="num">${fmt(x.v, 2)}</td><td class="num muted">${fmt(x.exp, 2)}</td>${aboveCell(x.above)}
    <td class="num">${x.gp || dash}</td><td class="num">${x.gp ? fmt(x.war, 1) : dash}</td></tr>`).join("");
const pickHead = withClub => `<thead><tr><th class="num">Pick</th><th class="num">Rd</th>${withClub ? "<th>Team</th>" : ""}<th class="pcol">Player</th><th>Pos</th><th class="num">Age</th>
    <th>Now</th><th class="num">Est. CA</th><th class="num">Proj. peak</th><th class="num">Value</th><th class="num">Slot avg</th><th class="num">Above slot</th>
    <th class="num">NHL GP</th><th class="num">NHL WAR</th></tr></thead>`;
const DRAFT_VALUE_NOTE = `Value = expected WAR per season at the player's projected peak (his best est. CA, now or projected,
  through the expected-WAR curve on the trade predictor). Slot avg = the average value at that pick over every draft in the data, scaled to the
  class. Above slot = value − slot avg. A player who has left the data keeps the value of his last est. CA; one never seen counts as 0.
  NHL GP / WAR: regular-season box scores in this save so far. Picks without a draft record are left out.`;
const DH = { from: null, to: null, sort: "above" };
function renderDraftHistory(tab, arg, pick) {
  const V = draftValues(), years = V.years;
  let body = "";
  if (tab === "past") {
    const y = years.includes(+arg) ? +arg : years[0];
    const rows = V.picks.filter(x => x.year === y).sort((a, b) => a.pick - b.pick);
    const teams = drafterTable(y, y);
    const best = rows.filter(x => x.p).sort((a, b) => b.above - a.above).slice(0, 5);
    body = `<div class="cardbar"><div><h2 class="flat">${y} NHL Entry Draft</h2>
        <p class="sub">${rows.length} of ${V.slots(y)} picks in the draft records${rows.length < 0.8 * V.slots(y) ? ": players who left the database (or weren't crawled) are missing" : ""}.</p></div>
        <span class="inline yearnav">${(() => { const i = years.indexOf(y), older = years[i + 1], newer = years[i - 1];
          return `<a class="ghost${older ? "" : " disabled"}" ${older ? `href="#/draft/past/${older}"` : 'aria-disabled="true"'} title="Previous draft">← ${older || ""}</a>
          <label class="inline">Draft <select id="dh-year">${years.map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <a class="ghost${newer ? "" : " disabled"}" ${newer ? `href="#/draft/past/${newer}"` : 'aria-disabled="true"'} title="Next draft">${newer || ""} →</a>`; })()}</span></div>
      <div class="row">
        <section class="card-box" aria-labelledby="bp-h"><h2 id="bp-h">Best value</h2><p class="sub">Most above their slot</p>
          ${best.map(x => listRow(x.p, `<span class="lnum"><b>${signed(x.above, 2)}</b></span>`, `<a href="#/draft/past/${y}/${x.pick}">#${x.pick}</a> · ${tname(x.club)} · ${esc(x.p.pos)} · peak ${fmt(sortVal(x.p, "peak"), 0)}`)).join("")}</section>
        <section class="card-box" aria-labelledby="bt-h"><h2 id="bt-h">Best drafting teams</h2><p class="sub">Value above slot, ${y} picks</p>
          ${teams.slice(0, 5).map((t, i) => `<div class="lrow">${logo(t.club, 30)}<span class="lmain">${clubLink(t.club, "/drafts", `<b>${i + 1}. ${esc(t.club)}</b>`, "lname")}
            <small>${t.n} picks · best: ${hasPage(t.best.k) ? `<a href="${route(t.best.k)}">${esc(t.best.n)}</a>` : esc(t.best.n)} (<a href="#/draft/past/${y}/${t.best.pick}">#${t.best.pick}</a>)</small></span><span class="lnum"><b>${signed(t.above, 2)}</b></span></div>`).join("")}</section>
      </div>
      <section class="card-box flush" aria-label="Every pick"><h2 class="box-h">Every pick <span class="muted">${rows.length}</span></h2>
        <div class="tablewrap"><table class="rank sortable picks">${pickHead(true)}<tbody>${pickRows(rows, true, +pick)}</tbody></table></div><p class="sub pad">${DRAFT_VALUE_NOTE}</p></section>`;
  } else {
    const lo = years.at(-1), hi = years[0];
    if (arg === "all") Object.assign(DH, { from: lo, to: hi });
    else if (arg === "5") Object.assign(DH, { from: Math.max(lo, hi - 4), to: hi });
    DH.to = years.includes(DH.to) ? DH.to : hi;
    DH.from = years.includes(DH.from) ? DH.from : Math.max(lo, hi - 9);
    if (DH.from > DH.to) [DH.from, DH.to] = [DH.to, DH.from];
    const T = drafterTable(DH.from, DH.to);
    const yearsIn = years.filter(y => y >= DH.from && y <= DH.to).reverse();
    const th = (k, t) => `<th class="num${k === "above" ? " on" : ""}"${k === "above" ? ' aria-sort="descending"' : ""}>${t}</th>`;
    const sel = (id, v) => `<select id="${id}">${years.map(y => `<option ${y === v ? "selected" : ""}>${y}</option>`).join("")}</select>`;
    body = `<div class="cardbar"><div><h2 class="flat">Best drafters, ${DH.from}–${DH.to}</h2>
        <p class="sub">Each club's picks against what's normal at those slots. Picks in the records: ${yearsIn.map(y => `${y} ${V.cover[y]}/${V.slots(y)}`).join(" · ")}.</p></div>
        <span class="inline"><label>From ${sel("dh-from", DH.from)}</label> <label>To ${sel("dh-to", DH.to)}</label></span></div>
      <section class="card-box flush" aria-label="Drafting scoreboard"><div class="tablewrap"><table class="rank sortable"><thead><tr><th class="num">#</th><th>Team</th><th class="num">Picks</th>
        ${th("v", "Value")}<th class="num">Slot avg</th>${th("above", "Above slot")}${th("per", "Per pick")}${th("hits", "Beat slot")}${th("nhl", "Made NHL")}${th("war", "NHL WAR")}<th>Best pick</th></tr></thead><tbody>
        ${T.map((t, i) => `<tr class="${hasClub(t.club) ? "tlink" : ""}${t.club === decodePart(pick || "") ? " hl" : ""}" data-club="${esc(t.club)}"><td class="num">${i + 1}</td><th scope="row" class="nowrap">${clubLink(t.club, "/drafts", `${logo(t.club, 24)} ${esc(t.club)}`)}</th>
          <td class="num">${t.n}</td><td class="num">${fmt(t.v, 1)}</td><td class="num muted">${fmt(t.exp, 1)}</td>${aboveCell(t.above)}
          <td class="num" data-v="${t.above / t.n}">${signed(t.above / t.n, 3)}</td><td class="num">${Math.round(100 * t.hits / t.n)}%</td><td class="num">${t.nhl}</td><td class="num">${fmt(t.war, 1)}</td>
          <td class="small">${hasPage(t.best.k) ? `<a href="${route(t.best.k)}">${esc(t.best.n)}</a>` : esc(t.best.n)} <span class="muted"><a href="#/draft/past/${t.best.year}/${t.best.pick}">${t.best.year} #${t.best.pick}</a>, ${signed(t.best.above, 2)}</span></td></tr>`).join("")}
        </tbody></table></div>
        <p class="sub pad">Above slot = the sum over the club's picks of value − slot avg (value = expected WAR per season at the player's projected peak).
          Per pick = above slot / picks, fairer when clubs made different numbers of picks. Beat slot = share of picks worth more than their slot avg.
          Made NHL / NHL WAR: picks with regular-season NHL games in this save's box scores. The club is the one that made the pick; a club isn't its GM,
          so in a multiplayer league read it per GM tenure. Recent classes are mostly projection, older ones mostly settled ability.</p></section>`;
  }
  view.innerHTML = `${draftHead(tab)}<div class="wrap page">${body}</div>`;
  bindDraftHead();
  view.querySelector("#dh-year")?.addEventListener("change", e => (location.hash = "#/draft/past/" + e.target.value));
  // the router scrolls to the top after rendering: scroll to the highlighted pick after that
  const hl = view.querySelector("tr.hl");
  if (hl) setTimeout(() => hl.scrollIntoView({ block: "center" }), 0);
  view.querySelector("#dh-from")?.addEventListener("change", e => { DH.from = +e.target.value; renderDraftHistory(tab, null, pick); });
  view.querySelector("#dh-to")?.addEventListener("change", e => { DH.to = +e.target.value; renderDraftHistory(tab, null, pick); });
  makeSortable();
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  view.querySelectorAll("tr.tlink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = teamRoute(tr.dataset.club) + "/drafts"; });
}
/* Team page: every pick the club made, newest draft first, with the running total above slot. */
function teamDraftsTab(club) {
  const V = draftValues(), mine = V.picks.filter(x => x.club === club);
  const years = [...new Set(mine.map(x => x.year))].sort((a, b) => b - a);
  const all = drafterTable(V.years.at(-1), V.years[0]), rank = all.findIndex(t => t.club === club) + 1;
  const recent = drafterTable(V.years[0] - 4, V.years[0]), rRank = recent.findIndex(t => t.club === club) + 1;
  let run = 0;
  const tot = {};
  years.slice().reverse().forEach(y => { const a = mine.filter(x => x.year === y).reduce((s, x) => s + x.above, 0); run += a; tot[y] = [a, run]; });
  return `<div class="stat-cards">
      <div><span>Picks in the records</span><b>${mine.length}</b><small>${years.at(-1)}–${years[0]} drafts</small></div>
      <div><span>Above slot, all drafts</span><b>${rank ? signed(all[rank - 1].above, 2) : "–"}</b><small>${rank ? rankLink(`#/draft/scores/all/${encodeURIComponent(club)}`, `${ordinal(rank)} of ${all.length}`) : ""}</small></div>
      <div><span>Above slot, last 5 drafts</span><b>${rRank ? signed(recent[rRank - 1].above, 2) : "–"}</b><small>${rRank ? rankLink(`#/draft/scores/5/${encodeURIComponent(club)}`, `${ordinal(rRank)} of ${recent.length}`) : ""}</small></div>
      <div><span>Picks who made the NHL</span><b>${mine.filter(x => x.gp > 0).length}</b><small>${fmt(mine.reduce((s, x) => s + x.war, 0), 1)} WAR in this save</small></div>
    </div>
    ${years.map(y => { const rows = mine.filter(x => x.year === y).sort((a, b) => a.pick - b.pick);
      return `<section class="card-box flush" aria-label="${y} draft"><h2 class="box-h">${y} draft <span class="muted">${rows.length} picks · above slot ${signed(tot[y][0], 2)} · running total ${signed(tot[y][1], 2)}</span>
        <a class="small" href="#/draft/past/${y}">Whole draft →</a></h2>
        <div class="tablewrap"><table class="rank sortable picks">${pickHead(false)}<tbody>${pickRows(rows, false)}</tbody></table></div></section>`; }).join("")}
    <p class="sub">${DRAFT_VALUE_NOTE} Running total = above slot summed from the oldest draft in the data up to that one. <a href="#/draft/scores">Every club →</a></p>`;
}
