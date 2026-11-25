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
  if (gs.phase === 'loot' || gs.phase === 'event' || gs.phase === 'path') return 'explore';
  if (gs.phase === 'combat' && gs.enemy) {
    const threat = gs.enemy.threat;
    if (threat === 'Boss') {
      if (gs.depth >= 30) return 'boss3';
      if (gs.bossCount === 0) return 'boss1';
      if (gs.bossCount === 1) return 'boss2';
      return 'boss3';
    }
    if (threat === 'Elite') return 'elite';
    return 'battle';
  }
  return 'explore';
}

function pickTrackSrc(key) {
  const t = TRACKS[key];
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
  a.play().catch(() => {
    document.addEventListener('click', () => {
      if (audioEl && audioEl.paused && !audioMuted) audioEl.play().catch(()=>{});
    }, { once: true });
  });
}

function setMute(muted) {
  audioMuted = muted;
  if (audioEl) audioEl.volume = muted ? 0 : audioVolume;
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
  if (key === 'battle' && currentTrackKey !== 'battle') {
    currentTrackKey = null; // force re-pick
  }
  playTrack(key);
}
