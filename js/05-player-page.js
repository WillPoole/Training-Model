"use strict";

let PTAB = "overview";  // Prospect Profile layout: open tab
function renderPlayer(key, tab = "overview") {
  if (!byKey.get(key) && ALUMNI.has(key)) { renderFormer(ALUMNI.get(key)); return; }
  if (!byKey.get(key)) { markNav("players"); view.innerHTML = `<div class="wrap page"><div class="panel">Unknown player. <a href="#/players">All players</a></div></div>`; return; }
  const base = inSeason(byKey.get(key));
  const hasPO = !!base.po;
  const mode = PMODE === "po" && hasPO ? "po" : "rs";   // PMODE itself stays, for the next player and the list
  // playoff view: same page, with the box-score sections swapped for playoff games
  const p = mode === "po" ? { ...base, card: { ...base.po.card, ca_pct: base.card?.ca_pct, pa_pct: base.card?.pa_pct },
                               war: base.po.war, shots: base.po.shots, sa: base.po.sa, _po: true } : base;
  const G = p._po ? (seasonInfo().gamesPO || {}) : (seasonInfo().games || {});
  const proj = project(p);
  const peak = proj.reduce((a, b) => (b.mid > a.mid ? b : a));
  const card = p.card || {};
  const isG = p.grp === "G";
  const grpName = { F: "forwards", D: "defence", G: "goalies" }[p.grp];
  const first = p.h[0], last = p.h.at(-1);
  const caChange = p.h.length > 1 ? last[1] - first[1] : null;
  // the overview's change box: est. CA now vs his last snapshot at least 4 months (120 days) before the latest one,
  // else his first snapshot (newer players)
  const dayOf = i => new Date(D.dates[i] + "T00:00:00").getTime();
  const cutoff = dayOf(last[0]) - 120 * 864e5;
  const base4 = p.h.filter(h => dayOf(h[0]) <= cutoff).at(-1) || first;
  const recent = p.h.length > 1 && base4 !== last ? last[1] - base4[1] : null;
  const recentDays = Math.round((dayOf(last[0]) - dayOf(base4[0])) / 864e5);

  const comps = card.comp ? Object.keys(COMP_LABELS).filter(k => card.comp[k] != null) : [];
  const metricsDef = isG ? D.goalieMetrics : D.skaterMetrics;
  const metricRows = card.pct ? metricsDef.map(([k, label]) => barRow(label, rawFmt(k, card.raw?.[k]), card.pct[k], null, pRankHref("m", k, p.grp, p.k))).join("") : "";
  const t = card.totals;
  const tags = [seenText(p), p.sc?.role ? "Role: " + p.sc.role : null,
    bigGame(p) ? `Big games (Important Matches): ${bigGame(p)}/20` : (p._po ? "Big-game rating unknown (no scout phrase)" : null),
    p.pr ? [p.pr, prospectHref(p)] : null, p.dr ? [p.dr, /NHL/.test(p.dr) ? "#/draft" : null] : null, t ? `NHL: ${t.gp} GP · ${t.g} G · ${t.a} A · ${t.p} P` : null,
    p.dft?.pro?.pick != null ? [`Drafted ${p.dft.pro.year} · #${p.dft.pro.pick} overall`, draftHref(p.dft.pro)] : null,
    ...achTags(p)].filter(Boolean);
  const tagsHtml = tags.map(x => Array.isArray(x) && x[1] ? `<a class="tag" href="${x[1]}">${esc(x[0])}</a>` : `<span class="tag">${esc(Array.isArray(x) ? x[0] : x)}</span>`).join("");

  const S = {};
  S.controls = `
  <div class="cardbar">
    ${backLink()}
    <span class="cardbar-r">
      ${seasonSelect("pseason", SEASONS, SEASON, { cls: "small muted", single: "disable" })}
      <label class="small muted">Games <select id="pmode">
        <option value="rs" ${mode === "rs" ? "selected" : ""}>Regular season</option>
        <option value="po" ${mode === "po" ? "selected" : ""} ${hasPO ? "" : "disabled"}>Playoffs${hasPO ? "" : " (none yet)"}</option>
      </select></label>
      <button class="ghost small" id="png" type="button">Download PNG</button>
    </span>
  </div>`;
  S.card = `
  <div class="card" id="card">
    <div class="card-head">
      <div>
        <div class="name">${esc(p.n)}</div>
        <div class="meta">${p.no ? "#" + esc(p.no) + " · " : ""}${esc(p.pos)} · Age ${p.age}${clubOf(p) ? " · " + tname(clubOf(p)) : ""}${p.lg ? ` (${esc(p.lg)})` : ""}
          ${p.sh ? " · Shoots " + esc(p.sh[0]) : ""} · ${esc(p.ht)} · ${esc(p.wt)}</div>
        <div class="meta">${esc(p.nat)}${headerContract(p)}</div>
        <div class="tags">${tagsHtml}</div>
      </div>
      <div class="badge"><b>EHM card</b>${fmtDate(p.seen || D.dates.at(-1))}</div>
    </div>
    <div class="hero">
      <div><div class="lab">Est. current ability</div><div class="val">${fmt(p.ca, 0)}</div>
        <div class="note">${stars(p.ca)} · ${card.ca_pct == null ? "" : rankLink(pRankHref("ca", "ca", p.grp, p.k), `${ordinal(card.ca_pct)} pct of ${grpName}`)}</div></div>
      <div><div class="lab">Est. potential ability</div><div class="val">${fmt(p.pa, 0)}</div>
        <div class="note">${stars(p.pa)} · likely ${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</div></div>
      <div><div class="lab">Projected peak (${D.projectionMonths / 12} yrs)</div><div class="val">${fmt(peak.mid, 0)}</div>
        <div class="note">${peak.m === 0 ? "at or past peak now" : `around age ${Math.floor(peak.age)} · ${fmtDate(peak.date)}`}</div></div>
      <div><div class="lab">${base4 === first && recentDays < 110 ? "Change since he appeared" : "Change in the past 4 months"}</div>
        <div class="val ${recent > 0.5 ? "up" : recent < -0.5 ? "down" : ""}">${recent == null ? "–" : (recent > 0 ? "+" : "") + recent.toFixed(1)}</div>
        <div class="note">est. CA since ${fmtDate(D.dates[base4[0]])}${recent == null ? "" : ` (${recentDays} days)`} · ${caChange == null ? "" : `${signed(caChange, 1)} since ${fmtDate(D.dates[first[0]])}`}</div></div>
      ${playoffHero(byKey.get(p.k))}
    </div>
    <div class="cols">
      <section>
        <h3>${isG ? "Goaltending" : "Impact profile"}</h3>
        ${comps.length ? `<div class="tiles">${comps.map(k => tile(COMP_LABELS[k], card.comp[k], k === "impact", pRankHref("c", k, p.grp, p.k))).join("")}</div>`
          : `<div class="empty">No NHL box-score sample (needs ${isG ? 300 : D.minToi}+ minutes in the snapshots' NHL games).</div>`}
      </section>
      <section>
        <h3>${isG ? "Goalie rates" : "Rates & usage"}</h3>
        ${metricRows ? `<div class="bars">${metricRows}</div>` : `<div class="empty">No NHL rate stats for this player yet.</div>`}
      </section>
      <section>
        <h3>Attribute profile</h3>
        <div class="bars">${p.grpS.map(([name, avg, pct]) => barRow(name, avg.toFixed(1) + "/20", pct,
          `Average of the ${name.toLowerCase()} attributes; percentile vs all ${grpName} in the database`, pRankHref("g", name, p.grp, p.k))).join("")}</div>
      </section>
    </div>
    ${warSection(p, grpName)}
    ${warHistory(p)}
    <div class="card-foot">
      <span>${p._po ? "<b>Playoffs.</b> " : ""}${card.pool ? "Stat percentiles vs " + esc(card.pool) + ". " : ""}Attribute percentiles vs all ${grpName}. NHL ${p._po ? "playoff" : "regular-season"} games ${G.first ? fmtDate(G.first) + " – " + fmtDate(G.last) : "–"}.</span>
      <span class="legend-scale">0 <i style="background:linear-gradient(90deg,${pctColor(0).bg},${pctColor(50).bg},${pctColor(100).bg})"></i> 100 percentile</span>
    </div>
  </div>`;
  S.ach = achievementsPanel(p);
  S.chart = `
  <div class="panel" id="chartpanel">
    <div class="chart-head">
      <div><h2 id="chart-title">Ability over time and projection</h2>
        <p class="sub" id="chart-sub"></p></div>
      <label class="small muted">Show <select id="metric">
        <option value="ca">Est. CA + projection</option>
        ${D.attrs.map((a, i) => p.h.some(h => h[i + 2] != null) ? `<option value="${i}">${esc(a.split(": ")[1])}</option>` : "").join("")}
      </select></label>
    </div>
    <div class="legend" id="legend"></div>
    <div id="chart"></div>
    <details><summary>Data table</summary><div class="tablewrap" id="chart-table"></div></details>
  </div>`;
  S.comps = compsPanel(p, proj);
  S.scout = scoutPanel(p);
  S.shots = shotPanel(p);
  S.attrs = `
  <div class="panel" id="attrpanel">
    <h2>Attributes</h2>
    <p class="sub">Latest snapshot; change since ${fmtDate(D.dates[first[0]])}. Click an attribute to chart it.</p>
    <div class="attr-game">${attrTables(p)}</div>
    <div id="attrproj"></div>
  </div>`;
  S.career = careerPanel(p);

  const X = { proj, peak, card, t, isG, grpName, first, caChange, comps, metricsDef, tagsHtml, G, hasPO, key, recent, recentDays, sinceAppeared: base4 === first && recentDays < 110 };
  view.innerHTML = composePlayer(S, p, X);

  const sel = view.querySelector("#metric");
  sel.onchange = () => drawChart(p, proj, sel.value);
  view.querySelector("#attr-role")?.addEventListener("change", e => {
    view.querySelectorAll(".attr-game .arow").forEach(r => {
      const t = e.target.value ? roleTier(e.target.value, r.dataset.n) : null;
      TIER_CLASS.forEach((c, i) => r.classList.toggle("t-" + c, t === i));
    });
  });
  view.querySelectorAll(".attr-game .arow").forEach(tr => {
    tr.onclick = () => {
      sel.value = tr.dataset.i; drawChart(p, proj, sel.value);
      reveal(view.querySelector("#chartpanel"));
    };
    tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tr.onclick(); } };   // reachable by keyboard too
  });
  view.querySelector("#png").onclick = () => exportCard(p, proj, X);
  view.querySelector("#pmode").onchange = e => { PMODE = e.target.value; renderPlayer(key, PTAB); };
  view.querySelector("#pseason").onchange = e => { SEASON = e.target.value; renderPlayer(key, PTAB); };
  drawChart(p, proj, "ca");
  renderAttrProjection(p, proj, 12);
  drawComps(p, proj, view.querySelector("#comps-mode button.on").dataset.m);
  drawCareer(p);
  view.querySelectorAll("#car-type button").forEach(b => b.onclick = () => { CTYPE = b.dataset.t; drawCareer(p); });
  view.querySelectorAll("#comps-mode button").forEach(b => b.onclick = () => drawComps(p, proj, b.dataset.m));
  initShotMaps(p);
  GAMELOG = () => drawGameLog(p);
  MINI = () => drawMini(p, proj);
  const jump = wireTabs(key, tab);
  view.querySelectorAll(".jumps [data-jump]").forEach(b => b.onclick = () => view.querySelector("#sec-" + b.dataset.jump)?.scrollIntoView({ behavior: "smooth" }));
  if (!keepScroll) window.scrollTo(0, 0);
  // an old link such as /p/<key>/shots lands on that section of its new tab
  if (jump) view.querySelector("#sec-" + jump)?.scrollIntoView();
}

// ---------------------------------------------------------------- player page layout
// on-ice performance first (stats, games, shots), then ability (development, scouting, comparables), then the record
const PTABS = [["overview", "Overview"], ["performance", "Performance"], ["dev", "Development"], ["record", "Contract &amp; record"]];
// the eight tabs of the old layout: their links land on the section that replaced them
const OLD_PTABS = { stats: ["performance", "stats"], games: ["performance", "games"], shots: ["performance", "shots"],
                    scout: ["dev", "scout"], comps: ["dev", "comps"], awards: ["record", "awards"] };
let MINI = null;      // draws the open player's small chart on Overview at its real width
let GAMELOG = null;   // draws the open player's game log when its tab is shown (the box scores load on demand)
function wireTabs(key, tab) {
  const btns = [...view.querySelectorAll(".ptabs [data-tab]")];
  if (!btns.length) return;
  const old = Object.hasOwn(OLD_PTABS, tab) ? OLD_PTABS[tab] : null;
  const show = (t, focus, push) => {
    // a tab name from the URL: only a known one goes into the selector (an odd one would make querySelector throw)
    if (!PTABS.some(x => x[0] === t) || !view.querySelector(`.tabpane[data-tab="${t}"]`)) t = "overview";
    PTAB = t;
    btns.forEach(b => { const on = b.dataset.tab === t; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    view.querySelectorAll(".tabpane").forEach(s => (s.hidden = s.dataset.tab !== t));
    if (t === "performance") GAMELOG?.();
    if (t === "dev") redrawChartIfResized();   // drawn while its tab was hidden (no width yet)
    if (t === "overview") MINI?.();
    // push/replaceState don't fire hashchange, so switching tabs doesn't re-render the page; a click adds a history
    // entry (the browser's Back returns to the previous tab), the initial show only normalises the URL
    const url = route(key) + (t === "overview" ? "" : "/" + t);
    if (push && location.hash !== url) history.pushState(null, "", url); else history.replaceState(null, "", url);
  };
  btns.forEach((b, i) => {
    b.onclick = () => show(b.dataset.tab, false, true);
    b.onkeydown = e => {   // arrow keys move between tabs
      const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (j == null) return;
      e.preventDefault(); show(btns[(j + btns.length) % btns.length].dataset.tab, true, true);
    };
  });
  show(old ? old[0] : tab);
  return old?.[1];
}
/* Player Game log section: every NHL game he played in a season (regular season and playoffs) from data/games_<season>.js,
   each opening its box score on his team's Results tab. */
let GL_SEASON = null;
function gameLogSeasons(p) {
  return SEASONS.filter(s => Object.values(D.teamPlayers?.[s] || {}).some(m => ["R", "P"].some(t => (m[t] || []).some(row => row[0] === p.k))));
}
function drawGameLog(p) {
  const box = view.querySelector("#gamelog");
  if (!box) return;
  const seasons = gameLogSeasons(p);
  if (!seasons.length) { box.innerHTML = `<h2>Game log</h2><p class="muted small">No NHL games in this save's box scores.</p>`; return; }
  const season = seasons.includes(GL_SEASON) ? GL_SEASON : seasons.includes(SEASON) ? SEASON : seasons.at(-1);
  box.dataset.season = season;
  loadGames(season).then(list => {
    if (box.dataset.season !== season || !view.contains(box)) return;
    if (!list) { box.innerHTML = `<h2>Game log</h2><p class="muted small">Box scores for ${seasonLabel(season)} aren't in this build.</p>`; return; }
    const isG = p.grp === "G";
    const games = list.map((g, i) => ({ g, i, x: g.pl.find(y => y[1] === p.k) })).filter(o => o.x && (o.x[11] > 0 || !isG));
    const tot = { gp: 0, g: 0, a: 0, p: 0, pm: 0, st: 0, s: 0, blk: 0, pim: 0, toi: 0, sa: 0, ga: 0, w: 0, l: 0 };
    const rows = games.map(({ g, i, x }) => {
      const club = x[0] === "home" ? g.h : g.a, opp = x[0] === "home" ? g.a : g.h, [res, gf, ga] = gameResult(g, club);
      const href = `${teamRoute(club)}/results/${season}/${i}`;
      tot.gp++; tot.toi += x[11] || 0;
      let line;
      if (isG) {
        const q = goalieGame(g, x);
        tot.sa += q.sa || 0; tot.ga += q.ga || 0; if (/W/.test(res)) tot.w++; else if (res) tot.l++;
        line = `<td class="num">${q.sa == null ? dash : Math.round(q.sa)}</td><td class="num">${q.sa == null ? dash : Math.round(q.sa - q.ga)}</td><td class="num">${q.ga == null ? dash : Math.round(q.ga)}</td>
          <td class="num">${q.sa ? (1 - q.ga / q.sa).toFixed(3).replace(/^0/, "") : dash}</td>`;
      } else {
        [["g", 4], ["a", 5], ["p", 6], ["pm", 7], ["st", 8], ["s", 9], ["blk", 14], ["pim", 10]].forEach(([k, j]) => { tot[k] += x[j] || 0; });
        line = [4, 5, 6, 7, 8, 9, 14, 10].map(j => `<td class="num">${x[j] == null ? dash : j === 6 ? `<b>${x[j]}</b>` : j === 7 && x[j] > 0 ? "+" + x[j] : x[j]}</td>`).join("");
      }
      return `<tr class="glink" data-href="${href}"><td class="nowrap" data-v="${g.d}"><a href="${href}" title="Box score">${fmtDate(g.d)}</a>${g.t === "P" ? ' <span class="chip">PO</span>' : ""}</td>
        <td class="nowrap">${tlink(club, `${logo(club, 20)} ${esc(NHL_TEAMS[club]?.[0] || club)}`)}</td><td class="nowrap">${x[0] === "home" ? "vs" : "@"} ${tlink(opp, `${logo(opp, 20)} ${esc(opp)}`)}</td>
        <td class="${/W/.test(res) ? "up" : res ? "down" : ""}"><b>${res}</b></td><td class="num" data-v="${gf - ga}">${gf ?? "–"}–${ga ?? "–"}</td>
        ${line}<td class="num" data-v="${x[11] ?? ""}">${x[11] == null ? dash : rawFmt("toi_gp", x[11])}</td><td class="num">${x[12] ?? dash}</td></tr>`;
    });
    const head = isG ? `<th class="num" title="Shots against">SA</th><th class="num">Saves</th><th class="num">GA</th><th class="num">SV%</th>`
      : `<th class="num">G</th><th class="num">A</th><th class="num">P</th><th class="num">+/−</th><th class="num" title="Shots on goal">SOG</th><th class="num" title="Shot attempts">Shots</th><th class="num" title="Shots blocked">Blk</th><th class="num">PIM</th>`;
    const totals = isG
      ? `${tot.w}–${tot.l} · ${tot.sa ? (1 - tot.ga / tot.sa).toFixed(3).replace(/^0/, "") : "–"} SV% · ${tot.toi ? (tot.ga * 60 / tot.toi).toFixed(2) : "–"} GAA`
      : `${tot.g} G · ${tot.a} A · ${tot.p} P · ${tot.pm > 0 ? "+" : ""}${tot.pm} · ${tot.st} SOG · ${tot.blk} blocks · ${tot.gp ? rawFmt("toi_gp", tot.toi / tot.gp) : "–"} TOI/GP`;
    box.innerHTML = `<div class="chart-head"><div><h2>Game log</h2><p class="sub">${seasonLabel(season)}: ${tot.gp} games · ${totals}. Click a game (or its date) for its box score. PO = playoffs.</p></div>
        ${seasonSelect("gl-season", seasons, season, { cls: "inline small muted" })}</div>
      <div class="tablewrap"><table class="rank sortable picks gamelog"><thead><tr><th aria-sort="descending">Date</th><th>Team</th><th>Opponent</th><th>Result</th><th class="num">Score</th>${head}
        <th class="num">TOI</th><th class="num" title="Game rating">Rtg</th></tr></thead><tbody>${rows.reverse().join("") || `<tr><td colspan="16" class="muted small">No games captured.</td></tr>`}</tbody></table></div>
      <p class="small muted">From this save's box scores (about 2% of games missing). Score: his team first.${isG ? " Shots and goals against: the box score's when he played the whole game, else the shot chart's." : ""}</p>`;
    box.querySelector("#gl-season")?.addEventListener("change", e => { GL_SEASON = e.target.value; drawGameLog(p); });
    box.querySelectorAll("tr.glink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = tr.dataset.href; });
    makeSortable(box);
  });
}
/* Box-score totals for the selected season / game type, with the team(s) he played for. */
function totalsTable(p, t) {
  if (!t) return `<p class="muted small">No NHL box-score games for this player in the selected season.</p>`;
  const toi = t.gp ? t.toi / t.gp : null;
  return `<div class="tablewrap"><table class="totals"><thead><tr><th>NHL ${p._po ? "playoffs" : "regular season"}</th><th>Team</th>
    <th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">A1</th><th class="num">P</th><th class="num">+/-</th>
    <th class="num">PIM</th><th class="num">SOG</th><th class="num">ixG</th><th class="num">TOI/GP</th><th class="num">TOI</th></tr></thead>
    <tbody><tr><td>${SEASON ? seasonLabel(SEASON) : ""}</td><td class="nowrap">${(t.team || abbrOf(clubOf(p)) || "–").split("/").map(a => `${teamLogo(clubOfAbbr(a), 22)} <b>${esc(a)}</b>`).join(" ")}</td>
    <td class="num">${t.gp}</td><td class="num">${t.g}</td><td class="num">${t.a}</td><td class="num">${t.a1}</td>
    <td class="num"><b>${t.p}</b></td><td class="num">${t.pm > 0 ? "+" : ""}${t.pm}</td><td class="num">${t.pim}</td><td class="num">${t.st}</td>
    <td class="num">${t.ixg ?? "–"}</td><td class="num">${toi == null ? "–" : rawFmt("toi_gp", toi)}</td><td class="num">${Math.round(t.toi)}</td></tr></tbody></table></div>`;
}
const bornText = p => p.dob ? fmtDate(p.dob) : "–";
/* A player the latest crawl didn't read (a quick SHA crawl reads only the NHL and AHL): build_data carries his card from
   the last snapshot that had him (p.seen); p.left = the club he was no longer on when a crawl read its league. */
const seenText = p => !p.seen ? null : p.left ? `Left ${p.left} · last seen ${fmtDate(p.seen)}`
  : `Last seen ${fmtDate(p.seen)} (his league wasn't in the latest crawl)`;
function factRows(p, X) {
  const pro = draftLine(p.dft?.pro), jr = draftLine(p.dft?.junior);
  return [
    ["Age", p.age], ["Born", bornText(p)], ["Birthplace", p.bp], ["Nationality", p.nat], ["Position", p.pos],
    ["Number", p.no ? "#" + p.no : null], ["Shoots", p.sh], ["Height", p.ht], ["Weight", p.wt],
    ["Club", clubOf(p) ? tname(clubOf(p)) : null, true], ["League", p.lg],
    ["Last seen", p.seen ? `${fmtDate(p.seen)} (${p.left ? "not on " + p.left + " in the latest crawl" : "league not in the latest crawl"})` : null],
    ["Contract", p.sal], ["Expires", contractEnds(p)], ["Signed through", contractInfo(byKey.get(p.k) || p).next ? seasonName(contractInfo(byKey.get(p.k) || p).next.e) : null], ["Condition", p.inj],
    ["Drafted", linkText(pro, draftHref(p.dft?.pro)), true], ["Junior draft", jr], ["Role", p.sc?.role], ["Career role", p.sc?.career],
    ["Big games", bigGame(p) ? bigGame(p) + "/20" : null], ["Top prospect", linkText(p.pr, prospectHref(p)), true], ["Draft ranking", linkText(p.dr, /NHL/.test(p.dr || "") ? "#/draft" : null), true],
    ["Est. CA", `${fmt(p.ca, 0)} ${stars(p.ca)}`, true], ["Est. PA", `${fmt(p.pa, 0)} ${stars(p.pa)} <span class="muted small">${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</span>`, true],
    ["Proj. peak", `${fmt(X.peak.mid, 0)}${X.peak.m ? ` <span class="muted small">age ${Math.floor(X.peak.age)}</span>` : ""}`, true],
  ].filter(r => r[1] != null && r[1] !== "");
}
const factList = rows => `<dl class="facts">${rows.map(([k, v, html]) => `<dt>${k}</dt><dd>${html ? v : esc(v)}</dd>`).join("")}</dl>`;

/* WAR's shot generation, finishing and defence need shot charts; a league's build can lack them (SHA's were lost on 2026-11-03), and a season can too: checked for the selected season. */
const SHOTS_BY = {};   // per season: does any player have shots (the latest season sits on the player, earlier ones in p.ss)
const hasShotData = () => SHOTS_BY[SEASON] ??= D.players.some(q => (!SEASON || SEASON === SEASONS.at(-1) ? q : q.ss?.[SEASON])?.shots?.length > 0);
/* The four numbers that sum a player up. Est. PA and the recent change sit under them, not in boxes of their own. */
function keyNumbers(p, X) {
  const w = p.war, imp = X.card.comp?.impact, c = imp == null ? null : pctColor(imp);
  const def = (t, d) => `<span class="def" tabindex="0" data-def="${esc(d)}">${t}</span>`;
  const change = X.recent == null ? "" : `<div class="note"><span class="${X.recent > 0.5 ? "up" : X.recent < -0.5 ? "down" : ""}">${signed(X.recent, 1)}</span> ${X.sinceAppeared ? "since he appeared" : "in the past 4 months"}</div>`;
  return `<div class="keynums">
    <div class="kn"><div class="lab">${def("Current ability", "Estimated current ability (CA) from his attributes. True CA is hidden from clients.")}</div>
      <div class="val">${fmt(p.ca, 0)}</div>
      <div class="note">${stars(p.ca)}${X.card.ca_pct == null ? "" : " · " + rankLink(pRankHref("ca", "ca", p.grp, p.k), `${ordinal(X.card.ca_pct)} pct of ${X.grpName}`)}</div>${change}</div>
    <div class="kn"><div class="lab">${def("Projected peak", `The highest point of his ${D.projectionMonths / 12}-year ability projection.`)}</div>
      <div class="val">${fmt(X.peak.mid, 0)}</div>
      <div class="note">${X.peak.m === 0 ? "At or past peak now" : `Around age ${Math.floor(X.peak.age)}`}</div>
      <div class="note">${def("Est. potential", "Estimated potential ability (PA), with its likely range.")} ${fmt(p.pa, 0)} · likely ${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</div></div>
    <div class="kn"><div class="lab">${def("Overall impact", TIP_PCT + " From NHL box scores, so only NHL players have one.")}</div>
      ${imp == null ? `<div class="val muted">–</div><div class="note">No NHL box-score sample</div>`
        : `<a class="val kpct" href="${pRankHref("c", "impact", p.grp, p.k)}" style="background:${c.bg};color:${c.fg}">${imp}</a><div class="note">Percentile among ${esc((X.card.pool || X.grpName).replace(/\s*\(.*\)$/, ""))}</div>`}</div>
    <div class="kn"><div class="lab">${def("WAR", "Wins above replacement in the selected season's NHL box scores.")}${p._po ? " · playoffs" : ""}</div>
      ${w ? `<div class="val">${w.war.toFixed(1)}</div><div class="note">${w.war82.toFixed(1)} per 82 GP · ${w.gp} GP</div>
        ${w.pct == null ? "" : `<div class="note">${rankLink(pRankHref("war", "war", p.grp, p.k), `${ordinal(w.pct)} pct of ${X.grpName}`)}</div>`}
        ${!X.isG && !hasShotData() ? `<div class="note warnnote">Partial: this build has no shot data, so only playmaking and penalties count.</div>` : ""}`
        : `<div class="val muted">–</div><div class="note">No NHL games</div>`}</div>
  </div>`;
}
/* Contract in a few words: the deal in force, the signed one after it and, for NHL players, how it compares with the market. */
/* The card header's contract line: today's deal, then the extension if one is signed. */
function headerContract(p) {
  const live = byKey.get(p.k) || p, { cur, next } = contractInfo(live);
  const m = v => `$${(v / 1e6).toFixed(v % 1e6 ? 3 : 1).replace(/0+$/, "").replace(/\.$/, "")}M`;
  if (!cur && !next) return p.sal ? " · " + esc(p.sal) + (p.exp ? " through " + esc(p.exp) : "") : "";
  return (cur ? ` · ${cur.sal ? m(cur.sal) : esc(p.sal || "")} through ${esc(contractEnds(live))}` : "")
    + (next ? ` · extension ${next.sal ? m(next.sal) + " " : ""}to ${seasonName(next.e)}` : "");
}
function contractSummary(p) {
  const live = byKey.get(p.k) || p, { cur, next } = contractInfo(live);
  if (!cur && !next) return `<p class="muted">${p.sal || p.exp ? `Contract ended ${esc(p.exp || "")}.` : "No contract on record."}</p>`;
  const cv = p.lg === "NHL" && cur?.sal ? contractValue(live) : null, n = contractSeasons(live).filter(y => !y.ext).length;
  const left = n === 0 ? "Expiring" : n === 1 ? "Final season" : `${n} seasons left`;
  const signed = v => `${v < 0 ? "−" : "+"}$${Math.abs(v / 1e6).toFixed(1)}M`;
  const club = clubOf(p), link = cv && NHL_TEAMS[club] ? ` <a href="${teamRoute(club)}/contracts">Team contracts →</a>` : "";
  return `<p class="cterm"><b>${cur?.sal ? capFull(cur.sal) : esc(p.sal || "Pay unknown")}</b>${cur ? ` through ${esc(contractEnds(live))}` : ""} · ${left}</p>
    ${next ? `<p class="cterm small">Extension signed: ${next.sal ? `<b>${capFull(next.sal)}</b>` : "value known July 1"}, ${seasonName(next.s)} to ${seasonName(next.e)}</p>` : ""}
    ${cv ? `<p class="small muted">Expected value ${signed(cv.perSeason)} a season against the market.${link}</p>` : ""}`;
}
const capFull = v => "$" + Math.round(v).toLocaleString("en-US");
/* PuckPedia's contract page: this deal, the next one, cap hit by season, the season grid, then the details and history. */
function contractPanel(p) {
  const live = byKey.get(p.k) || p, ct = live.ct || {}, { now, deals, cur, next, past } = contractInfo(live);
  if (!deals.length) return `<div class="panel"><h2>Contract</h2><p class="muted">No contract on record.</p></div>`;
  const fa = faStatus(live), isNhl = p.lg === "NHL", M = isNhl ? market() : null, cap = D.cap?.cap;
  const left = contractSeasons(live).filter(y => !y.ext).length;
  const fact = (k, v) => v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "";
  const curCard = cur ? `<div class="dealcard"><h3>Current contract</h3><b class="dealhit">${cur.sal ? capFull(cur.sal) : esc(p.sal || "Pay unknown")}</b><span class="small muted">Cap hit</span>
      <dl>${fact("Runs through", esc(contractEnds(live)))}${fact("Left", left === 0 ? "Expiring" : left === 1 ? "Final season" : `${left} seasons`)}${cur.s ? fact("Year", `${now - cur.s + 1} of ${cur.e - cur.s + 1}`) : ""}
        ${next ? "" : fact("Then", fa ? `<span title="${esc(fa.full)}">${fa.t}</span>` : "")}${ct.type ? fact("Type", esc(ct.type) + (ct.cl?.includes("Two-Way Clause") ? ", two-way" : "")) : ""}${ct.cs ? fact("Status", esc(ct.cs)) : ""}${ct.ts ? fact("Team role", esc(ct.ts[0].toUpperCase() + ct.ts.slice(1))) : ""}</dl></div>` : "";
  const nextCard = next ? `<div class="dealcard ext"><h3>Extension signed</h3><b class="dealhit">${next.sal ? capFull(next.sal) : "Known July 1"}</b><span class="small muted">${next.sal ? "Cap hit" : "The game shows the new pay when it starts"}</span>
      <dl>${fact("Term", `${next.e - next.s + 1} season${next.e > next.s ? "s" : ""}`)}${fact("Starts", seasonName(next.s))}${fact("Ends", seasonName(next.e))}
        ${next.signed ? fact(next.src === "game" ? "Signed" : "First seen", fmtDate(next.signed)) : ""}${next.sal ? fact("Total", capFull(next.sal * (next.e - next.s + 1))) : ""}${fact("Then", fa ? `<span title="${esc(fa.full)}">${fa.t}</span>` : "")}${ct.sb ? fact("Signing bonus", capFull(ct.sb)) : ""}</dl></div>` : "";
  // cap hit by season: everything the save has seen
  const bars = [];
  for (const d of deals) for (let e = d.s ?? (d === cur ? now : d.e); e <= (d.e ?? now); e++) bars.push({ e, sal: d.sal, d });
  const top = Math.max(...bars.map(b => b.sal || 0), 1);
  const chart = bars.length > 1 ? `<div class="capbars" role="img" aria-label="Cap hit by season">${bars.map(b => `<div class="capbar${b.d === next ? " ext" : ""}${b.e === now ? " now" : ""}" title="${seasonName(b.e)}: ${b.sal ? capFull(b.sal) : "signed, value not known"}">
      <span class="capval">${b.sal ? (b.sal >= 1e6 ? "$" + (b.sal / 1e6).toFixed(2) + "M" : money(b.sal)) : "?"}</span><i style="height:${b.sal ? Math.max(6, Math.round(b.sal / top * 90)) : 6}px"></i><small>${String(b.e - 1).slice(2)}-${String(b.e).slice(2)}</small></div>`).join("")}</div>` : "";
  const years = contractSeasons(live).length ? (isNhl && M?.perWar ? contractYears(live) : contractSeasons(live)) : [];
  const valued = isNhl && M?.perWar;
  const end = deals.at(-1)?.e;
  const grid = years.length ? `<div class="tablewrap"><table class="rank dealgrid"><thead><tr><th>Season</th><th class="num">Cap hit</th><th class="num">Salary</th>${ct.mp ? `<th class="num" title="Pay while in the minors (two-way deal)">Minors</th>` : ""}${cap ? `<th class="num" title="Against today's cap of ${capFull(cap)}">% of cap</th>` : ""}${valued ? `<th class="num">Exp. WAR</th><th class="num">Worth</th><th class="num">Surplus</th>` : ""}</tr></thead>
      <tbody>${years.map(y => `<tr class="${y.ext ? "ext" : ""}"><th scope="row">${seasonName(y.season)}${y.ext ? ` <span class="chip">ext</span>` : ""}</th>
        <td class="num">${y.pay ? capFull(y.pay) : `<span class="muted">Signed</span>`}</td><td class="num">${y.deal.pay?.[y.season] ? capFull(y.deal.pay[y.season]) : dash}</td>${ct.mp ? `<td class="num">${ct.mp[y.season] ? capFull(ct.mp[y.season]) : dash}</td>` : ""}
        ${cap ? `<td class="num">${y.pay ? (y.pay / cap * 100).toFixed(1) + "%" : dash}</td>` : ""}
        ${valued ? `<td class="num">${war1(y.war)}</td><td class="num">${money(y.worth)}</td><td class="num ${y.surplus == null ? "" : y.surplus > 0 ? "up" : "down"}">${y.surplus == null ? dash : signedMoney(y.surplus)}</td>` : ""}</tr>`).join("")}
        ${end && fa ? `<tr class="faline"><th scope="row">${seasonName(end + 1)}</th><td colspan="${2 + (ct.mp ? 1 : 0) + (cap ? 1 : 0) + (valued ? 3 : 0)}"><span title="${esc(fa.full)}"><b>${fa.t}</b></span> <span class="small muted">${esc(fa.full)}</span></td></tr>` : ""}</tbody></table></div>` : "";
  const list = (t, rows) => rows?.length ? `<div><h3>${t}</h3><ul class="plain small">${rows.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>` : "";
  const details = ct.read ? `<div class="dealdetails">${list("Bonuses", ct.bonus)}${list("Clauses", ct.cl || ["None"])}${list("Notes", ct.notes)}
      <div><h3>If he's moved</h3><ul class="plain small">${ct.buried ? `<li>${capFull(ct.buried)} a year if assigned to the minors</li>` : ""}${ct.buyout ? `<li>${capFull(ct.buyout)} a year if bought out${ct.bs ? `, for ${ct.bs} seasons` : ""}</li>` : ""}${ct.buried || ct.buyout ? "" : "<li>Nothing listed</li>"}</ul></div></div>` : "";
  const hist = past.length || next ? `<h3 class="dealh">Contract history</h3><div class="tablewrap"><table class="rank dealhist"><thead><tr><th>Seasons</th><th class="num">Term</th><th class="num">Cap hit</th><th class="num">Total</th><th>Signed</th></tr></thead><tbody>
      ${[...deals].reverse().map(d => { const n = d.s ? d.e - d.s + 1 : null; return `<tr><th scope="row">${d.s ? seasonName(d.s) : "Before " + (D.dates[0] || "").slice(0, 4)} to ${d.e ? seasonName(d.e) : "?"}</th><td class="num">${n ? n + (n > 1 ? " yrs" : " yr") : dash}</td>
        <td class="num">${d.sal ? capFull(d.sal) : `<span class="muted">Not known yet</span>`}</td><td class="num">${d.sal && n ? capFull(d.sal * n) : dash}</td><td>${d.signed ? fmtDate(d.signed) : dash}</td></tr>`; }).join("")}</tbody></table></div>` : "";
  const source = ct.read ? `From the game's Contract tab, read ${fmtDate(ct.read)}.` : `Worked out from his profile in each snapshot: a new deal's pay shows on July 1, and a deal signed before the first snapshot only shows when his pay jumps.`;
  const link = NHL_TEAMS[clubOf(p)] ? ` <a href="${teamRoute(clubOf(p))}/contracts">Team contracts →</a>` : "";
  return `<div class="panel contractp"><h2>Contract</h2><div class="dealcards">${curCard}${nextCard}</div>${chart}${grid}${details}${hist}
    <p class="small muted">${source}${fa?.t.endsWith("*") ? " * = estimated from his age at expiry." : ""}${link}</p></div>`;
}
function composePlayer(S, p, X) {
  const totals = `<div class="panel"><h2>NHL box-score totals</h2><p class="sub">Games in this save's box scores (the source of the card's percentiles and WAR).</p>${totalsTable(p, X.t)}</div>`;
  const awards = S.ach || `<div class="panel"><h2>Draft &amp; awards</h2><p class="sub">No draft or achievements recorded for this player.</p></div>`;
  // a tab with nothing for this player stays clickable (its panels say why) but is dimmed
  const empty = { performance: !X.t && !Object.keys(p.ss || {}).length && !(X.isG ? p.sa : p.shots)?.length && !careerLines(p).length };
  const pane = (k, html) => `<section class="tabpane" data-tab="${k}" role="tabpanel" aria-label="${PTABS.find(t => t[0] === k)[1]}">${html}</section>`;
  const sec = (id, html) => `<div class="psec" id="sec-${id}">${html}</div>`;
  const jumps = list => `<nav class="jumps" aria-label="On this tab">${list.map(([id, t]) => `<button type="button" data-jump="${id}">${t}</button>`).join("")}</nav>`;
  const po = playoffHero(byKey.get(p.k));
  const overview = `${keyNumbers(p, X)}
    <div class="ovtop">
      <div class="ovchart"><div class="ovhead"><h2>Ability and projection</h2><a class="small" href="${route(p.k)}/dev">Full chart and attributes →</a></div>
        <div class="legend"><span style="--c:var(--s1)">Est. current ability</span><span style="--c:var(--s2)">Projection</span><span class="band" style="--c:var(--s2)">80% range</span></div>
        <div id="minichart"></div></div>
      <div class="ovside">
        <div class="ovblock"><h2>Contract</h2>${contractSummary(p)}</div>
        ${po ? `<div class="ovblock ovpo">${po}</div>` : ""}
      </div>
    </div>
    ${S.card}`;
  const perf = `${jumps([["stats", "Career stats"], ["shots", "Shots"], ["games", "Game log"]])}
    ${sec("stats", S.career + totals)}${sec("shots", S.shots)}
    ${sec("games", `<div class="panel" id="gamelog"><h2>Game log</h2><p class="muted small">Loading the box scores…</p></div>`)}`;
  const dev = `${jumps([["ability", "Ability"], ["attrs", "Attributes"], ["scout", "Scouting"], ["comps", "Comparables"]])}
    ${sec("ability", S.chart)}${sec("attrs", S.attrs)}${sec("scout", S.scout)}${sec("comps", S.comps)}`;
  const record = `${contractPanel(p)}${playerTrades(p)}${sec("awards", awards)}
    <div class="panel"><h2>Player facts</h2>${factList(factRows(p, X))}</div>`;
  return `
  <section class="band pband"><div class="wrap">
    ${S.controls}
    <div class="phead">
      ${teamLogo(clubOf(p), 56)}
      <div class="phead-id">
        <h1>${p.no ? `<span class="no">#${esc(p.no)}</span>` : ""}${esc(p.n)}</h1>
        <p>${[esc(p.pos), clubOf(p) ? `<a href="${teamRoute(clubOf(p))}">${esc(clubOf(p))}</a>` : "–", p.lg && p.lg !== "NHL" ? esc(p.lg) : "", `Age ${p.age}`,
              p.sh ? "Shoots " + esc(p.sh[0]) : "", esc(p.ht || ""), esc(p.wt || ""), esc(p.nat || "")].filter(Boolean).join(" · ")}</p>
        <div class="chips">${X.tagsHtml}</div>
      </div>
    </div>
    <div class="ptabs" role="tablist" aria-label="Player sections">${PTABS.map(([k, t]) => `<button type="button" role="tab" data-tab="${k}"${empty[k] ? ` class="empty" title="Nothing recorded for this player yet"` : ""}>${t}</button>`).join("")}</div>
  </div></section>
  <div class="wrap page player">
    <div class="pmain">
      ${pane("overview", overview)}${pane("performance", perf)}${pane("dev", dev)}${pane("record", record)}
    </div>
  </div>`;
}
/* Overview's small chart: estimated ability so far, then the projection with its 80% range, drawn at the box's real width.
   Same colours as the full chart on Development. Hover gives the nearest point. */
function drawMini(p, proj) {
  const box = view.querySelector("#minichart");
  if (!box || !box.clientWidth) return;
  const W = Math.round(Math.max(280, Math.min(900, box.clientWidth)));
  if (box.dataset.w === String(W)) return;
  box.dataset.w = W;
  const H = 190, m = { l: 32, r: 30, t: 12, b: 24 };
  const hist = p.h.filter(h => h[1] != null).map(h => ({ date: new Date(D.dates[h[0]] + "T00:00:00"), v: h[1] }));
  const x0 = hist[0].date, x1 = proj.at(-1).date, span = Math.max(1, x1 - x0);
  const vals = [...hist.map(h => h.v), ...proj.flatMap(q => [q.lo, q.hi])];
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 20) * 20), hi = Math.min(200, Math.ceil((Math.max(...vals) + 4) / 20) * 20);
  const X = d => m.l + (d - x0) / span * (W - m.l - m.r), Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const s1 = css("--s1"), s2 = css("--s2"), grid = css("--grid"), surf = css("--surface");
  let g = "";
  for (let v = lo; v <= hi; v += hi - lo > 80 ? 40 : 20) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${grid}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const years = (x1.getFullYear() - x0.getFullYear()) || 1, every = Math.max(1, Math.ceil(years * 44 / (W - m.l - m.r)));
  for (let y = x0.getFullYear() + 1; y <= x1.getFullYear(); y++) if (y % every === 0) g += `<text x="${X(new Date(y, 0, 1))}" y="${H - 7}" text-anchor="middle">${y}</text>`;
  g += `<polygon points="${proj.map(q => `${X(q.date)},${Y(q.hi)}`).join(" ")} ${proj.slice().reverse().map(q => `${X(q.date)},${Y(q.lo)}`).join(" ")}" fill="${s2}" opacity="0.14"/>
    <polyline points="${proj.map(q => `${X(q.date)},${Y(q.mid)}`).join(" ")}" fill="none" stroke="${s2}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${hist.map(h => `${X(h.date)},${Y(h.v)}`).join(" ")}" fill="none" stroke="${s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const now = hist.at(-1), end = proj.at(-1);
  g += `<circle cx="${X(now.date)}" cy="${Y(now.v)}" r="4" fill="${s1}" stroke="${surf}" stroke-width="2"/><text class="lbl" x="${X(now.date)}" y="${Y(now.v) - 9}" text-anchor="middle">${now.v.toFixed(0)}</text>
    <circle cx="${X(end.date)}" cy="${Y(end.mid)}" r="4" fill="${s2}" stroke="${surf}" stroke-width="2"/><text class="lbl" x="${X(end.date) + 7}" y="${Y(end.mid) + 4}">${end.mid.toFixed(0)}</text>
    <line class="mx" y1="${m.t}" y2="${H - m.b}" stroke="${css("--axis")}" visibility="hidden"/><rect class="mhit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated ability ${now.v.toFixed(0)} now, projected ${end.mid.toFixed(0)} by ${esc(fmtDate(end.date))}">${g}</svg>`;
  const pts = [...hist.map(h => ({ date: h.date, label: "Est. ability", v: h.v.toFixed(1) })), ...proj.slice(1).map(q => ({ date: q.date, label: "Projected", v: q.mid.toFixed(0), range: `${q.lo.toFixed(0)}–${q.hi.toFixed(0)}` }))];
  const svg = box.querySelector("svg"), hit = svg.querySelector(".mhit"), line = svg.querySelector(".mx");
  hit.addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W;
    const b = pts.reduce((a, c) => Math.abs(X(c.date) - sx) < Math.abs(X(a.date) - sx) ? c : a);
    line.setAttribute("x1", X(b.date)); line.setAttribute("x2", X(b.date)); line.setAttribute("visibility", "visible");
    showTip(e, `<b>${fmtDate(b.date)}</b><div class="row"><span>${b.label}</span><b>${b.v}</b></div>${b.range ? `<div class="row muted"><span>80% range</span><span>${b.range}</span></div>` : ""}`);
  });
  hit.addEventListener("mouseleave", () => { tip.hidden = true; line.setAttribute("visibility", "hidden"); });
}

