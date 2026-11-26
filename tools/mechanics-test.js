'use strict';
// Mechanics tests: builds rooms in-process and checks specific rules fire.
// Run with: node tools/mechanics-test.js   (also part of npm test)
process.env.DATA_DIR = process.env.DATA_DIR || require('path').join(require('os').tmpdir(), 'sor-test-data');
const S0 = require('../server.js');
const S = { ...S0, ...S0.enemies, ...S0.gear };
process.removeAllListeners('uncaughtException'); // let test errors fail the run
const D = require('../game/data.js');
const all=[...D.ENEMY_POOLS.low,...D.ENEMY_POOLS.mid,...D.ENEMY_POOLS.high];
const tmpl=n=>all.find(e=>e.name===n);
function mkRoom(careers){
  const wss=careers.map(()=>({readyState:1,send(){}}));
  S.handleMessage(wss[0],{type:'CREATE_ROOM',payload:{name:'P0'}});
  const room=[...S.rooms.values()].pop();
  for(let i=1;i<careers.length;i++) S.handleMessage(wss[i],{type:'JOIN_ROOM',payload:{code:room.code,name:'P'+i}});
  careers.forEach((c,i)=>S.handleMessage(wss[i],{type:'SELECT_CAREER',payload:{career:c}}));
  careers.forEach((c,i)=>S.handleMessage(wss[i],{type:'PLAYER_READY',payload:{}}));
  return {room,wss};
}
function mkEnemy(name,room){ const e=S.scaleEnemy(JSON.parse(JSON.stringify(tmpl(name))),room.players.length,false,0); S.prepareEnemy&&S.prepareEnemy(e,0); e.id='e'+Math.random(); return e; }
function combat(room,names){
  const gs=room.gs; gs.enemies=names.map(n=>mkEnemy(n,room)); gs.enemy=gs.enemies[0]; gs.activeEnemyIdx=0;
  gs.inCombat=true; gs.phase='combat'; gs.roundNumber=1; gs.playersActedThisRound=[]; S.startSpoils(room); S.buildTurnOrder(room);
}
let fails=0; const ok=(c,m)=>{ console.log((c?'ok  ':'FAIL')+' '+m); if(!c) fails++; };
const logHas=(room,re)=>room.gs.log.some(l=>re.test(l.msg));
// 1. Clanrat hides behind an ally below 30%
{ const {room}=mkRoom(['warrior']); combat(room,['Skaven Clanrat','Skaven Stormvermin']);
  const rat=room.gs.enemies[0]; rat.hp=Math.floor(rat.maxHp*0.2);
  const r=S.enemyPreTurn(room,rat,room.players);
  ok(r==='done'&&rat._hiding, 'Clanrat hides when low and an ally stands');
  ok(logHas(room,/cowers behind/),'hide is logged');
  room.gs.activeEnemyIdx=0; const t=S.getTargetEnemy(room.gs);
  ok(t!==rat,'hidden Clanrat is not the target (got '+(t&&t.name)+')');
  room.gs.enemies[1].hp=0; const r2=S.enemyPreTurn(room,rat,room.players);
  ok(r2!=='done'&&!rat._hiding,'stops hiding when alone'); }
// 2. Warlord shoves a Clanrat into a big hit
{ const {room}=mkRoom(['warrior']); combat(room,['Skaven Warlord','Skaven Clanrat']);
  const wl=room.gs.enemies[0], rat=room.gs.enemies[1]; const ratHp=rat.hp;
  const dealt=S.enemyOnWeaponHit(room,room.players[0],wl,12);
  ok(dealt===0&&rat.hp<ratHp,'Coward redirects a 12-dmg hit to the Clanrat');
  const dealt2=S.enemyOnWeaponHit(room,room.players[0],wl,5);
  ok(dealt2>0,'small hits are not redirected'); }
// 3. Minotaur charge on round 1
{ const {room}=mkRoom(['warrior']); combat(room,['Minotaur']);
  const mino=room.gs.enemies[0]; const p=room.players[0];
  const dmg=S.enemyDamageMods(room,mino,p,5,{crit:false},{});
  ok(dmg>5 && logHas(room,/Bull Charge/),'Bull Charge adds damage on round 1 ('+dmg+')');
  S.enemyAfterHit(room,mino,p,dmg,{hit:true},{});
  ok((p.char.activeBuffs||[]).some(b=>b.name==='Prone'),'Bull Charge knocks Prone');
  room.gs.roundNumber=2; const dmg2=S.enemyDamageMods(room,mino,p,5,{crit:false},{});
  ok(dmg2===5,'no charge after round 1'); }
