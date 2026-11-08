"use strict";

// ---------------------------------------------------------------- rankings behind every rank / percentile
/* Every rank or percentile on the site links here (user rule: a ranked stat opens the whole ranking).
   #/rank/team/<stat>/<club>: all NHL teams on one team stat (season stats in SEASON, "pts" = standings, "pool" =
   prospect pool value). #/rank/p/<kind>/<key>/<F|D|G>/<player>: every player of that group on one card number,
   in the card's season and game type; kind m = rate stat, c = impact tile, g = attribute group, ca = est. CA, war = WAR/82, t = trait (04b), x = derived stat (Blk/60, 04b). */
/* Rank links carry the season (and for players the regular season / playoffs choice) they were shown for, so a shared or
   bookmarked link opens the same list, not whatever season the site last had selected. */
const teamRankHref = (key, club, season = key === "pool" ? null : SEASON) => `#/rank/team/${key}/${encodeURIComponent(club)}${season ? "/" + season : ""}`;
/* Stat and composite cards are pooled by the position he played that season (card.grp: a D used as a winger ranks with
   the forwards); CA, attributes, WAR and traits stay with the listed position. */
const cardGrp = (p0, kind) => (kind === "m" || kind === "c") ? (cardOf(p0, kind)?.card?.grp || p0.grp) : p0.grp;
const pRankHref = (kind, key, grp, k) => { const p0 = byKey.get(k);
  return `#/rank/p/${kind}/${encodeURIComponent(key)}/${p0 ? cardGrp(p0, kind) : grp}/${encodeURIComponent(k)}`
    + (["m", "c", "war", "x"].includes(kind) && SEASON ? `/${SEASON}/${PMODE}` : ""); };
