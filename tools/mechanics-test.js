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
  ok(wh.condemn&&wh.silverShot&&wh.firstVolley&&wh.catchBreath&&wh.maxHealth===31,'Witch Hunter starts with Condemn, Silver Shot, First Volley (31 HP)');
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
  ok(D2.ENEMY_POOLS.boss1.length===4&&D2.ENEMY_POOLS.boss2.length===5&&D2.ENEMY_POOLS.boss3.length===3,'boss pools: 4 / 5 / 3 (with the Warboss)');
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
// 28. Rows: melee enemies only reach the front row
{ const {room}=mkRoom(['warrior','wizard']); combat(room,['Skaven Clanrat']);
  ok(room.players[0].char.row==='front'&&room.players[1].char.row==='back','warriors start in front, wizards at the back');
  const wi=room.gs.turnOrder.findIndex(t=>t.id===room.players[0].id); room.gs.activeTurnIdx=wi;
  S.handlePlayerAction(room,room.players[0].id,{action:'SET_ROW',data:{row:'back'}}); ok(room.players[0].char.row==='back','you can change row on your turn');
  S.handlePlayerAction(room,room.players[1].id,{action:'SET_ROW',data:{row:'front'}}); ok(room.players[1].char.row==='back','but not on someone else\'s turn');
  ok(S.gear.hasRangedWeapon({equippedWeapon:{name:'Hunting Bow'}})&&!S.gear.hasRangedWeapon({equippedWeapon:{name:'Hand Weapon'}}),'bows count as ranged, swords do not'); }
// 29. Block halves damage and goes on cooldown
{ const {room}=mkRoom(['warrior','priest']); combat(room,['Skaven Clanrat']); const c=room.players[0].char;
  const wi=room.gs.turnOrder.findIndex(t=>t.id===room.players[0].id); room.gs.activeTurnIdx=wi;
  S.handlePlayerAction(room,room.players[0].id,{action:'USE_TALENT',data:{talent:'block'}});
  ok(S.isBlocking(c)&&c._blockUsed,'Block raises your guard and starts its cooldown');
  ok(room.gs.activeTurnIdx===wi,'Block is a free action');
  S.tickCooldowns(room); ok(c._cd.block===5,'Block recharges in 5 rounds'); }
