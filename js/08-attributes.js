"use strict";

/* The game's own role -> attribute tiers (decoded from ehm.exe, player.cpp FUN_00a992a0): per role the Key, Essential,
   Non-essential and Irrelevant visible attributes, "K | E | N | I"; anything not listed gets no highlight. Hidden attributes
   are left out. Faceoffs and Deflections are overrides applied in roleTier. Names without a suffix are the base of
   "<base> Goalie" / "<base> Defenseman" / "<base> Winger" and "<base> Center"; "Pointman" roles have no suffix in the data. */
const ROLE_TIERS = (() => {
  const text = {
    G: `Mixed Style: Positioning, Reflexes | Agility, Blocker, Glove, Rebound Control | Acceleration, Speed, Recovery | Flair, Strength
Butterfly: Agility, Recovery | Blocker, Glove, Positioning, Reflexes | Acceleration, Speed, Rebound Control | Flair, Strength
Standup: Positioning, Stickhandling | Blocker, Glove, Rebound Control, Reflexes | Acceleration, Agility, Speed | Flair, Strength
Unorthodox: Agility, Flair | Blocker, Glove, Reflexes, Stickhandling | Acceleration, Speed | Recovery, Strength`,
    D: `Offensive: Off The Puck, Passing | Anticipation, Pokecheck, Stickhandling, Creativity, Wristshot | Checking, Strength | Hitting
Finesse Offensive: Passing, Creativity | Off The Puck, Pokecheck, Slapshot, Stickhandling, Wristshot | Bravery, Hitting | Strength
Physical Offensive: Passing, Strength | Checking, Hitting, Off The Puck, Slapshot, Creativity | Agility, Bravery | Pokecheck
Pointman: Passing, Slapshot | Pokecheck, Positioning, Stickhandling, Creativity, Wristshot | Bravery, Deking, Hitting, Strength | -
Finesse Pointman: Passing, Wristshot | Anticipation, Pokecheck, Positioning, Slapshot, Stickhandling | Bravery, Hitting | Strength
Physical Pointman: Slapshot, Strength | Bravery, Checking, Hitting, Passing, Positioning | Creativity, Wristshot | Pokecheck
Playmaking: Passing, Creativity | Anticipation, Checking, Pokecheck, Positioning | Agility, Wristshot | Slapshot
Finesse Playmaking: Passing, Creativity | Checking, Pokecheck, Positioning, Stickhandling, Wristshot | Bravery, Hitting | Strength
Physical Playmaking: Passing, Creativity | Checking, Hitting, Pokecheck, Positioning, Strength | Agility, Wristshot | Slapshot
Defensive: Checking, Positioning | Bravery, Hitting, Pokecheck, Work Rate | Passing, Slapshot, Creativity, Wristshot | -
Finesse Defensive: Checking, Positioning | Agility, Passing, Pokecheck, Stickhandling | Hitting, Off The Puck | Strength
Physical Defensive: Hitting, Strength | Balance, Checking, Pokecheck, Positioning, Work Rate | Off The Puck, Passing, Stickhandling, Wristshot | -
All-Around: Checking, Positioning | Hitting, Passing, Pokecheck, Strength | Anticipation, Slapshot, Creativity, Wristshot | -
Rugged: Aggression, Hitting | Bravery, Checking, Positioning, Strength, Work Rate | Deking, Passing, Creativity, Wristshot | Stickhandling
Enforcer: Aggression | Bravery, Hitting, Positioning, Strength | Acceleration, Speed, Passing, Slapshot, Creativity, Wristshot | Flair`,
    F: `Defensive: Checking, Positioning | Passing, Pokecheck, Strength, Work Rate | Anticipation, Slapshot, Stickhandling, Creativity | -
Finesse Defensive: Pokecheck, Positioning | Balance, Checking, Passing, Stickhandling | Hitting, Off The Puck | Strength
Physical Defensive: Hitting, Positioning | Bravery, Checking, Pokecheck, Strength | Deking, Slapshot, Creativity, Wristshot | -
Goalscoring: Slapshot, Wristshot | Anticipation, Deflections, Deking, Off The Puck, Stickhandling | Checking, Hitting, Pokecheck, Positioning | -
Finesse Goalscoring: Anticipation, Wristshot | Deflections, Deking, Off The Puck, Slapshot, Stickhandling | Aggression, Bravery, Hitting | Strength
Physical Goalscoring: Slapshot, Strength | Anticipation, Deflections, Hitting, Off The Puck, Wristshot | Checking, Pokecheck, Positioning, Creativity | -
Playmaking: Passing, Creativity | Anticipation, Deflections, Deking, Off The Puck, Stickhandling | Checking, Hitting, Positioning, Slapshot | -
Finesse Playmaking: Passing, Creativity | Anticipation, Deking, Off The Puck, Stickhandling, Wristshot | Bravery, Hitting | Strength
Physical Playmaking: Strength, Creativity | Anticipation, Deflections, Hitting, Off The Puck, Passing | Checking, Deking, Pokecheck, Positioning | -
All-Around: Positioning, Work Rate | Checking, Off The Puck, Passing, Strength, Wristshot | Anticipation, Deking, Hitting, Creativity | -
Finesse: Deking, Stickhandling | Anticipation, Off The Puck, Passing, Creativity, Wristshot | Bravery, Hitting | Strength
Grinding: Checking, Hitting | Bravery, Deflections, Strength, Work Rate | Anticipation, Deking, Off The Puck, Creativity | -
Power: Deflections, Hitting | Aggression, Bravery, Strength, Wristshot | Deking, Pokecheck, Stickhandling, Creativity | -
Enforcer: Aggression | Bravery, Hitting, Strength, Work Rate | Anticipation, Passing, Slapshot, Stickhandling, Creativity, Wristshot | Flair`,
  };
  return Object.fromEntries(Object.entries(text).map(([g, t]) => [g, Object.fromEntries(t.split("\n").map(l => {
    const [name, rest] = l.split(": ");
    return [name, rest.split(" | ").map(x => (x === "-" ? [] : x.split(", ")))];
  }))]));
})();
const ROLE_SUFFIX = / (Goalie|Defenseman|Winger|Center)$/;
const roleGrp = role => { const m = role.match(ROLE_SUFFIX)?.[1]; return m === "Goalie" ? "G" : m === "Winger" || m === "Center" ? "F" : "D"; };
/* The game's tier of one visible attribute for a role: 0 Key, 1 Essential, 2 Non-essential, 3 Irrelevant, or null. */
function roleTier(role, attr) {
  const g = roleGrp(role), tiers = ROLE_TIERS[g]?.[role.replace(ROLE_SUFFIX, "")];
  if (!tiers) return null;
  if (attr === "Faceoffs") return g === "F" ? (role.endsWith("Center") ? 0 : 2) : null;
  if (attr === "Deflections" && g === "D") return 2;
  const t = tiers.findIndex(l => l.includes(attr));
  return t < 0 ? null : t;
}
/* Every role valid for a player's position group, named as the data names them ("Offensive Defenseman", "Goalscoring Winger"). */
function rolesFor(p) {
  const suffix = { G: " Goalie", D: " Defenseman" }[p.grp] ?? (/^C/.test(p.pos) ? " Center" : " Winger");
  return Object.keys(ROLE_TIERS[p.grp]).map(b => (/Pointman$/.test(b) ? b : b + suffix)).sort();
}
const TIER_CLASS = ["key", "ess", "non", "irr"], TIER_NAME = ["Key", "Essential", "Non-essential", "Irrelevant"];
/* Attributes laid out as in the game: Technical | Mental | Physical side by side, names alphabetical, each followed by a value
   box coloured by band (1-5 red, 6-10 gold, 11-15 teal, 16-20 green) and the change since the first snapshot. Under Physical a
   "Highlight key attributes" role list (default: his scouted preferred role) tints each row by the game's tier for that role. */
