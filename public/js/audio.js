'use strict';
let audioEl = null;
let currentTrackKey = null;
let audioMuted = false;
let audioVolume = 0.5;

function getTrackKey(gs, players) {
  if (!gs) return 'lobby';
  if (gs.phase === 'lobby')    return 'lobby';
  if (gs.phase === 'gameover') return 'defeat';
  if (gs.phase === 'victory')  return 'victory';
  if (gs.phase === 'merchant') return 'merchant';
  const zid = (typeof zoneOf === 'function' && zoneOf(gs)) ? zoneOf(gs).id : null;
  const z = k => (zid && ZONE_TRACKS[zid] && ZONE_TRACKS[zid][k]) ? `${k}@${zid}` : k;
  if (gs.phase === 'loot' || gs.phase === 'event' || gs.phase === 'path' || gs.phase === 'campfire' || gs.phase === 'relic' || gs.phase === 'choice') return z('explore');
  if (gs.phase === 'combat' && gs.enemy) {
    const threat = gs.enemy.threat;
    if (threat === 'Boss') {
      if (gs.endless && gs.bossCount >= 3) return z('boss');
      if (gs.depth >= 30) return 'boss3';
      if (gs.bossCount === 0) return 'boss1';
      if (gs.bossCount === 1) return 'boss2';
      return 'boss3';
    }
    if (threat === 'Elite') return z('elite');
    return z('battle');
  }
  return z('explore');
}

function pickTrackSrc(key) {
  const [k, zid] = key.split('@');
  const t = zid ? ZONE_TRACKS[zid][k] : TRACKS[key];
  if (!t) return null;
  if (Array.isArray(t)) return t[Math.floor(Math.random() * t.length)];
  return t;
}

function playTrack(key) {
  if (key === currentTrackKey) return; // already playing
  currentTrackKey = key;
  const src = pickTrackSrc(key);
  if (!src) return;

  if (audioEl) { audioEl.pause(); audioEl.src = ''; audioEl = null; }
  const a = new Audio();
  a.loop = true;
  a.volume = audioMuted ? 0 : audioVolume;
  a.onerror = () => { /* audio file missing — fail silently */ };
  a.src = src; // set src after onerror so 404s don't throw
  audioEl = a;
  if (audioMuted) return; // muted: load the track but don't start it
  a.play().catch(() => unlockOnFirstTouch());
}

// Browsers (iPhones especially) only start audio after the player touches the page.
let _unlockArmed = false;
function unlockOnFirstTouch() {
  if (_unlockArmed) return; _unlockArmed = true;
  const go = () => {
    _unlockArmed = false;
    ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.removeEventListener(ev, go, true));
    if (audioEl && audioEl.paused && !audioMuted) audioEl.play().catch(() => {});
  };
  ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, go, true));
}

function setMute(muted) {
  audioMuted = muted;
  // iPhones ignore the volume setting, so muting pauses the music rather than turning it down.
  if (audioEl) { if (muted) audioEl.pause(); else { audioEl.volume = audioVolume; audioEl.play().catch(() => unlockOnFirstTouch()); } }
  const btn = el('audio-toggle');
  if (btn) { btn.innerHTML = muted ? '🔇<span class="btn-lbl"> Unmute</span>' : '🔊<span class="btn-lbl"> Mute</span>'; btn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music'); }
  store.set('audioMuted', muted ? '1' : '0');
}

function setVolume(v) {
  audioVolume = v;
  if (audioEl && !audioMuted) audioEl.volume = v;
}

function initAudio() {
  if (store.get('audioMuted') === '1') setMute(true);
  playTrack('lobby');
}

function updateAudio(gs, players) {
  const key = getTrackKey(gs, players);
  if (key.startsWith('battle') && currentTrackKey !== key) {
    currentTrackKey = null; // force re-pick
  }
  playTrack(key);
}