// 30. Relics
{ const {room}=mkRoom(['warrior','priest']); const c=room.players[0].char, hp=c.maxHealth;
  S.relics.grantRelic(c,'ironHeart'); ok(c.maxHealth===hp+6&&S.relics.hasRelic(c,'ironHeart'),'Iron Heart adds 6 max HP');
  ok(!S.relics.grantRelic(c,'ironHeart'),'the same relic cannot be taken twice');
  room.gs.phase='event'; ok(S.relics.offerRelics(room,'path',true)&&room.gs.phase==='relic'&&room.gs.relic.prize,'a boss fight offers relics and a Champion\'s Prize');
  room.players.forEach(p=>ok((p.char.relicOptions||[]).length===3,p.career+' gets three relic choices'));
  room.players.forEach(p=>S.handlePlayerAction(room,p.id,{action:'PICK_RELIC',data:{key:p.char.relicOptions[0]}}));
  ok(room.gs.phase==='relic','the room waits for the prize vote');
  S.handlePlayerAction(room,room.players[0].id,{action:'VOTE_PRIZE',data:{choice:'need'}});
  S.handlePlayerAction(room,room.players[1].id,{action:'VOTE_PRIZE',data:{choice:'pass'}});
  ok(room.gs.phase==='path'&&!room.gs.relic,'once everyone decides, the road goes on');
  ok(logHas(room,/Champion's Prize — P0/),'the only player who needed it wins the roll');
  const w=room.players[1].char; w.relics=['phoenixFeather']; w.health=0; S.checkDeath(room,room.players[1]);
  ok(w.alive&&w.health===1&&w._phoenixUsed,'Phoenix Feather saves you once');
  w.health=0; S.checkDeath(room,room.players[1]); ok(!w.alive||w.health>1||w.resurrection,'but only once'); }
// 31. Relics after elite fights; cursed paths; road ahead
{ const {room}=mkRoom(['warrior']); combat(room,['Skaven Clanrat']); room.gs.enemies[0].isElite=true;
  room.gs.enemies[0].hp=0; S.resolveEnemyDeath(room,room.gs.enemies[0]);
  if(room.gs.phase==='aftermath') S.handlePlayerAction(room,room.players[0].id,{action:'CONTINUE_AFTERMATH',data:{}});
  ok(room.gs.phase==='relic','winning an elite fight offers a relic');
  const {room:r2}=mkRoom(['warrior']); r2.gs.depth=4; r2.gs.phase='path';
  S.enterNode(r2,'cursed'); ok(r2.gs.curseStacks===1&&r2.gs.cursedTaken===1&&r2.gs.phase==='relic','a Cursed Path gives a relic and a curse');
  S.relics.pickRelic(r2,r2.players[0].id,r2.players[0].char.relicOptions[0]);
  r2.gs.phase='event'; S._runNodeContent(r2,r2.gs,'combat',1); const e=r2.gs.enemies[0];
  ok(e.dmgBonus>=1,'cursed foes hit harder');
  e.threat='Boss'; e.hp=0; S.resolveEnemyDeath(r2,e); ok(!r2.gs.curseStacks,'killing a boss lifts the curse');
  const {room:r3}=mkRoom(['warrior']); r3.gs.depth=3; S.showPathChoices(r3);
  ok(Array.isArray(r3.gs.road)&&r3.gs.road.length===2&&r3.gs.road[0].depth===5,'the crossroads shows the next two stops of the road');
  const planned=r3.gs.road[0].choices.join(); r3.gs.depth=4; S.showPathChoices(r3);
  ok(r3.gs.pathChoices.join()===planned||planned==='boss','what the road showed is what you get');
  let bossAt10=true; const {room:r4}=mkRoom(['warrior']); r4.gs.depth=8; S.showPathChoices(r4); if(!r4.gs.road.some(r=>r.depth===10&&r.choices[0]==='boss')) bossAt10=false; ok(bossAt10,'the road shows the boss coming'); }
// 32. Revive and recurring characters
{ const {room}=mkRoom(['warrior','priest']); combat(room,['Skaven Clanrat']); const pr=room.players[1].char; pr.alive=false; pr.health=0;
  const wi=room.gs.turnOrder.findIndex(t=>t.id===room.players[0].id); room.gs.activeTurnIdx=wi;
  S.handlePlayerAction(room,room.players[0].id,{action:'USE_TALENT',data:{talent:'revive'}});
  ok(pr.alive&&pr.health===Math.ceil(pr.maxHealth*0.25),'Revive brings a fallen ally back at 25% HP');
  ok(room.players[0].char._reviveUsed,'and goes on cooldown');
  const {room:r2}=mkRoom(['warrior','rogue']); r2.gs.depth=3; S.events.startChoiceEvent(r2,'ravens1'); S.events.voteChoice(r2,r2.players[0].id,'pay'); S.events.voteChoice(r2,r2.players[1].id,'pay');
  ok(r2.gs.flags&&r2.gs.flags.ravens==='paid','the Black Ravens remember how you met them');
  r2.gs.depth=10; S.events.startChoiceEvent(r2,'ravens2'); S.events.voteChoice(r2,r2.players[0].id,'parley'); S.events.voteChoice(r2,r2.players[1].id,'parley');
  ok(logHas(r2,/favourite customers/),'and the second meeting follows from the first');
  const ok3=S.events.CHOICE_EVENTS.ravens3.requires(r2.gs,r2); ok(ok3,'the third meeting becomes possible');
  ok(!S.events.CHOICE_EVENTS.ravens1.requires(r2.gs,r2),'and the first never repeats');
  ok(S.lore.intro("Daemon Prince Vhar'kul")&&S.lore.last('Varghulf'),'bosses have opening and last words');
  const {room:r3}=mkRoom(['warrior']); S._runNodeContent(r3,r3.gs,'merchant',1); S._runNodeContent(r3,r3.gs,'merchant',1); ok(logHas(r3,/You again/),'Old Grete remembers you');
  r3.gs.bossCount=1; r3.gs.cursedTaken=1; r3.players[0].char.relics=['ironHeart']; const line=S.chronicleLine(r3,false,'Varghulf');
  ok(/slew 1 boss, walked 1 cursed path and carried 1 relic, before falling at depth/.test(line),'the run gets a one-line chronicle'); }
// 33. Achievements sync, start relic, hall of fame
{ S.accounts._reset(); const r=S.accounts.login('Achiever','1234',{achievements:{blooded:5}}); ok(r.ok.achievements.blooded===5,'new accounts keep achievements from this browser');
  const r2=S.accounts.syncAchievements(r.ok.token,{beastbane:7,'<bad>':1}); ok(r2.ok.achievements.beastbane===7&&!r2.ok.achievements['<bad>'],'achievements merge onto the account, junk keys are ignored');
  const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'R'}}); const room=[...S.rooms.values()].pop();
  S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:'warrior',startRelic:true,frame:'gold',title:'Beastbane<script>'}});
  const p=room.players[0]; ok(p.char.relics.length===1,'the Renown unlock starts you with a relic');
  ok(p.frame==='gold'&&p.title==='Beastbanescript','frames and titles are shown, with markup stripped');
  S.runlog._resetHof(); const hof=S.runlog.hallOfFame(5); ok(Array.isArray(hof),'the hall of fame lists the best runs'); }
