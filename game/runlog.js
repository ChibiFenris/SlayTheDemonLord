'use strict';
// Run records: one JSON line per finished run in DATA_DIR/runs.jsonl, a summary
// for /api/stats, and the Daily Run (shared modifiers + today's leaderboard).
const fs = require('fs');
const path = require('path');
const { DIR } = require('./persist');

const RUNS_FILE = path.join(DIR, 'runs.jsonl');
const DAILY_FILE = path.join(DIR, 'daily.json');

function appendRun(rec) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(RUNS_FILE, JSON.stringify(rec) + '\n'); }
  catch (e) { console.error('Logging run failed:', e.message); }
}

function readRuns() {
  try { return fs.readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); }
  catch (e) { return []; }
}

// Aggregate numbers for balancing from real play.
function stats() {
  const runs = readRuns();
  const pct = (n, d) => d ? Math.round(100 * n / d) : 0;
  const group = key => {
    const out = {};
    runs.forEach(r => { const ks = key(r); (Array.isArray(ks) ? ks : [ks]).forEach(k => { (out[k] = out[k] || []).push(r); }); });
    return Object.fromEntries(Object.entries(out).map(([k, rs]) => [k, {
      runs: rs.length,
      winPct: pct(rs.filter(r => r.victory).length, rs.length),
      pastBoss1Pct: pct(rs.filter(r => r.bosses >= 1).length, rs.length),
      avgDepth: +(rs.reduce((a, r) => a + r.depth, 0) / rs.length).toFixed(1),
    }]));
  };
  const killers = {};
  runs.filter(r => !r.victory && r.killer).forEach(r => { killers[r.killer] = (killers[r.killer] || 0) + 1; });
  return {
    runs: runs.length,
    byClass: group(r => [...new Set(r.players.map(p => p.career))]),
    byPartySize: group(r => String(r.players.length)),
    byDifficulty: group(r => ['Standard', 'Grim', 'Doom'][r.difficulty || 0]),
    topKillers: Object.entries(killers).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
}

// ── Daily Run ────────────────────────────────────────────────────────────────
// Every day picks one blessing and one hardship; everyone who plays the Daily
// faces the same pair and lands on the same leaderboard.
const DAILY_BLESSINGS = [
  { id: 'brittleFoes', name: 'Brittle Foes', desc: 'Enemies have −1 Defence.' },
  { id: 'richVeins', name: 'Rich Veins', desc: 'Silver and XP from battles ×1.5.' },
  { id: 'provisioned', name: 'Well Provisioned', desc: 'Everyone starts with 2 Healing Draughts and 20 extra silver.' },
];
const DAILY_HARDSHIPS = [
  { id: 'bloodMoon', name: 'Blood Moon', desc: 'Enemies deal +1 damage.' },
  { id: 'ironHide', name: 'Iron Hide', desc: 'Enemies have 20% more HP.' },
  { id: 'hardened', name: 'Hardened Foes', desc: 'Enemies have +1 Defence.' },
];

function todayKey(now = new Date()) { return now.toISOString().slice(0, 10); }
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function dailyMods(key = todayKey()) {
  const h = hash('reikland:' + key);
  return [DAILY_BLESSINGS[h % DAILY_BLESSINGS.length], DAILY_HARDSHIPS[(h >>> 8) % DAILY_HARDSHIPS.length]];
}

function readDaily() { try { return JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8')); } catch (e) { return {}; } }
function addDailyScore(key, entry) {
  try {
    const all = readDaily();
    Object.keys(all).sort().slice(0, -14).forEach(k => delete all[k]); // keep two weeks
    (all[key] = all[key] || []).push(entry);
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(DAILY_FILE, JSON.stringify(all));
  } catch (e) { console.error('Saving daily score failed:', e.message); }
}
// Best first: victory, then depth, then bosses, then fewest rounds.
function dailyBoard(key = todayKey()) {
  return (readDaily()[key] || []).slice()
    .sort((a, b) => (b.victory - a.victory) || (b.depth - a.depth) || (b.bosses - a.bosses) || ((a.rounds || 0) - (b.rounds || 0)))
    .slice(0, 10);
}

// Hall of fame: the best runs ever. Victories first, then harder difficulty,
// deeper, more bosses, fewer rounds. Cached for a minute.
let hofCache = null, hofAt = 0;
function hallOfFame(n = 10) {
  if (hofCache && Date.now() - hofAt < 60000) return hofCache;
  const score = r => [r.victory || (r.endless && r.depth > 30) ? 1 : 0, r.difficulty || 0, r.depth || 0, r.bosses || 0, -(r.rounds || 9999)];
  const cmp = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; };
  hofCache = readRuns().filter(r => (r.depth || 0) > 0 && Array.isArray(r.players)).sort(cmp).slice(0, n).map(r => ({
    ts: r.ts, victory: !!r.victory, endless: !!r.endless, depth: r.depth, bosses: r.bosses, difficulty: r.difficulty || 0, rounds: r.rounds || null, daily: !!r.daily,
    chronicle: r.chronicle || null, players: r.players.map(p => ({ name: String(p.name || '').slice(0, 20), career: p.career, level: p.level, title: p.title || null })),
  }));
  hofAt = Date.now();
  return hofCache;
}
function _resetHof() { hofCache = null; }

module.exports = { hallOfFame, _resetHof, appendRun, readRuns, stats, todayKey, dailyMods, addDailyScore, dailyBoard, DAILY_BLESSINGS, DAILY_HARDSHIPS };