// 4. Aftermath: XP banked, paid after combat
{ const {room}=mkRoom(['warrior','rogue']); combat(room,['Skaven Clanrat','Skaven Clanrat']);
  const p=room.players[0]; const xp0=p.char.xp, g0=p.char.gold;
  const [a,b]=room.gs.enemies; a.hp=0; S.resolveEnemyDeath(room,a);
  ok(p.char.xp===xp0&&p.char.gold===g0,'no XP/silver mid-fight');
  ok(room.gs.phase==='combat','still in combat after first kill');
  b.hp=0; S.resolveEnemyDeath(room,b);
  ok(room.gs.phase==='aftermath'&&room.gs.aftermath,'aftermath after last kill');
  ok(p.char.xp>xp0,'XP paid at the end ('+xp0+'→'+p.char.xp+')');
  ok(room.gs.aftermath.enemies.length===2,'aftermath lists both kills');
  S.handlePlayerAction(room,room.players[0].id,{action:'CONTINUE_AFTERMATH'},room.players[0].ws);
  ok(room.gs.phase==='aftermath','waits for everyone');
  S.handlePlayerAction(room,room.players[1].id,{action:'CONTINUE_AFTERMATH'},room.players[1].ws);
  ok(room.gs.phase==='path','moves on to the path vote'); }
// 5. Level-up happens after the fight, path pick after aftermath
{ const {room}=mkRoom(['warrior']); combat(room,['Chaos Warrior']);
  const p=room.players[0]; p.char.xp=1; const lvl0=p.char.level;
  room.gs.enemies[0].hp=0; S.resolveEnemyDeath(room,room.gs.enemies[0]);
  const r=room.gs.aftermath.rewards[p.id];
  ok(p.char.level>lvl0 && r.levelUps.length>0,'level up applied at payout (lv '+lvl0+'→'+p.char.level+')'); }
// 6. Illusionist talents
{ const {room}=mkRoom(['wizard']); combat(room,['Chaos Warrior']); const p=room.players[0];
  p.char.glamourVeil=true; const r=S.rollEnemyAttack(room.gs.enemies[0],p.char,false,room);
  ok(!r.hit&&p.char._glamourUsed,'Glamour Veil makes the first attack miss'); }
// 7. Choice events: vote, majority, effect
{ const {room}=mkRoom(['warrior','priest']); room.gs.phase='event';
  S.events.startChoiceEvent(room,'pilgrims');
  ok(room.gs.phase==='choice'&&room.gs.choice.options.length===2,'choice event opens a vote');
  const [a,b]=room.players; a.char.health=5; b.char.health=5;
  S.events.voteChoice(room,a.id,'pray');
  ok(room.gs.phase==='choice','waits for every vote');
  S.events.voteChoice(room,b.id,'pray');
  ok(room.gs.phase==='event'&&a.char.health>5,'majority option resolves and heals'); }
// 8. Every choice event resolves every option without errors
{ for(const [key,ev] of Object.entries(S.events.CHOICE_EVENTS)) for(const o of ev.options){
    const {room}=mkRoom(o.needs?['warrior',[].concat(o.needs)[0]]:['warrior','wizard']); room.gs.phase='event'; room.gs.depth=25; room.players.forEach(p=>{p.char.gold=50;});
    let err=null; try{ S.events.startChoiceEvent(room,key); room.players.forEach(p=>S.events.voteChoice(room,p.id,o.id)); }catch(e){ err=e; }
    if(err||room.gs.phase==='choice') ok(false,`event ${key}/${o.id} failed: ${err&&err.message}`);
  } ok(true,'all choice events resolve');
  const {room:g}=mkRoom(['warrior','wizard']); g.gs.depth=25; S.events.startChoiceEvent(g,'desecratedShrine');
  ok(!g.gs.choice.options.some(o=>o.id==='consecrate'||o.id==='purge'),'class options are hidden without that class');
  const {room:g2}=mkRoom(['priest','witchhunter']); g2.gs.depth=25; S.events.startChoiceEvent(g2,'desecratedShrine');
  ok(g2.gs.choice.options.some(o=>o.id==='consecrate')&&g2.gs.choice.options.some(o=>o.id==='purge'),'class options appear with that class');
  const {room:g3}=mkRoom(['warrior']); g3.gs.depth=3; let deep=false; for(let i=0;i<60;i++){ S.events.startChoiceEvent(g3); if(S.events.CHOICE_EVENTS[g3.gs.choice.key].minDepth>3) deep=true; }
  ok(!deep,'deep-road events never appear early'); }