// 34. Endless mode
{ const ws={readyState:1,send(){}}; S.handleMessage(ws,{type:'CREATE_ROOM',payload:{name:'E'}}); const room=[...S.rooms.values()].pop();
  S.handleMessage(ws,{type:'SET_DAILY',payload:{on:true}}); S.handleMessage(ws,{type:'SET_ENDLESS',payload:{on:true}});
  ok(room.gs.endless&&!room.gs.daily,'the host can turn on Endless (and it turns off the Daily)');
  room.gs.depth=30; room.gs.bossCount=3; ok(!S.runWon(room.gs),'beating the third boss does not end an Endless run');
  ok(S.runWon({depth:30,bossCount:3}),'it still ends a normal run');
  S.handleMessage(ws,{type:'SELECT_CAREER',payload:{career:'warrior'}}); S.handleMessage(ws,{type:'PLAYER_READY',payload:{}});
  room.gs.depth=30; room.gs.bossCount=3; room.gs.phase='event'; room.gs.road=[]; S.showPathChoices(room);
  ok(room.gs.phase==='path'&&room.gs.road.some(r=>r.depth===32),'the road goes on past depth 30');
  room.gs.depth=39; S.showPathChoices(room); ok(room.gs.pathChoices.join()==='boss','a boss waits at depth 40');
  const b=S.pickEnemy(40,false,true,1,3); ok(b.threat==='Boss','the bosses come round again');
  const t0=S.pickEnemy(25,false,false,1,2), t2=S.pickEnemy(45,false,false,1,4);
  ok(t2.endlessTier===2&&!t0.endlessTier,'each boss past the third is a tier');
  const base=D.ENEMY_POOLS.high[0]; const a=S.scaleEnemy(JSON.parse(JSON.stringify(base)),1,false,2), z=S.scaleEnemy(JSON.parse(JSON.stringify(base)),1,false,4);
  ok(z.maxHp>a.maxHp*1.5&&z.dmgBonus===a.dmgBonus+3&&z.atk===(a.atk||0)+2,'foes get more HP, damage and accuracy every tier');
  let wHi=0,wLo=0; for(let i=0;i<200;i++){ wLo+=S.genWpn(2).bonus; wHi+=S.genWpn(5).bonus; } ok(wHi-wLo>=200*2.5,'gear keeps scaling too (+1 per tier)');
  const {room:rr}=mkRoom(['warrior']); rr.players[0].char.relics=Object.keys(S.relics.RELICS); rr.gs.phase='event';
  ok(!S.relics.offerRelics(rr,'path',false)&&rr.gs.phase==='event','with every relic taken, the relic screen is skipped');
  const leg=S.genLegendaryItem(4); ok(/\+2$/.test(leg.name),'legendaries from later loops are stronger'); }
