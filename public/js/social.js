'use strict';
// ─── PRACTICE COACH ───────────────────────────────────────────────────────────
// Tips shown above the actions during a practice fight, one lesson per round.
const COACH_TALENT={
  warrior:['Taunt','forces every enemy to attack you for 2 rounds, so your allies can act safely.'],
  rogue:['Trickery','poisons whatever you hit. Poison ticks every round, and 5+ stacks give the enemy a bane.'],
  wizard:['your spells','are in the spell list. Spells of the same rank share castings, and every pool refills at the start of each fight.'],
  priest:['Shared Recovery','heals the whole warband once per fight. Your weapon hits also heal you through Holy Fervor.'],
  witchhunter:['Condemn','is a free action: mark the enemy, then attack it for +1 boon and +1d6 damage. It does not use your turn.'],
  engineer:['your Volley Gun','keeps shooting for 3 rounds after you set it up, and your Bomb hits every enemy at once. Stay in the back row.'],
  waywatcher:['Arrow Storm','hits every enemy at once. Hawk Eye makes your shots from the back row more accurate.'],
  slayer:["Death Wish","makes you stronger below half HP, and Slayer's Oath adds 1d6 against elites and bosses. Rage readies a stronger hit each time you are struck."],
};
function coachHtml(gs,me){
  const r=gs.roundNumber||1, t=COACH_TALENT[me.career]||['your talents','are listed with the actions.'];
  const tips=[
    ['Your first move','On your turn, choose <strong>Attack</strong>. You roll a d20 plus your weapon skill against the enemy\'s Defence (shown on its card). A natural 20 is a critical hit.'],
    ['Boons and banes',`A <strong>boon</strong> adds a d6 to your roll, a <strong>bane</strong> subtracts one. Now try <strong>${t[0]}</strong>: it ${t[1]}`],
    ['Reading the enemy','Hover or tap the chips on an enemy to see its traits. Bosses show a <strong>⚠ warning</strong> a turn before a big attack: stun them or prepare for it.'],
    ['Staying alive','Healing Draughts heal more as you level up. When the fight ends you see what you earned before moving on.'],
  ];
  const [h,b]=tips[Math.min(r,tips.length)-1];
  return `<div class="coach"><div class="coach-h">🎓 ${h}</div><div class="coach-b">${b}</div></div>`;
}

