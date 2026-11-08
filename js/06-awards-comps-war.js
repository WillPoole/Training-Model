"use strict";

// ---------------------------------------------------------------- draft + achievements
/* Links from a player's draft and Top Prospects tags: an NHL draft pick opens that draft on the Past drafts tab
   (his pick highlighted), a prospect rank opens the NHL club's Prospects & picks tab. */
const draftHref = d => d?.pick != null && /NHL/.test(d.draft || "") && draftValues().years.includes(d.year) ? `#/draft/past/${d.year}/${d.pick}` : null;
const prospectHref = p => p.tp && NHL_TEAMS[p.tp[0]] ? teamRoute(p.tp[0]) + "/prospects" : null;
const linkText = (text, href) => text == null ? null : href ? `<a href="${href}">${esc(text)}</a>` : esc(text);
function draftLine(d) {
  if (!d) return null;
  if (d.pick == null) return d.text && d.text !== "-" ? d.text : null;
  return `${d.year} ${d.draft.replace(/ Entry Draft| Priority Selection| Draft$/, "")} draft · Round ${d.round}, #${d.pick} overall · ${d.team}`;
}
const LEAGUE_SHORT = [["National Hockey League", "NHL"], ["American Hockey League", "AHL"], ["Kontinental Hockey League", "KHL"],
  ["Canadian Hockey League", "CHL"], ["Western Hockey League", "WHL"], ["Ontario Hockey League", "OHL"],
  ["Quebec Major Junior Hockey League", "QMJHL"], ["Québec Maritimes Junior Hockey League", "QMJHL"]];