// 35. Career paths are limited and named for each career
{ const {room}=mkRoom(['warrior']); const p=room.players[0], c=p.char; c.pendingLevelUp=true; c.pendingPathTier='expert';
  S.handlePlayerAction(room,p.id,{action:'APPLY_PATH',data:{pathId:'elementalist'}});
  ok(!c.expertPath,'a State Soldier cannot become a Bright Journeyman');
  S.handlePlayerAction(room,p.id,{action:'APPLY_PATH',data:{pathId:'defender'}});
  ok(c.expertPath==='defender'&&logHas(room,/Greatsword/),'but can become a Greatsword');
  ok(D.pathLabel('slayer','master','daemonSlayer')==='Daemon Slayer'&&D.pathLabel('waywatcher','master','executioner')==='Wardancer','shared paths have career names');
  Object.entries(D.CAREER_PATHS).forEach(([k,v])=>ok(Object.keys(v.expert).length>=2&&Object.keys(v.master).length>=2&&Object.keys(v.expert).every(x=>D.EXPERT_PATHS[x])&&Object.keys(v.master).every(x=>D.MASTER_PATHS[x]),k+' has at least two real expert and master paths'));
  const pr={career:'priest',expertPath:'healer'}; ok(D.traditionAllowed(pr,'life')&&!D.traditionAllowed(pr,'fire')&&!D.traditionAllowed(pr,'chaos'),'priests learn prayers, not fire or Chaos');
  ok(D.traditionAllowed({career:'wizard',expertPath:'warlock'},'chaos')&&!D.traditionAllowed({career:'wizard',expertPath:'wizard'},'chaos'),'only the Dark Magister touches Chaos'); }
// 36. Engineer and Waywatcher
{ const {room}=mkRoom(['engineer','waywatcher']); const en=room.players[0], wy=room.players[1];
  ok(en.char.turret&&en.char.grenade&&en.char.row==='back'&&wy.char.hawkEye&&wy.char.row==='back','both new careers start in the back row with their kit');
  ok(S.gear.hasRangedWeapon(en.char)&&S.gear.hasRangedWeapon(wy.char),'and shoot ranged weapons');
  combat(room,['Skaven Clanrat','Skaven Stormvermin']);
  room.gs.activeTurnIdx=room.gs.turnOrder.findIndex(t=>t.id===en.id);
  S.handlePlayerAction(room,en.id,{action:'USE_TALENT',data:{talent:'turret'}});
  ok(en.char._turretRounds===3&&en.char._turretUsed&&room.gs.turnOrder[room.gs.activeTurnIdx].id===en.id,'the Volley Gun is set up for 3 rounds, as a free action');
  const hp0=room.gs.enemies.reduce((a,e)=>a+e.hp,0); S.engineerRoundTick(room); const hp1=room.gs.enemies.reduce((a,e)=>a+Math.max(0,e.hp),0);
  ok(hp1<hp0&&en.char._turretRounds===2,'and fires at the end of the round');
  room.gs.activeTurnIdx=room.gs.turnOrder.findIndex(t=>t.id===wy.id); const before=room.gs.enemies.map(e=>e.hp);
  S.handlePlayerAction(room,wy.id,{action:'USE_TALENT',data:{talent:'arrowStorm'}});
  ok(room.gs.enemies.every((e,i)=>e.hp<before[i]||e.hp<=0),'Arrow Storm hits every enemy'); }
// 37. Corruption and Insanity
{ const {room}=mkRoom(['warrior','priest']); const p=room.players[0], c=p.char;
  S.dark.gainCorruption(room,p,3,'test'); ok(c.mutations.length===1,'3 Corruption brings a mutation');
  S.dark.gainCorruption(room,p,6,'test'); ok(c.mutations.length===3,'up to three');
  c.mutations=[]; const lim=S.dark.limit(c); S.dark.gainInsanity(room,p,lim-1); ok(c.insanity===lim-1&&!c.disorders.length,'Insanity builds up to the limit');
  S.dark.gainInsanity(room,p,1); ok(c.insanity===0&&c.disorders.length===1&&logHas(room,/snaps!/),'at the limit you snap: a madness and a lasting disorder');
  const w=room.players[1].char; w.alive=true; c.health=0; const ins=w.insanity||0; S.checkDeath(room,p); ok(w.insanity>ins||w.disorders.length,'seeing an ally fall costs Insanity');
  const {room:r2}=mkRoom(['warrior']); const q=r2.players[0]; q.char.inventory.push({name:'Laudanum',qty:1},{name:'Sigmarite Incense',qty:1}); q.char.insanity=3; q.char.corruption=4;
  S.useItemLogic(r2,q,'Laudanum',false); S.useItemLogic(r2,q,'Sigmarite Incense',false);
  ok(q.char.insanity===1&&q.char.corruption===2,'Laudanum and Incense help'); }
