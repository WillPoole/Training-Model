"use strict";

// ---------------------------------------------------------------- players page (topic tabs)
/* #/players/<tab>: Overview, Offence, Defence, Traits, Goalies, Development, Contract. Always-visible filters (league,
   position, club, max age, season, regular season / playoffs), then 3-6 "top 5" boxes that follow the filters, then one
   sortable table. A column or box with no data for the current filter hides itself and a note says why.
   Data: p.card / p.war (season + game type, via inSeason / rankRow), D.teamPlayers (blocks), the career lines (PP / SH
   points, goalie record, other leagues), the attribute history (traits) and the scout ranges (character). */
const PL_TABS = [["overview", "Overview"], ["offence", "Offence"], ["defence", "Defence"], ["traits", "Traits"], ["goalies", "Goalies"],
  ["development", "Development"], ["contract", "Contract"]];
const TAG_CUT = 85;   // a trait tag needs this percentile among NHL players at the position

// ---- traits: the average of a few visible attributes, as a percentile against NHL players of the same group (F, D, G)
const TRAITS = [
  { k: "shooter", t: "Shooter", a: ["Wristshot", "Slapshot"], grps: "FD" },
  { k: "openice", t: "Finds open ice", a: ["Off The Puck", "Anticipation"], grps: "FD" },
  { k: "playmaker", t: "Playmaker", a: ["Passing", "Creativity"], grps: "FD" },
  { k: "puck", t: "Puck skills", a: ["Stickhandling", "Deking"], grps: "FD" },
  { k: "speed", t: "Speed", a: ["Speed", "Acceleration", "Agility"], grps: "FD" },
  { k: "physical", t: "Physical", a: ["Hitting", "Strength", "Bravery"], grps: "FD" },
  { k: "shutdown", t: "Shutdown", a: ["Checking", "Positioning", "Pokecheck"], grps: "FD" },
  { k: "motor", t: "Motor", a: ["Work Rate", "Stamina"], grps: "FD" },
  { k: "leader", t: "Leader", a: ["Influence", "Teamwork", "Determination"], grps: "FD" },
  { k: "faceoffs", t: "Faceoffs", a: ["Faceoffs"], grps: "F" },
  { k: "gshot", t: "Shot stopping", s: "Shot stopping", grps: "G" },
  { k: "gpos", t: "Positioning", s: "Positioning", grps: "G" },
  { k: "gath", t: "Athleticism", s: "Athleticism", grps: "G" },
  { k: "gpuck", t: "Puck play", s: "Puck play", grps: "G" },
  { k: "gment", t: "Mental", s: "Mental", grps: "G" },
];
TRAITS.forEach(t => { t.i = (t.a || []).map(a => (D.attrs || []).findIndex(x => x.endsWith(": " + a))); });
const plTraitsFor = grp => TRAITS.filter(t => t.grps.includes(grp));
const GRP_NAME = { F: "forwards", D: "defence", G: "goalies" };
function plTraitScore(p, t) {
  if (t.s) return (p.grpS || []).find(x => x[0] === t.s)?.[1] ?? null;
  const row = p.h?.at(-1);
  if (!row || t.i.includes(-1)) return null;
  const v = t.i.map(i => row[i + 2]);
  return v.some(x => x == null) ? null : v.reduce((s, x) => s + x, 0) / v.length;
}
function plPctIn(a, v) {   // a sorted ascending: mid-rank percentile of v in it
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  let up = lo;
  while (up < a.length && a[up] <= v) up++;
  return a.length ? Math.round(100 * (lo + (up - lo) / 2) / a.length) : null;
}
let PL_TD = null;   // player key -> { traitKey: [score, percentile] }; attributes are the latest snapshot, so no season dependency
function plTraitData() {
  if (PL_TD?.data === D) return PL_TD.m;
  const m = new Map(), pool = {};
  D.players.forEach(p => {
    const o = {};
    plTraitsFor(p.grp).forEach(t => {
      const s = plTraitScore(p, t);
      if (s == null) return;
      o[t.k] = [s, null];
      if (p.lg === "NHL") (pool[p.grp + t.k] ||= []).push(s);
    });
    m.set(p.k, o);
  });
  Object.values(pool).forEach(a => a.sort((x, y) => x - y));
  D.players.forEach(p => { const o = m.get(p.k); for (const k in o) o[k][1] = plPctIn(pool[p.grp + k] || [], o[k][0]); });
  PL_TD = { data: D, m };
  return m;
}
function plTags(p) {
  const d = plTraitData().get(p.k) || {};
  return TRAITS.filter(t => d[t.k]?.[1] >= TAG_CUT).map(t => ({ t: t.t, pct: d[t.k][1], score: d[t.k][0] }))
    .sort((a, b) => b.pct - a.pct || b.score - a.score).slice(0, 3);
}
/* Traits shown for a position filter: goalie traits for goalies, the skater traits otherwise (Faceoffs not for defence). */
const plTraitList = grp => (grp === "G" ? plTraitsFor("G") : TRAITS.filter(t => !t.s && (!grp || t.grps.includes(grp))));
function plCurTrait() {
  const list = plTraitList(R.grp);
  return list.find(t => t.k === R.trait) || list[0];
}
const CHARACTER = ["Important Matches", "Professionalism", "Ambition", "Consistency", "Pressure"];
const CHAR_LABEL = { "Important Matches": "Big games" };
const plCharLabel = n => CHAR_LABEL[n] || n;
const plRange = (p, n) => { const r = (p.sc?.ranges || []).find(x => x[0] === n); return r ? [Math.min(r[1], r[2]), Math.max(r[1], r[2]), r[1] > r[2]] : null; };
/* A scout range with lo > hi comes from overlapping phrases ("very ambitious" also matches "ambitious"): shown as approximate. */
const PL_APPROX = "Scout phrases overlap, so this range is approximate";
const plRangeTxt = r => (r[2] ? `≈${r[0]}–${r[1]}` : r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);
const plRangeSpan = (r, tag) => `<${tag}${r[2] ? ` title="${PL_APPROX}"` : ""}>${plRangeTxt(r)}</${tag}>`;

// ---- per season + game type indexes (blocks from the box scores, season lines from the career table)
const plMode = () => (PMODE === "po" ? "P" : "R");
const PL_CACHE = {};
/* Blocks per player (a traded player's rows summed). Blk/60 and its percentile only for players over the minutes floor,
   forwards and defence pooled separately. A league whose blocks sum to 0 has no block data. */