const rankLink = (href, html) => `<a class="ranklink" href="${href}">${html}</a>`;
function cardOf(p0, kind) {   // the card the player page shows: season, then playoffs when PMODE is on (not for CA / attributes)
  const b = inSeason(p0);
  if (kind === "ca" || kind === "g" || PMODE !== "po") return b;
  return b.po ? { ...b, card: { ...b.po.card, ca_pct: b.card?.ca_pct }, war: b.po.war, _po: true } : null;
}
function teamRankRows(key) {
  if (key === "pool") {
    const rows = nhlClubs().map(c => ({ club: c, v: poolValue(listedBy(c)), txt: null })).sort((a, b) => b.v - a.v);
    rows.forEach((r, i) => { r.rank = i + 1; r.txt = fmt(r.v, 1); });
    return { rows, title: "Prospect pool value", sub: "Expected WAR per season at projected peak, summed over each club's Top Prospects list", seasonal: false };
  }
  const T = teamTable(SEASON);
  if (!T) return null;
  const label = Object.fromEntries((D.teamStatKeys || []).map(([k, l]) => [k, l]));
  const rows = Object.entries(T.teams).map(([abbr, r]) => {
    const club = clubOfAbbr(abbr);
    if (key === "pts") return { club, v: r.pts, rank: r.place, txt: `${r.pts}`, extra: `${r.w}–${r.l}–${r.otl} · ${r.gp} GP` };
    const s = r.stats[key];
    return s ? { club, v: s[0], rank: s[1], txt: statFmt(key, s[0]) } : null;
  }).filter(Boolean).sort((a, b) => a.rank - b.rank);
  if (!rows.length) return null;
  return { rows, title: key === "pts" ? "Standings points" : label[key] || key, seasonal: true,
           sub: `${seasonLabel(SEASON)} regular season · league average ${key === "pts" ? statFmt("pts", T.avg.pts) : statFmt(key, T.avg[key])} · 1st is best` };
}
function playerRankRows(kind, key, grp) {
  if (kind === "po") {
    const rows = playoffForms().map((x, i) => ({ p: x.p, pct: x.pct, ca: x.p.ca, rank: i + 1,
      txt: `${signed(x.f.delta, 2)} (playoffs ${x.f.po82.toFixed(1)} vs ${x.f.rs82.toFixed(1)}, ${x.f.gp} GP)` }));
    return { rows, title: "Playoff performer", ranked: true,
             sub: "Playoff WAR/82 minus the same seasons' regular-season WAR/82, recent seasons weighted more, pulled toward 0 for small samples · every player with NHL playoff games" };
  }
  if (kind === "t" || kind === "x") return kind === "t" ? traitRankRows(key, grp) : derivedRankRows(key, grp);
  const val = {
    m: p => p.card?.pct?.[key] == null ? null : [p.card.pct[key], rawFmt(key, p.card.raw?.[key])],
    c: p => p.card?.comp?.[key] == null ? null : [p.card.comp[key], null],
    g: p => { const g = (p.grpS || []).find(x => x[0] === key); return g ? [g[2], g[1].toFixed(1) + "/20"] : null; },
    ca: p => p.card?.ca_pct == null ? null : [p.card.ca_pct, fmt(p.ca, 0)],
    war: p => p.war?.pct == null ? null : [p.war.pct, `${p.war.war82.toFixed(1)} per 82 · ${p.war.war.toFixed(1)} in ${p.war.gp} GP`],
  }[kind];
  if (!val) return null;
  const rows = D.players.filter(p => cardGrp(p, kind) === grp).map(p0 => {
    const p = cardOf(p0, kind), x = p && val(p);
    return x ? { p, pct: x[0], txt: x[1], ca: p.ca } : null;
  }).filter(Boolean).sort((a, b) => b.pct - a.pct || b.ca - a.ca);
  rows.forEach((r, i) => { r.rank = i && r.pct === rows[i - 1].pct ? rows[i - 1].rank : i + 1; });
  const metric = [...(D.skaterMetrics || []), ...(D.goalieMetrics || [])].find(m => m[0] === key);
  const title = { m: metric?.[1] || key, c: COMP_LABELS[key] || key, g: key, ca: "Est. current ability", war: "WAR per 82 GP" }[kind];
  const grpName = { F: "forwards", D: "defence", G: "goalies" }[grp];
  const games = kind === "ca" || kind === "g" ? "whole database" : `${SEASON ? seasonLabel(SEASON) : ""} ${PMODE === "po" ? "playoffs" : "regular season"}, NHL players with a big enough sample`;
  return { rows, title, sub: `Every ${grpName.replace(/s$/, "")} with a value · ${games} · percentile vs this list` };
}
function renderRank(raw) {
  // ["team", key, club, season?] or ["p", kind, key, grp, player, season?, rs|po?]
  const parts = raw.split("/").map(decodePart);
  const isTeam = parts[0] === "team";
  markNav(isTeam ? "teams" : "players");
  if (isTeam && SEASONS.includes(parts[3])) SEASON = parts[3];
  if (!isTeam && SEASONS.includes(parts[5])) SEASON = parts[5];
  if (!isTeam && ["rs", "po"].includes(parts[6])) PMODE = parts[6];
  const R = isTeam ? teamRankRows(parts[1]) : parts[0] === "p" ? playerRankRows(parts[1], parts[2], parts[3]) : null;
  if (!R || !R.rows.length) { view.innerHTML = `<div class="wrap page"><div class="panel">No ranking here. <a href="#/teams">Teams</a> · <a href="#/players">Players</a></div></div>`; return; }
  const me = isTeam ? parts[2] : parts[4];
  // a team in a team ranking opens the tab the ranking is about: prospect pool -> Prospects, standings -> Roster, stats -> Team stats
  const tabFor = !isTeam ? "" : parts[1] === "pool" ? "/prospects" : parts[1] === "pts" ? "" : "/stats";
  const back = isTeam ? (hasClub(me) ? `<a href="${teamRoute(me)}${parts[1] === "pool" ? "/prospects" : parts[1] === "pts" ? "" : "/stats"}">← ${esc(me)}</a>` : "")
    : (me && byKey.get(me) ? `<a href="${route(me)}">← ${esc(byKey.get(me).n)}</a>` : "");
  const seasons = isTeam && R.seasonal ? SEASONS.filter(s => teamTable(s)?.teams) : !isTeam && !["ca", "g", "po", "t"].includes(parts[1]) ? SEASONS : [];
  const body = isTeam
    ? `<table class="rank"><thead><tr><th class="num">Rank</th><th>Team</th><th class="num">${esc(R.title)}</th>${R.rows[0].extra ? "<th>Record</th>" : ""}</tr></thead><tbody>
        ${R.rows.map(r => `<tr class="tlink${r.club === me ? " hl" : ""}" data-club="${esc(r.club)}"><td class="num">${rankChip(r.rank, R.rows.length)}</td>
          <th scope="row" class="nowrap"><a href="${teamRoute(r.club)}${tabFor}">${logo(r.club, 24)} ${esc(r.club)}</a></th><td class="num"><b>${r.txt}</b></td>${r.extra ? `<td class="small muted">${r.extra}</td>` : ""}</tr>`).join("")}</tbody></table>`
    : `<table class="rank"><thead><tr><th class="num">Rank</th><th class="pcol">Player</th><th>Club</th><th class="num">Age</th><th class="num">Est. CA</th>${R.rows.some(r => r.txt) ? `<th class="num">${esc(R.title)}</th>` : ""}<th class="num">Percentile</th></tr></thead><tbody>
        ${R.rows.map(r => `<tr class="link${r.p.k === me ? " hl" : ""}" data-k="${esc(r.p.k)}"><td class="num">${r.rank}</td>
          <th scope="row" class="pcol"><a class="pcell" href="${route(r.p.k)}"><span><b>${esc(r.p.n)}</b></span></a></th>
          <td class="nowrap">${tlink(clubOf(r.p), `${logo(clubOf(r.p), 22)} ${esc(clubOf(r.p))}`)}${r.p.lg && r.p.lg !== "NHL" ? ` <span class="muted small">${esc(r.p.lg)}</span>` : ""}</td>
          <td class="num">${r.p.age}</td><td class="num">${fmt(r.p.ca, 0)}</td>${R.rows.some(x => x.txt) ? `<td class="num">${esc(r.txt || "")}</td>` : ""}<td class="num">${impPill(r.pct)}</td></tr>`).join("")}</tbody></table>`;
  view.innerHTML = `<section class="band"><div class="wrap"><div class="cardbar">${back}<span></span></div><h1>${esc(R.title)}</h1>
      <p class="lede">${R.sub}. ${R.rows.length} ${isTeam ? "teams" : "players"}.</p></div></section>
    <div class="wrap page">
      ${seasons.length > 1 ? `<div class="cardbar"><span></span>${seasonSelect("rk-season", seasons, SEASON)}</div>` : ""}
      <section class="card-box flush"><div class="tablewrap">${body}</div></section></div>`;
  view.querySelector("#rk-season")?.addEventListener("change", e => {
    SEASON = e.target.value;
    location.hash = isTeam ? teamRankHref(parts[1], parts[2] || "", SEASON) : pRankHref(parts[1], parts[2], parts[3], parts[4] || "");
  });
  view.querySelectorAll("tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) playerRow(tr); });
  view.querySelectorAll("tr.tlink").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = teamRoute(tr.dataset.club) + tabFor; });
  const hl = view.querySelector("tr.hl");
  if (hl) setTimeout(() => hl.scrollIntoView({ block: "center" }), 0);
}