// 9. Difficulty raises enemy HP and rewards
{ const {room,wss}=mkRoom(['warrior']); room.gs.phase='lobby'; S.handleMessage(wss[0],{type:'SET_DIFFICULTY',payload:{level:2}});
  ok(room.gs.difficulty===2,'host can set difficulty in the lobby'); }
// 10. Starting charm is equipped
{ const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'C'}}); const room=[...S.rooms.values()].pop();
  S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:'rogue',startingCharm:'haresFoot'}});
  ok(room.players[0].char.equippedCharm&&room.players[0].char.equippedCharm.key==='haresFoot','starting charm is equipped'); }
// 10b. Lone Survivor: solo Warrior/Wizard get it, a party and a solo Rogue don't
{ const solo=c=>{ const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'L'}}); const room=[...S.rooms.values()].pop();
    S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:c}}); const hp=room.players[0].char.maxHealth, pw=room.players[0].char.power;
    S.handleMessage(ws,{type:'PLAYER_READY',payload:{}}); const ch=room.players[0].char; return {room,ch,dHp:ch.maxHealth-hp,dPw:ch.power-pw}; };
  const w=solo('warrior'), z=solo('wizard'), r=solo('rogue');
  ok(w.ch.loneSurvivor&&w.dHp===6,'solo Warrior gets Lone Survivor (+6 HP)');
  ok(z.ch.loneSurvivor&&z.dHp===5,'solo Wizard gets Lone Survivor (+5 HP)');
  ok(!r.ch.loneSurvivor&&r.dHp===0,'solo Rogue does not get Lone Survivor');
  const pr2=solo('priest'); ok(pr2.ch.loneSurvivor&&pr2.dHp===5,'solo Priest gets Lone Survivor (+5 HP)');
  const {room:pr}=mkRoom(['warrior','wizard']); ok(!pr.players.some(p=>p.char.loneSurvivor),'party members do not get Lone Survivor'); }
// 11. Rejoin reclaims a seat
{ const ws1={readyState:1,send(){}}; S.handleMessage(ws1,{type:'CREATE_ROOM',payload:{name:'R'}}); const room=[...S.rooms.values()].pop();
  const pid=room.players[0].id; room.players[0].connected=false;
  const got=[]; const ws2={readyState:1,send(m){got.push(JSON.parse(m).type);},close(){}};
  S.handleMessage(ws2,{type:'REJOIN',payload:{code:room.code,playerId:pid}});
  ok(room.players[0].connected&&room.players[0].ws===ws2&&got.includes('ROOM_JOINED'),'REJOIN reclaims the seat');
  const ws3={readyState:1,send(m){got.push(JSON.parse(m).type);}}; S.handleMessage(ws3,{type:'REJOIN',payload:{code:'NOPE',playerId:'x'}});
  ok(got.includes('REJOIN_FAILED'),'unknown seat is refused'); }
// 12. Daily Run: modifiers apply at the start and to enemies
{ const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'D'}}); const room=[...S.rooms.values()].pop();
  S.handleMessage(ws,{type:'SET_DAILY',payload:{on:true}}); ok(room.gs.daily===true,'host can turn the Daily Run on');
  S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:'warrior'}}); S.handleMessage(ws,{type:'PLAYER_READY',payload:{}});
  ok(room.gs.dailyKey===S.runlog.todayKey()&&room.gs.dailyMods.length===2,'daily run records today\'s two modifiers');
  room.gs.dailyMods=['brittleFoes','bloodMoon']; const e={ac:14,dmgNum:1,dmgSides:6,dmgBonus:0,hp:20,maxHp:20};
  S.applyDailyToEnemies(room.gs,[e]); ok(e.ac===13&&e.dmgBonus===1,'daily modifiers change enemy Defence and damage');
  const ws2={readyState:1,send(){}}; S.handleMessage(ws2,{type:'CREATE_ROOM',payload:{name:'D2'}}); const r2=[...S.rooms.values()].pop();
  r2.players[0].career='rogue'; r2.players[0].char=S.buildChar('rogue'); r2.gs.daily=true;
  const realMods=S.runlog.dailyMods; S.runlog.dailyMods=()=>[{id:'provisioned',name:'P',desc:''},{id:'ironHide',name:'I',desc:''}];
  const g0=r2.players[0].char.gold; S.startDailyRun(r2); S.runlog.dailyMods=realMods;
  const hd=r2.players[0].char.inventory.find(i=>i.name==='Healing Draught');
  ok(hd&&hd.qty>=2&&r2.players[0].char.gold===g0+20,'Well Provisioned gives draughts and silver'); }
