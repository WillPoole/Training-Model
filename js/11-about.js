"use strict";

// ---------------------------------------------------------------- backtest, history, roles (How it works)
function lineChart(series, xLabel, yLabel, opts = {}) {
  const W = 640, H = 240, m = { l: 44, r: 16, t: 12, b: 34 };
  const xs = series.flatMap(s => s.pts.map(q => q[0])), ys = series.flatMap(s => s.pts.map(q => q[1]));
  const x0 = opts.x0 ?? Math.min(...xs), x1 = opts.x1 ?? Math.max(...xs);
  const y0 = Math.floor(Math.min(...ys, opts.ymin ?? Infinity) * 2) / 2, y1 = Math.ceil(Math.max(...ys) * 2) / 2;
  const X = x => m.l + (x - x0) / Math.max(1e-9, x1 - x0) * (W - m.l - m.r), Y = y => m.t + (1 - (y - y0) / Math.max(1e-9, y1 - y0)) * (H - m.t - m.b);
  let g = "";
  const step = (y1 - y0) > 3 ? 1 : 0.5;
  for (let v = y0; v <= y1 + 1e-9; v += step)
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css("--grid")}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  [...new Set(xs)].sort((a, b) => a - b).forEach(x => (g += `<text x="${X(x)}" y="${H - m.b + 16}" text-anchor="middle">${opts.xfmt ? opts.xfmt(x) : x}</text>`));
  g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 2}" text-anchor="middle">${esc(xLabel)}</text>
        <text x="12" y="${(m.t + H - m.b) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(m.t + H - m.b) / 2})">${esc(yLabel)}</text>`;
  for (const s of series) {
    g += `<polyline points="${s.pts.map(q => `${X(q[0])},${Y(q[1])}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    g += s.pts.map(q => `<circle cx="${X(q[0])}" cy="${Y(q[1])}" r="4" fill="${s.color}" stroke="${css("--surface")}" stroke-width="2"><title>${esc(s.name)}: ${q[1]}</title></circle>`).join("");
  }
  return `<div class="legend">${series.map(s => `<span style="--c:${s.color}">${esc(s.name)}</span>`).join("")}</div>
    <svg class="chart lc" viewBox="0 0 ${W} ${H}" style="max-width:${W}px">${g}</svg>`;
}