function achText(t) {
  if (/^National Hockey League winners$/.test(t)) return "Stanley Cup champion";
  if (/^National Hockey League runners up$/.test(t)) return "Stanley Cup finalist";
  if (/^Canadian Hockey League Memorial Cup winners$/.test(t)) return "Memorial Cup champion";
  LEAGUE_SHORT.forEach(([a, b]) => { t = t.replace(a, b); });
  return t.replace(/^Named in /, "").replace(/ winners$/, " champion").replace(/ runners up$/, " runner-up")
          .replace(/ third placed$/, " (3rd)").replace(/ runner up$/, " (2nd)");
}
/* Header tags: trophies won, championships and NHL First/Second All-Star teams. */
/* An achievement won in a specific NHL playoff (Stanley Cup champion / finalist, Conn Smythe) links to that playoff page. */
const seasonOfDay = d => { const y = +d.slice(0, 4), s = +d.slice(5, 7) >= 7 ? y : y - 1; return `${String(s % 100).padStart(2, "0")}-${String((s + 1) % 100).padStart(2, "0")}`; };
function achHref(d, text) {
  if (!/^National Hockey League (winners|runners up)$|Conn Smythe/.test(text)) return null;
  const s = seasonOfDay(d);
  return playoffSeasons().includes(s) ? `#/playoffs/${s}` : null;
}
function achTags(p) {
  return (p.ach || []).filter(([, , t, k]) => k === "T" || k === "C" || (k === "A" && /National Hockey League (First|Second)/.test(t)))
    .map(([d, , t]) => [`${achText(t).replace(/^\d+\/\d+ /, "")} (${d.slice(0, 4)})`, achHref(d, t)]);
}
function achievementsPanel(p) {
  const a = p.ach || [], pro = draftLine(p.dft?.pro), jr = draftLine(p.dft?.junior);
  if (!a.length && !pro && !jr) return "";
  const of = k => a.filter(x => k.includes(x[3]));
  const row = ([d, team, text]) => { const href = achHref(d, text);
    return `<tr><td class="nowrap ${href ? "" : "muted"}">${href ? `<a href="${href}" title="${seasonLabel(seasonOfDay(d))} playoffs">${fmtDate(d)}</a>` : fmtDate(d)}</td><td>${esc(achText(text))}</td><td class="muted nowrap">${tname(team)}</td></tr>`; };
  const table = rows => `<div class="tablewrap"><table class="fit"><tbody>${rows.map(row).join("")}</tbody></table></div>`;
  const counts = {};
  of("m").forEach(([, , text]) => { const t = achText(text).replace(/ for \w+$/, ""); counts[t] = (counts[t] || 0) + 1; });
  const sections = [["Trophies &amp; awards", of("T")], ["Award finalist", of("F")], ["Championships", of("Cc")], ["All-Star teams", of("A")]]
    .filter(([, r]) => r.length);
  return `<div class="panel" id="achpanel">
    <h2>Draft &amp; awards</h2>
    <p class="sub">Draft from the player's Information tab. Achievements are the save's own log (History tab), so they
      start when the save started; real-life trophies from before then aren't in the game's database.</p>
    <div class="tags-plain">
      <div><span class="muted small">Drafted (pro)</span> <b>${pro ? linkText(pro, draftHref(p.dft?.pro)) : "None recorded"}</b>${pro ? "" : ` <span class="muted small">(undrafted, or a pick the game's database lacks, e.g. some Arizona picks)</span>`}</div>
      ${jr ? `<div><span class="muted small">Drafted (junior)</span> ${esc(jr)}</div>` : ""}
    </div>
    ${sections.map(([h, r]) => `<h3>${h}</h3>${table(r)}`).join("")}
    ${Object.keys(counts).length ? `<h3>Other recognition</h3>
      <p class="small">${Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([t, n]) => `${esc(t)}${n > 1 ? ` <b>×${n}</b>` : ""}`).join(" · ")}</p>` : ""}
    ${of("x").length ? `<details><summary>Career moves (${of("x").length})</summary>${table(of("x"))}</details>` : ""}
    ${!a.length ? `<p class="small muted">Nothing logged in this save yet.</p>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- comparable players
/* Similarity = distance between visible-attribute profiles, each attribute standardized within the
   position group (a point of a rare attribute counts more than a point of a common one).
   Now: anyone in the group. Same age: within a year. Could become (23 and under): his projected
   attributes at his projected peak vs established players aged 24-31 today. */
const COMP_STATS = {};
function compStats(grp) {
  if (COMP_STATS[grp]) return COMP_STATS[grp];
  const pool = D.players.filter(q => q.grp === grp && q.h.length);
  const idx = D.attrs.map((_, i) => i).filter(i => pool.filter(q => q.h.at(-1)[i + 2] != null).length > pool.length * 0.9);
  const mean = {}, sd = {};
  idx.forEach(i => {
    const v = pool.map(q => q.h.at(-1)[i + 2]).filter(x => x != null);
    mean[i] = v.reduce((a, b) => a + b, 0) / v.length;
    sd[i] = Math.sqrt(v.reduce((a, b) => a + (b - mean[i]) ** 2, 0) / v.length) || 1;
  });
  return (COMP_STATS[grp] = { pool, idx, sd });
}
function compDist(S, a, b) {
  let s = 0, n = 0;
  for (const i of S.idx) {
    if (a[i] == null || b[i] == null) continue;
    s += ((a[i] - b[i]) / S.sd[i]) ** 2; n++;
  }
  return n ? Math.sqrt(s / n) : Infinity;
}
function compList(p, proj, mode) {
  const S = compStats(p.grp);
  let vec = p.h.at(-1).slice(2), pool = S.pool.filter(q => q.k !== p.k), peak = null;
  if (mode === "age") pool = pool.filter(q => Math.abs(q.age - p.age) <= 1);
  if (mode === "become") {
    peak = proj.reduce((a, b) => (b.mid > a.mid ? b : a));
    vec = D.attrs.map(() => null);
    projectAttrs(p, peak).forEach(r => { vec[D.attrs.indexOf(r.c)] = r.mid; });
    pool = pool.filter(q => q.age >= 24 && q.age <= 31);
  }
  const rows = pool.map(q => ({ q, d: compDist(S, vec, q.h.at(-1).slice(2)) }))
    .sort((a, b) => a.d - b.d).slice(0, 10);
  return { rows, peak };
}
function compsPanel(p, proj) {
  const canBecome = p.age <= 23 && proj.some(x => x.m > 0 && x.mid > p.ca + 1);
  const modes = [["now", "Most similar now"], ["age", "Same age (±1)"], ...(canBecome ? [["become", "Could become"]] : [])];
  return `<div class="panel" id="comps">
    <div class="chart-head"><div><h2>Comparable players</h2>
      <p class="sub" id="comps-sub"></p></div>
      <div class="seg" id="comps-mode">${modes.map(([k, t]) => `<button type="button" data-m="${k}" class="${k === (canBecome ? "become" : "now") ? "on" : ""}">${t}</button>`).join("")}</div>
    </div>
    <div class="tablewrap" id="comps-table"></div></div>`;
}
function drawComps(p, proj, mode) {
  const box = view.querySelector("#comps");
  if (!box) return;
  box.querySelectorAll("#comps-mode button").forEach(b => b.classList.toggle("on", b.dataset.m === mode));
  const { rows, peak } = compList(p, proj, mode);
  const grpName = { F: "forwards", D: "defencemen", G: "goalies" }[p.grp];
  box.querySelector("#comps-sub").innerHTML = {
    now: `The ${grpName} whose current attributes look most like his, at any age.`,
    age: `The ${grpName} within a year of his age whose attributes look most like his.`,
    become: `His <b>projected</b> attributes at his projected peak (est. CA ${peak ? fmt(peak.mid, 0) : "–"}, age ${peak ? Math.floor(peak.age) : "–"})
      compared with established ${grpName} aged 24–31 today: who he could turn into.`,
  }[mode] + ` Match = how close the attribute profiles are (100 = identical), each attribute scaled by how much it varies among ${grpName}.`;
  box.querySelector("#comps-table").innerHTML = `<table><thead><tr><th>Player</th><th class="num">Age</th><th>Pos</th><th>Club</th>
    <th class="num">Est. CA</th><th class="num">Est. PA</th><th>Role</th><th class="num">NHL WAR/82</th><th class="num">Match</th></tr></thead><tbody>
    ${rows.map(({ q, d }) => `<tr class="link" data-k="${esc(q.k)}"><td><a href="${route(q.k)}">${esc(q.n)}</a></td>
      <td class="num">${q.age}</td><td>${esc(q.pos)}</td><td>${tname(clubOf(q))}${q.lg ? ` <span class="muted small">${esc(q.lg)}</span>` : ""}</td>
      <td class="num">${fmt(q.ca, 0)}</td><td class="num">${fmt(q.pa, 0)}</td><td class="small">${esc(q.sc?.role?.split(" / ")[1] || q.sc?.role || "")}</td>
      <td class="num">${q.war ? q.war.war82.toFixed(1) : "–"}</td><td class="num"><b>${Math.round(100 * Math.exp(-d * d))}</b></td></tr>`).join("")}
    </tbody></table>`;
  box.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (e.target.tagName !== "A") location.hash = route(tr.dataset.k); });
}

// ---------------------------------------------------------------- WAR
const WAR_LABELS = { shooting: "Shot generation", finishing: "Finishing", playmaking: "Playmaking",
                     defence: "Defence", penalties: "Penalties", goaltending: "Goaltending" };
/* Goalies' WAR is measured against the league's average goalie in WAR v2 (user's rule): name the zero line right. */
const warVsAverage = p => p.grp === "G" && D.warInfo?.replacement?.G?.baseline === "average";
function warSection(p, grpName) {
  const w = p.war, avg = warVsAverage(p), vs = avg ? "above an average goalie" : "above replacement";
  if (!w) return `<div class="war-row"><div class="war-main"><div class="lab">Wins ${vs}</div>
    <div class="empty">No NHL box-score games yet.</div></div></div>`;
  const comps = Object.entries(w.comps);
  const max = Math.max(2, ...comps.map(([, v]) => Math.abs(v)));
  const c = pctColor(w.pct);
  return `<div class="war-row">
    <div class="war-main">
      <div class="lab">Wins ${vs}</div>
      <div class="war-num">${w.war.toFixed(1)} <span>WAR</span></div>
      <div class="note">${w.war82.toFixed(1)} per 82 GP${D.warInfo?.war82_shrink_gp ? ` (pace, with ${D.warInfo.war82_shrink_gp} games of the position average)` : ""} · ${w.gar.toFixed(1)} goals ${vs} · ${w.gp} GP</div>
      ${w.pct != null ? `<a class="pill" href="${pRankHref("war", "war", p.grp, p.k)}" style="background:${c.bg};color:${c.fg}" title="${TIP_PCT}">${ordinal(w.pct)} pct WAR/82 of ${grpName}</a>` : ""}
    </div>
    <div class="war-bars" title="Goals above replacement by component">
      ${comps.map(([k, v]) => {
        const pct = Math.abs(v) / max * 50;
        return `<div class="wb"><span class="wl">${WAR_LABELS[k] || k}</span>
          <span class="wt"><i class="${v >= 0 ? "pos" : "neg"}" style="${v >= 0 ? "left:50%" : `left:${50 - pct}%`};width:${pct}%"></i><b></b></span>
          <span class="wv">${v > 0 ? "+" : ""}${v.toFixed(1)}</span></div>`;
      }).join("")}
      <div class="wb axis"><span></span><span class="wt-axis"><span>−${max.toFixed(0)}</span><span>0</span><span>+${max.toFixed(0)} goals</span></span><span></span></div>
    </div>
  </div>`;
}

/* WAR in each of the last seasons (regular season), the current one so far; the selected season is outlined. */
function warHistory(p) {
  const base = byKey.get(p.k) || p;
  const rows = SEASONS.slice(-3).map(s => {
    const w = s === SEASONS.at(-1) ? base.war : base.ss?.[s]?.war;
    const games = (D.seasons || []).find(x => x.season === s)?.games?.games || 0;
    return { s, w, partial: games < 0.9 * (D.predict?.blend?.season_gp || 84) * 16 };
  }).filter(r => r.w);
  if (!rows.length) return "";
  const max = Math.max(1, ...rows.map(r => Math.abs(r.w.war)));
  return `<div class="war-hist" aria-label="WAR by season">
    <div class="lab">WAR by season · regular season</div>
    ${rows.map(r => `<div class="wh ${r.s === SEASON ? "sel" : ""}"><span class="wl">${seasonLabel(r.s)}${r.partial ? " <small>so far</small>" : ""}</span>
      <span class="wt"><i class="${r.w.war >= 0 ? "pos" : "neg"}" style="${r.w.war >= 0 ? "left:0" : "left:0"};width:${(Math.abs(r.w.war) / max * 100).toFixed(1)}%"></i></span>
      <span class="wv">${fmt(r.w.war, 1)}</span><span class="wx">${r.w.gp} GP · ${fmt(r.w.war82, 1)} per 82</span></div>`).join("")}
  </div>`;
}