// 13. Finished runs are logged once and counted in stats
{ const before=S.runlog.readRuns().length; const {room}=mkRoom(['warrior','priest']); room.gs.depth=7; room.gs.phase='gameover';
  room.gs.deathCause='<strong>Varghulf</strong> hits P0 — -9 dmg'; S.broadcastState(room.code); S.broadcastState(room.code);
  const runs=S.runlog.readRuns(); ok(runs.length===before+1,'a finished run is logged exactly once');
  ok(runs[runs.length-1].killer==='Varghulf'&&runs[runs.length-1].players.length===2,'run log names the killer and the party');
  ok(S.runlog.stats().runs===runs.length,'stats summarise the log'); }
// 14. Turn timer passes an idle player's turn in a party, never solo
{ const {room}=mkRoom(['warrior','rogue']); combat(room,['Skaven Clanrat']);
  const realST=global.setTimeout; let fired=null; global.setTimeout=(fn,ms)=>{ if(ms===S.TURN_LIMIT_MS){ fired=fn; return {unref(){}}; } return realST(fn,ms); };
  const pIdx=room.gs.turnOrder.findIndex(t=>t.type==='player'); room.gs.activeTurnIdx=pIdx; const cur=room.gs.turnOrder[pIdx];
  S.startTurnTimer(room,cur); global.setTimeout=realST;
  ok(room.gs.turnDeadline>Date.now()&&typeof fired==='function','party turns get a deadline');
  fired(); ok(room.gs.activeTurnIdx!==pIdx||room.gs.roundNumber>1,'an idle player\'s turn passes when time runs out');
  ok(logHas(room,/hesitates too long/),'the timeout is announced');
  const {room:solo}=mkRoom(['warrior']); combat(solo,['Skaven Clanrat']); const sc=solo.gs.turnOrder.find(t=>t.type==='player');
  S.startTurnTimer(solo,sc); ok(solo.gs.turnDeadline==null,'solo turns have no timer'); }
// 15. Joining a run in progress takes over a seat that has been empty for a while
{ const sent=[]; const {room}=mkRoom(['warrior','wizard']); room.gs.phase='event';
  const seat=room.players[1]; seat.connected=false; seat.disconnectedAt=Date.now();
  const nw={readyState:1,send(m){sent.push(JSON.parse(m));}};
  S.handleMessage(nw,{type:'JOIN_ROOM',payload:{code:room.code,name:'Late'}});
  ok(sent.some(m=>m.type==='ERROR')&&seat.name!=='Late','a seat that only just emptied is not taken');
  seat.disconnectedAt=Date.now()-60000; sent.length=0;
  S.handleMessage(nw,{type:'JOIN_ROOM',payload:{code:room.code,name:'Late'}});
  const j=sent.find(m=>m.type==='ROOM_JOINED');
  ok(j&&j.payload.playerId===seat.id&&seat.name==='Late'&&seat.connected,'a newcomer takes over the empty seat');
  const back=[]; S.handleMessage({readyState:1,send(m){back.push(JSON.parse(m).type);}},{type:'REJOIN',payload:{code:room.code,playerId:seat.id}});
  ok(back.includes('REJOIN_FAILED')&&seat.ws===nw,'the old player cannot snatch the seat back without its new token');
  const ok2=[]; seat.connected=false; S.handleMessage({readyState:1,send(m){ok2.push(JSON.parse(m).type);}},{type:'REJOIN',payload:{code:room.code,playerId:seat.id,token:j.payload.token}});
  ok(ok2.includes('ROOM_JOINED'),'the newcomer can rejoin with their token'); }
