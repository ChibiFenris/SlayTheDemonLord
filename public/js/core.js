'use strict';
// Portraits live in public/tokens/ as small webp files; index.json maps a class or
// enemy name to its file so the browser only downloads (and caches) what it shows.
let TOKEN_FILES={};
fetch('tokens/index.json',{cache:'no-cache'}).then(r=>r.json()).then(d=>{ TOKEN_FILES=d; if(lastState) renderState(lastState); }).catch(()=>{});
function tokenSrc(name){ const f=TOKEN_FILES[name]; return f?'tokens/'+f:null; }

// Rules tables come from the server so client and server always agree.
fetch('api/game-data').then(r=>r.json()).then(g=>{
  if(Array.isArray(g.xpThresholds)) XP_T.splice(0,XP_T.length,...g.xpThresholds);
  if(g.castingsTable) Object.assign(CASTINGS_TABLE_C,g.castingsTable);
  if(g.spellElements) Object.assign(SPELL_ELEMENT,g.spellElements);
  if(g.charms) GAME_CHARMS=g.charms;
  if(g.difficulties) GAME_DIFFICULTIES=g.difficulties;
  renderProgressUI();
  if(lastState) renderState(lastState);
}).catch(()=>{});

// Browser storage can throw (private mode, blocked cookies) — never let it break the game.
const store={
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){ /* ignore */ } },
};

function showDebuffTip(name, isEnemy, evt) {
  const info = DEBUFF_INFO[name] || BUFF_INFO[name];
  if (!info) return;
  const tt = document.getElementById('debuff-tooltip');
  document.getElementById('dtt-name').textContent = info.icon + ' ' + name;
  document.getElementById('dtt-desc').textContent = info.desc;
  document.getElementById('dtt-mech').textContent = info.mech;
  tt.style.display = 'block';
  positionTooltip(tt, evt);
}
function positionTooltip(tt, evt) {
  const x = evt.clientX, y = evt.clientY;
  const w = window.innerWidth, h2 = window.innerHeight;
  tt.style.left = (x + 12 + 240 > w ? x - 252 : x + 12) + 'px';
  tt.style.top  = (y + 12 + 120 > h2 ? y - 130 : y + 12) + 'px';
}
function hideDebuffTip() { document.getElementById('debuff-tooltip').style.display='none'; }
document.addEventListener('mousemove', function(e) {
  const tt = document.getElementById('debuff-tooltip');
  if (tt.style.display==='block') positionTooltip(tt, e);
});

// ─── WS ───────────────────────────────────────────────────────────────────────
let ws=null,myId=null,lastState=null,selectedCareer='warrior',pathPickPending=false,reconnectTimer=null;

function connect(){
  clearTimeout(reconnectTimer);
  const proto=location.protocol==='https:'?'wss:':'ws:';
  const url=`${proto}//${location.host}`;
  el('conn-msg').textContent='Connecting to '+location.host+'...';
  show('screen-connect');
  try{ ws=new WebSocket(url); }catch(e){ sched('Could not open connection.'); return; }
  ws.onopen=()=>{
    clearTimeout(reconnectTimer); buildCareerGrid();
    const sess=loadSession();
    send('HELLO',{patches:true}); // ask for small state patches instead of the full state every time
    const acct=getAccount(); if(acct) send('ACCOUNT_RESUME',{token:acct.token}); // keep the account signed in
    if(sess) send('REJOIN',sess); // reclaim our seat after a refresh, dropped connection or server restart
    else show('screen-lobby');
  };
  ws.onmessage=e=>{ try{ onMsg(JSON.parse(e.data)); }catch(ex){ console.error(ex); } };
  ws.onclose=e=>{ sched('Disconnected (code '+e.code+' reason: '+(e.reason||'none')+'). Retrying...'); console.warn('WS close',e.code,e.reason,e.wasClean); };
  ws.onerror=e=>{ console.error('WS error',e); };
}
function sched(msg){ el('conn-msg').textContent=msg; show('screen-connect'); reconnectTimer=setTimeout(connect,3000); }
function send(type,payload={}){ if(ws&&ws.readyState===1) ws.send(JSON.stringify({type,payload})); }
function el(id){ return document.getElementById(id); }
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); el(id).classList.add('active'); }

// The room and seat we're in, so a refresh or reconnect drops us back into the game.
const SESSION_KEY='sorSession', SESSION_MAX_AGE=12*60*60*1000;
function saveSession(code,playerId,token){ store.set(SESSION_KEY,JSON.stringify({code,playerId,token,at:Date.now()})); }
function loadSession(){
  try{ const s=JSON.parse(store.get(SESSION_KEY)||'null'); return s&&Date.now()-s.at<SESSION_MAX_AGE?{code:s.code,playerId:s.playerId,token:s.token}:null; }
  catch(e){ return null; }
}
function clearSession(){ store.set(SESSION_KEY,''); }
function leaveGame(){
  send('LEAVE_ROOM',{}); clearSession();
  setTimeout(()=>location.reload(),150); // give the message a moment to go out
}
// Ask before leaving; what happens depends on where you are.
function confirmLeave(){
  const st=lastState, gs=st&&st.gs, phase=gs?gs.phase:'lobby';
  const party=st?st.players.filter(p=>p.connected).length:1;
  const ended=['gameover','victory','practiceDone'].includes(phase);
  let title='Leave this room?', text='You go back to the main menu.', go='Leave room';
  if(gs&&gs.practice&&!ended){ title='End the practice fight?'; text='You go back to the main menu.'; go='Leave practice'; }
  else if(phase!=='lobby'&&!ended){
    title='Quit this run?'; go='Quit to main menu';
    text=party>1
      ? 'Your character stays behind and the warband carries on without you. Another player can take over your seat with the room code.'
      : 'The run ends here. It earns no Renown and is not added to your run history.';
  }
  closeOverlay();
  const ov=document.createElement('div'); ov.className='overlay'; ov.id='ov';
  ov.onclick=e=>{ if(e.target===ov) closeOverlay(); };
  ov.innerHTML=`<div class="panel overlay-box leave-box" role="dialog" aria-modal="true" aria-labelledby="leave-h">
    <div class="ph" id="leave-h">${title}</div><p class="help-p">${text}</p>
    <div class="leave-actions"><button class="btn" onclick="closeOverlay()">Stay</button><button class="btn gold" onclick="leaveGame()">${go}</button></div></div>`;
  document.body.appendChild(ov);
  const stay=ov.querySelector('.btn'); if(stay) stay.focus();
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeOverlay(); });
// The Leave button shows whenever you're in a room.
function updateLeaveButton(){ const b=el('leave-btn'); if(b) b.hidden=!myId; }

