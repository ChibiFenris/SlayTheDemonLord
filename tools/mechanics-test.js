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
    const {room}=mkRoom(['warrior','wizard']); room.gs.phase='event'; room.players.forEach(p=>{p.char.gold=50;});
    let err=null; try{ S.events.startChoiceEvent(room,key); room.players.forEach(p=>S.events.voteChoice(room,p.id,o.id)); }catch(e){ err=e; }
    if(err||room.gs.phase==='choice') ok(false,`event ${key}/${o.id} failed: ${err&&err.message}`);
  } ok(true,'all choice events resolve'); }
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
  const {room:pr}=mkRoom(['warrior','wizard']); ok(!pr.players.some(p=>p.char.loneSurvivor),'party members do not get Lone Survivor'); }
// 11. Rejoin reclaims a seat
{ const ws1={readyState:1,send(){}}; S.handleMessage(ws1,{type:'CREATE_ROOM',payload:{name:'R'}}); const room=[...S.rooms.values()].pop();
  const pid=room.players[0].id; room.players[0].connected=false;
  const got=[]; const ws2={readyState:1,send(m){got.push(JSON.parse(m).type);},close(){}};
  S.handleMessage(ws2,{type:'REJOIN',payload:{code:room.code,playerId:pid}});
  ok(room.players[0].connected&&room.players[0].ws===ws2&&got.includes('ROOM_JOINED'),'REJOIN reclaims the seat');
  const ws3={readyState:1,send(m){got.push(JSON.parse(m).type);}}; S.handleMessage(ws3,{type:'REJOIN',payload:{code:'NOPE',playerId:'x'}});
  ok(got.includes('REJOIN_FAILED'),'unknown seat is refused'); }
console.log(fails?fails+' FAILED':'all passed'); process.exit(fails?1:0);