function backtestSection() {
  const bt = D.backtest;
  if (!bt || !bt.pairs) return `<h3>Projection backtest</h3><p class="muted">Needs at least four training snapshots.</p>`;
  const cols = [css("--s1"), css("--s2"), "#1baf7a", "#6250d6"];
  // error by horizon: average over origins
  const byH = {};
  bt.pairs.forEach(r => { const h = Math.round(r.h); (byH[h] ||= []).push(r); });
  const hs = Object.keys(byH).map(Number).sort((a, b) => a - b);
  const avg = (arr, k) => +(arr.reduce((s, r) => s + r[k] * r.n, 0) / arr.reduce((s, r) => s + r.n, 0)).toFixed(2);
  const horizonChart = lineChart([
    { name: "Projection", color: cols[0], pts: hs.map(h => [h, avg(byH[h], "mae_proj")]) },
    { name: "No change (today's estimate held flat)", color: css("--muted"), pts: hs.map(h => [h, avg(byH[h], "mae_flat")]) },
  ], "Months ahead", "Mean error (CA points)");
  // improvement: same horizon, more snapshots used
  const bySnap = hs.filter(h => h <= 2).map((h, i) => ({ name: `${h} month${h > 1 ? "s" : ""} ahead`, color: cols[i + 1] || cols[0],
    pts: bt.pairs.filter(r => Math.round(r.h) === h).map(r => [r.n_snap, r.mae_proj]) })).filter(s => s.pts.length > 1);
  const hist = (D.history || []);
  const lh = D.longHorizon;
  const lhLine = lh ? `<p class="small">Training save: ${lh.span.toFixed(0)} months of labelled snapshots so far.
    ${lh.horizons.map(r => r.ready ? `<b>${r.months / 12}-year test: ready</b> (${r.origins} origins, ${r.young.toLocaleString()} players aged ${lh.ages[0]}–${lh.ages[1]})`
      : `${r.months / 12}-year test: ${r.origins} of ${lh.minOrigins} origins, ${r.young.toLocaleString()} of ${lh.minYoung.toLocaleString()} players aged ${lh.ages[0]}–${lh.ages[1]} (ready about ${fmtDate(r.readyAbout)} in game at the earliest)`).join("; ")}.</p>` : "";
  return `<h3>Projection backtest</h3>
  ${lhLine}
  <p>Walk-forward test on the training save: at each past snapshot every model (CA, PA, growth curve) is retrained using only
  the snapshots up to that date. Each player is estimated by models that never saw his own labels, as on the live league.
  The projection is then compared with his true CA at every later snapshot.
  Overall: <b>${bt.overall.mae_proj}</b> mean error vs <b>${bt.overall.mae_flat}</b> for "no change" (${bt.overall.n.toLocaleString()} projections).${bt.latest ? ` Run on the snapshots up to ${fmtDate(bt.latest)} (it only re-runs on a full model rebuild).` : ""}</p>
  ${horizonChart}
  ${bySnap.length ? `<p>Accuracy as snapshots accumulate: the same horizon, projected from later origins that had more snapshots to learn from.</p>
    ${lineChart(bySnap, "Snapshots available when projecting", "Mean error (CA points)")}` : ""}
  <div class="tablewrap"><table><thead><tr><th>From</th><th class="num">Snapshots used</th><th>To</th><th class="num">Months</th>
    <th class="num">Players</th><th class="num">Projection error</th><th class="num">No-change error</th><th class="num">Bias</th></tr></thead><tbody>
    ${bt.pairs.map(r => `<tr><td>${fmtDate(r.origin)}</td><td class="num">${r.n_snap}</td><td>${fmtDate(r.target)}</td><td class="num">${r.h.toFixed(1)}</td>
      <td class="num">${r.n.toLocaleString()}</td><td class="num"><b>${r.mae_proj}</b></td><td class="num">${r.mae_flat}</td>
      <td class="num ${Math.abs(r.bias) > 0.5 ? "down" : ""}">${r.bias > 0 ? "+" : ""}${r.bias}</td></tr>`).join("")}</tbody></table></div>
  <p>By age, ${bt.by_age_horizon} months ahead (bias below zero = the projection was too low):</p>
  <div class="tablewrap"><table><thead><tr><th>Age</th><th class="num">Players</th><th class="num">Projection error</th><th class="num">No-change error</th><th class="num">Bias</th></tr></thead><tbody>
    ${bt.by_age.map(r => `<tr><td>${esc(r.age_band)}</td><td class="num">${r.n.toLocaleString()}</td><td class="num"><b>${r.mae_proj}</b></td>
      <td class="num">${r.mae_flat}</td><td class="num ${Math.abs(r.bias) > 0.5 ? "down" : ""}">${r.bias > 0 ? "+" : ""}${r.bias}</td></tr>`).join("")}</tbody></table></div>
  <p class="small muted">Read it as: from about 23 onwards the projection beats "no change"; for teenagers it currently under-predicts growth,
  mostly because their PA estimate is pulled towards the average. Expect this to move as the save is simmed further.</p>
  ${bt.attrs ? `<h3>Attribute projection backtest</h3>
  <p>Same walk-forward test for the projected attributes (a quarter of the players, every attribute): mean error in attribute points (1–20 scale)
  vs assuming the attribute stays where it is. Overall <b>${bt.attrs_overall.mae_model}</b> vs ${bt.attrs_overall.mae_flat}
  (${bt.attrs_overall.n.toLocaleString()} attribute projections).</p>
  <div class="tablewrap"><table><thead><tr><th class="num">Months ahead</th><th class="num">Attribute values</th><th class="num">Projection error</th><th class="num">No-change error</th></tr></thead><tbody>
  ${bt.attrs.map(r => `<tr><td class="num">${r.h}</td><td class="num">${r.n.toLocaleString()}</td><td class="num"><b>${r.mae_model}</b></td><td class="num">${r.mae_flat}</td></tr>`).join("")}
  </tbody></table></div>` : ""}
  <h3>Model history</h3>
  <p>One row per build, keyed by the latest training snapshot and the model (rebuilding the same snapshot replaces its row).</p>
  <div class="tablewrap"><table><thead><tr><th>Latest snapshot</th><th>Model</th><th class="num">Snapshots</th><th class="num">CA error</th><th class="num">PA error</th>
    <th class="num">PA error (16–18)</th><th class="num">Backtest error</th><th class="num">No-change</th></tr></thead><tbody>
    ${hist.map(h => `<tr><td>${fmtDate(h.latest)}</td><td>${h.model === "accurate" ? "Accurate" : "Fast"}</td><td class="num">${h.snapshots}</td><td class="num">${h.ca_mae}</td><td class="num">${h.pa_mae}</td>
      <td class="num">${h.pa_mae_young ?? "–"}</td><td class="num">${h.bt_mae ?? "–"}</td><td class="num">${h.bt_flat ?? "–"}</td></tr>`).join("")}</tbody></table></div>
  ${hist.length > 1 ? lineChart([
    { name: "CA error", color: cols[0], pts: hist.filter(h => h.model !== "accurate").map(h => [h.snapshots, h.ca_mae]) },
    { name: "PA error", color: cols[1], pts: hist.filter(h => h.model !== "accurate").map(h => [h.snapshots, h.pa_mae]) },
  ], "Training snapshots", "Mean error") : `<p class="small muted">The chart appears after the next build with a new snapshot.</p>`}`;
}

