"use strict";

// ---------------------------------------------------------------- draft room: board, underrated finder, shortlist
/* The ranking and the flag the user chose after ehm/studies/draft_rank_bench.py (2026-11-06): "ours" is the average of the NHL
   rank and the projected-peak rank (draftBoard), and a player is flagged when his projected peak is at least
   DRAFT_EVIDENCE.slot.threshold above what his NHL slot usually projects to (draftSlotPeak). */
const DRAFT_TABS = [["board", "Draft board"], ["underrated", "Underrated"], ["past", "Past drafts"], ["scores", "Drafters"]];
function draftHead(tab) {
  const tabs = draftValues().picks.length ? DRAFT_TABS : DRAFT_TABS.slice(0, 2);
  return `<section class="band"><div class="wrap"><h1>Draft</h1>
    ${tabBar("Draft sections", tabs, tab, "data-dtab")}</div></section>`;
}
function bindDraftHead() {
  view.querySelectorAll("[data-dtab]").forEach(b => b.onclick = () => (location.hash = "#/draft" + (b.dataset.dtab === "board" ? "" : "/" + b.dataset.dtab)));
}
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(storeKey(key))) ?? fallback; } catch (e) { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(storeKey(key), JSON.stringify(value)); } catch (e) { /* storage blocked: lasts until the page closes */ } };
const DR_MORE = { open: false, more: false, onlyShort: false, pick: stored("ehm-draft-pick", ""), short: new Set(stored("ehm-draft-shortlist", [])), cmp: new Set() };
const leagueName = lg => lg || "Junior / other";
const scoutStars = n => (n != null ? `<span class="stars" aria-label="${n} of 5 stars">${"★".repeat(n)}</span>` : dash);
const starBtn = k => {
  const on = DR_MORE.short.has(k);
  return `<button type="button" class="dstar${on ? " on" : ""}" data-star="${esc(k)}" aria-pressed="${on}" title="${on ? "Remove from" : "Add to"} shortlist" aria-label="${on ? "Remove from" : "Add to"} shortlist">${on ? "★" : "☆"}</button>`;
};
function toggleShort(k) {
  if (DR_MORE.short.has(k)) { DR_MORE.short.delete(k); DR_MORE.cmp.delete(k); } else DR_MORE.short.add(k);
  store("ehm-draft-shortlist", [...DR_MORE.short]);
}