function plStatIdx() {
  const key = "s" + SEASON + plMode() + D.dates.length;
  if (PL_CACHE[key]) return PL_CACHE[key];
  const cols = D.teamPlayerCols || [], ix = Object.fromEntries(cols.map((c, i) => [c, i])), by = new Map();
  Object.values(D.teamPlayers?.[SEASON] || {}).forEach(t => (t[plMode()] || []).forEach(r => {
    const e = by.get(r[0]) || { blk: 0, toi: 0, gp: 0, pos: r[ix.pos] };
    e.blk += r[ix.blk] || 0; e.toi += r[ix.toi] || 0; e.gp += r[ix.gp] || 0;
    by.set(r[0], e);
  }));
  const floor = (PMODE === "po" ? D.poMinToi : D.minToi) || 200, pool = { F: [], D: [] };
  let total = 0;
  by.forEach((e, k) => {
    total += e.blk;
    e.grp = byKey.get(k)?.grp || (e.pos === "D" ? "D" : e.pos === "G" ? "G" : "F");
    if (e.grp !== "G" && e.toi >= floor) { e.blk60 = e.blk * 60 / e.toi; pool[e.grp].push(e.blk60); }
  });
  Object.values(pool).forEach(a => a.sort((x, y) => x - y));
  by.forEach(e => { if (e.blk60 != null) e.pct = plPctIn(pool[e.grp], e.blk60); });
  return (PL_CACHE[key] = { by, has: total > 0, floor });
}
const plBlk = p => (plStatIdx().has ? plStatIdx().by.get(p.k)?.blk60 ?? null : null);
/* The player's season line(s) per league from his career table, summed; { league: line }. */
function plCareerIdx() {
  const type = PMODE === "po" ? "P" : "R", key = "c" + SEASON + type + D.dates.length;
  if (PL_CACHE[key]) return PL_CACHE[key];
  const C = D.careerCols || [], ix = Object.fromEntries(C.map((c, i) => [c, i])), m = new Map();
  const sum = (rs, k) => (rs.some(r => r[ix[k]] != null) ? rs.reduce((s, r) => s + (r[ix[k]] || 0), 0) : null);
  D.players.forEach(p => {
    const rows = (p.car || []).filter(r => r[ix.season] === SEASON && r[ix.type] === type);
    if (!rows.length) return;
    const by = {};
    rows.forEach(r => (by[r[ix.league] || ""] ||= []).push(r));
    const out = {};
    for (const lg in by) {
      const rs = by[lg], o = {};
      ["gp", "g", "a", "p", "pm", "pim", "s", "ppg", "ppa", "shg", "sha", "w", "l", "t", "min", "ga", "so"].forEach(k => (o[k] = sum(rs, k)));
      const gp = o.gp || 0, rated = rs.filter(r => r[ix.avr] != null && r[ix.gp]);
      o.avr = rated.length ? rated.reduce((s, r) => s + r[ix.avr] * r[ix.gp], 0) / rated.reduce((s, r) => s + r[ix.gp], 0) : null;
      o.gaa = o.min && o.ga != null ? o.ga * 60 / o.min : null;
      const sa = rs.every(r => r[ix.ga] != null && r[ix.svp] != null && r[ix.svp] < 1) ? rs.reduce((s, r) => s + r[ix.ga] / (1 - r[ix.svp]), 0) : null;
      o.svp = sa ? 1 - o.ga / sa : null;
      out[lg] = o;
    }
    m.set(p.k, out);
  });
  return (PL_CACHE[key] = m);
}
const plLine = p => plCareerIdx().get(p.k)?.[p.lg || ""] || null;
/* Basic counting numbers: the box-score totals for NHL players, else the season line from the career table. */
function plBasic(p) {
  const t = p.card?.totals;
  if (t) return { gp: t.gp, g: t.g, a: t.a, p: t.p, pm: t.pm, pim: t.pim, st: t.st };
  const c = plLine(p);
  return c ? { gp: c.gp, g: c.g, a: c.a, p: c.p, pm: c.pm, pim: c.pim, st: c.s } : null;
}
const plRaw = (p, k) => p.card?.raw?.[k] ?? null;
const plComp = (p, k) => p.card?.comp?.[k] ?? null;
const plGp = p => plBasic(p)?.gp ?? null;
const plSum2 = (c, a, b) => (c && c[a] != null && c[b] != null ? c[a] + c[b] : null);
const plGrpAvg = (p, name) => (p.grpS || []).find(x => x[0] === name)?.[1] ?? null;
const plGFloor = () => (PMODE === "po" ? 3 : 10);   // goalie games for a SV% ranking
const plDefWar = p => (hasShotData() && p.grp !== "G" ? p.war?.comps?.defence ?? null : null);

// ---- columns: { k, t, tip, num, val(p), cell(v, p), keep (never hidden), why (shown when the column hides), low (low is good) }
const plRC = k => { const [t, val, num, cell, tip] = RC[k]; return { k, t, tip, num, val, cell: (v, p) => cell(p), keep: ["pos", "age", "lg", "ca", "pa"].includes(k) }; };
const plNum = (d = 0, pre = "", post = "") => v => `<td class="num">${v == null ? dash : pre + fmt(v, d) + post}</td>`;
const plSgn = d => v => `<td class="num ${v == null ? "" : tint(Math.abs(v) < 0.05 ? 0 : v)}">${v == null ? dash : signed(v, d)}</td>`;
const plPill = (kind, key) => (v, p) => `<td class="num">${impPill(v, pRankHref(kind, key, p.grp, p.k))}</td>`;
const plCol = (k, t, val, cell, o = {}) => ({ k, t, val, cell, num: true, ...o });
const SHOT = "no shot data this season";
const plRate = (k, t, d, tip, o) => plCol(k, t, p => plRaw(p, k), plNum(d), { tip, ...o });
const plTime = (k, t, tip) => plCol(k, t, p => plRaw(p, k), v => `<td class="num">${v == null ? dash : rawFmt("toi_gp", v)}</td>`, { tip });
const plOff = plCol("offp", "Offence %", p => plComp(p, "offence"), plPill("c", "offence"), { tip: "Offence percentile (shots, xG when charted, points per 60)" });
const plDef = plCol("defp", "Defence %", p => plComp(p, "defence"), plPill("c", "defence"), { tip: "Defence percentile: built only from +/- per 60 and penalty-kill time" });
const plFin = plCol("fin", "Finishing", p => (plRaw(p, "fin60") == null ? null : plRaw(p, "fin60")), plSgn(2), { tip: "Goals minus expected goals per 60 (needs shot data)", why: SHOT });
const plRec = c => (c && c.w != null ? `${c.w}-${c.l ?? 0}${c.t ? "-" + c.t : ""}` : null);
const plSvp = p => plLine(p)?.svp ?? plRaw(p, "svp");
const plTrait = (t, p) => plTraitData().get(p.k)?.[t.k] || null;

