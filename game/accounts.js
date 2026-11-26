'use strict';
// Optional accounts: a name and a PIN keep a player's Renown and run history on
// the server, so it follows them to another browser or device. No email, no
// personal data. PINs are stored as salted scrypt hashes; repeated wrong PINs
// lock the account for a few minutes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIR } = require('./persist');

const FILE = path.join(DIR, 'accounts.json');
const HISTORY_MAX = 20;
const TOKEN_DAYS = 90;
const LOCK = { tries: 5, ms: 5 * 60 * 1000 };

let accounts = null;
function load() {
  if (accounts) return accounts;
  try { accounts = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { accounts = {}; }
  return accounts;
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(accounts));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error('Saving accounts failed:', e.message); }
  }, 500);
  if (saveTimer.unref) saveTimer.unref();
}

const keyOf = name => String(name || '').trim().toLowerCase();
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const validName = n => typeof n === 'string' && /^[\p{L}\p{N} _.-]{2,20}$/u.test(n.trim());
const validPin = p => typeof p === 'string' && /^\d{4,8}$/.test(p);

function publicView(a, token) {
  return { name: a.name, token, progress: a.progress, history: a.history };
}
function issueToken(a) {
  const t = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  a.tokens = Object.fromEntries(Object.entries(a.tokens || {}).filter(([, exp]) => exp > now).slice(-9));
  a.tokens[t] = now + TOKEN_DAYS * 86400000;
  return t;
}

// Sign in, or create the account if the name is free. `local` is the progress
// already in this browser: a brand-new account starts from it.
function login(name, pin, local) {
  if (!validName(name)) return { error: 'Names are 2–20 letters, numbers or spaces.' };
  if (!validPin(pin)) return { error: 'The PIN must be 4 to 8 digits.' };
  const all = load(), k = keyOf(name), now = Date.now();
  let a = all[k];
  if (!a) {
    const salt = crypto.randomBytes(16).toString('hex');
    const prog = local && local.progress ? local.progress : {};
    a = all[k] = { name: name.trim(), salt, hash: hashPin(pin, salt), created: now,
      progress: { renown: +prog.renown || 0, runs: +prog.runs || 0, best: +prog.best || 0 },
      history: Array.isArray(local && local.history) ? local.history.slice(0, HISTORY_MAX) : [], tokens: {}, fails: 0 };
    const token = issueToken(a); save();
    return { ok: publicView(a, token), created: true };
  }
  if (a.lockedUntil && a.lockedUntil > now) return { error: 'Too many wrong PINs. Try again in a few minutes.' };
  const h = hashPin(pin, a.salt);
  if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(a.hash, 'hex'))) {
    a.fails = (a.fails || 0) + 1;
    if (a.fails >= LOCK.tries) { a.lockedUntil = now + LOCK.ms; a.fails = 0; }
    save();
    return { error: 'That name is taken and the PIN does not match.' };
  }
  a.fails = 0; a.lockedUntil = 0;
  const token = issueToken(a); save();
  return { ok: publicView(a, token) };
}

function byToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const now = Date.now();
  return Object.values(load()).find(a => a.tokens && a.tokens[token] > now) || null;
}
function resume(token) { const a = byToken(token); return a ? { ok: publicView(a, token) } : { error: 'Signed out.' }; }
function logout(token) { const a = byToken(token); if (a) { delete a.tokens[token]; save(); } }

// A finished run: add its Renown and put it at the top of the history.
function recordRun(token, rec, earned) {
  const a = byToken(token); if (!a) return { error: 'Signed out.' };
  const e = Math.max(0, Math.min(500, Math.round(+earned || 0)));
  const depth = Math.max(0, Math.min(30, Math.round(+(rec && rec.depth) || 0)));
  a.progress.renown += e; a.progress.runs += 1; a.progress.best = Math.max(a.progress.best, depth);
  if (rec && typeof rec === 'object') {
    const clean = { at: +rec.at || Date.now(), victory: !!rec.victory, depth, bosses: +rec.bosses || 0, difficulty: +rec.difficulty || 0,
      daily: !!rec.daily, career: String(rec.career || '').slice(0, 20), level: +rec.level || 0, party: +rec.party || 1,
      cause: String(rec.cause || '').slice(0, 90), renown: e };
    a.history = [clean, ...(a.history || [])].slice(0, HISTORY_MAX);
  }
  save();
  return { ok: publicView(a, token) };
}

function _reset() { accounts = {}; }
module.exports = { login, resume, logout, recordRun, validName, validPin, _reset };