function attrTables(p) {
  const last = p.h.at(-1), first = p.h[0], roles = rolesFor(p), pref = roles.includes(p.sc?.role) ? p.sc.role : "";
  const sections = { Technical: [], Mental: [], Physical: [] };
  D.attrs.forEach((a, i) => {
    const v = last[i + 2];
    if (v == null) return;
    const [sec, name] = a.split(": ");
    const d = first[i + 2] == null ? 0 : v - first[i + 2], t = pref ? roleTier(pref, name) : null;
    (sections[sec] ||= []).push([name, `<div class="arow ${t == null ? "" : "t-" + TIER_CLASS[t]}" data-i="${i}" data-n="${esc(name)}" tabindex="0" title="Chart ${esc(name)}${t == null ? "" : " · " + TIER_NAME[t] + " for " + esc(pref)}"><span class="an">${esc(name)}</span>
      <span class="ad ${d > 0 ? "up" : d < 0 ? "down" : "muted"}">${d > 0 ? "+" + d : d < 0 ? d : "·"}</span><b class="av av${v <= 5 ? 1 : v <= 10 ? 2 : v <= 15 ? 3 : 4}">${v}</b></div>`]);
  });
  const picker = `<label class="attr-role">Highlight key attributes <select id="attr-role"><option value="">None</option>${roles
    .map(r => `<option value="${esc(r)}" ${r === pref ? "selected" : ""}>${esc(r)}${r === p.sc?.role ? " (preferred)" : ""}</option>`).join("")}</select>
    <small class="muted">The game's key attributes for the role (decoded from EHM): <span class="tier t-key">Key</span> <span class="tier t-ess">Essential</span>
    <span class="tier t-non">Non-essential</span> <span class="tier t-irr">Irrelevant</span>. Default is his scouted preferred role.</small></label>`;
  return Object.entries(sections).filter(([, rs]) => rs.length).map(([s, rs]) => `<div class="attr-col"><h4>${esc(s)}</h4>
    ${rs.sort((x, y) => x[0].localeCompare(y[0])).map(x => x[1]).join("")}${s === "Physical" ? picker : ""}</div>`).join("");
}