// 16. Input safety
{ ok(S.cleanName('<img src=x onerror=alert(1)>Bob','P')==='img src=x onerror=alert(1)Bob'.slice(0,20),'names lose markup characters');
  ok(S.cleanName('   ','Player')==='Player'&&S.cleanName('A'.repeat(50),'P').length===20,'blank names fall back, long names are cut');
  const ws={readyState:1,send(){},close(){ this.closed=true; }}; let allowed=0;
  for(let i=0;i<100;i++) if(S.allowMessage(ws)) allowed++;
  ok(allowed<=S.RATE.burst+1&&allowed>=S.RATE.burst-1,'a burst of messages is capped');
  const sent=[]; const w2={readyState:1,send(m){sent.push(JSON.parse(m));}};
  for(let i=0;i<7;i++) S.handleMessage(w2,{type:'CREATE_ROOM',payload:{name:'Spam'}});
  ok(sent.filter(m=>m.type==='ROOM_CREATED').length===5&&sent.some(m=>m.type==='ERROR'),'one connection can only create a few rooms');
  S.handleMessage(w2,null); S.handleMessage(w2,{type:5}); S.handleMessage(w2,{type:'JOIN_ROOM'}); ok(true,'malformed messages are ignored'); }
// 17. Per-room random numbers
{ const R=require('../game/rng');
  const a=R.makeRng(42), b=R.makeRng(42); const sa=[1,2,3,4,5].map(()=>R.next(a)), sb=[1,2,3,4,5].map(()=>R.next(b));
  ok(JSON.stringify(sa)===JSON.stringify(sb)&&sa.every(x=>x>=0&&x<1),'the same seed gives the same numbers');
  const roomA={gs:{rng:R.makeRng(7)}}, roomB={gs:{rng:R.makeRng(7)}};
  const ra=R.withRoom(roomA,()=>[Math.random(),Math.random()]); Math.random(); const rb=R.withRoom(roomB,()=>[Math.random(),Math.random()]);
  ok(ra[0]===rb[0]&&ra[1]===rb[1],'Math.random follows the room being handled');
  const mk=()=>{ const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'S'}}); const room=[...S.rooms.values()].pop();
    S.handleMessage(ws,{type:'SET_DAILY',payload:{on:true}}); S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:'warrior'}}); S.handleMessage(ws,{type:'PLAYER_READY',payload:{}}); return room; };
  const d1=mk(), d2=mk();
  ok(JSON.stringify(d1.gs.pathChoices)===JSON.stringify(d2.gs.pathChoices)&&d1.gs.rng.s===d2.gs.rng.s,'two Daily Runs start with the same choices');
  ok(S.publicState(d1).gs.rng===undefined,'the seed is never sent to players'); }
// 18. State patches rebuild exactly the full state
{ const SS=require('../game/statesync');
  const {room}=mkRoom(['warrior','priest']); combat(room,['Skaven Clanrat','Skaven Clanrat']);
  const got=[]; const pws={readyState:1,_patches:true,send(m){got.push(JSON.parse(m));}};
  const fws={readyState:1,send(m){got.push({full:true,...JSON.parse(m)});}};
  room.players[0].ws=pws; room.players[1].ws=fws; room._sync=null;
  let mirror=null, okAll=true, fullBytes=0, patchBytes=0;
  for(let step=0;step<25;step++){
    got.length=0;
    if(step%3===0) S.addLog(room,'step '+step,'sys');
    if(step%4===1) room.gs.enemies[0].hp=Math.max(0,room.gs.enemies[0].hp-1);
    if(step%5===2) room.players[1].char.health--;
    if(step===10) delete room.gs.choice; if(step===11) room.gs.someFlag=true;
    S.broadcastState(room.code);
    const forP=got.find(m=>!m.full), forF=got.find(m=>m.full);
    fullBytes+=JSON.stringify(forF).length; patchBytes+=JSON.stringify(forP).length;
    if(forP.type==='STATE_UPDATE') mirror=forP.payload; else mirror=SS.apply(mirror,forP.payload);
    const canon=v=>JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.keys(x).sort().reduce((o,kk)=>{ if(kk!=='turnMsLeft') o[kk]=x[kk]; return o; },{}):x);
    if(canon(S.publicState(room))!==canon(mirror)){ okAll=false; console.log('  patch mismatch at step',step); break; }
  }
  ok(okAll,'patched state matches the full state after every update');
  ok(got.length===2,'players who did not ask for patches still get full states');
  ok(patchBytes<fullBytes/4,`patches are much smaller (${Math.round(patchBytes/1024)} KB vs ${Math.round(fullBytes/1024)} KB over 25 updates)`); }