// ---------------------------------------------------------------- back: one level up
/* The "←" link always goes up, never sideways, so it can't loop (2026-10-27, user's choice; it used to follow a stack
   of visited pages that could disagree with the browser's history). A player page goes back to the page he was opened
   from (ORIGIN: the last non-player page before entering, kept through his tabs and any players opened from him), or
   Players when opened directly. Every other page goes to its parent (parentOf), ending at Home. The browser's own
   Back is untouched. Going to the back target, either way, restores that page's scroll position. */
const SCROLL = new Map();
let ORIGIN = null;
const pkeyOf = h => (h.startsWith("#/p/") ? h.slice(4).split("/")[0] : null);
function parentOf(hash) {
  const parts = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return "#/";
  if ((parts[0] === "team" || parts[0] === "league") && parts.length === 2) return "#/teams";
  if (parts[0] === "playoffs" && !playoffSeasons().includes(parts[1])) return "#/playoffs";   // a made-up season
  if (parts[0] === "playoffs" && parts[2] === "game") return `#/playoffs/${parts[1]}/games`;
  if (parts[0] === "rank") return "#/players";
  return "#/" + parts.slice(0, -1).join("/");
}
const backTarget = hash => (pkeyOf(hash) ? ORIGIN ?? "#/players" : parentOf(hash));
const TEAM_TAB_LABEL = { players: "Player stats", results: "Results", contracts: "Contracts", trades: "Trades", prospects: "Prospects & picks", drafts: "Draft history", stats: "Team stats", history: "History", hof: "Hall of Fame" };
function routeLabel(hash) {
  const parts = hash.slice(2).split("/").map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  switch (parts[0]) {
    case "p": { const p = byKey.get(parts[1]) || ALUMNI.get(parts[1]); return p ? p.n : "Player"; }
    case "players": return "Players";
    case "prospects": return "Prospects" + (parts[1] ? " · " + (PROSPECT_TABS.find(t => t[0] === parts[1])?.[1] || parts[1]) : "");
    case "draft": return parts[1] === "past" ? "Past drafts" : parts[1] === "scores" ? "Drafters" : parts[1] === "underrated" ? "Underrated" : "Draft board";
    case "teams": return "Teams";
    case "value": return "Value" + (parts[1] ? " · " + (VALUE_TABS.find(t => t[0] === parts[1])?.[1] || parts[1]) : "");
    case "team": return parts[1] + (TEAM_TAB_LABEL[parts[2]] ? " · " + TEAM_TAB_LABEL[parts[2]] : "");
    case "rank": return "Ranking";
    case "hof": return "Hall of Fame";
    case "playoffs": return parts[2] === "game" ? "Playoff box score" : parts[2] === "games" ? (parts[3] ? "Playoff series" : "Playoff games") : "Playoffs" + (parts[1] ? " " + seasonLabel(parts[1]) : "");
    case "league": return parts[1] || "League";
    case "h2h": return "Head to head";
    case "trade": return "Trade predictor";
    case "about": return "How it works";
    default: return "Home";
  }
}
/* "← one level up" from the current page (backTarget). */
function backLink() {
  const h = backTarget(location.hash) || "#/";
  return `<a href="${esc(h)}">← ${esc(routeLabel(h))}</a>`;
}
function onHashChange(e) {
  const from = new URL(e.oldURL).hash, to = location.hash;
  SCROLL.set(from || "#/", scrollY);
  const restore = (to || "#/") === (backTarget(from) || "#/");
  if (pkeyOf(to) && !pkeyOf(from)) ORIGIN = from || "#/";   // entering players; player-to-player keeps the origin
  render();
  const y = restore && SCROLL.get(to || "#/");
  if (y) { scrollTo(0, y); setTimeout(() => scrollTo(0, y), 0); }   // again after charts that draw late
}
