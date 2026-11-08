/* EHM Player Cards: static site over data/ehm_data.js (built by build_data.py). */
"use strict";

/* Scripts load in order (index.html), each file may only run code at load that uses names of earlier files. Without the
   data file the later files still load, on an empty stand-in (no cascade of TypeErrors), and 19-router.js starts nothing. */
const NO_DATA = !window.EHM_DATA;
const D = window.EHM_DATA || { players: [], dates: [], seasons: [] };
if (NO_DATA) {
  document.getElementById("view").innerHTML = `<div class="wrap page"><div class="panel">No data found. Run <code>python build_data.py</code> in the website folder first.</div></div>`;
  console.error("data/ehm_data.js is missing");
}
// History rows that repeat the previous row's attributes arrive as [snapshot, est CA] (build_data.compact_history):
// expand them here, before anything reads p.h, so every page sees full rows as before.
for (const p of D.players) {
  let prev = null;
  p.h = (p.h || []).map(r => (prev = r.length > 2 || !prev ? r : [r[0], r[1], ...prev.slice(2)]));
}
const MY_TEAM = D.myTeam || "Montréal";  // the user's club (build_data --my-team): default side in head to head / trades
const RIVAL = MY_TEAM === "Toronto" ? "Montréal" : "Toronto";
// every file:// page shares one localStorage: keep a league's own settings (cap, home team) apart
const storeKey = k => D.siteKey ? `${k}-${D.siteKey}` : k;
const view = document.getElementById("view");
const tip = document.getElementById("tip");
const byKey = new Map();
const ALUMNI = new Map();   // players who left the data: a former-player page (renderFormer), no card
const hasPage = k => byKey.has(k) || ALUMNI.has(k);
const COMP_LABELS = {
  impact: "Overall impact", offence: "Offence", playmaking: "Playmaking", finishing: "Finishing",
  defence: "Defence", usage: "Usage", discipline: "Discipline",
};
const TIP_PCT = "Percentile within the comparison pool: 50 = median, 90 = better than 90%.";
