'use strict';
// State patches: after the first full state, players get only what changed.
// The game state is a handful of top-level fields plus the log and the players;
// we compare each top-level field (as JSON) with what was sent last time, send
// new log lines only, and send a player only when their data changed.
//
// Each room keeps one cache and a sequence number. A browser that opted in with
// HELLO {patches:true} and has the previous sequence gets a STATE_PATCH; anyone
// else (bots, new arrivals, someone who missed an update) gets a full STATE_UPDATE.

const logKey = e => e ? `${e.ts}|${e.msg}` : null;

function diff(cache, pub) {
  const gsJson = {}, patch = { gs: {}, gsDel: [] };
  for (const [k, v] of Object.entries(pub.gs)) {
    if (k === 'log' || v === undefined) continue;
    const j = JSON.stringify(v);
    gsJson[k] = j;
    if (!cache || cache.gs[k] !== j) patch.gs[k] = v;
  }
  if (cache) for (const k of Object.keys(cache.gs)) if (!(k in gsJson)) patch.gsDel.push(k);

  const log = pub.gs.log || [];
  let idx = -1;
  if (cache && cache.lastLog) for (let i = log.length - 1; i >= 0; i--) if (logKey(log[i]) === cache.lastLog) { idx = i; break; }
  if (idx >= 0) { if (idx < log.length - 1) patch.logAppend = log.slice(idx + 1); }
  else patch.logFull = log;
  patch.logLen = log.length;

  const pJson = pub.players.map(p => JSON.stringify(p));
  if (!cache || cache.players.length !== pJson.length) patch.playersFull = pub.players;
  else {
    const changed = {};
    pJson.forEach((j, i) => { if (cache.players[i] !== j) changed[i] = pub.players[i]; });
    if (Object.keys(changed).length) patch.players = changed;
  }
  if (!cache || cache.hostId !== pub.hostId) patch.hostId = pub.hostId;
  if (!patch.gsDel.length) delete patch.gsDel;
  return { patch, cache: { gs: gsJson, players: pJson, hostId: pub.hostId, lastLog: logKey(log[log.length - 1]) } };
}

// Client-side counterpart (the browser has its own copy in public/js/core.js);
// used by the tests to check that patches rebuild the exact state.
function apply(state, patch) {
  const gs = { ...state.gs };
  Object.assign(gs, patch.gs || {});
  (patch.gsDel || []).forEach(k => { delete gs[k]; });
  if (patch.logFull) gs.log = patch.logFull;
  else if (patch.logAppend) gs.log = (gs.log || []).concat(patch.logAppend).slice(-patch.logLen);
  let players = state.players;
  if (patch.playersFull) players = patch.playersFull;
  else if (patch.players) { players = players.slice(); for (const [i, p] of Object.entries(patch.players)) players[+i] = p; }
  return { gs, players, hostId: patch.hostId !== undefined ? patch.hostId : state.hostId };
}

// Send this room's state to everyone in it.
function broadcast(room, pub) {
  const sync = room._sync || (room._sync = { cache: null, seq: 0 });
  const { patch, cache } = diff(sync.cache, pub);
  const base = sync.seq, seq = base + 1;
  sync.cache = cache; sync.seq = seq;
  let full = null, part = null;
  room.players.forEach(p => {
    const ws = p.ws; if (!ws || ws.readyState !== 1) return;
    const inStep = ws._patches && ws._syncRoom === room.code && ws._syncSeq === base;
    if (inStep) ws.send(part || (part = JSON.stringify({ type: 'STATE_PATCH', payload: { base, seq, ...patch } })));
    else ws.send(full || (full = JSON.stringify({ type: 'STATE_UPDATE', seq, payload: pub })));
    ws._syncRoom = room.code; ws._syncSeq = seq;
  });
}

// A browser that lost track asks for a full state.
function resync(ws, room, pub) {
  const seq = room._sync ? room._sync.seq : 0;
  ws._syncRoom = room.code; ws._syncSeq = seq;
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'STATE_UPDATE', seq, payload: pub }));
}

module.exports = { diff, apply, broadcast, resync };