// 38. Boss phases, elite modifiers, greenskins
{ const {room}=mkRoom(['warrior','priest']); const boss=JSON.parse(JSON.stringify(D.ENEMY_POOLS.boss2.find(b=>b.name==='Warboss Grubnak Skullsmasha')));
  const b=S.scaleEnemy(boss,1,false,1); b.id='b1'; room.gs.enemies=[b]; room.gs.enemy=b; room.gs.inCombat=true; room.gs.phase='combat'; room.gs.roundNumber=1; S.startSpoils(room); S.buildTurnOrder(room);
  b.hp=Math.floor(b.maxHp/2)-1; S.enemyPreTurn(room,b,room.players);
  ok(b._phase2&&room.gs.enemies.filter(e=>e.name==='Orc Boy').length===2&&logHas(room,/WAAAGH/),'at half HP the Warboss calls the Waaagh! and Orc Boyz charge in (one per warrior, up to two)');
  Object.keys(S.foes.BOSS_PHASES).forEach(n=>ok([...D.ENEMY_POOLS.boss1,...D.ENEMY_POOLS.boss2,...D.ENEMY_POOLS.boss3].some(x=>x.name===n),'phase for a real boss: '+n));
  const e=S.scaleEnemy(JSON.parse(JSON.stringify(D.ENEMY_POOLS.mid[0])),1,true,1); ok(e.affix&&e.affixLabel,'elites get a modifier ('+e.affixLabel+')');
  const g=S.scaleEnemy(JSON.parse(JSON.stringify(D.ENEMY_POOLS.high.find(x=>x.name==='Black Orc'))),1,false,2); S.addDebuff(g,'Stunned',{skipTurn:true},1); ok(!(g.activeDebuffs||[]).length,'Black Orcs shrug off stuns');
  ['Night Goblin','Cave Squig','Orc Boy','Goblin Fanatic','Night Goblin Shaman','Black Orc','Warboss Grubnak Skullsmasha'].forEach(n=>ok(require('../public/tokens/index.json')[n],'token for '+n)); }
// 39. Endless mutators
{ const {room}=mkRoom(['warrior']); room.gs.endless=true; room.gs._pendingMutator=true; room.gs.phase='event'; S.showPathChoices(room);
  ok(room.gs.phase==='choice'&&room.gs.choice.key==='endlessMutator'&&room.gs.choice.options.length===3,'after an Endless boss the warband picks one of three mutators');
  const pick=room.gs.choice.options[0].id; S.events.voteChoice(room,room.players[0].id,pick);
  ok(room.gs.mutators.includes(pick)&&room.gs.phase==='event','and it lasts the run');
  S.foes.applyMutator(room,'horde'); room.gs.phase='event'; room.gs.depth=12; S._runNodeContent(room,room.gs,'combat',1); ok(room.gs.enemies.length>=2,'The Horde adds a foe to every fight'); }