// ─── QUICK CHAT ───────────────────────────────────────────────────────────────
const EMOTE_LIST=[['heal','Heal me!'],['focus','Focus the boss!'],['wait','Wait for me!'],['back','Fall back!'],['nice','Well fought!'],['ready','Ready!']];
function emoteBarHtml(players){
  if(players.filter(p=>p.char).length<2) return '';
  return `<div class="emote-bar" aria-label="Quick chat">${EMOTE_LIST.map(([id,t])=>`<button class="mini-btn" onclick="send('EMOTE',{id:'${id}'})">${t}</button>`).join('')}</div>`;
}
function renderEmoteBar(st){
  const host=isMobileUI()?el('m-game-view'):el('g-actions-panel'); if(!host) return;
  let bar=document.getElementById('emote-slot');
  if(!bar){ bar=document.createElement('div'); bar.id='emote-slot'; }
  if(bar.parentNode!==host) host.appendChild(bar);
  const show=st.gs.phase!=='lobby'&&!st.gs.practice;
  bar.innerHTML=show?emoteBarHtml(st.players):'';
}
// Pop a short bubble when a party member sends a quick-chat line.
let _emoteSeenTs=Date.now();
function showEmoteToasts(gs){
  const fresh=(gs.log||[]).filter(l=>l.type==='emote'&&l.ts>_emoteSeenTs);
  if(!fresh.length) return;
  _emoteSeenTs=Math.max(...fresh.map(l=>l.ts));
  let box=el('emote-toasts'); if(!box){ box=document.createElement('div'); box.id='emote-toasts'; box.setAttribute('aria-live','polite'); document.body.appendChild(box); }
  fresh.slice(-3).forEach(l=>{
    const n=document.createElement('div'); n.className='emote-toast'; n.innerHTML=l.msg; box.appendChild(n);
    setTimeout(()=>n.remove(),4000);
  });
}

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────────
// Optional: a name and a PIN keep Renown and run history on the server.
const ACCOUNT_KEY='sorAccount';
function getAccount(){ try{ return JSON.parse(store.get(ACCOUNT_KEY)||'null'); }catch(e){ return null; } }
function setAccount(a){ store.set(ACCOUNT_KEY,a?JSON.stringify(a):''); }
function accountLogin(){
  const name=(el('acct-name').value||'').trim(), pin=(el('acct-pin').value||'').trim();
  el('acct-err').textContent='';
  if(!name||!/^\d{4,8}$/.test(pin)){ el('acct-err').textContent='Enter a name and a 4–8 digit PIN.'; return; }
  send('ACCOUNT_LOGIN',{name,pin,local:{progress:getProgress(),history:getHistory(),achievements:getAch()}});
}
function accountLogout(){ const a=getAccount(); if(a) send('ACCOUNT_LOGOUT',{token:a.token}); setAccount(null); renderAccount(); }
function onAccountMsg(msg){
  if(msg.type==='ACCOUNT_OK'){
    const p=msg.payload; setAccount({name:p.name,token:p.token});
    store.set(PROGRESS_KEY,JSON.stringify(p.progress)); store.set(HISTORY_KEY,JSON.stringify(p.history||[]));
    mergeAch(p.achievements); if(Object.keys(getAch()).length>Object.keys(p.achievements||{}).length) accountSyncAch();
    renderAccount(p.created?'Account created. Your Renown is saved.':''); renderProgressUI(); return true;
  }
  if(msg.type==='ACCOUNT_ERROR'){ const e=el('acct-err'); if(e) e.textContent=msg.payload.msg; return true; }
  if(msg.type==='ACCOUNT_SIGNED_OUT'){ setAccount(null); renderAccount(); return true; }
  return false;
}
function renderAccount(note){
  const box=el('account-box'); if(!box) return;
  const a=getAccount(); box.dataset.state=a?'in':'out';
  if(a){ box.innerHTML=`<div class="acct-in">Renown saved to <strong>${escapeHtml(a.name)}</strong> <button class="mini-btn" onclick="accountLogout()">Sign out</button></div>${note?`<div class="acct-note">${note}</div>`:''}`; return; }
  box.innerHTML=`<details class="acct-form"><summary>Save your Renown across devices</summary>
    <p class="hint">Pick a name and a PIN. Use the same pair on another device to bring your Renown with you. A new name creates an account.</p>
    <div class="acct-row"><input id="acct-name" maxlength="20" placeholder="Account name" autocomplete="username"><input id="acct-pin" maxlength="8" inputmode="numeric" placeholder="PIN" autocomplete="current-password" type="password"></div>
    <button class="btn btn-w" onclick="accountLogin()">Sign in or create</button><div class="err" id="acct-err" role="alert"></div></details>`;
}
function accountRecordRun(rec,earned){ const a=getAccount(); if(a) send('ACCOUNT_RUN',{token:a.token,rec,earned,achievements:getAch()}); }
function accountSyncAch(){ const a=getAccount(); if(a) send('ACCOUNT_ACH',{token:a.token,achievements:getAch()}); }

// ─── PRACTICE FIGHT ───────────────────────────────────────────────────────────
function openPractice(){
  const box=el('practice-pick'); if(!box) return;
  box.hidden=!box.hidden; if(box.hidden) return;
  box.innerHTML='<div class="rh-title">Practice with which career?</div><div class="practice-grid">'+
    Object.entries(CAREER_DETAILS).map(([k,c])=>`<button class="btn" onclick="startPractice('${k}')">${c.name}</button>`).join('')+'</div>';
}
function startPractice(career){
  const name=(el('inp-name').value||'').trim()||'Recruit';
  send('START_PRACTICE',{name,career});
}

