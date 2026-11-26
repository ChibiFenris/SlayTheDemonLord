'use strict';
// ─── RENOWN & UNLOCKS ─────────────────────────────────────────────────────────
// Every run earns Renown (depth reached, bosses slain, victory). Renown is kept
// in this browser and unlocks starting charms and harder difficulties.
const PROGRESS_KEY='sorProgress';
const UNLOCKS=[
  { at:15,  key:'startCharm', label:'Choose a starting charm' },
  { at:40,  key:'allCharms',  label:'All ten charms as starting choices' },
  { at:60,  key:'grim',       label:'Grim difficulty (tougher foes, 1.5× rewards)' },
  { at:100, key:'doom',       label:'Doom difficulty (much tougher foes, 2× rewards)' },
];
const STARTER_CHARMS=['haresFoot','ironTooth','grailToken'];
let GAME_CHARMS={}, GAME_DIFFICULTIES=[{id:0,name:'Standard'}];
let selectedCharm='';

function getProgress(){
  try{ return Object.assign({renown:0,runs:0,best:0},JSON.parse(store.get(PROGRESS_KEY)||'{}')); }
  catch(e){ return {renown:0,runs:0,best:0}; }
}
function hasUnlock(key){ const u=UNLOCKS.find(x=>x.key===key); return !!u&&getProgress().renown>=u.at; }
function nextUnlock(){ const r=getProgress().renown; return UNLOCKS.find(u=>u.at>r)||null; }

// Called once when a run ends; returns what was earned for the end screen.
function awardRun(gs,code){
  const stamp=`${code}:${gs.depth}:${gs.phase}`;
  if(store.get('sorLastAward')===stamp) return null;
  store.set('sorLastAward',stamp);
  const before=getProgress();
  const diff=gs.difficulty||0;
  const earned=Math.round((gs.depth+5*(gs.bossCount||0)+(gs.phase==='victory'?10:0))*(1+0.5*diff));
  const after={renown:before.renown+earned,runs:before.runs+1,best:Math.max(before.best,gs.depth)};
  store.set(PROGRESS_KEY,JSON.stringify(after));
  const unlocked=UNLOCKS.filter(u=>before.renown<u.at&&after.renown>=u.at);
  addRunToHistory(gs,earned);
  return {earned,total:after.renown,unlocked};
}