// 19. New classes
{ const {room}=mkRoom(['witchhunter','slayer']); const wh=room.players[0].char, sl=room.players[1].char;
  ok(wh.condemn&&wh.silverShot&&wh.firstVolley&&wh.catchBreath&&wh.maxHealth===29,'Witch Hunter starts with Condemn, Silver Shot, First Volley (29 HP)');
  ok(sl.slayerOath&&sl.deathWish&&sl.rage&&sl.maxHealth===34&&sl.defense===10,'Dwarf Slayer starts with Oath, Death Wish, Rage (34 HP, Defence 10)');
  ok(wh.equippedWeapon.dmgType==='piercing'&&sl.equippedWeapon.dice==='1d8','new classes get their own weapons');
  combat(room,['Undead Skeleton','Skaven Clanrat']); room.gs.activeEnemyIdx=0;
  const pIdx=room.gs.turnOrder.findIndex(t=>t.id===room.players[0].id); room.gs.activeTurnIdx=pIdx;
  const before=room.gs.activeTurnIdx;
  S.handlePlayerAction(room,room.players[0].id,{action:'USE_TALENT',data:{talent:'condemn'}});
  ok(wh._condemnTargetId===room.gs.enemies[0].id&&room.gs.activeTurnIdx===before,'Condemn marks the target and does not use the turn');
  ok((room.gs.enemies[0].activeDebuffs||[]).some(d=>d.condemned),'the Condemned enemy shows the mark');
  S.handlePlayerAction(room,room.players[0].id,{action:'USE_TALENT',data:{talent:'condemn'}});
  ok(wh._condemnUsed===true&&(room.gs.log.slice(-1)[0].msg||'').includes('recharging'),'Condemn cannot be used again while recharging');
  // Boons: First Volley + Condemn on the first attack
  const real=Math.random; Math.random=()=>0.5;
  const ra=S.rollAttack(wh,room.gs.enemies[0],0); Math.random=real;
  ok(ra&&ra.final>ra.base,'First Volley and Condemn give boons');
  // Death Wish
  sl.health=Math.floor(sl.maxHealth/2)-1; Math.random=()=>0.5; const rb=S.rollAttack(sl,room.gs.enemies[1],0); Math.random=real;
  ok(rb&&rb.final>rb.base,'Death Wish gives a boon below half HP');
  const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'X'}}); const r2=[...S.rooms.values()].pop();
  S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:'slayer'}}); ok(r2.players[0].char.novicePath==='slayer','choosing Slayer applies its novice path'); }
// 20. New bosses: every boss pool has three, and each wind-up resolves
{ const D2=require('../game/data.js');
  ok(D2.ENEMY_POOLS.boss1.length===4&&D2.ENEMY_POOLS.boss2.length===4&&D2.ENEMY_POOLS.boss3.length===3,'boss pools: 4 / 4 / 3');
  const kinds=['warpStorm','hornCurse','plagueWind','trollSmash','hellfire','dragonBreath'];
  let allOk=true;
  for(const k of kinds){
    const {room}=mkRoom(['warrior','priest']); const boss=[...D2.ENEMY_POOLS.boss1,...D2.ENEMY_POOLS.boss2,...D2.ENEMY_POOLS.boss3].find(b=>b.telegraph===k);
    const e=S.scaleEnemy(JSON.parse(JSON.stringify(boss)),2,false,1); e.id='b1'; room.gs.enemies=[e]; room.gs.enemy=e; room.gs.inCombat=true; room.gs.phase='combat'; room.gs.roundNumber=3;
    S.startSpoils(room); S.buildTurnOrder(room); e._windup=k;
    const hp0=room.players.map(p=>p.char.health);
    try{ const res=S.enemyPreTurn(room,e,room.players.filter(p=>p.char.alive)); 
      const changed=room.players.some((p,i)=>p.char.health!==hp0[i]||(p.char.activeBuffs||[]).length||p.char._poisonedStacks)||res!=='done';
      if(!changed){ allOk=false; console.log('  wind-up did nothing:',k); }
    }catch(err){ allOk=false; console.log('  wind-up failed:',k,err.message); }
  }
  ok(allOk,'all six new boss wind-ups resolve');
  ok(true,'boss portraits: '+['Grey Seer Skrittar','Bray-Shaman Ghorros','Blight King Gutrot','Gorgrund the Stone Troll',"Daemon Prince Vhar'kul",'Skaldrak the Elder Wyrm'].filter(n=>require('../public/tokens/index.json')[n]).length+'/6'); }