// ─── SHAREABLE RUN IMAGE ──────────────────────────────────────────────────────
// Draws a 1200×630 card of the run (party, depth, what killed you) to save or share.
function loadImg(src){ return new Promise(res=>{ if(!src) return res(null); const i=new Image(); i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; }); }
async function makeRunImage(){
  const st=lastState; if(!st) return null;
  const gs=st.gs, party=st.players.filter(p=>p.char);
  const W=1200,H=630, cv=document.createElement('canvas'); cv.width=W; cv.height=H; const g=cv.getContext('2d');
  const css=getComputedStyle(document.documentElement), tok=n=>css.getPropertyValue(n).trim()||'#888';
  const bg=g.createLinearGradient(0,0,0,H); bg.addColorStop(0,'#1d1712'); bg.addColorStop(1,'#0c0907'); g.fillStyle=bg; g.fillRect(0,0,W,H);
  g.strokeStyle=tok('--brass'); g.lineWidth=3; g.strokeRect(18,18,W-36,H-36);
  try{ await document.fonts.ready; }catch(e){ /* fonts optional */ }
  const won=gs.phase==='victory';
  g.fillStyle=tok('--blood-bright'); g.font='700 64px "Grenze Gotisch", serif'; g.fillText('Shadows Over Reikland',60,110);
  g.fillStyle=won?tok('--brass-bright'):tok('--bone'); g.font='700 48px "Alegreya", serif';
  g.fillText(won?'Victory — the depths are conquered':(gs.endless?`Endless: fell at depth ${gs.depth}`:`Fell at depth ${gs.depth} of 30`),60,180);
  const diff=['Standard','Grim','Doom'][gs.difficulty||0];
  g.fillStyle=tok('--ash'); g.font='28px "Alegreya", serif';
  g.fillText(`${gs.bossCount||0} boss${(gs.bossCount||0)===1?'':'es'} slain · ${diff}${gs.dailyKey?' · Daily Run '+gs.dailyKey:''}`,60,226);
  const imgs=await Promise.all(party.map(p=>loadImg(tokenSrc(p.career))));
  party.forEach((p,i)=>{
    const x=60+i*275, y=270;
    if(imgs[i]) g.drawImage(imgs[i],x,y,150,150);
    g.fillStyle=tok('--bone'); g.font='700 30px "Alegreya", serif'; g.fillText(p.name.slice(0,14),x,y+190);
    g.fillStyle=tok('--ash'); g.font='24px "Alegreya", serif';
    g.fillText(`${CAREER_LABELS[p.career]||''} · Lv ${p.char.level}`,x,y+222);
  });
  if(gs.chronicle){
    g.fillStyle=tok('--bone'); g.font='italic 24px "Alegreya", serif';
    const words=String(gs.chronicle).split(' '); let line='', y=H-95;
    words.forEach(w=>{ if(g.measureText(line+w).width>W-120){ g.fillText(line.trim(),60,y); line=''; y+=30; } line+=w+' '; }); g.fillText(line.trim(),60,y);
  } else if(!won&&gs.deathCause){
    const cause=String(gs.deathCause).replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,80);
    g.fillStyle=tok('--ember'); g.font='italic 26px "Alegreya", serif'; g.fillText(cause,60,H-60);
  }
  return new Promise(res=>cv.toBlob(res,'image/png'));
}
async function shareRun(){
  const btn=el('share-run'); if(btn) btn.disabled=true;
  try{
    const blob=await makeRunImage(); if(!blob) return;
    const file=new File([blob],'reikland-run.png',{type:'image/png'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:'Shadows Over Reikland'}); return; }
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='reikland-run.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }catch(e){ console.warn('Share failed',e); }
  finally{ if(btn) btn.disabled=false; }
}