// Rebuild the full state from a patch (mirror of game/statesync.js apply()).
let lastSeq=null;
function applyStatePatch(state,patch){
  const gs=Object.assign({},state.gs,patch.gs||{});
  (patch.gsDel||[]).forEach(k=>{ delete gs[k]; });
  if(patch.logFull) gs.log=patch.logFull;
  else if(patch.logAppend) gs.log=(gs.log||[]).concat(patch.logAppend).slice(-patch.logLen);
  let players=state.players;
  if(patch.playersFull) players=patch.playersFull;
  else if(patch.players){ players=players.slice(); Object.keys(patch.players).forEach(i=>{ players[+i]=patch.players[i]; }); }
  return {gs,players,hostId:patch.hostId!==undefined?patch.hostId:state.hostId};
}

function onMsg(msg){
  if(onAccountMsg(msg)) return;
  if(msg.type==='REJOIN_FAILED'){ clearSession(); show('screen-lobby'); return; }
  if(msg.type==='ROOM_CREATED'||msg.type==='ROOM_JOINED'){
    myId=msg.payload.playerId; updateLeaveButton();
    saveSession(msg.payload.code,myId,msg.payload.token);
    el('disp-code').textContent=msg.payload.code;
    el('join-panel').hidden=true;
    el('room-panel').hidden=false;
    el('career-panel').hidden=false;
  }
  if(msg.type==='STATE_UPDATE'){
    lastState=msg.payload; lastSeq=msg.seq;
    pathPickPending=false;
    renderState(msg.payload);
  }
  if(msg.type==='STATE_PATCH'){
    const p=msg.payload;
    if(!lastState||p.base!==lastSeq){ send('RESYNC',{}); return; } // missed an update: ask for the full state
    lastState=applyStatePatch(lastState,p); lastSeq=p.seq;
    pathPickPending=false;
    renderState(lastState);
  }
  if(msg.type==='ERROR'){ el('lobby-err').textContent=msg.payload.msg; }
  if(msg.type==='STAT_CHOICE'){ showStatChoiceModal(msg.payload.attrs); }
}

// ─── LOBBY ────────────────────────────────────────────────────────────────────
function buildCareerGrid(){
  const grid=el('career-grid'); if(!grid||grid.children.length>0) return;
  Object.entries(CAREER_DETAILS).forEach(([key,info])=>{
    const btn=document.createElement('button');
    btn.className='cbtn'+(key==='warrior'?' sel':'');
    btn.dataset.career=key;
    btn.innerHTML=`
      <span class="cbtn-head"><span class="cn">${info.name}</span><span class="cmeta">${info.hp} · ${info.defence}</span></span>
      <span class="cstats">${info.stats}</span>
      <span class="cmeta">${info.armor} · ${info.weapon}</span>
      <span class="cx">${info.role}</span>
      <span class="cl1">${info.level1}</span>`;
    btn.onclick=()=>selCareer(btn);
    grid.appendChild(btn);
  });
}
function createRoom(){ send('CREATE_ROOM',{name:el('inp-name').value.trim()||'Wanderer'}); }
function joinRoom(){
  const code=el('inp-code').value.trim().toUpperCase();
  if(!code){el('lobby-err').textContent='Enter a room code.';return;}
  send('JOIN_ROOM',{name:el('inp-name').value.trim()||'Wanderer',code});
}
function selCareer(btn){
  document.querySelectorAll('.cbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel'); selectedCareer=btn.dataset.career;
  send('SELECT_CAREER',{career:selectedCareer,startingCharm:selectedCharm});
}
function setReady(){ send('SELECT_CAREER',{career:selectedCareer,startingCharm:selectedCharm}); setTimeout(()=>send('PLAYER_READY'),50); }
function updateLobbySlots(players){
  renderProgressUI(players);
  const el2=el('player-slots'); if(!el2)return;
  let h='';
  for(let i=0;i<4;i++){
    const p=players[i];
    if(p) h+=`<div class="pslot"><div class="pdot${p.ready?' ready':''}"></div><span class="ps-name">${p.name}</span><span class="ps-meta">${p.career?CAREER_LABELS[p.career]||p.career:'Choosing…'}${p.ready?' · Ready':''}</span></div>`;
    else  h+=`<div class="pslot"><div class="pdot empty"></div><span class="ps-meta">Open seat</span></div>`;
  }
  el2.innerHTML=h;
}
