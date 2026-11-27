'use strict';
// The public stats page: reads /api/stats (real runs) and /api/game-data (names).
(function () {
  const CAREERS = { empire: 'Human (Empire)', bretonnia: 'Human (Bretonnia)', dwarf: 'Dwarf', highelf: 'High Elf', woodelf: 'Wood Elf', warrior: 'State Soldier', rogue: 'Roadwarden', wizard: 'Bright Wizard', priest: 'Sigmarite Priest', witchhunter: 'Witch Hunter', slayer: 'Dwarf Slayer', engineer: 'Imperial Engineer', waywatcher: 'Elf Waywatcher' };
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = document.getElementById('ledger');
  let GD = {};

  const bar = (v, max, cls) => `<div class="bar ${cls || ''}"><i style="width:${max ? Math.max(2, Math.round(100 * v / max)) : 0}%"></i></div>`;
  function section(title, note, inner, wide) {
    return `<section class="card${wide ? ' wide' : ''}"><h2>${title}</h2>${note ? `<p class="note">${note}</p>` : ''}${inner}</section>`;
  }
  // A summary table: name → win% bar, with runs and average depth.
  function summaryRows(obj, label) {
    const rows = Object.entries(obj || {}).filter(([, s]) => s.runs).sort((a, b) => b[1].winPct - a[1].winPct || b[1].avgDepth - a[1].avgDepth);
    if (!rows.length) return '<p class="empty">No runs yet.</p>';
    return `<div class="rows">${rows.map(([k, s]) => `<span class="lbl">${esc(label(k))}<small>${s.runs} run${s.runs > 1 ? 's' : ''} · avg depth ${s.avgDepth} · ${s.pastBoss1Pct}% past boss 1</small></span>${bar(s.winPct, 100, 'win')}<span class="num"><b>${s.winPct}%</b> won</span>`).join('')}</div>`;
  }
  function countRows(list, label, cls) {
    if (!list || !list.length) return '<p class="empty">Nothing recorded yet.</p>';
    const max = Math.max(...list.map(x => x[1]));
    return `<div class="rows">${list.map(([k, n]) => `<span class="lbl">${esc(label(k))}</span>${bar(n, max, cls)}<span class="num"><b>${n}</b></span>`).join('')}</div>`;
  }
  function pickRows(list, label) {
    if (!list || !list.length) return '<p class="empty">Nothing recorded yet.</p>';
    const max = Math.max(...list.map(x => x.picks));
    return `<div class="rows">${list.map(x => `<span class="lbl">${esc(label(x.key))}<small>${x.winPct}% of these runs won · avg depth ${x.avgDepth}</small></span>${bar(x.picks, max)}<span class="num"><b>${x.picks}</b> pick${x.picks > 1 ? 's' : ''}</span>`).join('')}</div>`;
  }
  const pathLabel = (tier) => key => {
    const [career, id] = key.split(':');
    const n = GD.careerPaths && GD.careerPaths[career] && GD.careerPaths[career][tier] && GD.careerPaths[career][tier][id];
    return `${n || id} (${CAREERS[career] || career})`;
  };
  const relicLabel = k => (GD.relics && GD.relics[k]) ? `${GD.relics[k].icon} ${GD.relics[k].name}` : k;
  const patronLabel = k => (GD.patrons && GD.patrons[k]) ? `${GD.patrons[k].icon} ${GD.patrons[k].label}` : k;

  function render(st) {
    if (!st || !st.runs) { box.innerHTML = '<p class="empty">No runs have been recorded yet. Play a game and come back.</p>'; return; }
    const o = st.overall;
    const buckets = Object.entries(st.depthBuckets || {}).sort((a, b) => (a[0] === 'Victory') - (b[0] === 'Victory') || parseInt(a[0]) - parseInt(b[0]));
    let html = `<div class="tally">
      <div><b>${st.runs}</b><span>runs recorded</span></div>
      <div><b>${o.winPct}%</b><span>reached the end</span></div>
      <div><b>${o.pastBoss1Pct}%</b><span>beat the first boss</span></div>
      <div><b>${o.avgDepth}</b><span>average depth</span></div>
      <div><b>${st.deepestEndless || '—'}</b><span>deepest Endless run</span></div>
    </div><div class="cols">`;
    html += section('Peoples', 'Every run a race took part in, solo or in a party.', summaryRows(st.byClass, k => CAREERS[k] || k));
    html += section('Peoples alone', 'Runs with a single warrior.', summaryRows(st.soloByClass, k => CAREERS[k] || k));
    html += section('Warband size', '', summaryRows(st.byPartySize, k => k === '1' ? 'Alone' : `${k} warriors`));
    html += section('Difficulty and mode', '', summaryRows(Object.assign({}, st.byDifficulty, st.byMode), k => k));
    html += section('How far runs got', 'Where each run ended.', countRows(buckets, k => k === 'Victory' ? '🏆 Victory' : `Depth ${k}`));
    html += section('Where warbands fall', '', countRows(st.deathsByZone, k => k, 'death'));
    html += section('The deadliest foes', 'What dealt the final blow.', countRows(st.topKillers, k => k, 'death'));
    html += section('Expert classes', 'How often each is chosen, and how those runs went.', pickRows(st.expertPaths, pathLabel('expert')));
    html += section('Master classes', '', pickRows(st.masterPaths, pathLabel('master')));
    html += section('Relics carried', 'Relics held at the end of a run.', pickRows(st.relics, relicLabel));
    html += section('Claimed by the Dark Gods', 'Warriors who reached 9 Corruption.', pickRows(st.patrons, patronLabel));
    html += section('Recent runs', '', st.recent && st.recent.length ? `<ul class="recent">${st.recent.map(r => `<li class="${r.victory ? 'won' : 'lost'}"><strong>${r.victory ? 'Victory' : `Fell at depth ${r.depth}`}${r.endless ? ' · Endless' : ''}</strong> — ${r.players.map(p => esc(CAREERS[p.career] || p.career) + ' ' + (p.level || '')).join(', ')}${r.killer && !r.victory ? ` · slain by ${esc(r.killer)}` : ''}${r.chronicle ? `<small>${esc(r.chronicle)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="empty">None yet.</p>', true);
    html += '</div>';
    box.innerHTML = html;
  }

  Promise.all([
    fetch('api/game-data').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch('api/stats', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([gd, st]) => { GD = gd || {}; if (!st) { box.innerHTML = '<p class="empty">The ledger could not be read right now. Try again in a moment.</p>'; return; } render(st); });
})();
