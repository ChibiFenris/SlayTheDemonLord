'use strict';
// ─── RENOWN & UNLOCKS ─────────────────────────────────────────────────────────
// Every run earns Renown (depth reached, bosses slain, victory). Renown is kept
// in this browser and unlocks starting charms and harder difficulties.
const PROGRESS_KEY='sorProgress';
const UNLOCKS=[
  { at:15,  key:'startCharm', label:'Choose a starting charm' },
  { at:40,  key:'allCharms',  label:'All ten charms as starting choices' },
  { at:60,  key:'grim',       label:'Grim difficulty (tougher foes, 1.5× rewards)' },
  { at:80,  key:'frameBronze',label:'Bronze portrait frame' },
  { at:100, key:'doom',       label:'Doom difficulty (much tougher foes, 2× rewards)' },
  { at:150, key:'startRelic', label:'Start every run with a relic' },
  { at:200, key:'frameSilver',label:'Silver portrait frame' },
  { at:300, key:'frameGold',  label:'Gold portrait frame' },
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
  if(gs.practice) return null; // practice fights earn nothing
  const stamp=`${code}:${gs.depth}:${gs.phase}`;
  if(store.get('sorLastAward')===stamp) return null;
  store.set('sorLastAward',stamp);
  const before=getProgress();
  const diff=gs.difficulty||0;
  const earned=Math.round((gs.depth+5*(gs.bossCount||0)+5*(gs.cursedTaken||0)+(gs.phase==="victory"?10:0))*(1+0.5*diff));
  const after={renown:before.renown+earned,runs:before.runs+1,best:Math.max(before.best,gs.depth)};
  store.set(PROGRESS_KEY,JSON.stringify(after));
  const unlocked=UNLOCKS.filter(u=>before.renown<u.at&&after.renown>=u.at);
  addRunToHistory(gs,earned);
  const newAch=checkAchievements(gs);
  return {earned,total:after.renown,unlocked,newAch};
}