/* Goalie results, shared by Overview (Goalies filter) and the Goalies tab. GP, record, SV% and GAA all come from the same
   season line, so they agree with each other (a goalie's box-score count includes games he only dressed for). */
const NO_GCARD = "no shot data for these goalies";
const plGGp = p => plLine(p)?.gp ?? plGp(p);
const plGQual = p => (plGGp(p) || 0) >= plGFloor();
const plGaa = p => plLine(p)?.gaa ?? null;
const plGoalieCols = () => [
  plCol("gp", "GP", plGGp, plNum(0)),
  plCol("rec", "W-L", p => plLine(p)?.w ?? null, (v, p) => `<td class="num">${plRec(plLine(p)) || dash}</td>`, { tip: "Wins-losses-overtime losses, from the career table" }),
  plCol("svp", "SV%", plSvp, v => `<td class="num">${v == null ? dash : v.toFixed(3).replace(/^0/, "")}</td>`, { tip: `Save percentage (career-table line; the charted one when there is none). Under ${plGFloor()} games sorts last`, qual: plGQual }),
  plCol("gaa", "GAA", plGaa, plNum(2), { tip: `Goals against per 60 minutes. Depends on how many shots his team allows. Under ${plGFloor()} games sorts last`, low: true, qual: plGQual }),
  plCol("so", "SO", p => plLine(p)?.so ?? null, plNum(0), { tip: "Shutouts" }),
  plCol("gsax", "GSAx", p => plRaw(p, "gsax"), (v, p) => `<td class="num ${v == null ? "" : tint(Math.abs(v) < 0.05 ? 0 : v)}">${v == null ? dash : signed(v, 1)}${plRaw(p, "gsax_se") == null ? "" : ` <span class="muted small">±${fmt(1.28 * plRaw(p, "gsax_se"), 1)}</span>`}</td>`, { tip: "Goals saved above expected: pre-shot xG of the shots he faced minus goals allowed, empty nets left out. A second opinion on SV%; ± is an 80% range from chance alone", why: NO_GCARD }),
  plCol("gsax100", "GSAx/100", p => plRaw(p, "gsax100"), plSgn(2), { tip: "GSAx per 100 charted shots", why: NO_GCARD }),
  plCol("gsa", "Shots", p => plRaw(p, "sa"), plNum(0), { tip: "Charted shots behind his GSAx. Under about 500, treat GSAx as a rough guide", why: NO_GCARD })];
const plSvpBox = tab => ({ id: "svp", title: "Save percentage", sub: `At least ${plGFloor()} games`, val: plSvp, ok: plGQual, right: v => `<span class="lnum"><b>${v.toFixed(3).replace(/^0/, "")}</b></span>`, goto: [tab, "svp", -1] });
const plGaaBox = tab => ({ id: "gaa", title: "Goals against average", sub: `Lowest, at least ${plGFloor()} games`, val: plGaa, ok: plGQual, dir: 1, right: v => `<span class="lnum"><b>${fmt(v, 2)}</b></span>`, goto: [tab, "gaa", 1] });
const plOverG = () => plGrp("overview") === "G";