/* #/p/<key> for a player who has left the data (D.teamHist.alumni: retired, unsigned or moved to a league the crawl
   doesn't read) but still appears in box scores and franchise records: bio and est. CA from the last snapshot that
   had him, NHL WAR by season, honours and his career lines. No card or projection: there are no current attributes. */
function renderFormer(a) {
  markNav("players");
  const L = a.last || {}, seasons = Object.keys(a.war || {}).sort();
  const facts = [["Last seen", L.d ? fmtDate(L.d) : "–"], ["Club then", L.cl ? `${logo(L.cl, 18)} ${tlink(L.cl)}${L.lg ? ` <span class="muted small">${esc(L.lg)}</span>` : ""}` : "–", true],
    ["Age then", L.age ?? "–"], ["Born", L.dob || "–"], ["Birthplace", L.bp || "–"], ["Nationality", L.nat || "–"],
    ["Height", L.ht || "–"], ["Weight", L.wt || "–"], ["Shoots", L.sh || "–"], ["Contract ran to", L.exp || "–"],
    ["Est. CA then", L.ca == null ? "–" : fmt(L.ca, 0)]];
  const warPanel = seasons.length ? `<div class="panel"><h2>NHL WAR by season</h2><p class="sub">From this save's box scores (regular season).</p>
    <div class="tablewrap"><table class="rank"><thead><tr><th>Season</th><th>Team</th><th class="num">GP</th><th class="num">WAR</th></tr></thead><tbody>
    ${seasons.map(s => { const [w, gp, t] = a.war[s]; return `<tr><td>${seasonLabel(s)}</td><td>${String(t || "").split("/").map(x => alink(x, `${logo(clubOfAbbr(x), 16)} ${esc(x)}`)).join(" / ")}</td><td class="num">${gp}</td><td class="num">${w.toFixed(2)}</td></tr>`; }).join("")}
    </tbody></table></div></div>` : "";
  const achPanel = a.ach?.length ? `<div class="panel"><h2>NHL honours</h2><ul class="plain">${a.ach.map(x => `<li><span class="muted small">${esc(x[0])}</span> ${achHref(x[0], x[2]) ? `<a href="${achHref(x[0], x[2])}">${esc(x[2])}</a>` : esc(x[2])} <span class="muted small">${tname(x[1])}</span></li>`).join("")}</ul></div>` : "";
  view.innerHTML = `<section class="band pband"><div class="wrap"><div class="cardbar">${backLink()}<span></span></div><div class="phead">${teamLogo(L.cl, 64)}
      <div class="phead-id"><h1>${esc(a.n)}</h1><p>${esc(a.pos || "")} · Former player: not in the latest snapshot (${fmtDate(D.dates.at(-1))})</p></div></div></div></section>
    <div class="wrap page player"><aside class="factbox card-box" aria-label="Player facts"><h2>Player facts</h2>${factList(facts)}</aside>
      <div class="pmain"><div class="panel"><p class="sub">He was last crawled on ${L.d ? fmtDate(L.d) : "an earlier snapshot"}${L.cl ? ` with ${tname(L.cl)}` : ""}. Since then he isn't on any roster,
        prospect or draft list the crawl reads (retired, unsigned, or playing in a league that isn't crawled), so there is no card, attribute history or projection.</p></div>
      ${careerPanel(a)}${warPanel}${achPanel}</div></div>`;
  drawCareer(a);
  view.querySelectorAll("#car-type button").forEach(b => b.onclick = () => { CTYPE = b.dataset.t; drawCareer(a); });
  if (!keepScroll) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- career stats
/* Season-by-season lines like an NHL stats site, from the player's History tab: one line per club he played for
   in each season of the save (EHM shows nothing from before it), in any league. A finished NHL stint whose History
   line stopped early is completed from the box scores (src "box", marked †). NHL lines add PP/SH points, GWG, TOI
   and shutouts from the team's Statistics tab. Totals per league once he has two lines in it. */
const CAR_TYPES = [["R", "Regular season"], ["P", "Playoffs"], ["O", "Preseason & other"]];
let CTYPE = "R";
const careerLines = p => ((byKey.get(p.k) || ALUMNI.get(p.k))?.car || []).map(r => Object.fromEntries((D.careerCols || []).map((c, i) => [c, r[i]])));
function careerPanel(p) {
  if (!D.careerCols) return `<div class="panel"><h2>Career statistics</h2><p class="sub">Rebuild the site data (<code>build_data.py</code>) to see season-by-season stats.</p></div>`;
  const lines = careerLines(p);
  if (!lines.length) return `<div class="panel"><h2>Career statistics</h2><p class="sub">No games on his History tab in any season of this save yet.</p></div>`;
  const types = CAR_TYPES.filter(([t]) => lines.some(l => l.type === t));
  return `<div class="panel" id="careerpanel">
    <div class="chart-head"><div><h2>Career statistics</h2>
      <p class="sub">Every club he played for in each season of this save, in any league, from his History tab (the current season is so far).
      ${p.grp === "G" ? "Shutouts come" : "PP, SH, GWG and TOI come"} from NHL team statistics, so other leagues show –.</p></div>
      <div class="seg" id="car-type">${types.map(([t, label]) => `<button type="button" data-t="${t}">${label}</button>`).join("")}</div>
    </div>
    <div class="tablewrap" id="car-table"></div></div>`;
}
/* Sum of a column, or null when any line lacks it (a partial total would understate). */
const carSum = (rows, k) => rows.every(r => r[k] != null) ? rows.reduce((s, r) => s + r[k], 0) : null;
function careerTotal(rows, label) {
  const t = { season: label, club: "", league: rows[0].league, total: true };
  ["gp", "g", "a", "p", "pm", "pim", "s", "ppg", "ppa", "shg", "sha", "gwg", "w", "l", "t", "min", "ga", "so"].forEach(k => (t[k] = carSum(rows, k)));
  t.toi = rows.every(r => r.toi != null) ? rows.reduce((s, r) => s + r.toi * r.gp, 0) / t.gp : null;
  t.avr = rows.every(r => r.avr != null) ? rows.reduce((s, r) => s + r.avr * r.gp, 0) / t.gp : null;
  t.gaa = t.min && t.ga != null ? t.ga * 60 / t.min : null;
  // shots against from each line's GA and SV%
  const sa = rows.every(r => r.ga != null && r.svp != null && r.svp < 1) ? rows.reduce((s, r) => s + r.ga / (1 - r.svp), 0) : null;
  t.svp = sa ? 1 - t.ga / sa : null;
  return t;
}
function drawCareer(p) {
  const box = view.querySelector("#car-table");
  if (!box) return;
  const lines = careerLines(p), isG = p.grp === "G";
  const btns = [...view.querySelectorAll("#car-type button")];
  if (!btns.some(b => b.dataset.t === CTYPE)) CTYPE = btns[0].dataset.t;
  btns.forEach(b => { const on = b.dataset.t === CTYPE; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  const rows = lines.filter(l => l.type === CTYPE);
  const leagues = [...new Set(rows.map(r => r.league || ""))];
  const totals = leagues.map(lg => rows.filter(r => (r.league || "") === lg)).filter(rs => rs.length > 1)
    .map(rs => careerTotal(rs, `${rs[0].league || "Other"} totals`));
  const known = new Set(D.players.map(clubOf));
  const team = r => r.total ? "" : r.club ? `${logo(r.club, 20)} ${known.has(r.club) ? `<a href="${teamRoute(r.club)}">${esc(r.club)}</a>` : esc(r.club)}` : dash;
  const BOX = "From this save's box scores: the History tab dropped this line when he changed clubs, after the last snapshot that showed it";
  const n = (v, d = 0) => v == null ? dash : fmt(v, d);
  const cols = isG
    ? [["GP", r => n(r.gp)], ["W", r => n(r.w)], ["L", r => n(r.l)], ["T/OT", r => n(r.t)], ["GA", r => n(r.ga)],
       ["GAA", r => n(r.gaa, 2)], ["SV%", r => r.svp == null ? dash : r.svp.toFixed(3).replace(/^0/, "")], ["SO", r => n(r.so)],
       ["MIN", r => r.min == null ? dash : Math.round(r.min).toLocaleString()], ["Av R", r => n(r.avr, 2)]]
    : [["GP", r => `${n(r.gp)}${r.src === "box" ? `<sup title="${BOX}">†</sup>` : ""}`], ["G", r => n(r.g)], ["A", r => n(r.a)], ["P", r => `<b>${n(r.p)}</b>`],
       ["+/-", r => r.pm == null ? dash : (r.pm > 0 ? "+" : "") + r.pm], ["PIM", r => n(r.pim)], ["PPG", r => n(r.ppg)],
       ["PPP", r => r.ppg == null || r.ppa == null ? dash : r.ppg + r.ppa], ["SHG", r => n(r.shg)],
       ["SHP", r => r.shg == null || r.sha == null ? dash : r.shg + r.sha], ["GWG", r => n(r.gwg)], ["S", r => n(r.s)],
       ["S%", r => r.s ? (100 * r.g / r.s).toFixed(1) : dash], ["TOI/GP", r => r.toi == null ? dash : rawFmt("toi_gp", r.toi)],
       ["Av R", r => n(r.avr, 2)]];
  const tips = { "Av R": "Average game rating", "T/OT": "Ties and overtime / shootout losses", PPP: "Power-play points",
                 SHP: "Short-handed points", GWG: "Game-winning goals", "TOI/GP": "Average time on ice per game" };
  const seasonCell = r => {
    if (r.total) return esc(r.season);
    const abbr = r.league === "NHL" && NHL_TEAMS[r.club] && abbrOf(r.club);
    return abbr && D.teamPlayers?.[r.season]?.[abbr]
      ? `<a href="${teamRoute(r.club)}/players/${r.season}/${encodeURIComponent(p.k)}" data-mode="${CTYPE === "P" ? "P" : "R"}" title="${esc(r.club)} player stats and team stats, ${seasonLabel(r.season)}">${seasonLabel(r.season)}</a>`
      : seasonLabel(r.season);
  };
  const row = r => `<tr class="${r.total ? "total" : ""}"><th scope="row" class="nowrap">${seasonCell(r)}</th>
    <td class="nowrap">${team(r)}</td><td>${r.total ? "" : esc(r.league || "")}</td>${cols.map(([, f]) => `<td class="num">${f(r)}</td>`).join("")}</tr>`;
  box.innerHTML = `<table class="career"><thead><tr><th>Season</th><th>Team</th><th>League</th>${cols.map(([h]) =>
    `<th class="num"${tips[h] ? ` title="${tips[h]}"` : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row).join("")}</tbody>${totals.length ? `<tfoot>${totals.map(row).join("")}</tfoot>` : ""}</table>
    ${rows.some(r => r.src === "box") ? `<p class="small muted">† ${BOX}; the box scores miss about 2% of games.</p>` : ""}
    <p class="small muted">Click an NHL season for that club's player and team stats that season.</p>`;
  box.querySelectorAll("a[data-mode]").forEach(x => x.addEventListener("click", () => { TPS.mode = x.dataset.mode; }));
}