/* The plain reason behind a rank, only from what the row already holds. */
function draftWhy(s, rows) {
  const p = s.p, out = [];
  if (EV_SLOT) {
    const g = Math.round(s.gap);
    out.push(`Projected peak ${fmt(s.mid, 0)} is ${g >= 0 ? `${g} above` : `${-g} below`} what NHL #${s.nhl} usually projects to (${fmt(s.mid - s.gap, 0)}).`);
  }
  const peers = rows.filter(x => x.p.age === p.age).sort((a, b) => b.p.ca - a.p.ca);
  const at = peers.findIndex(x => x === s) + 1;
  if (at && peers.length > 1) out.push(`Current ability ${fmt(p.ca, 0)} is ${ordinal(at)} of ${peers.length} ${p.age}-year-olds on this list.`);
  const mv = lastMove(p), prev = MOVE_BASE == null ? null : D.dates[MOVE_BASE];
  if (mv != null && Math.abs(mv) >= 3) out.push(`Est. CA is ${mv > 0 ? "up" : "down"} ${Math.abs(mv).toFixed(1)} since ${fmtDate(prev)}; part of a jump can be estimation noise.`);
  const width = s.hi - s.lo, widths = rows.map(x => x.hi - x.lo).sort((a, b) => a - b), mid = widths[Math.floor(widths.length / 2)];
  out.push(`Likely peak range ${fmt(s.lo, 0)}–${fmt(s.hi, 0)}, ${width > mid * 1.15 ? "wider than" : width < mid * 0.85 ? "narrower than" : "about the same as"} most of this list.`);
  if (s.move) out.push(`The NHL moved him ${s.move > 0 ? "up" : "down"} ${Math.abs(s.move)} since its previous list.`);
  if (p.sc) {
    const tier = (p.sc.career || "").split(",").slice(1).join(",").trim();
    out.push(`Scout: ${p.sc.fut != null ? `${p.sc.fut} of 5 stars for the future` : "no future rating"}${tier ? `, ${tier}` : ""}.`);
  } else out.push("No scout report on him, so this rests on his visible attributes.");
  return out;
}
const whyList = (s, rows) => `<ul class="dwhy">${draftWhy(s, rows).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
const pctTxt = v => (v == null ? "–" : Math.round(v * 100) + "%");

/* What the ranking and the flag were tested on: the page says it, including what they can't do. */
function rankingEvidence() {
  const E = EV_DATA;
  if (!E) return "";
  const r = t => E.ranking[t], cell = (t, n) => (r(t)?.[n] ? fmt(r(t)[n].rho, 2) : "–");
  return `<details class="devidence"><summary>How this ranking was tested</summary>
    <p class="small">Our rank is the average of the NHL rank and the projected-peak rank. It was tested on ${E.lists} past NHL lists of the training save
      (${E.players.toLocaleString()} players, drafts ${E.classes[0]}–${E.classes.at(-1)}) against what the players actually became.</p>
    <div class="tablewrap"><table class="rank devtable"><thead><tr><th>Rank correlation with</th><th class="num">Our rank</th><th class="num">NHL list</th><th class="num">Peak alone</th><th class="num">Predicted CA</th><th class="num">Est. PA</th></tr></thead><tbody>
      ${[["ca_24", "True CA, 24 months later"], ["ca_36", "True CA, 36 months later"], ["ca_48", "True CA, 48 months later"], ["pa_true", "True PA"]].map(([t, lab]) =>
        `<tr><th scope="row">${lab}</th>${["nhl~peak", "nhl", "peak_mid", "fut", "est_pa"].map((n, i) => `<td class="num">${i ? cell(t, n) : `<b>${cell(t, n)}</b>`}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="small muted">Higher is better. At 48 months our rank only ties the NHL list, and it rests on just ${E.ranking_lists.ca_48} lists. At the very top of a draft nothing clearly beats the NHL list.
      The estimates use the draft rank as an input, so they aren't independent of it. Safe and Upside swap in that end of the projected range; only Balanced was tested as a blend.</p></details>`;
}
function flagEvidence() {
  const E = EV_DATA;
  if (!E) return "";
  const f = E.flag, o = E.old_flag, r = (b, t) => E.reach[b]?.[t];
  const line = (x, t) => (x?.[t] ? `${signed(x[t].excess, 1)} ± ${fmt(x[t].se, 1)} CA (${x[t].n})` : "–");
  const top = r("1-32", "ca_36"), mid = r("33-60", "ca_36"), deep = r("101-200", "ca_36");
  return `<details class="devidence"><summary>How this flag was tested</summary>
    <p class="small">A player is flagged when his projected peak is at least ${fmt(E.slot.threshold, 1)} CA above what his NHL slot usually projects to.
      On past lists of the training save, flagged players against same-slot players of other drafts (count in brackets):</p>
    <div class="tablewrap"><table class="rank devtable"><thead><tr><th>Rule</th><th class="num">True CA, 36 months</th><th class="num">True CA, 48 months</th><th class="num">True PA</th></tr></thead><tbody>
      <tr><th scope="row">Projected peak over slot (this page)</th><td class="num"><b>${line(f, "ca_36")}</b></td><td class="num">${line(f, "ca_48")}</td><td class="num">${line(f, "pa_true")}</td></tr>
      <tr><th scope="row">25+ rank spots (the old list)</th><td class="num">${line(o, "ca_36")}</td><td class="num">${line(o, "ca_48")}</td><td class="num">${line(o, "pa_true")}</td></tr>
    </tbody></table></div>
    <p class="small muted">${top ? `Reached 130+ CA within 36 months, leaving the database counted as not reaching it: NHL top 32, ${pctTxt(top.flag)} of flagged (${top.flag_n}) vs ${pctTxt(top.rest)} of the rest (${top.rest_n})` : ""}${mid ? `; NHL 33–60, ${pctTxt(mid.flag)} (${mid.flag_n}) vs ${pctTxt(mid.rest)} (${mid.rest_n})` : ""}${deep ? `; NHL 101–200, ${pctTxt(deep.flag)} (${deep.flag_n}) vs ${pctTxt(deep.rest)} (${deep.rest_n})` : ""}.
      Counts are small, so treat a flag as a reason to look closer, not a verdict.</p></details>`;
}

// ---------------------------------------------------------------- board
function renderDraft(tab = "board", arg, pick) {
  markNav("draft");
  if (!DRAFT_TABS.some(t => t[0] === tab)) tab = "board";   // a mistyped #/draft/<x> shows the board
  if (tab === "underrated") { renderUnderrated(); return; }
  if (tab !== "board" && draftValues().picks.length) { renderDraftHistory(tab, arg, pick); return; }
  const { rows } = draftBoard(DR.mode);
  const byK = new Map(rows.map(s => [s.p.k, s]));
  const stages = [...new Set(rows.map(s => s.stage))].sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
  const leagues = [...rows.reduce((m, s) => m.set(s.p.lg || "", (m.get(s.p.lg || "") || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const flagged = rows.filter(s => s.under).length;
  const active = () => Object.values(DR.f).filter(v => v && v.trim()).length + (DR.lg ? 1 : 0) + (DR.scouted ? 1 : 0);
  const COLS = DR_MORE.more ? DRAFT_COLS : DRAFT_MAIN.map(k => DRAFT_COLS.find(c => c[0] === k));
  const modeName = { lo: "the safe end of his range", mid: "his expected peak", hi: "the upside end of his range" };
  view.innerHTML = `${draftHead("board")}<div class="wrap page draftroom">
    <div class="dintro"><p class="sub">${rows.length} players on the ${esc(stages.join(" / "))} NHL list, ${fmtDate(D.dates.at(-1))}. <b>Ours</b> averages the NHL rank and
      the rank by projected peak, using ${modeName[DR.mode]}. Teenage potential is uncertain (±${D.report.pa_by_age["16-18"].mae} on average), so read the range, not just the middle.
      ${flagged ? `<a href="#/draft/underrated">${flagged} flagged as underrated →</a>` : ""}</p>${rankingEvidence()}</div>
    <div class="dbar">
      ${segCtl("d-grp", "Position", [["", "All"], ["F", "F"], ["D", "D"], ["G", "G"]], DR.grp)}
      <fieldset><legend>Outcome</legend><div class="seg" id="d-mode">${Object.entries({ lo: "Safe", mid: "Balanced", hi: "Upside" })
        .map(([k, t]) => `<button type="button" data-m="${k}" class="${DR.mode === k ? "on" : ""}">${t}</button>`).join("")}</div></fieldset>
      <label class="dpick">My pick <input id="d-pick" type="number" min="1" max="224" inputmode="numeric" placeholder="#" value="${esc(DR_MORE.pick)}"></label>
      <button class="ghost" id="d-only" type="button" aria-pressed="${DR_MORE.onlyShort}">${DR_MORE.onlyShort ? "Show everyone" : "Shortlist only"}</button>
      <button class="ghost" id="d-filter" type="button" aria-expanded="${DR_MORE.open}">Filters${active() ? ` (${active()})` : ""}</button>
      <button class="ghost" id="d-morecols" type="button" aria-pressed="${DR_MORE.more}">${DR_MORE.more ? "Fewer columns" : "More columns"}</button>
      <span class="muted small count" id="d-count"></span>
    </div>
    <div class="dfilters" id="d-filters"${DR_MORE.open ? "" : " hidden"}>
      <div class="filters">
        ${segCtl("d-lg", "League", [["", "All"], ...leagues.map(([l, n]) => [esc(l), `${esc(leagueName(l))} ${n}`])], DR.lg)}
        ${segCtl("d-sc", "Scout report", [["", "All"], ["yes", "Scouted"], ["no", "Unscouted"]], DR.scouted)}
        <button class="ghost small" id="d-clear" type="button">Clear filters</button>
      </div>
      <div class="dfgrid">${DRAFT_COLS.map(([k, t, , n]) => `<label>${esc(t)}<input data-k="${k}" value="${esc(DR.f[k] || "")}" placeholder="${n ? ">0, 5-10" : "filter"}"></label>`).join("")}</div>
      <p class="small muted">Text matches anywhere ("!" excludes); numbers accept &gt;, &lt;, &gt;=, &lt;=, ranges like 100-150, or an exact value.</p>
    </div>
    <p class="dbest" id="d-best" hidden></p>
    <section class="dshort" id="d-short" aria-label="Shortlist" hidden></section>
    <div class="tablewrap"><table class="draft ${DR_MORE.more ? "" : "compact"}">
      <thead><tr><th data-nosort aria-label="Shortlist"></th>${COLS.map(([k, t, , n]) => {
        const on = DR.sort === k;
        return `<th class="sort ${n ? "num" : ""} ${on ? "on" : ""}" data-k="${k}" tabindex="0" aria-sort="${on ? (DR.dir < 0 ? "descending" : "ascending") : "none"}" ${DRAFT_TIP[k] ? `title="${esc(DRAFT_TIP[k])}"` : ""}>${t}${on ? (DR.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
      }).join("")}</tr></thead>
      <tbody id="d-body"></tbody></table></div>
    <p id="d-more-wrap"></p>
    <p class="small muted">Tiers are a reading aid: a new one starts where the players ahead project about one model error (${EV_SLOT ? fmt(EV_SLOT.threshold * 2, 0) : "–"} CA) higher.
      NHL = the NHL's rank and how far ours differs. Change = places gained since the NHL's previous list.</p>
  </div>`;
  const body = () => {
    let shown = rows.filter(s => (!DR.grp || s.p.grp === DR.grp) && (!DR.lg || (s.p.lg || "") === DR.lg) && (!DR.scouted || !!s.p.sc === (DR.scouted === "yes"))
      && (!DR_MORE.onlyShort || DR_MORE.short.has(s.p.k)) && DRAFT_COLS.every(([k, , g, n]) => matchFilter(g(s), DR.f[k] || "", n)));
    const [, , g, n] = DRAFT_COLS.find(c => c[0] === DR.sort);
    shown.sort((a, b) => {
      const x = g(a), y = g(b);
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      return (n ? x - y : String(x).localeCompare(String(y))) * DR.dir;
    });
    view.querySelector("#d-count").textContent = `${shown.length} of ${rows.length} shown`;
    const pk = +DR_MORE.pick || 0, W = v => Math.max(0, Math.min(100, (v - 60) / 140 * 100)).toFixed(1);
    const cells = {
      ours: s => `<td class="num"><b>${s.ours}</b></td>`,
      nhl: s => { const d = s.nhl - s.ours; return `<td class="num" title="${esc(s.stage)} list">${s.nhl} <span class="small ${d > 5 ? "up" : d < -5 ? "down" : "muted"}" title="ours vs NHL">${d > 0 ? "+" + d : d < 0 ? "−" + -d : ""}</span></td>`; },
      move: s => `<td class="num ${s.move > 0 ? "up" : s.move < 0 ? "down" : "muted"}" title="${esc(s.prevTxt || "no earlier list")}">${s.move == null ? "–" : (s.move > 0 ? "+" : s.move < 0 ? "−" : "") + Math.abs(s.move)}</td>`,
      n: s => `<td class="dplayer"><button type="button" class="dx" data-k="${esc(s.p.k)}" aria-expanded="${DR.open.has(s.p.k)}" aria-label="Why ${esc(s.p.n)} ranks here">${DR.open.has(s.p.k) ? "▾" : "▸"}</button>
        <span><a href="${route(s.p.k)}"><b>${esc(s.p.n)}</b></a>${s.under ? ' <span class="dflag">Underrated</span>' : ""}
        ${DR_MORE.more ? "" : `<small>${esc(s.p.pos)} · ${s.p.age} · ${tname(clubOf(s.p))}${s.p.lg ? ` (${esc(s.p.lg)})` : ""}</small>`}</span></td>`,
      pos: s => `<td>${esc(s.p.pos)}</td>`, age: s => `<td class="num">${s.p.age}</td>`, lg: s => `<td>${esc(leagueName(s.p.lg))}</td>`, cl: s => `<td>${tname(clubOf(s.p))}</td>`,
      ca: s => `<td class="num">${fmt(s.p.ca, 0)}</td>`, pa: s => `<td class="num">${fmt(s.p.pa, 0)}</td>`,
      peak: s => `<td class="num nowrap"><b>${fmt(s.mid, 0)}</b> <span class="rangebar" title="${s.lo.toFixed(0)} – ${s.hi.toFixed(0)}"><i style="left:${W(s.lo)}%;width:${(W(s.hi) - W(s.lo)).toFixed(1)}%"></i><b style="left:${W(s.mid)}%"></b></span></td>`,
      lo: s => `<td class="num">${fmt(s.lo, 0)}</td>`, hi: s => `<td class="num">${fmt(s.hi, 0)}</td>`,
      fut: s => `<td class="num">${scoutStars(s.p.sc?.fut)}</td>`,
      tier: s => `<td class="small">${esc(DRAFT_COLS.find(c => c[0] === "tier")[2](s)) || dash}</td>`,
      role: s => `<td class="small">${esc(s.p.sc?.role || "") || dash}</td>`, other: s => `<td class="small">${esc(s.other) || dash}</td>`,
    };
    const tiers = DR.sort === "ours" && DR.dir === 1;
    let lastTier = null;
    view.querySelector("#d-body").innerHTML = shown.slice(0, DR.limit).map(s => {
      const brk = tiers && s.tier !== lastTier ? `<tr class="dtier"><th colspan="${COLS.length + 1}" scope="rowgroup">Tier ${s.tier}</th></tr>` : "";
      lastTier = s.tier;
      return `${brk}<tr class="link${pk && s.nhl < pk ? " dgone" : ""}" data-k="${esc(s.p.k)}"><td class="dstarc">${starBtn(s.p.k)}</td>${COLS.map(([k]) => cells[k](s)).join("")}</tr>`
        + (DR.open.has(s.p.k) ? `<tr class="dexp"><td colspan="${COLS.length + 1}">${whyList(s, rows)}
            <p class="small muted">Est. PA ${fmt(s.p.pa, 0)} (likely ${fmt(s.p.pa_lo, 0)}–${fmt(s.p.pa_hi, 0)}) · safe ${fmt(s.lo, 0)} · upside ${fmt(s.hi, 0)}${s.other ? ` · ${esc(s.other)}` : ""}</p>${scoutBrief(s.p)}</td></tr>` : "");
    }).join("");
    view.querySelector("#d-more-wrap").innerHTML = shown.length > DR.limit ? `<button class="ghost" id="d-more" type="button">Show more (${shown.length - DR.limit} left)</button>` : "";
    view.querySelector("#d-more")?.addEventListener("click", () => { DR.limit += 200; body(); });
    view.querySelectorAll("#d-body tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a, button")) playerRow(tr); });
    view.querySelectorAll("#d-body .dx").forEach(b => b.onclick = () => { DR.open.has(b.dataset.k) ? DR.open.delete(b.dataset.k) : DR.open.add(b.dataset.k); body(); });
    view.querySelectorAll("#d-body [data-star]").forEach(b => b.onclick = () => { toggleShort(b.dataset.star); body(); drawShort(); });
    const best = view.querySelector("#d-best"), avail = pk ? rows.filter(s => s.nhl >= pk && (!DR.grp || s.p.grp === DR.grp)).slice(0, 3) : [];
    best.hidden = !avail.length;
    best.innerHTML = avail.length ? `Likely still there at #${pk}, going by the NHL list: ${avail.map(s => `<a href="${route(s.p.k)}">${esc(s.p.n)}</a> <span class="muted">(ours #${s.ours}, NHL #${s.nhl})</span>`).join(", ")}. Greyed rows are expected to be gone; real drafts rarely follow the list exactly.` : "";
  };
  const drawShort = () => {
    const box = view.querySelector("#d-short"), list = [...DR_MORE.short].map(k => byKey.get(k)).filter(Boolean);
    box.hidden = !list.length;
    if (!list.length) { box.innerHTML = ""; return; }
    const picked = list.filter(p => DR_MORE.cmp.has(p.k));
    box.innerHTML = `<h2>Shortlist <span class="muted">${list.length}</span></h2><div class="dchips">${list.map(p => {
        const on = DR_MORE.cmp.has(p.k), full = !on && picked.length >= 4;
        return `<span class="dchip"><a href="${route(p.k)}">${esc(p.n)}</a>
          <label class="small"><input type="checkbox" data-cmp="${esc(p.k)}" ${on ? "checked" : ""} ${full ? "disabled" : ""}> Compare</label>
          <button type="button" class="ghost small" data-unstar="${esc(p.k)}" aria-label="Remove ${esc(p.n)} from shortlist">Remove</button></span>`;
      }).join("")}</div>
      ${picked.length >= 2 ? draftCompare(picked, byK) : `<p class="small muted">Tick 2 to 4 players to compare them.</p>`}`;
    box.querySelectorAll("[data-cmp]").forEach(c => c.onchange = () => { c.checked ? DR_MORE.cmp.add(c.dataset.cmp) : DR_MORE.cmp.delete(c.dataset.cmp); drawShort(); });
    box.querySelectorAll("[data-unstar]").forEach(b => b.onclick = () => { toggleShort(b.dataset.unstar); body(); drawShort(); });
  };
  view.querySelectorAll("#d-filters .dfgrid input").forEach(inp => inp.addEventListener("input", () => {
    DR.f[inp.dataset.k] = inp.value; DR.limit = 150; body();
    view.querySelector("#d-filter").textContent = `Filters${active() ? ` (${active()})` : ""}`;
  }));
  view.querySelectorAll("th.sort").forEach(th => {
    const go = () => {
      const k = th.dataset.k, col = DRAFT_COLS.find(c => c[0] === k);
      DR.dir = DR.sort === k ? -DR.dir : (col[3] && !["ours", "nhl", "age"].includes(k) ? -1 : 1);
      DR.sort = k; renderDraft();
      view.querySelector(`th.sort[data-k="${k}"]`)?.focus();
    };
    th.onclick = go;
    th.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  view.querySelectorAll("#d-mode button").forEach(b => b.onclick = () => { DR.mode = b.dataset.m; renderDraft(); });
  [["d-grp", "grp"], ["d-lg", "lg"], ["d-sc", "scouted"]].forEach(([id, k]) => view.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
    DR[k] = b.dataset.v; DR.limit = 150; renderDraft();
  }));
  view.querySelector("#d-clear").onclick = () => { DR.f = {}; DR.grp = DR.lg = DR.scouted = ""; renderDraft(); };
  view.querySelector("#d-filter").onclick = () => { DR_MORE.open = !DR_MORE.open; renderDraft(); };
  view.querySelector("#d-morecols").onclick = () => { DR_MORE.more = !DR_MORE.more; renderDraft(); };
  view.querySelector("#d-only").onclick = () => { DR_MORE.onlyShort = !DR_MORE.onlyShort; renderDraft(); };
  view.querySelector("#d-pick").addEventListener("input", e => { DR_MORE.pick = e.target.value; store("ehm-draft-pick", DR_MORE.pick); body(); });
  bindDraftHead();
  body();
  drawShort();
}
/* 2-4 shortlisted players side by side. A player no longer on the list still compares on his own numbers. */
function draftCompare(list, byK) {
  const row = (lab, f) => `<tr><th scope="row">${lab}</th>${list.map(p => `<td class="num">${f(p, byK.get(p.k))}</td>`).join("")}</tr>`;
  return `<div class="tablewrap"><table class="rank dcompare"><thead><tr><th></th>${list.map(p => `<th class="num"><a href="${route(p.k)}">${esc(p.n)}</a></th>`).join("")}</tr></thead><tbody>
    ${row("Ours", (p, s) => (s ? `<b>${s.ours}</b>` : dash))}${row("NHL rank", (p, s) => (s ? s.nhl : dash))}
    ${row("Position", p => esc(p.pos))}${row("Age", p => p.age)}${row("Playing for", p => tname(clubOf(p)))}
    ${row("Current ability", p => fmt(p.ca, 0))}${row("Projected peak", p => `<b>${fmt(sortVal(p, "peak"), 0)}</b>`)}
    ${row("Likely peak range", (p, s) => (s ? `${fmt(s.lo, 0)}–${fmt(s.hi, 0)}` : dash))}${row("Peak over slot", (p, s) => (s && EV_SLOT ? signed(s.gap, 0) : dash))}
    ${row("Est. PA", p => `${fmt(p.pa, 0)} <span class="muted small">${fmt(p.pa_lo, 0)}–${fmt(p.pa_hi, 0)}</span>`)}
    ${row("Recent change", p => { const m = lastMove(p); return m == null ? dash : signed(m, 1); })}
    ${row("Scout, future", p => scoutStars(p.sc?.fut))}${row("Preferred role", p => esc(p.sc?.role || "") || dash)}
    </tbody></table></div>
    <div class="dcbars" style="--n:${list.length}">${list.map(p => `<div><h3><a href="${route(p.k)}">${esc(p.n)}</a></h3><div class="bars">${(p.grpS || []).map(([name, avg, pct]) => barRow(name, avg.toFixed(1) + "/20", pct, null, pRankHref("g", name, p.grp, p.k))).join("")}</div></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- underrated finder
const UD = { grp: "" };
function underratedPlot(rows) {
  const X = 720, Y = 340, L = 54, R = 16, T = 14, B = 44;
  const maxN = Math.max(...rows.map(s => s.nhl)), maxO = Math.max(...rows.map(s => s.ours));
  const x = n => X - R - (n - 1) / (maxN - 1 || 1) * (X - L - R), y = o => T + (o - 1) / (maxO - 1 || 1) * (Y - T - B);
  // name the biggest gaps, skipping any whose label would land on one already placed
  const lab = [];
  rows.filter(s => s.under).sort((a, b) => b.gap - a.gap).forEach(s => {
    if (lab.length < 6 && !lab.some(o => Math.abs(y(o.ours) - y(s.ours)) < 16 && Math.abs(x(o.nhl) - x(s.nhl)) < 90)) lab.push(s);
  });
  return `<svg class="dplot" viewBox="0 0 ${X} ${Y}" role="img" aria-label="NHL rank against our rank. The table below holds the same players.">
    <line class="axis" x1="${L}" y1="${Y - B}" x2="${X - R}" y2="${Y - B}"/><line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${Y - B}"/>
    <line class="even" x1="${x(maxN)}" y1="${y(Math.min(maxN, maxO))}" x2="${x(1)}" y2="${y(1)}"/>
    <text x="${(X + L) / 2}" y="${Y - 10}" text-anchor="middle">NHL rank (better to the right)</text>
    <text x="${X - R}" y="${Y - B + 16}" text-anchor="end">#1</text><text x="${L}" y="${Y - B + 16}">#${maxN}</text>
    <text x="14" y="${(Y - B + T) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(Y - B + T) / 2})">Our rank (better going up)</text>
    <text x="${L - 6}" y="${T + 4}" text-anchor="end">#1</text><text x="${L - 6}" y="${Y - B}" text-anchor="end">#${maxO}</text>
    ${rows.map(s => `<a href="${route(s.p.k)}" aria-label="${esc(s.p.n)}, ours ${s.ours}, NHL ${s.nhl}"><circle class="${s.under ? "flag" : "rest"}" cx="${x(s.nhl).toFixed(1)}" cy="${y(s.ours).toFixed(1)}" r="${s.under ? 5 : 3.5}"><title>${esc(s.p.n)}: ours #${s.ours}, NHL #${s.nhl}${EV_SLOT ? `, peak ${signed(s.gap, 0)} over slot` : ""}</title></circle></a>`).join("")}
    ${lab.map(s => `<text class="lab" x="${(x(s.nhl) + (x(s.nhl) > X - 110 ? -8 : 8)).toFixed(1)}" y="${(y(s.ours) + 4).toFixed(1)}" text-anchor="${x(s.nhl) > X - 110 ? "end" : "start"}">${esc(s.p.n.split(" ").pop())}</text>`).join("")}
  </svg>`;
}
function renderUnderrated() {
  const { rows: all } = draftBoard("mid");
  const rows = all.filter(s => !UD.grp || s.p.grp === UD.grp);
  const under = rows.filter(s => s.under).sort((a, b) => b.gap - a.gap);
  const top = under.filter(s => s.nhl <= 60), deep = under.filter(s => s.nhl > 60);
  const over = rows.filter(s => s.nhl <= 60 && EV_SLOT && s.gap <= -EV_SLOT.threshold).sort((a, b) => a.gap - b.gap).slice(0, 8);
  const flagRow = s => listRow(s.p, `<span class="lnum dstack"><b class="up">${signed(s.gap, 0)}</b><small>over slot</small></span>${starBtn(s.p.k)}`,
    `${rankLink("#/draft", `NHL #${s.nhl}`)} · ours #${s.ours} · ${esc(s.p.pos)} · ${s.p.age} · ${tname(clubOf(s.p))}`);
  const ages = all.map(s => s.p.age), loAge = Math.min(...ages), hiAge = Math.max(...ages);
  const cut = all.map(s => s.mid).sort((a, b) => b - a)[59] ?? Infinity;
  const pool = prospectPool(false).filter(x => !UD.grp || x.p.grp === UD.grp);
  const long = pool.filter(x => !x.o && !x.r && !x.p.dft?.pro && x.p.age >= loAge && x.p.age <= hiAge && x.peak >= cut).sort(byPeak).slice(0, 12);
  const older = pool.filter(x => !x.o && undraftedKind(x) === "older").sort(byPeak).slice(0, 12);
  const off = EV_DATA?.off_list;
  const pad = (a, b) => `<div class="drows">${a.map(flagRow).join("") || `<p class="muted small">${b}</p>`}</div>`;
  view.innerHTML = `${draftHead("underrated")}<div class="wrap page draftroom">
    <div class="dintro"><p class="sub">Players whose projected peak is well above what their NHL slot usually projects to. ${under.length} of ${rows.length} are flagged on the ${fmtDate(D.dates.at(-1))} list.</p>${flagEvidence()}</div>
    <div class="dbar">${segCtl("u-grp", "Position", [["", "All"], ["F", "F"], ["D", "D"], ["G", "G"]], UD.grp)}</div>
    ${rows.length ? underratedPlot(rows) : `<p class="muted small">No NHL draft ranking in the latest snapshot.</p>`}
    <div class="dcols">
      <section aria-labelledby="u1"><h2 id="u1">Ranked too low, NHL top 60</h2><p class="sub">Where the flag has held up best in testing.</p>${pad(top, "Nobody flagged here.")}</section>
      <section aria-labelledby="u2"><h2 id="u2">Ranked too low, deeper</h2><p class="sub">Better than their slot, but past players this deep rarely reached NHL level.</p>${pad(deep, "Nobody flagged here.")}</section>
    </div>
    <div class="dcols">
      <section aria-labelledby="u3"><h2 id="u3">Long shots: not on the NHL list</h2>
        <p class="sub">Aged ${loAge}–${hiAge}, no NHL club, never drafted, with a projected peak inside the list's top 60. Not underrated by default${off?.pa_true != null ? `: on past Final lists, similar players' true PA averaged ${fmt(off.pa_true, 0)} against ${fmt(off.peer_pa, 0)} for listed peers` : ""}.</p>
        <div class="drows">${long.map(x => prospectRow(x, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}`)).join("") || `<p class="muted small">None.</p>`}</div></section>
      <section aria-labelledby="u4"><h2 id="u4">Past draft age, never drafted</h2><p class="sub">Aged 20–${PROSPECT_AGE} with no NHL club. Sorted by projected peak; this list hasn't been tested.</p>
        <div class="drows">${older.map(x => prospectRow(x, `${esc(x.p.pos)} · ${x.p.age} · ${tname(clubOf(x.p))}${x.p.lg ? ` (${esc(x.p.lg)})` : ""}`)).join("") || `<p class="muted small">None.</p>`}</div></section>
    </div>
    ${over.length ? `<section aria-labelledby="u5"><h2 id="u5">Ranked higher by the NHL than the projection</h2><p class="sub">NHL top 60, projected peak well under the slot. For context: this direction hasn't been tested, so don't read it as a warning.</p>
      <div class="drows two">${over.map(s => listRow(s.p, `<span class="lnum dstack"><b class="down">${signed(s.gap, 0)}</b><small>vs slot</small></span>`, `${rankLink("#/draft", `NHL #${s.nhl}`)} · ours #${s.ours} · ${esc(s.p.pos)} · ${s.p.age} · ${tname(clubOf(s.p))}`)).join("")}</div></section>` : ""}
    <div class="tablewrap"><table class="rank dudtable"><caption class="sub">Everyone in the chart</caption><thead><tr><th class="num">Ours</th><th class="num">NHL</th><th>Player</th><th class="num">Proj. peak</th><th class="num">Over slot</th></tr></thead><tbody>
      ${rows.map(s => `<tr class="link" data-k="${esc(s.p.k)}"><td class="num"><b>${s.ours}</b></td><td class="num">${s.nhl}</td><td><a href="${route(s.p.k)}"><b>${esc(s.p.n)}</b></a>${s.under ? ' <span class="dflag">Underrated</span>' : ""}</td><td class="num">${fmt(s.mid, 0)}</td><td class="num">${EV_SLOT ? signed(s.gap, 0) : dash}</td></tr>`).join("")}
    </tbody></table></div>
  </div>`;
  view.querySelectorAll("#u-grp button").forEach(b => b.onclick = () => { UD.grp = b.dataset.v; renderUnderrated(); });
  view.querySelectorAll("[data-star]").forEach(b => b.onclick = () => { toggleShort(b.dataset.star); renderUnderrated(); });
  view.querySelectorAll(".dudtable tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a, button")) playerRow(tr); });
  bindDraftHead();
}