const TABS = {
  overview: {
    lede: "Who is good now, at a glance",
    cols: () => (plOverG()
      ? [plRC("pos"), plRC("age"), plRC("ca"), plRC("peak"), ...plGoalieCols(), { ...plRC("war"), why: NO_GCARD }, { ...plRC("war82"), why: NO_GCARD }, plRC("cap")]
      : [plRC("pos"), plRC("age"), plRC("ca"), plRC("peak"), plRC("war"), plRC("war82"), plOff, plDef, plRC("imp"), plRC("cap")]),
    sort: () => (plOverG() ? ["svp", "gp"] : ["ca"]),
    boxes: () => (plOverG() ? [plSvpBox("overview"), plGaaBox("overview")] : []).concat([
      { id: "war", title: "WAR leaders", sub: "Wins above replacement, chosen season", val: p => p.war?.war ?? null, right: (v, p) => `<span class="lnum">${rankLink(pRankHref("war", "war", p.grp, p.k), `<b>${fmt(v, 1)}</b>`)}</span>`, goto: ["overview", "war", -1], why: plOverG() ? NO_GCARD : undefined },
      ...(plOverG() ? [] : [{ id: "pts", title: "Top scorers", sub: "Points", val: p => plBasic(p)?.p ?? null, right: v => `<span class="lnum"><b>${v}</b></span>`, goto: ["offence", "p", -1], ok: p => p.grp !== "G" },
      { id: "def", title: "Best defenders", sub: "Defence percentile", val: p => plComp(p, "defence"), right: (v, p) => `<span class="lnum">${impPill(v, pRankHref("c", "defence", p.grp, p.k))}</span>`, goto: ["defence", "defp", -1], ok: p => p.grp !== "G" }]),
      { id: "up", title: "Biggest risers", sub: "Est. CA since the last snapshot", val: p => lastMove(p), ok: (p, v) => v > 0, right: v => `<span class="lnum"><span class="delta pos">${signed(v)}</span></span>`, goto: ["development", "chg", -1] },
    ]),
  },
  offence: {
    lede: "Scoring, playmaking and shooting. Goalies are on their own tab",
    cols: () => [plRC("pos"), plRC("age"), plRC("ca"),
      plCol("gp", "GP", plGp, plNum(0)), plCol("g", "G", p => plBasic(p)?.g ?? null, plNum(0)), plCol("a", "A", p => plBasic(p)?.a ?? null, plNum(0)),
      plCol("p", "P", p => plBasic(p)?.p ?? null, v => `<td class="num">${v == null ? dash : `<b>${v}</b>`}</td>`),
      plCol("pgp", "P/GP", p => { const b = plBasic(p); return b?.gp ? b.p / b.gp : null; }, plNum(2), { tip: "Points per game" }),
      plRate("p60", "P/60", 2, "Points per 60 minutes"), plRate("g60", "G/60", 2, "Goals per 60 minutes"), plRate("a160", "A1/60", 2, "Primary assists per 60 minutes"),
      plRate("st60", "SOG/60", 1, "Shots on goal per 60 minutes"),
      plCol("shp", "S%", p => { const b = plBasic(p); return b?.st ? 100 * b.g / b.st : null; }, plNum(1), { tip: "Goals per shot on goal" }),
      plRate("ixg60", "ixG/60", 2, "Individual expected goals per 60 (needs shot data)", { why: SHOT }), plFin,
      plCol("ppp", "PP pts", p => plSum2(plLine(p), "ppg", "ppa"), plNum(0), { tip: "Power-play points (goals + assists), from the career table" }),
      plOff,
      plCol("rat", "Rating", p => plRaw(p, "rat") ?? plLine(p)?.avr ?? null, plNum(2), { tip: "Average game rating" })],
    sort: ["p60", "p"],
    boxes: () => [
      { id: "g", title: "Goal scorers", sub: "Goals", val: p => plBasic(p)?.g ?? null, right: v => `<span class="lnum"><b>${v}</b></span>`, goto: ["offence", "g", -1], ok: p => p.grp !== "G" },
      { id: "a1", title: "Playmakers", sub: "Primary assists per 60", val: p => plRaw(p, "a160"), right: (v, p) => `<span class="lnum">${rankLink(pRankHref("m", "a160", p.grp, p.k), `<b>${fmt(v, 2)}</b>`)}</span>`, href: p => pRankHref("m", "a160", p.grp, p.k) },
      { id: "fin", title: "Finishers", sub: "Goals minus xG per 60", val: p => plRaw(p, "fin60"), right: (v, p) => `<span class="lnum stack">${rankLink(pRankHref("m", "fin60", p.grp, p.k), `<b>${signed(v, 2)}</b>`)}</span>`, href: p => pRankHref("m", "fin60", p.grp, p.k), why: SHOT },
      { id: "ppp", title: "Power-play producers", sub: "PP points", val: p => plSum2(plLine(p), "ppg", "ppa"), right: v => `<span class="lnum"><b>${v}</b></span>`, goto: ["offence", "ppp", -1], ok: p => p.grp !== "G" },
      { id: "sog", title: "Shot volume", sub: "Shots on goal per 60", val: p => plRaw(p, "st60"), right: (v, p) => `<span class="lnum">${rankLink(pRankHref("m", "st60", p.grp, p.k), `<b>${fmt(v, 1)}</b>`)}</span>`, href: p => pRankHref("m", "st60", p.grp, p.k) },
    ],
  },
  defence: {
    lede: "Defensive impact, blocks, penalty killing and discipline. Goalies are on their own tab",
    cols: () => [plRC("pos"), plRC("age"), plRC("ca"),
      plTime("toi_gp", "TOI/GP", "Time on ice per game"), plTime("pk_toi", "PK TOI", "Penalty-kill time per game"),
      plCol("pm60", "+/-/60", p => plRaw(p, "pm60"), plSgn(2), { tip: "Plus-minus per 60 minutes" }),
      plCol("blk60", "Blk/60", plBlk, plNum(2), { tip: "Blocked shots per 60 minutes, players over the minutes floor", why: "no block counts in these box scores" }),
      plCol("shpts", "SH pts", p => plSum2(plLine(p), "shg", "sha"), plNum(0), { tip: "Short-handed points, from the career table" }),
      plRate("pim60", "PIM/60", 2, "Penalty minutes per 60 (fewer is better)", { low: true }),
      plCol("defwar", "Def. WAR", plDefWar, plSgn(1), { tip: "Defence part of WAR: ridge regression on unblocked xGA (needs shot data)", why: SHOT }),
      plCol("defattr", "Def. attrs", p => (p.grp === "G" ? null : plGrpAvg(p, "Defence")), plNum(1), { tip: "Average of the defensive attributes (1-20)" }),
      plDef],
    sort: ["defp", "toi_gp"],
    boxes: () => [
      { id: "def", title: "Defensive impact", sub: "Defence percentile", val: p => plComp(p, "defence"), right: (v, p) => `<span class="lnum">${impPill(v, pRankHref("c", "defence", p.grp, p.k))}</span>`, href: p => pRankHref("c", "defence", p.grp, p.k), ok: p => p.grp !== "G" },
      { id: "dw", title: "Defensive WAR", sub: "WAR from defence (needs shot data)", val: plDefWar, right: v => `<span class="lnum"><b>${signed(v, 1)}</b></span>`, goto: ["defence", "defwar", -1], why: SHOT },
      { id: "blk", title: "Shot blockers", sub: "Blocks per 60", val: plBlk, right: v => `<span class="lnum"><b>${fmt(v, 2)}</b></span>`, href: p => pRankHref("x", "blk60", p.grp, p.k), why: "no block counts in these box scores" },
      { id: "pk", title: "PK workhorses", sub: "Penalty-kill time per game", val: p => plRaw(p, "pk_toi"), right: (v, p) => `<span class="lnum">${rankLink(pRankHref("m", "pk_toi", p.grp, p.k), `<b>${rawFmt("toi_gp", v)}</b>`)}</span>`, href: p => pRankHref("m", "pk_toi", p.grp, p.k) },
      { id: "pim", title: "Cleanest", sub: "Fewest penalty minutes per 60", dir: 1, val: p => plRaw(p, "pim60"), right: (v, p) => `<span class="lnum">${rankLink(pRankHref("m", "pim60", p.grp, p.k), `<b>${fmt(v, 2)}</b>`)}</span>`, href: p => pRankHref("m", "pim60", p.grp, p.k) },
    ],
  },
  traits: {
    lede: "What kind of player: attribute traits, and the character values scouts report",
    cols: tr => [plRC("pos"), plRC("age"), plRC("ca"),
      plCol("tscore", tr.t, p => plTrait(tr, p)?.[0] ?? null, plNum(1), { tip: `${tr.s ? "Average of his " + tr.s + " attributes" : "Average of " + tr.a.join(", ")} (1-20)`, keep: true }),
      plCol("tpct", "Percentile", p => plTrait(tr, p)?.[1] ?? null, (v, p) => `<td class="num">${impPill(v, pRankHref("t", tr.k, p.grp, p.k))}</td>`, { tip: "Percentile among NHL players at his position" }),
      ...(tr.i || []).map((ai, n) => plCol("ta" + n, tr.a[n], p => p.h?.at(-1)?.[ai + 2] ?? null, plNum(0), { tip: D.attrs[ai] })),
      ...CHARACTER.map(n => plCol("c_" + n, plCharLabel(n), p => { const r = plRange(p, n); return r ? (r[0] + r[1]) / 2 : null; },
        (v, p) => (v == null ? `<td class="num">${dash}</td>` : plRangeSpan(plRange(p, n), "td").replace("<td", '<td class="num"')), { tip: `${n} (hidden attribute), range from scout reports, scouted players only`, why: "no scout reports for these players" }))],
    sort: ["tscore"],
    boxes: () => [],
  },
  goalies: {
    lede: "Goalies only: SV% and GAA first, then GSAx and attribute groups",
    cols: () => [plRC("pos"), plRC("age"), plRC("ca"),
      ...plGoalieCols(),
      plRC("war"), plRC("war82"),
      ...["Shot stopping", "Positioning", "Athleticism", "Puck play", "Mental"].map(n => plCol("gs_" + n, n, p => plGrpAvg(p, n), plNum(1), { tip: n + " attribute group, average (1-20)" }))],
    sort: ["svp", "gsax", "gp"],
    boxes: () => [
      plSvpBox("goalies"), plGaaBox("goalies"),
      { id: "gsax", title: "GSAx", sub: "Goals saved above expected", val: p => plRaw(p, "gsax"), right: (v, p) => `<span class="lnum">${rankLink(pRankHref("m", "gsax", p.grp, p.k), `<b>${signed(v, 1)}</b>`)}</span>`, href: p => pRankHref("m", "gsax", p.grp, p.k), why: NO_GCARD },
      { id: "wl", title: "Workload", sub: "Games played", val: plGGp, right: v => `<span class="lnum"><b>${v}</b></span>`, goto: ["goalies", "gp", -1] },
      { id: "ss", title: "Shot stopping", sub: "Attribute group average (1-20)", val: p => plGrpAvg(p, "Shot stopping"), right: (v, p) => `<span class="lnum"><b>${fmt(v, 1)}</b></span>`, goto: ["goalies", "gs_Shot stopping", -1] },
    ],
  },
  development: {
    lede: "Growth left, projected peaks and recent movement of est. CA",
    cols: () => (R.dev === "movers"
      ? [plRC("pos"), plRC("age"), plRC("ca"), plRC("chg"), plRC("chg4")]
      : [plRC("pos"), plRC("age"), plRC("ca"), plRC("pa"), plRC("peak"), plRC("left"), plRC("pkage")]),
    sort: [],
    boxes: () => [
      { id: "pro", title: "Top prospects", sub: "Age 20 and under, by projected peak", val: p => peakInfo(p).mid, ok: p => p.age <= 20, right: (v, p) => `<span class="lnum stack"><b>${fmt(v, 0)}</b><small>PA ${fmt(p.pa, 0)}</small></span>`, goto: ["development", "peak", -1, "future"] },
      { id: "left", title: "Most growth left", sub: "Projected peak minus est. CA now", val: p => peakInfo(p).mid - p.ca, right: v => `<span class="lnum"><span class="delta pos">${signed(v, 0)}</span></span>`, goto: ["development", "left", -1, "future"] },
      { id: "up", title: "Risers", sub: "Est. CA since the last snapshot", val: p => lastMove(p), ok: (p, v) => v > 0, right: v => `<span class="lnum"><span class="delta pos">${signed(v)}</span></span>`, goto: ["development", "chg", -1, "movers"] },
      { id: "down", title: "Fallers", sub: "Est. CA since the last snapshot", dir: 1, val: p => lastMove(p), ok: (p, v) => v < 0, right: v => `<span class="lnum"><span class="delta neg">${signed(v)}</span></span>`, goto: ["development", "chg", 1, "movers"] },
    ],
  },
  contract: {
    lede: "Contracts against what the player is expected to deliver (NHL only)",
    cols: () => [plRC("pos"), plRC("age"), plRC("ca"), plRC("cap"), plRC("seas"), plRC("ewar"), plRC("surplus")],
    sort: ["surplus"],
    boxes: () => [
      { id: "best", title: "Best surplus", sub: "Worth over the deal minus cap hit", val: p => liveContract(p)?.surplus ?? null, right: v => `<span class="lnum stack ${tint(v)}"><b>${signedMoney(v)}</b></span>`, goto: ["contract", "surplus", -1] },
      { id: "worst", title: "Worst surplus", sub: "Worth over the deal minus cap hit", dir: 1, val: p => liveContract(p)?.surplus ?? null, right: v => `<span class="lnum stack ${tint(v)}"><b>${signedMoney(v)}</b></span>`, goto: ["contract", "surplus", 1] },
      { id: "exp", title: "Expiring soon", sub: "Final season of the deal, by expected WAR", val: p => { const c = liveContract(p); return c && c.seasons <= 1 && !c.next ? c.now : null; }, right: v => `<span class="lnum"><b>${war1(v)}</b></span>`, goto: ["contract", "seas", 1] },
    ],
  },
};
const TRAIT_NOTE = `Traits describe visible attributes: the average of the attributes named in each box, as a percentile against NHL players at the same position. They have not been tested as predictors of results. Character ranges come from scout report phrases; a range shown with ≈ comes from overlapping phrases and is approximate. Big games (Important Matches) is a hidden value shown as character information: the 2026-10-26 big-game test found no real playoff effect from it.`;
const NOTES = {
  defence: `Hits, takeaways, giveaways and faceoff wins exist only as team totals, so they have no player columns. Defence % is built from +/- per 60 and penalty-kill time only; blocks come from the box scores.`,
};
const rValueOk = () => !R.lg || R.lg === "NHL";   // contractValue prices NHL salaries only