function rolesSection() {
  const R = D.roles || { rows: [] };
  return `<h3>Player roles</h3>
  <p>The preferred role ("Finesse Winger", "Defensive Center", ...) is shown on the Scout Report tab, so it's only known for players with a report.
  For each role: average WAR per 82 games, and how far that is above or below what the players' estimated CA predicts
  (positive = the role gets more out of the same ability).</p>
  ${R.rows.length ? `<div class="tablewrap"><table><thead><tr><th>Position</th><th>Preferred role</th><th class="num">NHL players</th><th class="num">Avg est. CA</th>
    <th class="num">WAR/82</th><th class="num">vs expected</th><th class="num">± (1 SE)</th></tr></thead><tbody>
    ${R.rows.map(r => `<tr class="${r.enough ? "" : "muted"}"><td>${r.grp}</td><td>${esc(r.role)}</td><td class="num">${r.n}</td><td class="num">${r.ca}</td>
      <td class="num">${r.war82}</td><td class="num ${r.enough && r.vs_expected > 0 ? "up" : r.enough && r.vs_expected < 0 ? "down" : ""}">${r.vs_expected == null ? "–" : (r.vs_expected > 0 ? "+" : "") + r.vs_expected}</td>
      <td class="num">${r.se ?? "–"}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted">${R.rated} rated NHL players have a known role. Greyed rows have fewer than ${R.min_players} players and aren't used anywhere yet.</p>`
    : `<p class="muted">No roles yet: run the crawler with <code>--scout</code>.</p>`}`;
}

function extraInputsSection() {
  const sg = D.report.scout_gain, ng = D.report.nhl_rank_gain;
  const row = (label, r, extra = "") => r ? `<tr><td>${label}</td><td class="num">${r.without}</td><td class="num"><b>${r.with}</b></td>
    <td class="num ${r.with < r.without ? "up" : "down"}">${r.with < r.without ? "−" : "+"}${Math.abs(r.with - r.without).toFixed(2)}</td><td class="small muted">${extra}</td></tr>` : "";
  return `<h3>Do the scout report and NHL rankings help?</h3>
  <p>Each extra input is tested on exactly the players who have it, across every labelled snapshot, with the same
  player-grouped folds with and without it.</p>
  <div class="tablewrap"><table><thead><tr><th>Input</th><th class="num">Error without</th><th class="num">Error with</th><th class="num">Change</th><th></th></tr></thead><tbody>
    ${sg ? row(`Scout report → CA (${sg.players.toLocaleString()} players)`, sg.ca) + row("Scout report → PA", sg.pa,
      `stars match round(ability/40): current ${sg.sc_cur_exact != null ? (sg.sc_cur_exact * 100).toFixed(0) + "%" : "–"}, future ${sg.sc_fut_exact != null ? (sg.sc_fut_exact * 100).toFixed(0) + "%" : "–"}`) : ""}
    ${ng ? row(`NHL ranking history → PA (${ng.rows.toLocaleString()} rows, ${ng.players.toLocaleString()} players)`, ng.pa,
      `movement alone: ${ng.pa.without_move_only} without it`) + row("NHL ranking history → CA", ng.ca) : ""}
  </tbody></table></div>
  ${!sg ? `<p class="small muted">Scout test needs a training snapshot taken with --scout (at least 200 reports).</p>` : ""}
  <p class="small muted">Scout inputs used: ${(D.report.scout_columns || []).length} (stars, talent tier from the career role,
  points projection, and the midpoint of every hidden-value range at least 30 reports mention).</p>`;
}

function predictorsSection() {
  const P = D.predict || {}, h = P.h2h, pk = P.picks, cw = P.carWar;
  const pc = v => v == null ? "–" : (100 * v).toFixed(1) + "%";
  return `<h3>Head to head</h3>
  ${h ? `<p>A logistic regression of a home win (overtime and shootouts included; a shootout's winner is read from the "SO" result,
  because the box score keeps the tied score) on the home-minus-away difference in the top-6 forwards' and top-4 defence's average
  est. CA, the starting goalie's est. CA (each as known at the snapshot before the game) and home ice. Once both teams have played
  ${h.standings_min_gp}+ games of a season, their win rate and goal difference per game so far are added. Fitted on
  ${h.games.toLocaleString()} games (${h.seasons.map(seasonLabel).join(", ")}).</p>
  <p>Walk-forward test: every month predicted using only earlier games (${h.tested.toLocaleString()} games).</p>
  <div class="tablewrap"><table><thead><tr><th>Model</th><th class="num">Picked the winner</th><th class="num">Log loss</th><th class="num">Brier</th></tr></thead><tbody>
    ${[["home", "Home team every time"], ["standings", "Standings so far"], ["lineup", "Lineups"], ["full", "Lineups + standings"]].map(([k, t]) =>
      `<tr><td>${t}</td><td class="num">${pc(h.results[k].accuracy)}</td><td class="num">${h.results[k].log_loss}</td><td class="num">${h.results[k].brier}</td></tr>`).join("")}
  </tbody></table></div>
  <p class="small muted">Calibration: ${h.bands.map(b => `favourites at ${Math.round(100 * b.lo)}${b.hi > 1 ? "%+" : "–" + Math.round(100 * b.hi) + "%"} won ${pc(b.won)} (${b.n} games)`).join("; ")}.
  Est. CA comes from the final CA model, which saw these players' labels in training (its error is small, 3-4 points).</p>` : `<p class="muted">Needs at least 200 games with box-score lineups.</p>`}

  <h3>Draft-pick value</h3>
  ${pk ? `<p>A pick is worth the NHL WAR the player taken at that slot is expected to produce. Every draft slot had exactly one player;
  one who isn't in the data, or didn't play in the NHL, counts as 0 WAR. Expected WAR per season = A(seasons since the draft) × f(slot),
  with f smooth and strictly decreasing, so an earlier pick is always worth more (unsmoothed slot averages rise from one pick to the next
  ${pk.validation.raw_rises} times out of 223). In trades a pick is valued on ${P.prime5.length} seasons of his prime
  (${P.prime5[0]}–${P.prime5.at(-1)} seasons after the draft), the same length as the players' 5-season window.</p>
  <p>From ${pk.seasons.map(seasonLabel).join(", ")}, draft classes ${pk.draft_years[0]}–${pk.draft_years[1]}. Leaving one draft year out at a time
  (${pk.validation.years_tested} tests): error <b>${pk.validation.model}</b> WAR per pick vs ${pk.validation.flat} for giving every pick the average value.
  The slot shape is chosen by that same test at every build: ${Object.entries(pk.method_errors || {}).map(([m, e]) => `${m.startsWith("flex") ? `flexible shape smoothed over ${m.slice(4)} picks` : "3-parameter curve"} ${e}`).join(", ")}
  (using the ${pk.method.startsWith("flex") ? `flexible shape smoothed over ${pk.method.slice(4)} picks` : "3-parameter curve"}).
  Round averages over 5 prime seasons: ${pk.rounds.map((v, i) => `R${i + 1} ${v}`).join(", ")}.</p>${borrowed(pk)}` : `<p class="muted">Needs a complete NHL season.</p>`}

  <h3>Expected WAR from ability</h3>
  ${cw ? `<p>Season WAR by pre-season est. CA (the snapshot before the season's first game), per forwards, defence and goalies; players who
  didn't play in the NHL count as 0. A smoothed curve that never falls as CA rises, pooled over ${cw.seasons.map(seasonLabel).join(", ")}.
  Used for the trade predictor's "this season" and 5-season values (5 seasons = the curve at each future season's projected CA).</p>
  <div class="tablewrap"><table><thead><tr><th>Group</th><th class="num">Players</th><th class="num">In the NHL</th><th class="num">Curve error</th><th class="num">Straight line</th><th class="num">Constant</th><th class="num">Error, NHL players only</th></tr></thead><tbody>
    ${Object.entries(cw.validation).map(([g, v]) => `<tr><td>${{ F: "Forwards", D: "Defence", G: "Goalies" }[g]}</td><td class="num">${v.n.toLocaleString()}</td><td class="num">${v.nhl}</td>
      <td class="num"><b>${v.curve}</b></td><td class="num">${v.line}</td><td class="num">${v.constant}</td><td class="num">${v.nhl_only.curve} <span class="muted">(vs ${v.nhl_only.constant})</span></td></tr>`).join("")}
  </tbody></table></div>
  <p class="small muted">5-fold cross-validation, mean absolute error in WAR per season. Most players never reach the NHL, so the overall error looks small;
  the last column is the honest one for NHL regulars. Multi-season projections can only be checked once more seasons are simmed.</p>${borrowed(cw)}` : `<p class="muted">Needs a complete NHL season.</p>`}

  <h3>Own record vs ability</h3>
  ${P.blend ? `<p>A player's expected WAR blends his own record with what his ability predicts:
  <code>(GP × own WAR pace + K × ability curve) / (GP + K)</code>, so the more NHL games he has, the more his own results count.
  K = <b>${P.blend.K}</b> games, fitted by predicting each player's WAR pace in the next season from everything before it
  (${P.blend.players.toLocaleString()} player-seasons with ${P.blend.min_gp}+ GP in ${P.blend.seasons.map(seasonLabel).join(", ")}, weighted by games).
  Error in WAR per ${P.blend.season_gp} GP: blend <b>${P.blend.validation.blend}</b>, ability only ${P.blend.validation.ability_only},
  own record only ${P.blend.validation.own_only}. The trade predictor uses it for "this season" and carries the same pull into the 5-season value.</p>${borrowed(P.blend)}`
    : `<p class="muted">Needs a season with games after a complete one.</p>`}
  ${pickCheck(pk)}

  <h3>Team stats</h3>
  <p>From the de-duplicated box scores of each season. Points: 2 for a win, 1 for an overtime or shootout loss. xG from the shot charts
  (only games with one). Ranks are out of every team with games; 1st is best (fewest for goals and shots against, giveaways and penalty minutes).</p>`;
}

/* #/about[/<section slug>]: every h3 is a section with its own URL (the Contents list links to them). */
const slug = t => fold(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function renderAbout(section) {
  markNav("about");
  const r = D.report, g = D.growth, G0 = seasonInfo().games || {};
  const bandRows = Object.entries(r.pa_by_age).map(([k, s]) =>
    `<tr><td>${k}</td><td class="num">${s.mae}</td><td class="num">${s.p90}</td><td class="num">${s.r2}</td>
     <td class="num">${r.pa_band_by_age[k][0]} / +${r.pa_band_by_age[k][1]}</td></tr>`).join("");
  view.innerHTML = `<div class="panel about">

  <h3>Estimated CA and PA</h3>
  <p>EHM never sends current or potential ability to a client, so both are <b>estimated from what a client can see</b>:
  every profile attribute, position, age, height/weight, league, Top-Prospect rank and draft ranking, plus how fast the
  attributes have moved over the last 1-12 months. The models are trained on the hosted training save, where the true
  CA/PA can be read for scoring. The true values are never inputs and never shown here.</p>
  <p><b>This build used the ${esc(r.model_label || "fast model: gradient-boosted trees on the CPU")}.</b>
  Regular builds use the fast model; the accurate one is a separate, much slower build
  (${D.siteKey ? "Build SHA Website - Accurate (GPU).bat" : "Build Website - Accurate (GPU).bat"}): in the benchmark it cut the CA error from 3.29 to 2.51 and the PA error from 8.91 to 8.28.</p>
  <div class="tablewrap"><table><thead><tr><th>Model</th><th class="num">Mean error</th><th class="num">90% within</th><th class="num">R²</th></tr></thead><tbody>
    <tr><td>Current ability</td><td class="num">${r.ca.mae}</td><td class="num">${r.ca.p90}</td><td class="num">${r.ca.r2}</td></tr>
    <tr><td>Potential ability</td><td class="num">${r.pa.mae}</td><td class="num">${r.pa.p90}</td><td class="num">${r.pa.r2}</td></tr>
  </tbody></table></div>
  <p class="small muted">Cross-validated by player (5 folds, ${r.rows.toLocaleString()} player-snapshots, ${r.players.toLocaleString()} players).
  Stars ≈ round(ability / 40), the calibration from the Scout Report.</p>
  <p>PA is much harder to guess for teenagers than for veterans. The "likely" PA range on each card is the 10th–90th
  percentile of the model's error for that age group:</p>
  <div class="tablewrap"><table><thead><tr><th>Age</th><th class="num">Mean error</th><th class="num">90% within</th><th class="num">R²</th><th class="num">Range used</th></tr></thead><tbody>${bandRows}</tbody></table></div>

  ${extraInputsSection()}

  <h3>Projection</h3>
  <p>Fitted on ${g.pairs.toLocaleString()} consecutive-snapshot pairs of true CA in the training save:
  <code>monthly change = a(age) × (PA − CA) + b(age)</code>. The first term is growth towards potential, the second
  the age effect (positive in the early-to-mid 20s, increasingly negative into the 30s). There is no hard cut-off age.
  Goalies get their own curve (they decline more slowly in their 30s), blended towards the all-player curve because only
  ${(g.goalie_pairs || 0).toLocaleString()} of the pairs are goalies. Ages with fewer than ${g.min_n || 300} observations borrow the nearest well-sampled age.
  The gap is the <i>estimated</i> PA − CA, the same numbers the projection starts from, so the curve allows for the
  PA estimate being shrunk towards the average (fitting on the true gap under-projected teenagers).
  ${g.near_months ? `The first ${g.near_months} months come from separate forecast models, fitted on
  ${g.near_pairs.toLocaleString()} snapshot pairs: true CA after <i>h</i> months minus today's estimate, from far more than
  the estimate (the whole attribute profile and how each attribute moved over the last 1-12 months, the est-CA trend,
  status, contract, season line, role and the calendar). They learn where the CA estimate runs low or high and how much
  of a trend carries on; the curve continues from where they end. The same models forecast each attribute's change up to
  12 months ahead (Projected attributes on each player).` : ""}
  ${D.longModel ? `After them, out to ${D.longModel.hmax} months, a long-range model takes over: true CA <i>h</i> months
  later minus today's estimate, from the estimates, age and position, fitted on ${D.longModel.pairs.toLocaleString()}
  snapshot pairs up to ${D.longModel.hmax} months apart (the forecast path blends into it over a year). Tested on players it
  never saw (5 player folds), it cut the error of 3-year projections at ages 24-29 from 8.0 to 5.8 and at 30+ from 8.8 to
  6.5, and took away the curve's biases. The curve above only continues past ${D.longModel.hmax} months.
  The 80% band is that model's 10th–90th percentile (it covered 76–78% of real outcomes at every age, where the old band
  covered about half at 0-6 months); past it, the PA range above plus the month-to-month noise of real growth.` :
  "The 80% band uses the PA range above plus the month-to-month noise of real growth."}</p>
  <p class="small muted">Caveat: the snapshots so far run from ${fmtDate(D.dates[0])} to ${fmtDate(D.dates.at(-1))}.
  Months not covered yet (especially the off-season) aren't in the fit, and long-range projections can't be checked against reality
  until the save has been simmed that far. The curve will sharpen as more snapshots arrive; just rebuild.</p>

  <h3>JFresh-style stats (NHL)</h3>
  <p>${G0.games ? `From ${G0.games} de-duplicated NHL box scores (${fmtDate(G0.first)} – ${fmtDate(G0.last)}),
  ${G0.xg_games} of them with shot charts for expected goals.` : "No NHL box scores in this data yet: these stats appear once a snapshot is taken with <code>--games</code>."}
  Every number is a percentile within the player's position group (forwards / defence with ≥${D.minToi} minutes; goalies ≥300).</p>
  <ul>
    <li><b>Offence</b>: individual xG/60, points/60 and shots on goal/60.</li>
    <li><b>Playmaking</b>: primary assists/60 (from the goal log; assists are matched by surname within the scorer's team).</li>
    <li><b>Finishing</b>: goals minus individual xG, per 60 (xG model from shot location, type and rebound; AUC 0.73).</li>
    <li><b>Defence</b>: +/− per 60 and PK time. EHM exposes no on-ice data, so this is the weakest component.</li>
    <li><b>Usage</b>: TOI/game (double weight), PP and PK TOI/game.</li>
    <li><b>Discipline</b>: penalty minutes per 60, inverted.</li>
    <li><b>Overall impact</b>: 40% offence, 15% each finishing / playmaking / defence, 10% usage, 5% discipline.</li>
    <li><b>Goalies</b>: official save percentage leads and sets the Impact percentile: tested on the training save, it repeats best from one season to the next. GAA also follows how many shots the team allows. GSAx = pre-shot xG of the charted shots he faced minus goals allowed, empty nets left out, as a second opinion on shot difficulty; per shot it is steadier than charted SV%, but it covers fewer games. On SHA, the games to January 10 2027 come from a site backup, so they lack shots labelled as blocked and still hold empty-net goals.</li>
  </ul>
  <p><b>Attribute profile</b> bars average groups of the 1–20 attributes and rank them against every player at the same position group.</p>

  ${D.warInfo && D.warInfo.goals_per_win ? `<h3>WAR (wins above replacement)</h3>
  <p>Goals above a replacement-level player, converted to wins. A replacement player is anyone outside each team's
  top 13 forwards / 7 defence (top 2 goalies) by ice time; their pooled rates are the zero line.
  ${D.warInfo.goals_per_win} goals = 1 win (twice the league's ${(D.warInfo.goals_per_win / 2).toFixed(2)} goals per team-game,
  from a Pythagorean win expectation).</p>
  ${D.warInfo.version === "v2" ? `<p>Each part below is then weighted by what it turned out to be worth in games: on ${"7,157"} games of the
  training save, rating players on other games and predicting each game's goal difference from who dressed
  (${Object.entries(D.warInfo.weights || {}).map(([k, v]) => `${k} ${v}`).join(", ")}; 1 = full credit). A low weight mostly means a part
  is noisy or overlaps with others, not that it doesn't matter. WAR/82 is a pace with ${D.warInfo.war82_shrink_gp} games of the position
  average mixed in, so a player with a handful of games doesn't top the list; WAR itself is what he did.</p>` : ""}
  <ul>
    <li><b>Shot generation</b>: individual xG per 60 minus replacement, times ice time.</li>
    <li><b>Finishing</b>: goals minus xG, shrunk towards zero (shots / (shots + ${D.warInfo.finishing_shrink})) because it's partly luck over a small sample.</li>
    <li><b>Playmaking</b>: primary assists earn ${D.warInfo.a1_credit} of a goal, secondary ${D.warInfo.a2_credit}. The scorer keeps the rest
      (${(D.warInfo.scorer_share * 100).toFixed(0)}% of an average goal), so every goal is credited exactly once.</li>
    <li><b>Defence</b>: ${D.warInfo.defence?.obs == null ? "not fitted in this build, which has no shot data, so it counts as 0 here. Normally: " : ""}a ridge regression over ${D.warInfo.defence?.obs == null ? "" : D.warInfo.defence.obs.toLocaleString() + " "}team-games of the xG the opponent generated on
      ${D.warInfo.version === "v2" ? "<i>all</i> shots, blocked ones too" : "<i>unblocked</i> shots (so blocking shots counts)"}, using each skater's ice time in that game. It also accounts for the opponent and how many
      power plays they had. Players are pulled towards what ${D.warInfo.version === "v2" ? "their average game rating" : "their defensive attributes"} predict${D.warInfo.version === "v2" ? "s" : ""}
      ${D.warInfo.defence?.attr_slope == null ? "" : `(${D.warInfo.defence.attr_slope} xGA/60 per standard deviation)`}. EHM has no on-ice data, so treat it as a rough estimate.</li>
    <li><b>Penalties</b>: ${D.warInfo.version === "v2" ? "the power plays his penalties gave (each game's PIM: a minor 1, a double minor 2; fighting majors and misconducts give none)" : "minors taken (PIM / 2)"} × ${D.warInfo.pp_goal_value} goals per power play. Penalties drawn aren't recorded anywhere a client can see.</li>
    <li><b>Goalies</b>: goals saved above expected (pre-shot xG of the charted shots he faced minus goals allowed, empty nets left out)${D.warInfo.replacement?.G?.baseline === "average"
      ? ", compared with the league's average goalie on the same shots, so goalie WAR averages 0 and a goalie reads as better or worse than average. Skaters stay above replacement, so a team's WAR adds skaters above replacement and goalies above average. In two-goalie games each shot is shared by minutes."
      : " minus what a replacement goalie saves on the same shots. Replacement is the league's backups, the goalies ranked just behind one starter per team by minutes."} WAR/82 counts games he actually played.</li>
  </ul>` : ""}

  ${D.gms ? `<h3>GM ranking</h3>
  <p>Who ran each club is read off the game's GM Status screen each time the crawler logs in (first ${fmtDate(D.gms.firstRead)}, latest ${fmtDate(D.gms.asOf)}).
  The GM seen at a club's first reading is assumed to have run it since ${fmtDate(D.gms.first)}, the first snapshot; known changes go in
  <code>gm_overrides.csv</code>. A club's trades, picks, results and lineup strength count for the GM in charge on that date.</p>
  <ul>${GM_PARTS.map(([, label, tip]) => `<li><b>${label}</b>: ${esc(tip)}.</li>`).join("")}</ul>
  <p>The <a href="#/gms">GM score</a> is the weighted mean of each part's z-score across GMs (${Object.entries(D.gms.weights).map(([k, v]) => `${GM_PARTS.find(x => x[0] === k)?.[1] || k} ${v}`).join(", ")};
  a part with no data yet drops out), shown as 50 + 10 × that mean. The parts reward GMs who have been in charge longer: they are totals, not rates.</p>` : ""}

  <h3>Shot maps</h3>
  <p>Every shot on the box-score shot chart has a rink position and a target on the net. Away-team charts are rotated so every shot
  attacks the net at the top of the rink drawing. Heatmaps are smoothed (4 ft on the rink); orange dots are goals.
  "Effectiveness" compares goals with xG per zone, shrunk towards zero for zones with few shots. The net is drawn from the shooter's view:
  the opening runs post to post and crossbar to ice, and saves can land just outside it (the goalie's body).</p>

  <h3>Data checks</h3>
  <p>Every snapshot re-reads the previous month, so the same games show up in several files. Each table is
  de-duplicated before anything is counted, and the growth model skips snapshot pairs with no sim between them.</p>
  <div class="tablewrap"><table><thead><tr><th>Check</th><th>Result</th><th class="num">Duplicates removed</th></tr></thead><tbody>
    ${(D.audit || []).map(a => `<tr><td>${esc(a.check)}</td><td style="white-space:normal">${esc(a.detail)}</td><td class="num">${a.removed ? a.removed.toLocaleString() : "·"}</td></tr>`).join("")}
  </tbody></table></div>

  ${backtestSection()}

  ${rolesSection()}

  ${predictorsSection()}

  <h3>Updating</h3>
  ${D.siteKey ? `<p>Take SHA Snapshot.bat crawls the league and builds this site; to rebuild without crawling, run <code>Build SHA Website.bat</code>
  in the SHA_Website folder, then refresh the page. Publish SHA Website.bat copies it for the public site.</p>`
  : `<p>After a new snapshot run <code>Build Website.bat</code> (or <code>python build_data.py</code>), then refresh the page.
  For league data: <code>python build_data.py --data "../player data"</code>.</p>`}
  </div>`;
  // sticky table of contents: each section is a route of its own (#/about/<slug>), so it can be linked to
  {
    const panel = view.querySelector(".about"), hs = [...panel.querySelectorAll("h3")];
    hs.forEach(h => (h.id = "ab-" + slug(h.textContent)));
    view.innerHTML = `<section class="band"><div class="wrap"><h1>How it works</h1>
      <p class="lede">The models behind every estimate on this site, how accurate they are, and the data checks. Built ${esc(D.built)} from ${D.dates.length} snapshots
        (${fmtDate(D.dates[0])} to ${fmtDate(D.dates.at(-1))}).</p></div></section>
      <div class="about-wrap"><nav class="toc" aria-label="Contents"><b>Contents</b>${hs.map(h =>
      `<a href="#/about/${slug(h.textContent)}" class="${section === slug(h.textContent) ? "on" : ""}">${esc(h.textContent)}</a>`).join("")}</nav></div>`;
    view.querySelector(".about-wrap").append(panel);
    const target = section && view.querySelector("#ab-" + CSS.escape(section));
    if (target) { keepScroll = true; requestAnimationFrame(() => target.scrollIntoView()); }
  }
}