// ─── RUN HISTORY ──────────────────────────────────────────────────────────────
const HISTORY_KEY='sorHistory', HISTORY_MAX=20;
function getHistory(){ try{ return JSON.parse(store.get(HISTORY_KEY)||'[]'); }catch(e){ return []; } }
function addRunToHistory(gs,earned){
  const me=lastState&&lastState.players.find(p=>p.id===myId), c=me&&me.char;
  const cause=String(gs.deathCause||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  const rec={ at:Date.now(), victory:gs.phase==='victory', depth:gs.depth||0, bosses:gs.bossCount||0, difficulty:gs.difficulty||0,
    daily:!!gs.dailyKey, career:me&&me.career, level:c&&c.level, party:lastState?lastState.players.filter(p=>p.char).length:1,
    cause:cause.slice(0,90), renown:earned };
  const h=[rec,...getHistory()].slice(0,HISTORY_MAX);
  store.set(HISTORY_KEY,JSON.stringify(h));
}
function renderHistory(){
  const box=el('run-history'); if(!box) return;
  const h=getHistory();
  if(!h.length){ box.hidden=true; return; }
  box.hidden=false;
  const names={warrior:'Warrior',rogue:'Roadwarden',wizard:'Wizard',priest:'Priest'};
  const diffs=['','Grim','Doom'];
  const when=t=>{ const d=Math.round((Date.now()-t)/86400000); return d<=0?'today':d===1?'yesterday':`${d} days ago`; };
  box.innerHTML='<div class="rh-title">Recent runs</div>'+h.slice(0,6).map(r=>`
    <div class="rh-row ${r.victory?'won':'lost'}">
      <span class="rh-icon">${r.victory?'🏆':'✝'}</span>
      <span class="rh-main"><strong>${r.victory?'Victory':'Depth '+r.depth}</strong> · ${names[r.career]||'?'}${r.level?' Lv'+r.level:''}${r.party>1?` · party of ${r.party}`:' · solo'}${diffs[r.difficulty]?' · '+diffs[r.difficulty]:''}${r.daily?' · Daily':''}
        ${!r.victory&&r.cause?`<span class="rh-cause">${escapeHtml(r.cause)}</span>`:''}</span>
      <span class="rh-when">${when(r.at)}<br>+${r.renown||0}</span>
    </div>`).join('');
}
function escapeHtml(t){ return String(t).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }

// ─── DAILY RUN ────────────────────────────────────────────────────────────────
// The server picks one blessing and one hardship per day; the host can turn the
// Daily on for their room, and everyone's result lands on today's board.
let dailyInfo=null, dailyFetched=0;
function loadDaily(){
  if(Date.now()-dailyFetched<60000) return; dailyFetched=Date.now();
  fetch('api/daily').then(r=>r.ok?r.json():null).then(d=>{ if(d&&Array.isArray(d.mods)&&Array.isArray(d.board)){ dailyInfo=d; renderDaily(); } }).catch(()=>{});
}
function renderDaily(){
  const board=el('daily-board');
  if(board&&dailyInfo){
    const names={warrior:'Warrior',rogue:'Roadwarden',wizard:'Wizard',priest:'Priest'};
    board.hidden=false;
    board.innerHTML=`<div class="rh-title">Today's Daily Run</div>
      <div class="daily-mods">${dailyInfo.mods.map(m=>`<span class="daily-mod"><strong>${m.name}</strong> ${m.desc}</span>`).join('')}</div>
      ${dailyInfo.board.length?`<ol class="daily-list">${dailyInfo.board.map(e=>`<li><strong>${e.victory?'Victory':'Depth '+e.depth}</strong> — ${escapeHtml(e.names.join(', '))} <small>(${e.careers.map(c=>names[c]||c).join(', ')})</small></li>`).join('')}</ol>`
        :'<p class="hint">No one has finished today\'s Daily yet.</p>'}`;
  }
  const pick=el('daily-pick');
  if(pick&&lastState){
    const gs=lastState.gs, isHost=lastState.hostId===myId;
    if(isHost){
      pick.hidden=false;
      pick.innerHTML=`<span>Daily Run</span><button class="mini-btn${gs.daily?' good':''}" onclick="send('SET_DAILY',{on:${!gs.daily}})">${gs.daily?'On':'Off'}</button>`+
        (gs.daily&&dailyInfo?`<small>${dailyInfo.mods.map(m=>m.name).join(' + ')}</small>`:'');
    } else {
      pick.hidden=!gs.daily;
      pick.innerHTML=`<span>Daily Run</span><strong>On</strong>${dailyInfo?`<small>${dailyInfo.mods.map(m=>m.name).join(' + ')}</small>`:''}`;
    }
  }
}

// Lobby: renown line, starting-charm picker and (for the host) difficulty.
function renderProgressUI(players){
  renderHistory(); loadDaily(); renderDaily();
  const p=getProgress(), nu=nextUnlock();
  const line=el('renown-line');
  if(line) line.innerHTML=`Renown <strong>${p.renown}</strong>${p.runs?` · ${p.runs} run${p.runs>1?'s':''}, deepest ${p.best}`:''}${nu?` · next unlock at ${nu.at}: ${nu.label}`:' · everything unlocked'}`;
  const cw=el('charm-pick');
  if(cw){
    const keys=hasUnlock('allCharms')?Object.keys(GAME_CHARMS):STARTER_CHARMS.filter(k=>GAME_CHARMS[k]);
    cw.hidden=!hasUnlock('startCharm')||!keys.length;
    if(!cw.hidden&&!cw.dataset.built){
      cw.dataset.built='1';
      const sel=el('charm-select');
      sel.innerHTML='<option value="">No charm</option>'+keys.map(k=>`<option value="${k}">${GAME_CHARMS[k].name} — ${GAME_CHARMS[k].desc}</option>`).join('');
      sel.onchange=()=>{ selectedCharm=sel.value; send('SELECT_CAREER',{career:selectedCareer,startingCharm:selectedCharm}); };
    }
  }
  const dw=el('difficulty-pick');
  if(dw&&lastState){
    const gs=lastState.gs, isHost=lastState.hostId===myId;
    const allowed=GAME_DIFFICULTIES.filter(d=>d.id===0||(d.id===1&&hasUnlock('grim'))||(d.id===2&&hasUnlock('doom')));
    const cur=GAME_DIFFICULTIES.find(d=>d.id===(gs.difficulty||0))||GAME_DIFFICULTIES[0];
    if(isHost&&allowed.length>1){
      dw.hidden=false;
      dw.innerHTML=`<span>Difficulty</span>`+allowed.map(d=>`<button class="mini-btn${d.id===cur.id?' good':''}" onclick="send('SET_DIFFICULTY',{level:${d.id}})">${d.name}</button>`).join('');
    } else {
      dw.hidden=(gs.difficulty||0)===0;
      dw.innerHTML=`<span>Difficulty</span><strong>${cur.name}</strong>`;
    }
  }
}