// ---- page
const plGrp = tab => (tab === "goalies" ? "G" : ["offence", "defence"].includes(tab) && R.grp === "G" ? "" : R.grp);
function plScope(tab, p, tr) {
  if (tab === "offence" || tab === "defence") return p.grp !== "G";
  if (tab === "goalies") return p.grp === "G";
  if (tab === "contract") return p.lg === "NHL";
  if (tab === "traits") return tr.grps.includes(p.grp);
  return true;
}
function plActive(tab) {
  const g = plGrp(tab) && tab !== "goalies";
  return (R.lg !== "NHL" ? 1 : 0) + (g ? 1 : 0) + (R.team ? 1 : 0) + (R.maxAge ? 1 : 0)
    + (SEASON !== (D?.defaultSeason || SEASONS.at(-1) || null) ? 1 : 0) + (PMODE !== "rs" ? 1 : 0);
}
function plNameCell(p) {
  const sub = [p.sc?.role ? esc(p.sc.role) : "", esc(clubOf(p))].filter(Boolean).join(" · "), tags = plTags(p);
  return `<th scope="row" class="pcol"><a class="pcell" href="${route(p.k)}">${logo(clubOf(p), 26)}<span><b>${esc(p.n)}</b>${sub ? `<small>${sub}</small>` : ""}${tags.length
    ? `<span class="ttags">${tags.map(t => `<span class="ttag" title="${esc(`${t.t}: ${t.pct}th percentile among NHL players at his position`)}">${esc(t.t)}</span>`).join("")}</span>` : ""}</span></a></th>`;
}
function plTop(rows, b) {
  const dir = b.dir ?? -1, out = [];
  rows.forEach(p => { const v = b.val(p); if (v != null && (!b.ok || b.ok(p, v))) out.push([v, p]); });
  out.sort((x, y) => (x[0] - y[0]) * dir || y[1].ca - x[1].ca);
  const top = out.slice(0, 5);
  top.ties = out.length ? out.filter(x => x[0] === out[0][0]).length : 0;   // players sharing the top value
  return top;
}
const plMeta = (p, i) => `${i + 1}. ${esc(p.pos)} · ${p.age} · ${tname(clubOf(p))}${p.lg && p.lg !== "NHL" ? ` (${esc(p.lg)})` : ""}`;
function plSpot(b, top, tab) {
  const act = b.href ? `<a class="more-link" href="${b.href(top[0][1])}">Rank all →</a>`
    : b.goto ? `<button type="button" class="more-link linkbtn" data-goto="${b.goto.join("|")}">Rank all →</button>` : "";
  const head = b.pick ? `<button type="button" class="spot-pick" data-trait="${b.pick}" aria-pressed="${b.on}">${esc(b.title)}</button>` : esc(b.title);
  return `<section class="card-box spot${b.on ? " on" : ""}" aria-labelledby="sp-${b.id}"><h2 id="sp-${b.id}">${head}</h2><p class="sub">${esc(b.sub || "")}</p>
    ${top.map(([v, p], i) => listRow(p, b.right(v, p), plMeta(p, i))).join("")}${act}</section>`;
}
function plTraitBoxes(rows, tr) {
  const out = [];
  plTraitList(R.grp).forEach(t => {
    const top = plTop(rows.filter(p => t.grps.includes(p.grp)), { val: p => plTrait(t, p)?.[0] ?? null });
    if (top.length) out.push({ b: { id: "t-" + t.k, title: t.t, sub: (t.s ? "Attribute group average (1-20)" : t.a.join(", ")) + (top.ties > 5 ? ` · ${top.ties} tied at ${fmt(top[0][0], 1)}` : ""), pick: t.k, on: t.k === tr.k,
      right: (v, p) => `<span class="lnum stack"><b>${fmt(v, 1)}</b>${impPill(plTrait(t, p)[1], pRankHref("t", t.k, p.grp, p.k))}</span>`,
      href: p => pRankHref("t", t.k, p.grp, p.k) }, top });
  });
  return out;
}
function plCharBoxes(rows) {
  return CHARACTER.map(n => {
    const top = plTop(rows.filter(p => p.grp !== "G"), { val: p => { const r = plRange(p, n); return r ? (r[0] + r[1]) / 2 : null; } });
    return top.length ? { b: { id: "c-" + n.replace(/\W/g, ""), title: plCharLabel(n), sub: (n === "Important Matches" ? "Range from scout reports (see note)" : "Range from scout reports (1-20)") + (top.ties > 5 ? ` · ${top.ties} tied at ${plRangeTxt(plRange(top[0][1], n))}` : ""),
      right: (v, p) => `<span class="lnum stack">${plRangeSpan(plRange(p, n), "b")}</span>`, goto: ["traits", "c_" + n, -1] }, top } : null;
  }).filter(Boolean);
}

