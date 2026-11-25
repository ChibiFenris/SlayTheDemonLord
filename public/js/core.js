'use strict';
// Portrait tokens (base64 images keyed by class / enemy name)
let TOKEN_DATA={};
fetch('tokens.json').then(r=>r.json()).then(d=>{ TOKEN_DATA=d; }).catch(()=>{});

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
  ws.onopen=()=>{ clearTimeout(reconnectTimer); show('screen-lobby'); buildCareerGrid(); };
  ws.onmessage=e=>{ try{ onMsg(JSON.parse(e.data)); }catch(ex){ console.error(ex); } };
  ws.onclose=e=>{ sched('Disconnected (code '+e.code+' reason: '+(e.reason||'none')+'). Retrying...'); console.warn('WS close',e.code,e.reason,e.wasClean); };
  ws.onerror=e=>{ console.error('WS error',e); };
}
function sched(msg){ el('conn-msg').textContent=msg; show('screen-connect'); reconnectTimer=setTimeout(connect,3000); }
function send(type,payload={}){ if(ws&&ws.readyState===1) ws.send(JSON.stringify({type,payload})); }
function el(id){ return document.getElementById(id); }
function show(id){ document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); el(id).classList.add('active'); }

function onMsg(msg){
  if(msg.type==='ROOM_CREATED'||msg.type==='ROOM_JOINED'){
    myId=msg.payload.playerId;
    el('disp-code').textContent=msg.payload.code;
    el('join-panel').hidden=true;
    el('room-panel').hidden=false;
    el('career-panel').hidden=false;
  }
  if(msg.type==='STATE_UPDATE'){
    lastState=msg.payload;
    pathPickPending=false;
    renderState(msg.payload);
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
  send('SELECT_CAREER',{career:selectedCareer});
}
function setReady(){ send('SELECT_CAREER',{career:selectedCareer}); setTimeout(()=>send('PLAYER_READY'),50); }
function updateLobbySlots(players){
  const el2=el('player-slots'); if(!el2)return;
  let h='';
  for(let i=0;i<4;i++){
    const p=players[i];
    if(p) h+=`<div class="pslot"><div class="pdot${p.ready?' ready':''}"></div><span class="ps-name">${p.name}</span><span class="ps-meta">${p.career?CAREER_LABELS[p.career]||p.career:'Choosing…'}${p.ready?' · Ready':''}</span></div>`;
    else  h+=`<div class="pslot"><div class="pdot empty"></div><span class="ps-meta">Open seat</span></div>`;
  }
  el2.innerHTML=h;
}