// 40. Zones
{ const Z=require('../game/zones'); ok(Z.zoneFor(1).id==='drakwald'&&Z.zoneFor(10).id==='drakwald'&&Z.zoneFor(11).id==='undercity'&&Z.zoneFor(25).id==='wastes'&&Z.zoneFor(31).id==='drakwald','three regions of ten depths, looping in Endless');
  let fav=0; for(let i=0;i<300;i++){ const e=S.pickEnemy(5,false,false,1,0); if((e.tags||[]).some(t=>['beast','greenskin'].includes(t))) fav++; } ok(fav>160,`the Drakwald is mostly beastmen and greenskins (${fav}/300)`);
  let sk=0; for(let i=0;i<300;i++){ const e=S.pickEnemy(15,false,false,1,1); if((e.tags||[]).some(t=>['skaven','undead'].includes(t))) sk++; } ok(sk>160,`the Undercity is mostly Skaven and undead (${sk}/300)`);
  const {room}=mkRoom(['warrior']); room.gs.phase='path'; S.enterNode(room,'loot'); ok(room.gs.zoneId==='drakwald'&&logHas(room,/The Drakwald/),'entering a region announces it');
  room.gs.depth=10; room.gs.phase='path'; S.enterNode(room,'loot'); ok(room.gs.zoneId==='undercity'&&room.gs.bossBanner&&/Undercity/.test(room.gs.bossBanner.name),'and the next one'); }
// 41. Patron gods
{ const {room}=mkRoom(['warrior']); const p=room.players[0], c=p.char;
  c.mutations=['a','b','c']; S.dark.gainCorruption(room,p,9,'test');
  ok(c.patron&&S.dark.PATRONS[c.patron]&&logHas(room,/is claimed!/),'at 9 Corruption a Dark God claims you ('+c.patron+')');
  const pat=c.patron; S.dark.gainCorruption(room,p,3,'test'); ok(c.patron===pat,'only once');
  const k={career:'warrior',attrs:{str:10,agi:10,int:10,wil:10},maxHealth:30,health:30,defense:10,block:true}; S.dark.PATRONS.khorne.apply(k); ok(k.block===false&&k.weaponDmgBonus===2,'Khorne: more damage, no Block');
  const n={maxHealth:30,health:30,defense:12}; S.dark.PATRONS.nurgle.apply(n); ok(S.gear.immuneToPoison(n)&&n.defense===10,'Nurgle: poison-proof but slower');
  const sl={career:'rogue',attrs:{agi:12,wil:10},defense:12,baseAgiDef:12}; const lim=S.dark.limit(sl); sl.patron='slaanesh'; ok(S.dark.limit(sl)===lim-1,'Slaanesh: a lower Insanity limit');
  ok(S.events.CHOICE_EVENTS.aldricHunt.requires(room.gs,room),'and the witch hunters come for the marked'); }
// 42. Campfire
{ const {room}=mkRoom(['warrior','priest']); const [a,b]=room.players; a.char.health=5; room.gs.phase='path'; S.enterNode(room,'rest');
  ok(room.gs.phase==='campfire'&&a.char.campOptions.length===2,'a campfire lets each warrior choose');
  const w=a.char.equippedWeapon, bonus=w.bonus;
  S.handlePlayerAction(room,b.id,{action:'CAMPFIRE',data:{choice:'rest'}}); ok(room.gs.phase==='campfire','it waits for everyone');
  b.char.health=1;
  S.handlePlayerAction(room,a.id,{action:'CAMPFIRE',data:{choice:'upgrade',slot:'weapon'}});
  ok(room.gs.phase==='event'&&w.bonus===bonus+1&&w.upgrades===1&&a.char.health===5,'upgrading hones the weapon instead of healing');
  ok(b.char.health>1,'resting heals');
  for(let i=0;i<3;i++){ room.gs.phase='path'; S.enterNode(room,'rest'); S.handlePlayerAction(room,a.id,{action:'CAMPFIRE',data:{choice:'upgrade',slot:'weapon'}}); S.handlePlayerAction(room,b.id,{action:'CAMPFIRE',data:{choice:'rest'}}); }
  ok(w.upgrades===3,'up to three upgrades per item'); room.gs.phase='path'; S.enterNode(room,'rest'); ok(!a.char.campOptions.some(o=>o.slot==='weapon'),'then it is maxed out'); }
// 43. Stats
{ S.runlog._resetStats(); const st=S.runlog.stats(); ok(st&&typeof st.runs==='number'&&st.overall&&Array.isArray(st.relics)&&st.byClass,'the stats page has its numbers');
  ok(require('fs').existsSync(require('path').join(__dirname,'..','public','stats.html')),'and its page'); }
console.log(fails?fails+' FAILED':'all passed'); process.exit(fails?1:0);