function renderRankings(path = "") {
  markNav("players");
  const slug = decodePart(String(path).split("/")[0]);
  const tab = PL_TABS.some(t => t[0] === slug) ? slug : "overview";
  R.tab = tab;
  const T = TABS[tab], noContract = tab === "contract" && !rValueOk(), tr = plCurTrait();
  const rows = noContract ? [] : D.players.filter(p => (!R.lg || p.lg === R.lg) && (!plGrp(tab) || p.grp === plGrp(tab))
    && (!R.team || clubOf(p) === R.team) && (!R.maxAge || p.age <= +R.maxAge) && plScope(tab, p, tr)).map(inSeason).map(rankRow);
  const allCols = T.cols(tr);
  if (!R.lg) allCols.splice(1, 0, plRC("lg"));
  allCols.forEach((c, i) => (c.i = i));
  const V = rows.map(p => allCols.map(c => c.val(p)));
  const shown = allCols.filter(c => c.keep || V.some(v => v[c.i] != null));
  const hidden = rows.length ? allCols.filter(c => !shown.includes(c) && c.t) : [];
  const nameCol = { k: "n", t: "Player", num: false, i: -1 };
  const sortable = [nameCol, ...shown];
  if (!sortable.some(c => c.k === R.sort)) {
    const dev = tab === "development" ? [R.dev === "movers" ? "chg" : "peak"] : [];
    R.sort = [...dev, ...(typeof T.sort === "function" ? T.sort() : T.sort), "ca"].find(x => shown.some(c => c.k === x)) || shown[0]?.k || "n"; R.dir = -1;
  }
  const sc = sortable.find(c => c.k === R.sort);
  const ents = rows.map((p, i) => ({ p, v: V[i] }));
  const get = e => (sc.k === "n" ? e.p.n : e.v[sc.i]);
  ents.sort((a, b) => {
    const x = get(a), y = get(b);
    if (x == null || x === "") return y == null || y === "" ? 0 : 1;   // no value: last in either direction
    if (y == null || y === "") return -1;
    if (sc.qual && sc.qual(a.p) !== sc.qual(b.p)) return sc.qual(a.p) ? -1 : 1;   // a small sample can't top a rate column
    return (sc.num ? x - y : String(x).localeCompare(String(y))) * R.dir;
  });
  const total = ents.length, page = ents.slice(0, R.limit);
  // spotlight boxes
  let boxes = (tab === "traits" ? plTraitBoxes(rows, tr) : T.boxes().map(b => ({ b, top: plTop(rows, b) })));
  const hiddenBoxes = boxes.filter(x => !x.top.length && x.b.title);
  boxes = boxes.filter(x => x.top.length);
  const chars = tab === "traits" ? plCharBoxes(rows) : [];
  // notes
  const other = R.lg && R.lg !== "NHL";
  const why = c => (c.why?.startsWith("no scout") ? c.why : other ? "other leagues have no box scores" : c.why || "no data for these players");
  const hide = rows.length ? [...hidden.map(c => [c.t, why(c)]), ...hiddenBoxes.map(x => [x.b.title + " (box)", why(x.b)])] : [];
  const byWhy = {};
  hide.forEach(([t, w]) => (byWhy[w] ||= []).push(t));
  const notes = [
    NOTES[tab], tab === "traits" ? TRAIT_NOTE : "",
    other && ["offence", "defence", "overview"].includes(tab) ? `${esc(R.lg)} has no box scores here: only the games, goals, assists, points, +/- and penalty minutes from each player's own season line are shown.` : "",
    shown.some(c => c.k === "war") && !hasShotData() ? `* WAR is partial: this season has no shot data, so only playmaking and penalties count.` : "",
    tab === "traits" && !chars.length && rows.length ? "No scout reports among these players, so the character section is empty." : "",
    ...Object.entries(byWhy).map(([w, ts]) => `Hidden, ${w}: ${ts.join(", ")}.`),
  ].filter(Boolean);
  const nf = plActive(tab);
  const leagues = leagueList(), lgs = [...leagues.filter(l => l === "NHL"), ...leagues.filter(l => l !== "NHL")];
  const grpOk = tab === "offence" || tab === "defence" ? ["", "F", "D"] : ["", "F", "D", "G"];
  const tabsHtml = `<div class="ptabs" role="tablist" aria-label="Player sections">${PL_TABS.map(([k, t]) => {
    const off = k === "contract" && !rValueOk();
    return `<button type="button" role="tab" data-ptab="${k}" class="${tab === k ? "on" : ""}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}"${off ? ` disabled title="Contract is NHL only: pick the NHL league or All leagues"` : ""}>${t}</button>`; }).join("")}</div>`;
  const spots = list => `<div class="spots">${list.map(x => plSpot(x.b, x.top, tab)).join("")}</div>`;
  view.innerHTML = `
  <section class="band"><div class="wrap">
    <h1>Players</h1>
    <p class="lede">${D.players.length.toLocaleString()} players · snapshot ${fmtDate(D.dates.at(-1))} · ${T.lede} · est. CA and PA come from visible attributes only (see <a href="#/about">How it works</a>)</p>
    <form class="filters pfbar${R.fopen ? " open" : ""}" aria-label="Filters">
      <button class="ghost small pf-toggle" id="pf-toggle" type="button" aria-expanded="${!!R.fopen}">Filters${nf ? ` (${nf})` : ""}</button>
      <div class="pf-fields">
        <label>League <select id="f-lg"><option value="">All leagues</option>${lgs.map(l => `<option value="${esc(l)}" ${l === R.lg ? "selected" : ""}>${esc(l)} (${leagueCount(l).toLocaleString()})</option>`).join("")}</select></label>
        ${tab === "goalies" ? "" : `<fieldset><legend>Position</legend><div class="seg" id="f-grp">${[["", "All"], ["F", "Forwards"], ["D", "Defence"], ["G", "Goalies"]]
          .map(([v, t]) => { const off = !grpOk.includes(v); return `<button type="button" data-v="${v}" class="${v === plGrp(tab) ? "on" : ""}" aria-pressed="${v === plGrp(tab)}"${off ? ` disabled title="Goalies have their own tab"` : ""}>${t}</button>`; }).join("")}</div></fieldset>`}
        <label>Club <select id="f-team"><option value="">All clubs</option>${clubOptions(R.team, R.lg)}</select></label>
        <label class="narrow">Max age <input id="f-age" type="number" min="15" max="45" placeholder="Any" value="${esc(R.maxAge)}"></label>
        ${seasonSelect("f-season", SEASONS, SEASON, { cls: "small muted", single: "disable" })}
        <fieldset><legend>Games</legend><div class="seg" id="f-mode">${[["rs", "Regular season"], ["po", "Playoffs"]]
          .map(([v, t]) => `<button type="button" data-v="${v}" class="${v === PMODE ? "on" : ""}" aria-pressed="${v === PMODE}">${t}</button>`).join("")}</div></fieldset>
        <button class="ghost small" id="f-clear" type="button"${nf ? "" : " hidden"}>Clear filters</button>
      </div>
    </form>
    ${hasLeague(R.lg) ? `<p class="small"><a href="${leagueRoute(R.lg)}">${esc(R.lg)} league page: standings, stats, teams and prospects →</a></p>` : R.lg === "NHL" ? `<p class="small"><a href="#/teams">NHL teams and standings →</a></p>` : ""}
    ${tabsHtml}
  </div></section>
  <div class="wrap page plpage">
    ${noContract ? `<p class="small muted">The Contract tab is NHL only (contracts are priced against NHL salaries): choose the NHL league or All leagues.</p>` : ""}
    ${boxes.length ? `<div class="cardbar"><span></span><button type="button" class="linkbtn small" id="pl-jump">Jump to table ↓</button></div>` : ""}
    ${boxes.length ? spots(boxes) : ""}
    ${chars.length ? `<h2 class="sec-title">Character · scouted players only</h2>${spots(chars)}` : ""}
    ${notes.length ? `<div class="plnotes">${notes.map(n => `<p class="small ${n.startsWith("*") ? "warnnote" : "muted"}">${n.includes("<") ? n : esc(n)}</p>`).join("")}</div>` : ""}
    ${noContract ? "" : `<div class="cardbar tablebar">
      ${tab === "development" ? `<div class="seg" id="r-dev" role="group" aria-label="Development view">${[["future", "Future"], ["movers", "Movers"]]
        .map(([v, t]) => `<button type="button" data-v="${v}" class="${(R.dev || "future") === v ? "on" : ""}" aria-pressed="${(R.dev || "future") === v}">${t}</button>`).join("")}</div>` : "<span></span>"}
      <span class="cardbar-r"><span class="count" id="r-count">${total.toLocaleString()} players</span></span></div>
    <section class="card-box flush" aria-label="Player list" id="pl-table">${total ? `
      <div class="tablewrap"><table class="rank plist" data-tab="${tab}">
        <thead><tr><th class="num">#</th>${sortable.map(c => `<th class="sort ${c.num ? "num" : ""} ${c.k === "n" ? "pcol" : ""} ${R.sort === c.k ? "on" : ""}" data-k="${esc(c.k)}"${c.tip ? ` title="${esc(c.tip)}"` : ""} aria-sort="${R.sort === c.k ? (R.dir < 0 ? "descending" : "ascending") : "none"}"><button type="button">${esc(c.t)}${c.k === "war" && !hasShotData() ? "*" : ""}${R.sort === c.k ? (R.dir < 0 ? " ↓" : " ↑") : ""}</button></th>`).join("")}</tr></thead>
        <tbody>${page.map((e, i) => `<tr class="link" data-k="${esc(e.p.k)}"><td class="num muted">${i + 1}</td>${plNameCell(e.p)}${shown.map(c => c.cell(e.v[c.i], e.p)).join("")}</tr>`).join("")}</tbody>
      </table></div>
      ${total > R.limit ? `<div class="more"><button class="ghost" id="more" type="button">Show more (${(total - R.limit).toLocaleString()} left)</button></div>` : ""}`
      : `<p class="sub pad">No players match these filters.</p>`}</section>`}
  </div>`;
  plWire(tab, sortable);
}