// ─── RUN HISTORY ──────────────────────────────────────────────────────────────
const HISTORY_KEY='sorHistory', HISTORY_MAX=20;
function getHistory(){ try{ return JSON.parse(store.get(HISTORY_KEY)||'[]'); }catch(e){ return []; } }
function addRunToHistory(gs,earned){
  const me=lastState&&lastState.players.find(p=>p.id===myId), c=me&&me.char;
  const cause=String(gs.deathCause||'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  const rec={ at:Date.now(), victory:gs.phase==='victory', depth:gs.depth||0, bosses:gs.bossCount||0, difficulty:gs.difficulty||0,
    daily:!!gs.dailyKey, endless:!!gs.endless, career:me&&me.career, level:c&&c.level, party:lastState?lastState.players.filter(p=>p.char).length:1,
    cause:cause.slice(0,90), renown:earned, chronicle:String(gs.chronicle||'').slice(0,200) };
  const h=[rec,...getHistory()].slice(0,HISTORY_MAX);
  store.set(HISTORY_KEY,JSON.stringify(h));
  accountRecordRun(rec,earned); // signed-in players keep it on the server too
}
function renderHistory(){
  const box=el('run-history'); if(!box) return;
  const h=getHistory();
  if(!h.length){ box.hidden=true; return; }
  box.hidden=false;
  const names={warrior:'Warrior',rogue:'Roadwarden',wizard:'Wizard',priest:'Priest',witchhunter:'Witch Hunter',slayer:'Slayer'};
  const diffs=['','Grim','Doom'];
  const when=t=>{ const d=Math.round((Date.now()-t)/86400000); return d<=0?'today':d===1?'yesterday':`${d} days ago`; };
  box.innerHTML='<div class="rh-title">Recent runs</div>'+h.slice(0,6).map(r=>`
    <div class="rh-row ${r.victory?'won':'lost'}">
      <span class="rh-icon">${r.victory?'🏆':'✝'}</span>
      <span class="rh-main"><strong>${r.victory?'Victory':'Depth '+r.depth}</strong> · ${names[r.career]||'?'}${r.level?' Lv'+r.level:''}${r.party>1?` · party of ${r.party}`:' · solo'}${diffs[r.difficulty]?' · '+diffs[r.difficulty]:''}${r.daily?' · Daily':''}${r.endless?' · Endless':''}
        ${r.chronicle?`<span class="rh-cause">${escapeHtml(r.chronicle)}</span>`:!r.victory&&r.cause?`<span class="rh-cause">${escapeHtml(r.cause)}</span>`:''}</span>
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
    const names={warrior:'Warrior',rogue:'Roadwarden',wizard:'Wizard',priest:'Priest',witchhunter:'Witch Hunter',slayer:'Slayer'};
    board.hidden=false;
    board.innerHTML=`<div class="rh-title">Today's Daily Run</div>
      <div class="daily-mods">${dailyInfo.mods.map(m=>`<span class="daily-mod"><strong>${m.name}</strong> ${m.desc}</span>`).join('')}</div>
      ${dailyInfo.board.length?`<ol class="daily-list">${dailyInfo.board.map(e=>`<li><strong>${e.victory?'Victory':'Depth '+e.depth}</strong> — ${escapeHtml(e.names.join(', '))} <small>(${e.careers.map(c=>names[c]||c).join(', ')})</small></li>`).join('')}</ol>`
        :'<p class="hint">No one has finished today\'s Daily yet.</p>'}`;
  }
  const ep=el('endless-pick');
  if(ep&&lastState){
    const gs=lastState.gs, isHost=lastState.hostId===myId;
    if(isHost){ ep.hidden=false; ep.innerHTML=`<span>Endless</span><button class="mini-btn${gs.endless?' good':''}" onclick="send('SET_ENDLESS',{on:${!gs.endless}})">${gs.endless?'On':'Off'}</button><small>${gs.endless?'No final victory: a boss every 10 depths, foes and gear keep getting stronger.':'Keep going past depth 30.'}</small>`; }
    else { ep.hidden=!gs.endless; ep.innerHTML='<span>Endless</span><strong>On</strong>'; }
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
  renderHistory(); loadDaily(); renderDaily(); renderAchievements(); loadHallOfFame();
  const ab=el('account-box'), state=getAccount()?'in':'out';
  if(ab&&ab.dataset.state!==state){ ab.dataset.state=state; renderAccount(); } // don't wipe a half-typed PIN on every update
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
      sel.onchange=()=>{ selectedCharm=sel.value; resendCareer(); };
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

// ─── ACHIEVEMENTS & TITLES ────────────────────────────────────────────────────
// Earned at the end of a run; each gives a title you can wear in the lobby and
// on the battlefield. Kept in this browser and, when signed in, on your account.
const ACH_KEY='sorAch', TITLE_KEY='sorTitle', FRAME_KEY='sorFrame';
const ACHIEVEMENTS=[
  {key:'blooded',   title:'the Blooded',        desc:'Reach depth 5.',                         test:(gs)=>gs.depth>=5},
  {key:'beastbane', title:'Beastbane',          desc:'Slay a boss.',                           test:(gs)=>(gs.bossCount||0)>=1},
  {key:'twoBosses', title:'the Unbowed',        desc:'Slay two bosses in one run.',            test:(gs)=>(gs.bossCount||0)>=2},
  {key:'conqueror', title:'Conqueror of Reikland',desc:'Win a run.',                           test:(gs)=>gs.phase==='victory'},
  {key:'grimWin',   title:'the Grim',           desc:'Win on Grim or Doom.',                   test:(gs)=>gs.phase==='victory'&&(gs.difficulty||0)>=1},
  {key:'doomWin',   title:'Doombringer',        desc:'Win on Doom.',                           test:(gs)=>gs.phase==='victory'&&(gs.difficulty||0)>=2},
  {key:'loneBlade', title:'the Lone Blade',     desc:'Win a run alone.',                       test:(gs,me,party)=>gs.phase==='victory'&&party===1},
  {key:'cursed',    title:'Curse-Touched',      desc:'Walk two Cursed Paths in one run.',      test:(gs)=>(gs.cursedTaken||0)>=2},
  {key:'hoarder',   title:'Relic Hoarder',      desc:'Carry five relics at once.',             test:(gs,me)=>!!me&&(me.char.relics||[]).length>=5},
  {key:'moneybags', title:'the Moneylender',    desc:'End a run with 300 silver.',             test:(gs,me)=>!!me&&me.char.gold>=300},
  {key:'veteran',   title:'Veteran',            desc:'Reach level 7.',                         test:(gs,me)=>!!me&&me.char.level>=7},
  {key:'captain',   title:'Warband Captain',    desc:'Play a run with a full party of four.',  test:(gs,me,party)=>party>=4},
  {key:'endless40', title:'the Endless',        desc:'Reach depth 40 in Endless mode.',        test:(gs)=>!!gs.endless&&gs.depth>=40},
  {key:'endless60', title:'Abyss-Walker',       desc:'Reach depth 60 in Endless mode.',        test:(gs)=>!!gs.endless&&gs.depth>=60},
  {key:'daily',     title:'Daily Wanderer',     desc:'Finish a Daily Run.',                    test:(gs)=>!!gs.dailyKey},
  {key:'allCareers',title:'Jack of All Trades', desc:'Finish a run with every career.',        test:()=>{ const seen=new Set(getHistory().map(r=>r.career)); return ['warrior','rogue','wizard','priest','witchhunter','slayer'].every(k=>seen.has(k)); }},
];
function getAch(){ try{ return JSON.parse(store.get(ACH_KEY)||'{}')||{}; }catch(e){ return {}; } }
function setAch(a){ store.set(ACH_KEY,JSON.stringify(a)); }
function mergeAch(remote){ if(!remote||typeof remote!=='object') return; const a=getAch(); Object.entries(remote).forEach(([k,t])=>{ if(ACHIEVEMENTS.some(x=>x.key===k)&&!a[k]) a[k]=+t||Date.now(); }); setAch(a); }
function checkAchievements(gs){
  const me=lastState&&lastState.players.find(p=>p.id===myId);
  const party=lastState?lastState.players.filter(p=>p.char).length:1;
  const a=getAch(), fresh=[];
  ACHIEVEMENTS.forEach(x=>{ if(!a[x.key]){ let ok=false; try{ ok=x.test(gs,me,party); }catch(e){ ok=false; } if(ok){ a[x.key]=Date.now(); fresh.push(x); } } });
  if(fresh.length){ setAch(a); accountSyncAch(); }
  return fresh;
}
function myTitle(){ const t=store.get(TITLE_KEY)||''; const x=ACHIEVEMENTS.find(a=>a.key===t); return x&&getAch()[x.key]?x.title:''; }
function myFrame(){ const f=store.get(FRAME_KEY)||''; const need={bronze:'frameBronze',silver:'frameSilver',gold:'frameGold'}[f]; return need&&hasUnlock(need)?f:''; }
function lobbyCosmetics(){ return {title:myTitle()||null, frame:myFrame()||null, startRelic:hasUnlock('startRelic')&&store.get('sorStartRelic')!=='off'}; }
function setTitle(k){ store.set(TITLE_KEY,k); resendCareer(); renderAchievements(true); }
function setFrame(f){ store.set(FRAME_KEY,f); resendCareer(); renderAchievements(true); }
function setStartRelic(on){ store.set('sorStartRelic',on?'on':'off'); resendCareer(); renderAchievements(true); }
function resendCareer(){ if(typeof selectedCareer!=='undefined'&&selectedCareer&&lastState&&lastState.gs.phase==='lobby') send('SELECT_CAREER',Object.assign({career:selectedCareer,startingCharm:selectedCharm},lobbyCosmetics())); }
let _achBuilt='';
function renderAchievements(force){
  const box=el('ach-box'); if(!box) return;
  const a=getAch(), n=Object.keys(a).length, sig=n+'|'+(store.get(TITLE_KEY)||'')+'|'+(store.get(FRAME_KEY)||'')+'|'+getProgress().renown+'|'+(store.get('sorStartRelic')||'');
  if(!force&&_achBuilt===sig) return; _achBuilt=sig;
  const open=box.querySelector('details')&&box.querySelector('details').open;
  const cur=store.get(TITLE_KEY)||'', fr=store.get(FRAME_KEY)||'';
  const frames=[['','None'],['bronze','Bronze','frameBronze'],['silver','Silver','frameSilver'],['gold','Gold','frameGold']].filter(f=>!f[2]||hasUnlock(f[2]));
  box.innerHTML=`<details class="ach"${open?' open':''}><summary>Achievements <small>${n} / ${ACHIEVEMENTS.length}</small></summary>
    <ul class="ach-list">${ACHIEVEMENTS.map(x=>`<li class="${a[x.key]?'got':''}"><span class="ach-ic">${a[x.key]?'🏅':'○'}</span><span><strong>${x.title}</strong> — ${x.desc}</span>${a[x.key]?`<button class="mini-btn${cur===x.key?' good':''}" onclick="setTitle('${cur===x.key?'':x.key}')">${cur===x.key?'Worn':'Wear'}</button>`:''}</li>`).join('')}</ul>
    ${frames.length>1?`<div class="ach-row">Portrait frame ${frames.map(f=>`<button class="mini-btn${fr===f[0]?' good':''}" onclick="setFrame('${f[0]}')">${f[1]}</button>`).join('')}</div>`:''}
    ${hasUnlock('startRelic')?`<div class="ach-row">Start with a relic <button class="mini-btn${store.get('sorStartRelic')!=='off'?' good':''}" onclick="setStartRelic(true)">On</button><button class="mini-btn${store.get('sorStartRelic')==='off'?' good':''}" onclick="setStartRelic(false)">Off</button></div>`:''}
  </details>`;
}

// ─── HALL OF FAME ─────────────────────────────────────────────────────────────
let hofFetched=0;
function loadHallOfFame(){
  if(Date.now()-hofFetched<120000) return; hofFetched=Date.now();
  fetch('api/halloffame').then(r=>r.ok?r.json():null).then(d=>{ if(d&&Array.isArray(d.runs)) renderHallOfFame(d.runs); }).catch(()=>{});
}
function renderHallOfFame(runs){
  const box=el('hall-of-fame'); if(!box) return;
  if(!runs.length){ box.hidden=true; return; }
  box.hidden=false;
  const diffs=['','Grim','Doom'];
  box.innerHTML='<div class="rh-title">Hall of fame</div>'+runs.slice(0,5).map((r,i)=>`
    <div class="rh-row ${r.victory?'won':'lost'}">
      <span class="rh-icon">${['🥇','🥈','🥉'][i]||'·'}</span>
      <span class="rh-main"><strong>${r.players.map(p=>escapeHtml(p.name)+(p.title?` <em>${escapeHtml(p.title)}</em>`:'')).join(', ')}</strong>
        <span class="rh-cause">${r.victory?'Victory':'Depth '+r.depth}${diffs[r.difficulty]?' · '+diffs[r.difficulty]:''}${r.victory&&r.rounds?` · ${r.rounds} rounds`:''}${r.daily?' · Daily':''}${r.endless?' · Endless':''}</span></span>
    </div>`).join('');
}
