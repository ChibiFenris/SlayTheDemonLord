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
  return {earned,total:after.renown,unlocked};
}

// Lobby: renown line, starting-charm picker and (for the host) difficulty.
function renderProgressUI(players){
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