// 21. Quick chat
{ const {room,wss}=mkRoom(['warrior','priest']);
  S.handleMessage(wss[0],{type:'EMOTE',payload:{id:'heal'}}); S.handleMessage(wss[0],{type:'EMOTE',payload:{id:'heal'}}); S.handleMessage(wss[0],{type:'EMOTE',payload:{id:'<script>'}});
  ok(room.gs.log.filter(l=>l.type==='emote').length===1&&/Heal me!/.test(room.gs.log.find(l=>l.type==='emote').msg),'quick chat posts fixed lines with a cooldown'); }
// 22. Accounts
{ const A=require('../game/accounts'); A._reset();
  const got=[]; const ws={readyState:1,send(m){got.push(JSON.parse(m));}};
  S.handleMessage(ws,{type:'ACCOUNT_LOGIN',payload:{name:'Fox',pin:'1234',local:{progress:{renown:40,runs:2,best:12},history:[]}}});
  const okm=got.find(m=>m.type==='ACCOUNT_OK'); ok(okm&&okm.payload.created&&okm.payload.progress.renown===40,'a new account starts from this browser\'s Renown');
  got.length=0; S.handleMessage(ws,{type:'ACCOUNT_LOGIN',payload:{name:'fox',pin:'9999'}});
  ok(got.some(m=>m.type==='ACCOUNT_ERROR'),'a wrong PIN is refused');
  got.length=0; S.handleMessage(ws,{type:'ACCOUNT_RUN',payload:{token:okm.payload.token,earned:15,rec:{depth:14,victory:false,career:'slayer'}}});
  const after=got.find(m=>m.type==='ACCOUNT_OK'); ok(after&&after.payload.progress.renown===55&&after.payload.progress.best===14&&after.payload.history.length===1,'finished runs add Renown on the server');
  got.length=0; const ws2={readyState:1,send(m){got.push(JSON.parse(m));}}; S.handleMessage(ws2,{type:'ACCOUNT_LOGIN',payload:{name:'Fox',pin:'1234'}});
  ok(got.some(m=>m.type==='ACCOUNT_OK'&&m.payload.progress.renown===55),'signing in elsewhere brings the Renown along');
  for(let i=0;i<6;i++) A.login('Fox','0000'); ok(/Too many/.test(A.login('Fox','1234').error||''),'repeated wrong PINs lock the account');
  ok(A.login('<b>','1234').error&&A.login('Ann','12').error,'bad names and short PINs are refused'); }
// 23. Practice fight
{ const got=[]; const ws={readyState:1,send(m){got.push(JSON.parse(m));}};
  S.handleMessage(ws,{type:'START_PRACTICE',payload:{name:'Recruit',career:'witchhunter'}});
  const room=[...S.rooms.values()].pop();
  ok(room.gs.practice&&room.gs.phase==='combat'&&room.gs.enemies.length>=1&&room.players[0].char.condemn,'practice starts one fight with the chosen career');
  const before=S.runlog.readRuns().length; room.gs.phase='gameover'; S.broadcastState(room.code);
  ok(S.runlog.readRuns().length===before,'practice fights are not logged as runs');
  room.gs.phase='aftermath'; room.gs.aftermath={ready:[room.players[0].id]}; S.aftermathReady(room);
  ok(room.gs.phase==='practiceDone','practice ends after its one fight'); }
// 24. Leaving and quitting
{ const {room,wss}=mkRoom(['warrior','priest']); room.gs.phase='lobby'; const hostId=room.hostId;
  S.leaveRoom(wss[0]); ok(room.players.length===1&&room.hostId!==hostId&&room.hostId===room.players[0].id,'leaving the lobby removes you and hands over host');
  const {room:r2,wss:w2}=mkRoom(['warrior','priest']); combat(r2,['Skaven Clanrat']);
  const pIdx=r2.gs.turnOrder.findIndex(t=>t.id===r2.players[0].id); r2.gs.activeTurnIdx=pIdx;
  S.leaveRoom(w2[0]);
  ok(r2.players.length===2&&!r2.players[0].connected&&r2.players[0].char,'quitting mid-run leaves your character behind');
  const cur=r2.gs.turnOrder[r2.gs.activeTurnIdx]; ok(!cur||cur.id!==r2.players[0].id,'the quitter\'s turn passes');
  const sent=[]; S.handleMessage({readyState:1,send(m){sent.push(JSON.parse(m));}},{type:'JOIN_ROOM',payload:{code:r2.code,name:'Late'}});
  ok(sent.some(m=>m.type==='ROOM_JOINED')&&r2.players[0].name==='Late','the empty seat can be taken straight away');
  const {room:r3,wss:w3}=mkRoom(['wizard']); combat(r3,['Skaven Clanrat']); const code=r3.code;
  const before=S.runlog.readRuns().length; S.leaveRoom(w3[0]);
  ok(!S.rooms.has(code)&&S.runlog.readRuns().length===before,'quitting a solo run closes it without logging it'); }
