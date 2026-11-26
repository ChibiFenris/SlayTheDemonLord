'use strict';
// Per-room random numbers. Each room carries its own seeded generator in
// gs.rng = { seed, s }, so a run can be replayed from its seed and every Daily Run
// starts from the same seed for everyone.
//
// The game code calls Math.random() all over, so instead of threading a generator
// through every function, install() routes Math.random to the generator of the
// room currently being handled: withRoom() sets it around each incoming message,
// and timers scheduled while a room is active run with that room's generator too.
// Outside a room (lobby code, tests calling functions directly) it falls back to
// the normal Math.random.

const nativeRandom = Math.random;
let active = null;

// mulberry32: small, fast, good enough for dice. State is a single 32-bit number,
// so it survives being saved to disk as JSON.
function next(r) {
  r.s = (r.s + 0x6D2B79F5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function newSeed() { return Math.floor(nativeRandom() * 4294967296) >>> 0; }
function makeRng(seed = newSeed()) { return { seed: seed >>> 0, s: seed >>> 0 }; }
function seedFromString(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function withRoom(room, fn) {
  const prev = active;
  active = (room && room.gs && room.gs.rng) || null;
  try { return fn(); } finally { active = prev; }
}

let installed = false;
function install() {
  if (installed) return; installed = true;
  Math.random = () => (active ? next(active) : nativeRandom());
  // A timer keeps the generator of the room that scheduled it.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = function (fn, ms, ...args) {
    const r = active;
    if (!r || typeof fn !== 'function') return realSetTimeout(fn, ms, ...args);
    return realSetTimeout(() => { const prev = active; active = r; try { fn(...args); } finally { active = prev; } }, ms);
  };
}

module.exports = { install, withRoom, makeRng, seedFromString, next, nativeRandom };
