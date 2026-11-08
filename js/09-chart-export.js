"use strict";

// ---------------------------------------------------------------- chart
let LAST_CHART = null;   // [player, projection, metric, width] of the drawn ability chart
addEventListener("resize", () => {
  clearTimeout(LAST_CHART?.timer);
  if (!LAST_CHART) return;
  LAST_CHART.timer = setTimeout(() => {
    redrawChartIfResized();
  }, 200);
});
function redrawChartIfResized() {
  MINI?.();
  const box = view.querySelector("#chart");
  if (box && box.clientWidth && LAST_CHART && Math.abs(box.clientWidth - LAST_CHART[3]) > 60) drawChart(...LAST_CHART.slice(0, 3));
}
function drawChart(p, proj, metric) {
  const box = view.querySelector("#chart");
  const isCA = metric === "ca";
  const idx = isCA ? 1 : +metric + 2;
  const hist = p.h.filter(h => h[idx] != null).map(h => ({ date: new Date(D.dates[h[0]] + "T00:00:00"), v: h[idx] }));
  const name = isCA ? "Est. CA" : D.attrs[+metric].split(": ")[1];
  const s1 = css("--s1"), s2 = css("--s2");

  view.querySelector("#chart-title").textContent = isCA ? "Ability over time and projection" : `${name} over time`;
  view.querySelector("#chart-sub").textContent = isCA
    ? `Estimated CA at each snapshot, then a ${D.projectionMonths}-month projection towards estimated PA (${fmt(p.pa, 0)}). Shaded band = 80% range.`
    : "Attribute value (1–20) at each snapshot. Projections are only made for overall ability.";
  view.querySelector("#legend").innerHTML = isCA
    ? `<span style="--c:${s1}">Est. CA (snapshots)</span><span style="--c:${s2}">Projection</span><span class="band" style="--c:${s2}">80% range</span>`
    : "";

  // drawn at the box's real width (1 unit = 1 px), so the labels keep their size on a phone instead of shrinking
  // with a fixed 1000-wide viewBox; redrawn when the width changes a lot (see the resize listener below)
  const W = Math.round(Math.max(300, Math.min(1400, box.clientWidth || 1000))), H = W < 640 ? 240 : 340;
  const m = { l: 40, r: W < 640 ? 34 : 70, t: 14, b: 30 };
  LAST_CHART = [p, proj, metric, W];
  const x0 = hist[0].date, x1 = isCA ? proj.at(-1).date : hist.at(-1).date;
  const span = Math.max(1, x1 - x0);
  let lo, hi;
  if (isCA) {
    lo = Math.min(...hist.map(h => h.v), ...proj.map(q => q.lo));
    hi = Math.max(...hist.map(h => h.v), ...proj.map(q => q.hi));
    lo = Math.max(0, Math.floor((lo - 8) / 20) * 20); hi = Math.min(200, Math.ceil((hi + 8) / 20) * 20);
  } else { lo = 0; hi = 20; }
  const X = d => m.l + (d - x0) / span * (W - m.l - m.r);
  const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const step = isCA ? (hi - lo > 80 ? 40 : 20) : 5;

  let g = "";
  for (let v = lo; v <= hi; v += step)
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${css("--grid")}" stroke-width="1"/>
          <text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  // month ticks at least ~56 px apart: every 6 or 12 months (Jan/Jul) for the CA chart, every n months for attributes
  const perMonth = (W - m.l - m.r) / Math.max(1, span / (30.44 * 864e5));
  const tickEvery = isCA ? (perMonth * 6 < 56 ? 12 : 6) : Math.max(1, Math.ceil(56 / perMonth));
  const t = new Date(x0.getFullYear(), x0.getMonth() + 1, 1);
  for (let i = 0; t <= x1; i++, t.setMonth(t.getMonth() + 1)) {
    if (isCA ? t.getMonth() % tickEvery !== 0 : i % tickEvery !== 0) continue;
    g += `<line x1="${X(t)}" x2="${X(t)}" y1="${H - m.b}" y2="${H - m.b + 4}" stroke="${css("--axis")}"/>
          <text x="${X(t)}" y="${H - m.b + 17}" text-anchor="middle">${t.toLocaleDateString(undefined, { month: "short", year: "2-digit" })}</text>`;
  }
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="${css("--axis")}"/>`;

  if (isCA) {
    const band = proj.map(q => `${X(q.date)},${Y(q.hi)}`).join(" ") + " " + proj.slice().reverse().map(q => `${X(q.date)},${Y(q.lo)}`).join(" ");
    g += `<polygon points="${band}" fill="${s2}" opacity="0.12"/>`;
    g += `<polyline points="${proj.map(q => `${X(q.date)},${Y(q.mid)}`).join(" ")}" fill="none" stroke="${s2}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const end = proj.at(-1);
    g += `<circle cx="${X(end.date)}" cy="${Y(end.mid)}" r="4" fill="${s2}" stroke="${css("--surface")}" stroke-width="2"/>
          <text class="lbl" x="${X(end.date) + 8}" y="${Y(end.mid) + 4}">${end.mid.toFixed(0)}</text>`;
  }
  g += `<polyline points="${hist.map(h => `${X(h.date)},${Y(h.v)}`).join(" ")}" fill="none" stroke="${s1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  g += hist.map(h => `<circle cx="${X(h.date)}" cy="${Y(h.v)}" r="4" fill="${s1}" stroke="${css("--surface")}" stroke-width="2"/>`).join("");
  const lastH = hist.at(-1);
  if (!isCA) g += `<text class="lbl" x="${X(lastH.date) + 8}" y="${Y(lastH.v) + 4}">${lastH.v}</text>`;
  else g += `<text class="lbl" x="${X(lastH.date)}" y="${Y(lastH.v) - 10}" text-anchor="middle">${lastH.v.toFixed(0)}</text>`;
  g += `<line id="xh" y1="${m.t}" y2="${H - m.b}" stroke="${css("--axis")}" stroke-width="1" visibility="hidden"/>
        <rect id="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
  box.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} over time">${g}</svg>`;

  // hover: nearest snapshot or projection month
  const pts = hist.map(h => ({ date: h.date, html: `<div class="row"><span>${esc(name)}</span><b>${isCA ? h.v.toFixed(1) : h.v}</b></div>` }));
  if (isCA) proj.slice(1).forEach(q => pts.push({ date: q.date, q,
    html: `<div class="row"><span>Projected</span><b>${q.mid.toFixed(0)}</b></div><div class="row muted"><span>80% range</span><span>${q.lo.toFixed(0)}–${q.hi.toFixed(0)}</span></div><div class="row muted"><span>Age</span><span>${q.age.toFixed(1)}</span></div>` }));
  const svg = box.querySelector("svg"), xh = svg.querySelector("#xh");
  svg.querySelector("#hit").addEventListener("mousemove", e => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width * W;
    const best = pts.reduce((a, b) => Math.abs(X(b.date) - sx) < Math.abs(X(a.date) - sx) ? b : a);
    xh.setAttribute("x1", X(best.date)); xh.setAttribute("x2", X(best.date)); xh.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${fmtDate(best.date)}</b>${best.html}${best.q ? `<div class="muted small">Click for the projected attributes</div>` : ""}`;
    tip.hidden = false;
    placeTip(e);
    e.currentTarget.style.cursor = best.q ? "pointer" : "default";   // only projected months open something
  });
  svg.querySelector("#hit").addEventListener("mouseleave", () => { tip.hidden = true; xh.setAttribute("visibility", "hidden"); });
  // click a projected month: show the projected attributes for that date
  svg.querySelector("#hit").addEventListener("click", e => {
    if (!isCA) return;
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) / r.width * W;
    const best = pts.reduce((a, b) => Math.abs(X(b.date) - sx) < Math.abs(X(a.date) - sx) ? b : a);
    if (best.q) renderAttrProjection(p, proj, best.q.m);
  });

  const rows = hist.map(h => `<tr><td>${fmtDate(h.date)}</td><td>Snapshot</td><td class="num">${isCA ? h.v.toFixed(1) : h.v}</td><td></td></tr>`);
  if (isCA) proj.filter(q => q.m % 3 === 0 && q.m > 0).forEach(q =>
    rows.push(`<tr><td>${fmtDate(q.date)}</td><td>Projection (age ${q.age.toFixed(1)})</td><td class="num">${q.mid.toFixed(1)}</td><td class="num muted">${q.lo.toFixed(0)}–${q.hi.toFixed(0)}</td></tr>`));
  view.querySelector("#chart-table").innerHTML = `<table><thead><tr><th>Date</th><th>Source</th><th class="num">${esc(name)}</th><th class="num">80% range</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/* PNG export: every tab on one compact sheet (card, bio, ability chart, attributes with the 12-month projection,
   career stats, scout report, shot maps, comparables, draft & achievements). The sheet is built off-screen and
   removed again; charts drawn in a different mode for the export (CA chart, shots-taken maps, each career table)
   are redrawn as they were in the same task, so the page never shows it. */
function exportCard(p, proj, X) {
  if (!pngReady()) return;
  const grab = sel => view.querySelector(sel)?.innerHTML || "";
  const frag = html => { const t = document.createElement("template"); t.innerHTML = html; return t.content; };
  const outer = f => [...f.children].map(e => e.outerHTML).join("");

  const metric = view.querySelector("#metric").value;
  if (metric !== "ca") drawChart(p, proj, "ca");
  const chart = grab("#chart"), legend = grab("#legend");
  if (metric !== "ca") drawChart(p, proj, metric);

  let shots = "";
  const shotMode = view.querySelector("#shotpanel .seg button.on")?.dataset.m;
  if (shotMode) {
    if (shotMode !== "shots") drawShotMaps(p, "shots");
    shots = `<div class="panel"><h2>Shot maps · ${p.grp === "G" ? "shots against" : "shots taken"}</h2><p class="headline">${grab("#shot-headline")}</p>
      <div class="maps"><figure>${grab("#rinkmap")}<figcaption>${grab("#rink-cap")}</figcaption></figure>
        <figure>${grab("#netmap")}<figcaption>${grab("#net-cap")}</figcaption></figure></div>
      <div class="legend">${grab("#shot-legend")}</div></div>`;
    if (shotMode !== "shots") drawShotMaps(p, shotMode);
  }

  const keep = CTYPE, careers = [];
  for (const [t, label] of CAR_TYPES.filter(([t]) => t !== "O" && view.querySelector(`#car-type button[data-t="${t}"]`))) {
    CTYPE = t; drawCareer(p); careers.push(`<h3>${label}</h3>${grab("#car-table")}`);
  }
  if (careers.length) { CTYPE = keep; drawCareer(p); }

  const compMode = view.querySelector("#comps-mode button.on");
  const comps = frag(grab("#comps-table"));
  comps.querySelectorAll("tbody tr:nth-child(n+7)").forEach(tr => tr.remove());

  let scout = "";
  if (p.sc) {
    const f = frag(scoutPanel(p));
    const report = [p.sc.report, p.sc.projection].filter(Boolean).map(esc).join(" ");
    f.querySelector("details").outerHTML = report ? `<p class="small">${report}</p>` : "";
    scout = outer(f);
  }

  // facts the card's header doesn't already show
  const bio = factRows(p, X).filter(([k]) => ["Born", "Birthplace", "Condition", "Drafted", "Junior draft", "Career role"].includes(k));
  const sheet = document.createElement("div");
  sheet.className = "xsheet";
  sheet.innerHTML = `
    <div class="xrow">
      ${view.querySelector("#card").outerHTML}
      <div class="xcol">
        ${bio.length ? `<div class="panel"><h2>Bio</h2>${factList(bio)}</div>` : ""}
        ${dealsOf(byKey.get(p.k) || p).length ? `<div class="panel xcontract"><h2>Contract</h2>${contractSummary(p)}${(() => { const tr = frag(playerTrades(p)); tr.querySelectorAll("details").forEach(d => d.remove()); return tr.children.length ? `<div class="xtrades">${outer(tr)}</div>` : ""; })()}</div>` : ""}
        <div class="panel"><h2>Ability over time and projection</h2><div class="legend">${legend}</div>${chart}</div>
        <div class="panel"><h2>Attributes · change since ${fmtDate(D.dates[X.first[0]])}${D.attrModel ? " · projected in 12 months" : ""}</h2>
          <div class="attr-grid">${exportAttrs(p, proj)}</div></div>
        ${comps.children.length ? `<div class="panel"><h2>Comparable players${compMode ? " · " + esc(compMode.textContent) : ""}</h2>${outer(comps)}</div>` : ""}
      </div>
    </div>
    ${careers.length ? `<div class="panel"><h2>Career statistics</h2>${careers.join("")}</div>` : ""}
    ${X.t ? `<div class="panel"><h2>NHL box-score totals</h2>${totalsTable(p, X.t)}</div>` : ""}
    <div class="xrow">${scout}<div class="xcol">${shots}${achievementsPanel(p)}</div></div>
    <div class="xfoot"><span>${esc(D.title || "EHM Player Cards")} · ${esc(p.n)}${SEASON ? " · " + seasonLabel(SEASON) : ""}${p._po ? " playoffs" : ""}</span>
      <span>Snapshot ${fmtDate(D.dates.at(-1))}</span></div>`;
  sheet.querySelectorAll(".logo").forEach(e => e.remove());   // NHL logos are cross-origin: html2canvas can't draw them
  sheetToPng(sheet, 1700, p.n.replace(/[^\w\- ]+/g, "") + " card.png", () =>
    // html2canvas draws an SVG as an image of its own markup, so the stylesheet's text styles must be inlined
    sheet.querySelectorAll("svg text").forEach(t => {
      const s = getComputedStyle(t);
      Object.assign(t.style, { fill: s.fill, fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily });
    }));
}
// the PNG exports (player card, Game Score sheet): html2canvas comes from cdnjs, so it needs a connection
function pngReady() {
  if (window.html2canvas) return true;
  alert("PNG export needs an internet connection (html2canvas loads from cdnjs).");
  return false;
}
/* Put the off-screen sheet in the page, draw it with html2canvas, download the PNG and remove the sheet again.
   prepare() runs once the sheet is in the document (styles are computed there). */
function sheetToPng(sheet, windowWidth, file, prepare, scale = 2) {
  document.body.appendChild(sheet);
  if (prepare) prepare();
  html2canvas(sheet, { scale, backgroundColor: css("--page"), windowWidth }).then(canvas => {
    const a = document.createElement("a");
    a.download = file;
    a.href = canvas.toDataURL("image/png");
    a.click();
  }).catch(e => alert("PNG export failed: " + e.message)).finally(() => sheet.remove());
}
/* Attribute tables for the export: value, change since the first snapshot, expected value in 12 months. */
function exportAttrs(p, proj) {
  const last = p.h.at(-1), first = p.h[0];
  const q = proj[Math.min(12, proj.length - 1)];
  const fut = new Map(q?.m ? projectAttrs(p, q).map(r => [r.c, r]) : []);
  const delta = d => `<td class="num ${d > 0 ? "up" : d < 0 ? "down" : "muted"}">${d > 0 ? "+" + d : d < 0 ? d : "·"}</td>`;
  const sections = {};
  D.attrs.forEach((a, i) => {
    const v = last[i + 2];
    if (v == null) return;
    const [sec, name] = a.split(": ");
    const r = fut.get(a), f = r ? Math.round(r.mid) : null, rng = r ? `<small class="muted"> ${Math.round(r.lo)}–${Math.round(r.hi)}</small>` : "";
    (sections[sec] ||= []).push(`<tr><td>${esc(name)}</td><td class="num"><b>${v}</b></td>${delta(first[i + 2] == null ? 0 : v - first[i + 2])}
      ${fut.size ? (f == null ? `<td class="num muted">–</td>` : `<td class="num ${f > v ? "up" : f < v ? "down" : ""}">${f}${rng}</td>`) : ""}</tr>`);
  });
  return Object.entries(sections).map(([s, rows]) => `<div><h4>${esc(s)}</h4><table><thead><tr><th></th><th class="num">Now</th>
    <th class="num">±</th>${fut.size ? `<th class="num" title="Expected value in 12 months, 80% range">12 mo</th>` : ""}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`).join("");
}
