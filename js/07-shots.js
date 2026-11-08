"use strict";

// ---------------------------------------------------------------- shot maps
/* Shot rows: [fx, fy, nx, ny, outcome, xg*1000]. fx = feet out from the attacked goal line,
   fy = feet from the middle (negative = attacker's left). nx/ny = 0..1 across the net opening
   (shooter's view) and crossbar (0) to ice (1). Outcome 0 save, 1 goal, 2 block, 3 miss. */
const ZONES = [
  ["Behind net", -11, 0, -42.5, 42.5], ["Crease", 0, 10, -12, 12], ["Low slot", 10, 25, -12, 12],
  ["High slot", 25, 45, -12, 12], ["Left circle", 0, 45, -42.5, -12], ["Right circle", 0, 45, 12, 42.5],
  ["Left point", 45, 64, -42.5, -12], ["Centre point", 45, 64, -12, 12], ["Right point", 45, 64, 12, 42.5],
  ["Long range", 64, 200, -42.5, 42.5],
];
function zoneOf(fx, fy) {
  for (const z of ZONES) if (fx >= z[1] && fx < z[2] && fy >= z[3] && fy < z[4]) return z[0];
  return fx < 0 ? "Behind net" : "Long range";
}
const NET_ZONES = [["High", 0, 1 / 3], ["Middle", 1 / 3, 2 / 3], ["Low", 2 / 3, 1.0001]];
const NET_COLS = [["left", 0, 1 / 3], ["centre", 1 / 3, 2 / 3], ["right", 2 / 3, 1.0001]];
let LEAGUE_ZONES = null;
function leagueZones() {
  if (LEAGUE_ZONES) return LEAGUE_ZONES;
  const z = {};
  for (const p of D.players) for (const s of p.shots || []) {
    const k = zoneOf(s[0], s[1]);
    const t = (z[k] ||= { n: 0, g: 0, xg: 0 });
    t.n++; t.g += s[4] === 1; t.xg += s[5] / 1000;
  }
  return (LEAGUE_ZONES = z);
}
function zoneStats(rows) {
  const z = {};
  for (const s of rows) {
    const t = (z[zoneOf(s[0], s[1])] ||= { n: 0, g: 0, xg: 0 });
    t.n++; t.g += s[4] === 1; t.xg += s[5] / 1000;
  }
  return z;
}
const SEQ_LIGHT = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
// more = stronger contrast with the page: dark blue on a light page, light blue on a dark one
const seqScale = () => (isDark() ? SEQ_LIGHT.slice().reverse() : SEQ_LIGHT);
function seqColor(t, SEQ = seqScale()) {
  const i = Math.min(SEQ.length - 1.001, Math.max(0, t) * (SEQ.length - 1));
  return `rgb(${mix(hexToRgb(SEQ[Math.floor(i)]), hexToRgb(SEQ[Math.floor(i) + 1]), i % 1)})`;
}
/* Gaussian kernel density on a grid. pts = [[u, v, weight]]; returns {cells, max}. */
function kde(pts, u0, u1, v0, v1, step, su, sv) {
  const nu = Math.ceil((u1 - u0) / step), nv = Math.ceil((v1 - v0) / step);
  const grid = new Float32Array(nu * nv);
  for (const [u, v, w] of pts) {
    const iu0 = Math.max(0, Math.floor((u - 3 * su - u0) / step)), iu1 = Math.min(nu - 1, Math.ceil((u + 3 * su - u0) / step));
    const iv0 = Math.max(0, Math.floor((v - 3 * sv - v0) / step)), iv1 = Math.min(nv - 1, Math.ceil((v + 3 * sv - v0) / step));
    for (let i = iu0; i <= iu1; i++) for (let j = iv0; j <= iv1; j++) {
      const du = (u0 + (i + 0.5) * step - u) / su, dv = (v0 + (j + 0.5) * step - v) / sv;
      grid[i * nv + j] += w * Math.exp(-0.5 * (du * du + dv * dv));
    }
  }
  let max = 0;
  for (const x of grid) if (x > max) max = x;
  return { grid, nu, nv, max };
}
function heatRects(k, u0, v0, step, toX, toY, cellW, cellH) {
  if (!k.max) return "";
  let out = "";
  const seq = seqScale();   // once per map, not per cell (it reads the theme)
  for (let i = 0; i < k.nu; i++) for (let j = 0; j < k.nv; j++) {
    const t = k.grid[i * k.nv + j] / k.max;
    if (t < 0.06) continue;
    out += `<rect x="${toX(u0 + i * step).toFixed(1)}" y="${toY(v0 + j * step).toFixed(1)}" width="${cellW + 0.6}" height="${cellH + 0.6}" fill="${seqColor(t, seq)}" fill-opacity="${(0.25 + 0.7 * t).toFixed(2)}"/>`;
  }
  return out;
}

