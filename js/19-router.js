"use strict";

// ---------------------------------------------------------------- router
let keepScroll = false;   // set for a re-render that shouldn't jump to the top (theme toggle)
function render() {
  const raw = location.hash.slice(1), h = decodePart(raw);
  tip.hidden = true;
  if (raw.startsWith("/p/")) {
    markNav("players");
    // #/p/<encoded key>[/<tab>]: the key is URI-encoded, so a raw "/" only separates the tab
    const [k, tab] = raw.slice(3).split("/");
    renderPlayer(decodePart(k), tab || "overview");
    return;
  }
  if (h === "/players" || h.startsWith("/players/")) renderRankings(raw.slice(9));
  else if (h === "/prospects" || raw.startsWith("/prospects/")) renderProspects(raw.slice(11) || "overview");
  else if (h === "/about" || raw.startsWith("/about/")) renderAbout(raw.slice(7));
  else if (h === "/draft" || raw.startsWith("/draft/")) { const [t, y, pk] = raw.slice(7).split("/"); renderDraft(t || "board", y, pk); }
  else if (h === "/value" || raw.startsWith("/value/")) renderValue(raw.slice(7) || undefined);
  else if (h === "/teams") renderTeams(null);
  else if (h === "/trades" || raw.startsWith("/trades/")) { const [s, q] = raw.slice(8).split("/"); renderTrades(s, q); }
  else if (raw.startsWith("/league/")) {
    const [lg, tab, s, k] = raw.slice(8).split("/").map(decodePart);
    renderLeague(lg, tab || "overview", s, k);
  }
  else if (raw.startsWith("/team/")) {
    const [c, tab, x, y] = raw.slice(6).split("/");
    renderTeams(decodePart(c), TEAM_TABS.includes(tab) ? tab : "roster", x && decodePart(x), y && decodePart(y));
  }
  else if (raw.startsWith("/rank/")) renderRank(raw.slice(6));
  else if (h === "/hof" || raw.startsWith("/hof/")) { nhlPeople(); renderHof(raw.slice(5)); }
  else if (h === "/playoffs" || raw.startsWith("/playoffs/")) renderPlayoffs(raw.slice(10));
  else if (h === "/gms" || raw.startsWith("/gms/")) renderGms(raw.slice(5));
  else if (raw.startsWith("/gm/")) renderGm(decodePart(raw.slice(4)));
  else if (h === "/h2h") renderH2H();
  else if (h === "/trade") renderTrade();
  else {
    renderHome();
    if (h && h !== "/") view.insertAdjacentHTML("afterbegin", `<div class="wrap"><p class="warn notfound" role="status">There's no page at <code>#${esc(h)}</code>, so here is the home page.</p></div>`);
  }
  if (!keepScroll) window.scrollTo(0, 0);
  keepScroll = false;
  if (FOCUS_TAB != null) { view.querySelector('[role="tablist"] [role="tab"].on')?.focus(); FOCUS_TAB = null; }
}
if (!NO_DATA) {
  D.players.forEach(p => { p._n = fold(p.n); byKey.set(p.k, p); });
  (D.teamHist?.alumni || []).forEach(a => { if (!byKey.has(a.k)) ALUMNI.set(a.k, a); });
  if (!document.title.startsWith(D.title)) document.title += " · " + D.title;
  const snap = document.getElementById("foot-snap");
  // the League menu lists every league with its own pages
  document.getElementById("navmenu-league")?.insertAdjacentHTML("beforeend", leagueNames().map(l => `<a href="${leagueRoute(l)}">${esc(l)}</a>`).join(""));
  if (snap) snap.textContent = `· ${D.title} · ${D.players.length.toLocaleString()} players · snapshot ${fmtDate(D.dates.at(-1))}`;
  if (!D.gms) document.querySelectorAll('.top nav a[data-nav="gms"]').forEach(a => a.remove());
  addEventListener("hashchange", onHashChange);
  render();
}