// 25. Cooldowns replace once-per-combat
{ const {room}=mkRoom(['warrior','priest']); combat(room,['Skaven Stormvermin']); const w=room.players[0].char;
  w.catchBreathUsed=true; S.tickCooldowns(room);
  ok(w._cd.catchBreath===12,'using an ability starts its cooldown (Catch Breath: 12 rounds)');
  for(let i=0;i<11;i++) S.tickCooldowns(room); ok(w.catchBreathUsed&&w._cd.catchBreath===1,'it counts down each round');
  S.tickCooldowns(room); ok(!w.catchBreathUsed&&w._cd.catchBreath===undefined,'then it is ready again in the same fight');
  w.catchBreathUsed=true; S.tickCooldowns(room); S.resetCombatState(room.players[0]); ok(!w.catchBreathUsed&&Object.keys(w._cd).length===0,'every ability is ready when a new fight starts');
  const p=room.players[1].char; p.divineSmite=true; const pi=room.gs.turnOrder.findIndex(t=>t.id===room.players[1].id); room.gs.activeTurnIdx=pi;
  S.handlePlayerAction(room,room.players[1].id,{action:'USE_TALENT',data:{talent:'divineSmite'}});
  ok(p.divineSmiteUsed,'Divine Smite goes on cooldown after one use'); }
// 26. Selling, charms and the merchant
{ const {room}=mkRoom(['warrior']); const c=room.players[0].char; room.gs.phase='merchant';
  c.inventory.push({name:'Ironhide Tonic',qty:1}); const g0=c.gold; S.handleSell(room,room.players[0],c.inventory.length-1);
  ok(c.gold-g0===Math.round(22*0.15),'items sell for 15% of their value (Ironhide Tonic 22 → 3)');
  const w=S.genWpn(0); c.inventory.push({name:w.name,qty:1,type:'weapon',itemObj:w}); const g1=c.gold; S.handleSell(room,room.players[0],c.inventory.length-1);
  ok(c.gold-g1===Math.max(1,Math.round(w.cost*0.15)),'gear sells for 15% of its shop price');
  const ch=S.gear.makeCharm('haresFoot'); c.inventory.push({name:ch.name,qty:1,type:'charm',itemObj:ch}); S.equipItem(c,c.inventory.length-1);
  S.handlePlayerAction(room,room.players[0].id,{action:'UNEQUIP_CHARM',data:{}});
  ok(!c.equippedCharm&&c.inventory.some(i=>i.itemObj&&i.itemObj.key==='haresFoot'),'charms can be taken off');
  const cur=S.gear.makeCursedItem('nurgleMask'); if(cur.type==='charm'){ c.inventory.push({name:cur.name,qty:1,type:'charm',itemObj:cur}); S.equipItem(c,c.inventory.length-1);
    S.handlePlayerAction(room,room.players[0].id,{action:'UNEQUIP_CHARM',data:{}}); ok(c.equippedCharm&&c.equippedCharm.cursed,'cursed charms stay on'); }
  const shop=S.buildPlayerShop(0);
  ok(shop.weapon3&&shop.armor2&&shop.charm2&&shop.consumables.length===6&&shop.charm.key!==shop.charm2.key&&shop.armor.name!==shop.armor2.name&&new Set([shop.weapon1.name,shop.weapon2.name,shop.weapon3.name]).size===3,'the merchant stocks 3 weapons, 2 armours, 2 different charms and 6 consumables');
  combat(room,['Skaven Clanrat']); const items=['Bandages','Smelling Salts','Ironhide Tonic','Throwing Knives','Tar Pot']; let used=0;
  items.forEach(n=>{ c.inventory.push({name:n,qty:1}); if(S.useItemLogic(room,room.players[0],n,true)) used++; });
  ok(used===5,'all five new consumables work'); }
// 27. Unknown rooms that are events are always choices
{ let allChoice=true; for(let i=0;i<20;i++){ const {room}=mkRoom(['warrior']); S.resolveUnknownEvent(room); if(room.gs.phase!=='choice') allChoice=false; } ok(allChoice,'every unknown-room event is a choice'); }
console.log(fails?fails+' FAILED':'all passed'); process.exit(fails?1:0);