// ---------------------------------------------------------------- projected attributes
/* Attribute change = b0*dCA + b1*dCA*(a-10)/10 + b2*m + b3*m*(age-27)/10, coefficients per position
   group and (when known) preferred role; range from the CA band plus the attribute's own noise.
   Up to 12 months the expected value comes from the forecast models instead (p.af: change after 3, 6
   and 12 months, interpolated from 0 today), which beat this model in the fair test; the range keeps
   its width, centred on that value. */
function forecastChange(p, i, m) {
  if (!p.af || m > 12) return null;
  const pts = [[0, 0], ...Object.entries(p.af).map(([k, v]) => [+k, v[i]])].sort((a, b) => a[0] - b[0]);
  if (pts.some(x => x[1] == null)) return null;
  for (let j = 1; j < pts.length; j++)
    if (m <= pts[j][0]) return pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * (m - pts[j - 1][0]) / (pts[j][0] - pts[j - 1][0]);
  return pts.at(-1)[1];
}
function projectAttrs(p, q) {
  const M = D.attrModel;
  if (!M) return [];
  const last = p.h.at(-1), age0 = q.age - q.m / 12;
  const out = [];
  D.attrs.forEach((c, i) => {
    const v0 = last[i + 2];
    const coef = (p.sc?.role && M.roles[p.sc.role]?.[c]) || M.groups[p.grp]?.[c];
    if (v0 == null || !coef) return;
    const lin = dca => v0 + coef[0] * dca + coef[1] * dca * (v0 - 10) / 10 + coef[2] * q.m + coef[3] * q.m * (age0 - 27) / 10;
    const fc = forecastChange(p, i, q.m), shift = fc == null ? 0 : v0 + fc - lin(q.mid - p.ca);
    const f = dca => lin(dca) + shift;
    const a = f(q.lo - p.ca), b = f(q.hi - p.ca), mid = f(q.mid - p.ca);
    const noise = 1.28 * coef[4] * Math.sqrt(Math.max(q.m, 0.5));
    const clamp = v => Math.max(1, Math.min(20, v));
    out.push({ c, v0, mid: clamp(mid), lo: clamp(Math.min(a, b, mid) - noise), hi: clamp(Math.max(a, b, mid) + noise),
               role: !!(p.sc?.role && M.roles[p.sc.role]?.[c]) });
  });
  return out;
}
function renderAttrProjection(p, proj, month) {
  const box = view.querySelector("#attrproj");
  if (!box || !D.attrModel) return;
  const q = proj[Math.max(1, Math.min(proj.length - 1, month))];
  const rows = projectAttrs(p, q);
  if (!rows.length) { box.innerHTML = ""; return; }
  const opts = proj.filter(x => x.m > 0 && (x.m % 6 === 0 || x.m === q.m));
  const sections = {};
  rows.forEach(r => (sections[r.c.split(": ")[0]] ||= []).push(r));
  const usesRole = rows.some(r => r.role);
  box.innerHTML = `<div class="attrproj">
    <div class="chart-head"><div><h3>Projected attributes</h3>
      <p class="sub">Click any point on the projection, or pick a date. Expected value with an 80% range, driven by the projected
      ability (${q.mid.toFixed(0)}, range ${q.lo.toFixed(0)}–${q.hi.toFixed(0)}) and ${usesRole ? `how <b>${esc(p.sc.role)}s</b>` : `how ${{ F: "forwards", D: "defencemen", G: "goalies" }[p.grp]}`}
      typically spread growth across attributes at age ${q.age.toFixed(1)}.</p></div>
      <label class="small muted">Date <select id="ap-month">${opts.map(x => `<option value="${x.m}" ${x.m === q.m ? "selected" : ""}>${fmtDate(x.date)} (age ${x.age.toFixed(1)})</option>`).join("")}</select></label>
    </div>
    <div class="attr-grid">${Object.entries(sections).map(([sec, rs]) => `<div><h4>${esc(sec)}</h4><table><thead><tr>
      <th>Attribute</th><th class="num">Now</th><th class="num">Projected</th><th class="num">Range</th><th></th></tr></thead><tbody>
      ${rs.map(r => { const d = Math.round(r.mid) - r.v0;
        return `<tr><td>${esc(r.c.split(": ")[1])}</td><td class="num">${r.v0}</td><td class="num"><b>${Math.round(r.mid)}</b></td>
          <td class="num muted">${Math.round(r.lo)}–${Math.round(r.hi)}</td>
          <td class="num ${d > 0 ? "up" : d < 0 ? "down" : "muted"}">${d > 0 ? "+" + d : d < 0 ? d : "·"}</td></tr>`; }).join("")}
      </tbody></table></div>`).join("")}</div></div>`;
  box.querySelector("#ap-month").onchange = e => renderAttrProjection(p, proj, +e.target.value);
}