function shotPanel(p) {
  const isG = p.grp === "G";
  const rows = isG ? p.sa : p.shots;
  if (!rows || !rows.length) return `<div class="panel"><h2>Shot maps</h2><p class="sub">${(p._po ? seasonInfo().gamesPO : seasonInfo().games)?.xg_games
    ? `No charted NHL ${p._po ? "playoff " : ""}shots for this player in the selected season.` : "No NHL box scores with shot charts in this data for the selected season."}</p></div>`;
  const modes = isG ? [["shots", "Shots against"], ["goals", "Goals against"], ["eff", "Saves vs expected"]]
                    : [["shots", "Shots taken"], ["goals", "Goals scored"], ["eff", "Effectiveness by zone"]];
  return `<div class="panel" id="shotpanel">
    <div class="chart-head">
      <div><h2>Shot maps</h2>
        <p class="sub">${isG ? "Every charted unblocked shot he faced while in net" : "Every charted shot attempt of his"} in his
          ${p.card?.totals?.xg_gp ?? "–"} NHL ${p._po ? "playoff" : "regular-season"} games with a shot chart
          (${(p._po ? seasonInfo().gamesPO?.xg_games : seasonInfo().games?.xg_games) || 0} league games have one).
          EHM's charts show about 3 in 4 shots on goal, so counts run lower than the box score; locations and rates are what matter.
          The rink is drawn attacking the net at the top; the net is seen from the shooter.</p></div>
      <div class="seg" role="group" aria-label="Shot map">${modes.map(([k, t], i) => `<button type="button" data-m="${k}" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
    </div>
    <p class="headline" id="shot-headline"></p>
    <div class="maps">
      <figure><div id="rinkmap"></div><figcaption id="rink-cap"></figcaption></figure>
      <figure><div id="netmap"></div><figcaption id="net-cap"></figcaption></figure>
    </div>
    <div class="legend" id="shot-legend"></div>
    <details><summary>Zone table</summary><div class="tablewrap" id="zone-table"></div></details>
  </div>`;
}

function initShotMaps(p) {
  const panel = view.querySelector("#shotpanel");
  if (!panel) return;
  const draw = m => {
    panel.querySelectorAll(".seg button").forEach(b => b.classList.toggle("on", b.dataset.m === m));
    drawShotMaps(p, m);
  };
  panel.querySelectorAll(".seg button").forEach(b => b.onclick = () => draw(b.dataset.m));
  draw("shots");
}

function rinkSVG(inner, k) {
  const W = 85 * k, H = 81 * k, X = fy => (fy + 42.5) * k, Y = fx => (fx + 11) * k;
  const line = css("--axis"), red = css("--neg"), blue = css("--s1");
  const r = 28 * k, gx = (28 - Math.sqrt(28 * 28 - 17 * 17)) * k;
  const outline = `M0,${H} L0,${r} A${r},${r} 0 0 1 ${r},0 L${W - r},0 A${r},${r} 0 0 1 ${W},${r} L${W},${H} Z`;
  const circle = fy => `<circle cx="${X(fy)}" cy="${Y(20)}" r="${15 * k}" fill="none" stroke="${red}" stroke-opacity=".45"/>
    <circle cx="${X(fy)}" cy="${Y(20)}" r="${1 * k}" fill="${red}" fill-opacity=".6"/>`;
  return `<svg class="rink" viewBox="-2 -2 ${W + 4} ${H + 4}" role="img" aria-label="Offensive-zone shot map">
    <defs><clipPath id="rinkclip"><path d="${outline}"/></clipPath></defs>
    <path d="${outline}" fill="${css("--surface")}" stroke="none"/>
    <g clip-path="url(#rinkclip)">${inner}
      <line x1="${gx}" x2="${W - gx}" y1="${Y(0)}" y2="${Y(0)}" stroke="${red}" stroke-opacity=".6" stroke-width="2"/>
      <rect x="0" y="${Y(64)}" width="${W}" height="${1 * k}" fill="${blue}" fill-opacity=".45"/>
      <path d="M${X(-6)},${Y(0)} A${6 * k},${6 * k} 0 0 0 ${X(6)},${Y(0)}" fill="${blue}" fill-opacity=".12" stroke="${red}" stroke-opacity=".5"/>
      <rect x="${X(-3)}" y="${Y(-3.3)}" width="${6 * k}" height="${3.3 * k}" fill="none" stroke="${line}" stroke-width="2"/>
      ${circle(-22)}${circle(22)}
    </g>
    <path d="${outline}" fill="none" stroke="${line}" stroke-width="2"/>
  </svg>`;
}

function drawShotMaps(p, mode) {
  const isG = p.grp === "G";
  const rows = (isG ? p.sa : p.shots) || [];
  const k = 6, X = fy => (fy + 42.5) * k, Y = fx => (fx + 11) * k;
  const goals = rows.filter(s => s[4] === 1);
  const zs = zoneStats(rows), lz = leagueZones();
  const s2 = css("--s2");
  let inner = "", legend = "";

  if (mode === "eff") {
    // Per zone: goals vs expected, shrunk towards zero for small samples.
    for (const [name, a, b, c, d] of ZONES) {
      const z = zs[name];
      if (!z) continue;
      const val = (z.g - z.xg) / (z.n + 10) * (isG ? -1 : 1);
      const col = pctColor(Math.max(0, Math.min(100, 50 + val / 0.08 * 50)));
      inner += `<rect x="${X(c)}" y="${Y(a)}" width="${(d - c) * k}" height="${(Math.min(b, 70) - a) * k}" fill="${col.bg}" stroke="${css("--surface")}" stroke-width="2"/>`;
      if (z.n >= 3 && b <= 70) inner += `<text x="${X((c + d) / 2)}" y="${Y((a + Math.min(b, 70)) / 2) + 4}" text-anchor="middle" class="zl" fill="${col.fg}">${z.g}/${z.n}</text>`;
    }
    legend = `<span class="legend-scale">${isG ? "worse than expected" : "below expected"} <i style="background:linear-gradient(90deg,${pctColor(0).bg},${pctColor(50).bg},${pctColor(100).bg})"></i> ${isG ? "better" : "above expected"}</span>
      <span class="muted small">Numbers = ${isG ? "goals allowed / shots faced" : "goals / shots"} from that zone</span>`;
  } else {
    const pts = (mode === "goals" ? goals : rows).filter(s => s[0] < 75).map(s => [s[1], s[0], 1]);
    const dens = kde(pts, -42.5, 42.5, -11, 70, 1.5, 4, 4);
    inner += heatRects(dens, -42.5, -11, 1.5, X, Y, 1.5 * k, 1.5 * k);
    legend = `<span class="legend-scale">fewer <i style="background:linear-gradient(90deg,${seqScale().join(",")})"></i> more ${mode === "goals" ? "goals" : "shots"}</span>
      <span style="--c:${s2}" class="dot">${isG ? "goal against" : "goal"}</span>`;
  }
  inner += goals.filter(s => s[0] < 70).map(s =>
    `<circle cx="${X(s[1]).toFixed(1)}" cy="${Y(s[0]).toFixed(1)}" r="4" fill="${s2}" stroke="${css("--surface")}" stroke-width="2"/>`).join("");
  // zone hit areas for the tooltip
  inner += ZONES.filter(z => z[1] < 70).map(([name, a, b, c, d]) =>
    `<rect class="zhit" data-z="${name}" x="${X(c)}" y="${Y(a)}" width="${(d - c) * k}" height="${(Math.min(b, 70) - a) * k}" fill="transparent"/>`).join("");
  view.querySelector("#rinkmap").innerHTML = rinkSVG(inner, k);
  view.querySelector("#rink-cap").textContent = isG ? "Where shots against came from" : "Where he shoots from";
  view.querySelector("#shot-legend").innerHTML = legend;

  const zoneTip = name => {
    const z = zs[name] || { n: 0, g: 0, xg: 0 }, l = lz[name] || { n: 0, g: 0, xg: 0 };
    const pct = (g, n) => n ? (100 * g / n).toFixed(1) + "%" : "–";
    return `<b>${name}</b>
      <div class="row"><span>${isG ? "Shots faced" : "Shots"}</span><b>${z.n}</b></div>
      <div class="row"><span>${isG ? "Goals allowed" : "Goals"}</span><b>${z.g}</b></div>
      <div class="row"><span>Expected goals</span><span>${z.xg.toFixed(1)}</span></div>
      <div class="row"><span>${isG ? "Save %" : "Shooting %"}</span><span>${isG ? (z.n ? (1 - z.g / z.n).toFixed(3).replace(/^0/, "") : "–") : pct(z.g, z.n)}</span></div>
      <div class="row muted"><span>League ${isG ? "save %" : "shooting %"}</span><span>${isG ? (l.n ? (1 - l.g / l.n).toFixed(3).replace(/^0/, "") : "–") : pct(l.g, l.n)}</span></div>`;
  };
  view.querySelectorAll("#rinkmap .zhit").forEach(r => {
    r.addEventListener("mousemove", e => showTip(e, zoneTip(r.dataset.z)));
    r.addEventListener("mouseleave", () => (tip.hidden = true));
  });

  drawNet(p, rows, mode);
  shotHeadline(p, zs, lz);

  const order = ZONES.map(z => z[0]).filter(n => zs[n]);
  view.querySelector("#zone-table").innerHTML = `<table><thead><tr><th>Zone</th><th class="num">${isG ? "Shots faced" : "Shots"}</th>
    <th class="num">Share</th><th class="num">${isG ? "GA" : "Goals"}</th><th class="num">xG</th><th class="num">${isG ? "xG − GA" : "G − xG"}</th>
    <th class="num">${isG ? "Sv%" : "Sh%"}</th><th class="num">League</th></tr></thead><tbody>${order.map(n => {
      const z = zs[n], l = lz[n] || { n: 0, g: 0 }, diff = isG ? z.xg - z.g : z.g - z.xg;
      const rate = (g, c) => c ? (isG ? (1 - g / c).toFixed(3).replace(/^0/, "") : (100 * g / c).toFixed(1) + "%") : "–";
      return `<tr><td>${n}</td><td class="num">${z.n}</td><td class="num">${(100 * z.n / rows.length).toFixed(0)}%</td>
        <td class="num">${z.g}</td><td class="num">${z.xg.toFixed(1)}</td>
        <td class="num ${diff > 0.5 ? "up" : diff < -0.5 ? "down" : ""}">${diff > 0 ? "+" : ""}${diff.toFixed(1)}</td>
        <td class="num">${rate(z.g, z.n)}</td><td class="num muted">${rate(l.g, l.n)}</td></tr>`;
    }).join("")}</tbody></table>`;
}

function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  placeTip(e);
}
/* Next to the pointer, kept inside the window (flipped above it near the bottom edge). */
function placeTip(e) {
  tip.style.left = Math.max(8, Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)) + "px";
  const below = e.clientY + 14;
  tip.style.top = (below + tip.offsetHeight > innerHeight - 8 ? Math.max(8, e.clientY - tip.offsetHeight - 10) : below) + "px";
}
// a tap leaves no mouseleave behind: hide the tooltip on scroll and on a tap elsewhere
addEventListener("scroll", () => { if (!tip.hidden) tip.hidden = true; }, { passive: true });
/* <span class="def" data-def="..." tabindex="0">: a term with a definition, by hover, keyboard focus or tap. */
{
  const at = el => { const r = el.getBoundingClientRect(); return { clientX: r.left, clientY: r.bottom }; };
  const on = (type, make) => document.addEventListener(type, e => { const el = e.target.closest?.(".def[data-def]"); if (el) showTip(make(e, el), esc(el.dataset.def)); });
  on("mouseover", e => e);
  on("focusin", (e, el) => at(el));
  on("click", (e, el) => at(el));
  ["mouseout", "focusout"].forEach(t => document.addEventListener(t, e => { if (e.target.closest?.(".def[data-def]")) tip.hidden = true; }));
}
document.addEventListener("touchstart", e => { if (!e.target.closest("svg")) tip.hidden = true; }, { passive: true });

function shotHeadline(p, zs, lz) {
  const isG = p.grp === "G";
  const scored = Object.entries(zs).filter(([, z]) => z.n >= 5)
    .map(([n, z]) => [n, z, (isG ? z.xg - z.g : z.g - z.xg) / (z.n + 10)]);
  const most = Object.entries(zs).sort((a, b) => b[1].n - a[1].n)[0];
  const total = Object.values(zs).reduce((s, z) => s + z.n, 0);
  let html = `<b>${isG ? "Most shots faced from" : "Shoots most from"}:</b> ${most[0]} (${(100 * most[1].n / total).toFixed(0)}% of ${total}).`;
  if (scored.length) {
    const best = scored.reduce((a, b) => (b[2] > a[2] ? b : a)), worst = scored.reduce((a, b) => (b[2] < a[2] ? b : a));
    const sh = z => isG ? (1 - z.g / z.n).toFixed(3).replace(/^0/, "") + " sv%" : (100 * z.g / z.n).toFixed(0) + "% shooting";
    const lg = n => { const l = lz[n]; return l && l.n ? (isG ? (1 - l.g / l.n).toFixed(3).replace(/^0/, "") : (100 * l.g / l.n).toFixed(0) + "%") : "–"; };
    html += ` <b>${isG ? "Strongest against" : "Most effective from"}:</b> ${best[0]}: ${best[1].g} ${isG ? "GA" : "G"} on ${best[1].n} (${sh(best[1])}, league ${lg(best[0])}).`;
    if (worst[0] !== best[0] && worst[2] < 0)
      html += ` <b>${isG ? "Weakest against" : "Least effective"}:</b> ${worst[0]}: ${worst[1].g} on ${worst[1].n} (league ${lg(worst[0])}).`;
  }
  view.querySelector("#shot-headline").innerHTML = html;
}

function drawNet(p, rows, mode) {
  const isG = p.grp === "G";
  const on = rows.filter(s => s[2] != null && s[3] != null);
  const goals = on.filter(s => s[4] === 1);
  const k = 52, u0 = -0.2, u1 = 1.2, v0 = -0.4, v1 = 1.08;     // units: nx (6 ft), ny (4 ft)
  const X = u => (u - u0) * 6 * k, Y = v => (v - v0) * 4 * k;
  const W = (u1 - u0) * 6 * k, H = (v1 - v0) * 4 * k;
  const s2 = css("--s2"), line = css("--ink-2"), surface = css("--surface");
  let inner = "";
  if (mode === "eff") {
    for (const [rn, a, b] of NET_ZONES) for (const [cn, c, d] of NET_COLS) {
      const inZ = on.filter(s => s[3] >= a && s[3] < b && s[2] >= c && s[2] < d);
      if (!inZ.length) continue;
      const g = inZ.filter(s => s[4] === 1).length, xg = inZ.reduce((t, s) => t + s[5] / 1000, 0);
      const val = (g - xg) / (inZ.length + 10) * (isG ? -1 : 1);
      const col = pctColor(Math.max(0, Math.min(100, 50 + val / 0.08 * 50)));
      inner += `<rect x="${X(c)}" y="${Y(a)}" width="${(d - c) * 6 * k}" height="${(Math.min(b, 1) - a) * 4 * k}" fill="${col.bg}" stroke="${surface}" stroke-width="2"/>
        <text x="${X((c + d) / 2)}" y="${Y((a + Math.min(b, 1)) / 2) + 4}" text-anchor="middle" class="zl" fill="${col.fg}">${g}/${inZ.length}</text>`;
    }
  } else {
    const pts = (mode === "goals" ? goals : on).map(s => [s[2], s[3], 1]);
    const dens = kde(pts, u0, u1, v0, v1, 0.02, 0.07, 0.1);
    inner += heatRects(dens, u0, v0, 0.02, X, Y, 0.02 * 6 * k, 0.02 * 4 * k);
  }
  inner += goals.map(s => `<circle cx="${X(s[2]).toFixed(1)}" cy="${Y(s[3]).toFixed(1)}" r="4" fill="${s2}" stroke="${surface}" stroke-width="2"/>`).join("");
  // 3 x 3 hit areas for the tooltip
  for (const [rn, a, b] of NET_ZONES) for (const [cn, c, d] of NET_COLS)
    inner += `<rect class="nhit" data-r="${rn}" data-c="${cn}" data-a="${a}" data-b="${b}" data-cc="${c}" data-d="${d}" x="${X(c)}" y="${Y(a)}" width="${(d - c) * 6 * k}" height="${(Math.min(b, 1) - a) * 4 * k}" fill="transparent"/>`;
  const grid = [1 / 3, 2 / 3].map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="${Y(0)}" y2="${Y(1)}" stroke="${line}" stroke-opacity=".18"/>
    <line x1="${X(0)}" x2="${X(1)}" y1="${Y(t)}" y2="${Y(t)}" stroke="${line}" stroke-opacity=".18"/>`).join("");
  view.querySelector("#netmap").innerHTML = `<svg class="net" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net shot map">
    <rect x="0" y="0" width="${W}" height="${H}" fill="${surface}"/>
    <rect x="${X(0)}" y="${Y(0)}" width="${6 * k}" height="${4 * k}" fill="${css("--surface-2")}"/>
    ${inner}${grid}
    <path d="M${X(0)},${Y(1)} L${X(0)},${Y(0)} L${X(1)},${Y(0)} L${X(1)},${Y(1)}" fill="none" stroke="${css("--neg")}" stroke-width="5" stroke-linejoin="round"/>
    <line x1="0" x2="${W}" y1="${Y(1)}" y2="${Y(1)}" stroke="${css("--axis")}" stroke-width="2"/>
    <text x="${X(0)}" y="${H - 4}" class="nl">shooter's left</text>
    <text x="${X(1)}" y="${H - 4}" text-anchor="end" class="nl">shooter's right</text>
  </svg>`;
  view.querySelector("#net-cap").textContent = isG ? `Where the ${on.length} on-target shots against went` : `Where his ${on.length} on-target shots went`;
  view.querySelectorAll("#netmap .nhit").forEach(r => {
    const a = +r.dataset.a, b = +r.dataset.b, c = +r.dataset.cc, d = +r.dataset.d;
    const inZ = on.filter(s => s[3] >= a && s[3] < b && s[2] >= c && s[2] < d);
    const g = inZ.filter(s => s[4] === 1).length;
    const html = `<b>${r.dataset.r} ${r.dataset.c}</b>
      <div class="row"><span>${isG ? "Shots faced" : "On target"}</span><b>${inZ.length}</b></div>
      <div class="row"><span>${isG ? "Goals allowed" : "Goals"}</span><b>${g}</b></div>
      <div class="row"><span>${isG ? "Save %" : "Shooting %"}</span><span>${inZ.length ? (isG ? (1 - g / inZ.length).toFixed(3).replace(/^0/, "") : (100 * g / inZ.length).toFixed(1) + "%") : "–"}</span></div>`;
    r.addEventListener("mousemove", e => showTip(e, html));
    r.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}
