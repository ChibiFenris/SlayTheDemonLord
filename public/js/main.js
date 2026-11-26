'use strict';
// ─── LAYOUT MODE ──────────────────────────────────────────────────────────────
// Phones always open in the mobile layout. Other devices pick by viewport width
// and follow resizes/rotation. A manual switch only lasts for this visit, so a
// phone never gets stuck in the desktop layout.
const MOBILE_MAX_WIDTH = 760;
let layoutOverride = null; // 'mobile' | 'classic' | null
try { layoutOverride = sessionStorage.getItem('sorUIMode'); } catch (e) { /* storage blocked */ }

function isPhone(){
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|Mobi/i.test(ua)) return true;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return !!coarse && Math.min(screen.width, screen.height) < 600;
}
function wantsMobileLayout(){
  if (layoutOverride) return layoutOverride === 'mobile';
  return isPhone() || window.innerWidth <= MOBILE_MAX_WIDTH;
}
function isMobileUI(){ return document.body.classList.contains('ui-mobile'); }

function applyLayout(){
  const mobile = wantsMobileLayout();
  const changed = mobile !== isMobileUI();
  document.body.classList.toggle('ui-mobile', mobile);
  const btn = el('ui-toggle');
  if (btn){
    btn.textContent = mobile ? '🖥' : '📱';
    btn.title = mobile ? 'Switch to desktop layout' : 'Switch to mobile layout';
    btn.setAttribute('aria-label', btn.title);
  }
  if (changed && lastState) renderState(lastState);
}

function toggleUI(){
  layoutOverride = isMobileUI() ? 'classic' : 'mobile';
  try { sessionStorage.setItem('sorUIMode', layoutOverride); } catch (e) { /* storage blocked */ }
  applyLayout();
}

let _resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(applyLayout, 150);
});

// ─── STATE RENDER ENTRY POINT ─────────────────────────────────────────────────
function renderState(st){
  renderMainState(st);
  renderMobileState(st);
  sfxOnState(st);
  checkTips(st);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
applyLayout();
connect();
initAudio();