function plWire(tab, sortable) {
  const rerender = (focus) => { R.limit = 100; renderRankings(R.tab); if (focus) view.querySelector(focus)?.focus(); };
  const on = (id, ev, fn) => { const el = view.querySelector(id); if (el) el[ev] = fn; };
  const go = (t, sort, dir) => {
    if (sort !== undefined) { R.sort = sort; R.dir = dir; }
    R.limit = 100;
    if (t === R.tab) { renderRankings(t); view.querySelector("#pl-table")?.scrollIntoView({ block: "start" }); }
    else location.hash = "#/players" + (t === "overview" ? "" : "/" + t);
  };
  view.querySelectorAll("[data-ptab]").forEach(b => b.onclick = () => go(b.dataset.ptab, "", -1));
  on("#pf-toggle", "onclick", e => { R.fopen = !R.fopen; view.querySelector(".pfbar").classList.toggle("open", R.fopen); e.currentTarget.setAttribute("aria-expanded", R.fopen); });
  on("#f-lg", "onchange", e => { R.lg = e.target.value; R.team = ""; if (R.tab === "contract" && !rValueOk()) go("overview", "", -1); else rerender("#f-lg"); });
  view.querySelectorAll("#f-grp button").forEach(b => b.onclick = () => { if ((R.grp === "G") !== (b.dataset.v === "G")) R.sort = ""; R.grp = b.dataset.v; rerender(`#f-grp [data-v="${R.grp}"]`); });
  view.querySelectorAll("#f-mode button").forEach(b => b.onclick = () => { PMODE = b.dataset.v; rerender(`#f-mode [data-v="${PMODE}"]`); });
  on("#f-team", "onchange", e => { R.team = e.target.value; rerender("#f-team"); });
  on("#f-age", "onchange", e => { R.maxAge = e.target.value; rerender("#f-age"); });
  on("#f-season", "onchange", e => { SEASON = e.target.value; rerender("#f-season"); });
  on("#f-clear", "onclick", () => { R.lg = "NHL"; R.grp = R.team = R.maxAge = ""; PMODE = "rs"; SEASON = D?.defaultSeason || SEASONS.at(-1) || null; rerender(); });
  view.querySelectorAll("#r-dev button").forEach(b => b.onclick = () => { R.dev = b.dataset.v; R.sort = ""; rerender(`#r-dev [data-v="${R.dev}"]`); });
  view.querySelectorAll("[data-trait]").forEach(b => b.onclick = () => { R.trait = b.dataset.trait; R.sort = ""; rerender(`[data-trait="${R.trait}"]`); view.querySelector("#pl-table")?.scrollIntoView({ block: "start" }); });
  view.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => {
    const [t, k, d, dev] = b.dataset.goto.split("|");
    if (dev) R.dev = dev;
    go(t, k, +d);
  });
  on("#pl-jump", "onclick", () => view.querySelector("#pl-table")?.scrollIntoView({ block: "start" }));
  view.querySelector("#more")?.addEventListener("click", () => { R.limit += 200; renderRankings(R.tab); });
  view.querySelectorAll("th.sort button").forEach(b => b.onclick = () => {
    const k = b.parentNode.dataset.k, c = sortable.find(x => x.k === k);
    R.dir = R.sort === k ? -R.dir : (c.num && !c.low ? -1 : 1);
    R.sort = k; renderRankings(R.tab);
    view.querySelector(`th.sort[data-k="${k}"] button`)?.focus();
  });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
}

