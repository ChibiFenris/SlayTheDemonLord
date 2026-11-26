'use strict';
// Saves every room to disk so a restart or redeploy doesn't end games in progress.
// On Railway the container's disk is wiped on each deploy, so attach a Volume and
// set DATA_DIR to its mount path (e.g. /data) for saves to survive redeploys.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'rooms.json');
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // forget rooms nobody has touched for 12 hours

function serialize(rooms) {
  return JSON.stringify([...rooms.values()].map(r => ({
    code: r.code, hostId: r.hostId, touchedAt: r.touchedAt || Date.now(), gs: r.gs,
    players: r.players.map(p => ({ id: p.id, name: p.name, career: p.career, char: p.char, ready: p.ready })),
  })));
}

function saveNow(rooms) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, serialize(rooms));
    fs.renameSync(tmp, FILE); // atomic replace: a crash mid-write never corrupts the save
  } catch (e) { console.error('Saving rooms failed:', e.message); }
}

let timer = null;
function scheduleSave(rooms) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; saveNow(rooms); }, 1000);
}

function loadRooms() {
  try {
    const now = Date.now();
    return JSON.parse(fs.readFileSync(FILE, 'utf8')).filter(r => now - (r.touchedAt || 0) < MAX_AGE_MS);
  } catch (e) { return []; }
}

module.exports = { saveNow, scheduleSave, loadRooms, DIR, MAX_AGE_MS };