// ---- full rankings behind the new numbers (17-rank-nav.js): kind t = trait, x = derived stat (Blk/60)
function plRankRows(items, keyFn) {   // items [{p, v, pct, txt}] -> ranked rows, best first
  const rows = items.sort((a, b) => keyFn(b) - keyFn(a) || b.p.ca - a.p.ca).map(x => ({ ...x, ca: x.p.ca }));
  rows.forEach((r, i) => { r.rank = i && keyFn(r) === keyFn(rows[i - 1]) ? rows[i - 1].rank : i + 1; });
  return rows;
}
function traitRankRows(key, grp) {
  const t = TRAITS.find(x => x.k === key);
  if (!t || !t.grps.includes(grp)) return null;
  const items = D.players.filter(p => p.grp === grp).map(p => { const d = plTrait(t, p); return d ? { p, v: d[0], pct: d[1], txt: `${d[0].toFixed(1)}/20` } : null; }).filter(Boolean);
  const what = t.s ? `his ${t.s} attribute group` : t.a.join(", ");
  return { rows: plRankRows(items, x => x.v), title: t.t, ranked: true,
    sub: `Every ${GRP_NAME[grp].replace(/s$/, "").replace("defence", "defenceman")} in the database · average of ${what} (1-20), latest attributes · percentile against NHL ${GRP_NAME[grp]} · a description of attributes, not a tested predictor` };
}
function derivedRankRows(key, grp) {
  if (key !== "blk60") return null;
  const I = plStatIdx(), items = [];
  I.by.forEach((e, k) => { const p = byKey.get(k); if (p && e.blk60 != null && e.grp === grp) items.push({ p: inSeason(p), v: e.blk60, pct: e.pct, txt: `${e.blk60.toFixed(2)} per 60 · ${e.blk} blocks in ${Math.round(e.toi)} min` }); });
  return { rows: plRankRows(items, x => x.v), title: "Blocked shots per 60", ranked: true,
    sub: `${SEASON ? seasonLabel(SEASON) : ""} ${PMODE === "po" ? "playoffs" : "regular season"} · NHL ${GRP_NAME[grp]} with at least ${Math.round(I.floor)} minutes · percentile vs this list` };
}
