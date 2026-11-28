process.on('uncaughtException', err => { console.error('UNCAUGHT:', err); }); // log and keep serving other rooms
process.on('unhandledRejection', err => { console.error('UNHANDLED REJECTION:', err); });

const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 }); // no client message needs more than a few hundred bytes

app.get('/health', (req, res) => res.send('OK'));
app.get('/api/stats', (req, res) => res.json(runlog.stats()));
app.get('/api/halloffame', (req, res) => res.json({ runs: runlog.hallOfFame(10) }));
app.get('/api/daily', (req, res) => { const key = runlog.todayKey(); res.json({ key, mods: runlog.dailyMods(key), board: runlog.dailyBoard(key) }); });
// Rules tables the client needs for display (XP bar, castings, spell icons).
app.get('/api/game-data', (req, res) => {
  const spellElements = {};
  const cooldowns = Object.fromEntries(Object.entries(COOLDOWNS).map(([k, d]) => [k, { rounds: d.rounds, judgement: d.judgement || null }]));
  Object.values(TRADITIONS).forEach(t => (t.spells || []).forEach(s => { spellElements[s.name] = t.elemType || 'arcane'; }));
  const charms = {}; CHARM_SHOP_KEYS.forEach(k => { charms[k] = { name: CHARMS[k].name, desc: CHARMS[k].desc }; });
  res.json({ xpThresholds: XP_THRESHOLDS, castingsTable: CASTINGS_TABLE, spellElements, charms, cooldowns, relics: relics.RELICS, zones: zones.ZONES.map(z=>({id:z.id,name:z.name,icon:z.icon,places:z.places})), careerPaths: CAREER_PATHS, traditionAccess: require('./game/data').TRADITION_ACCESS, mutations: dark.MUTATIONS, patrons: Object.fromEntries(Object.entries(dark.PATRONS).map(([k,v])=>[k,{label:v.label,icon:v.icon,desc:v.desc}])), disorders: dark.DISORDERS, mutators: foes.MUTATORS, affixes: Object.fromEntries(Object.entries(foes.ELITE_AFFIXES).map(([k,v])=>[k,{label:v.label,desc:v.desc}])),
    difficulties: DIFFICULTIES.map(x => ({ id: x.id, name: x.name, hp: x.hp, dmg: x.dmg, reward: x.reward })) });
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/stats', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stats.html')));
app.set('trust proxy', 1);
// Music and portraits rarely change: let browsers cache them for a week.
app.use('/music', express.static(path.join(__dirname, 'public', 'music'), { maxAge: '7d' }));
app.use('/sfx', express.static(path.join(__dirname, 'public', 'sfx'), { maxAge: '7d' }));
// Portraits cache for a week, but the name→file list must always be fresh,
// or browsers miss portraits for anything added since their last visit.
app.use('/tokens', express.static(path.join(__dirname, 'public', 'tokens'), {
  maxAge: '7d',
  setHeaders: (res, file) => { if (file.endsWith('index.json')) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const affixes = require('./game/affixes');
const rows = require('./game/rows');
const persist = require('./game/persist');
const runlog = require('./game/runlog');
const rng = require('./game/rng');
const statesync = require('./game/statesync');
const accounts = require('./game/accounts');
const relics = require('./game/relics');
const lore = require('./game/lore');
const foes = require('./game/foes');
const dark = require('./game/dark');
const { hasRelic } = relics;
rng.install(); // Math.random follows the room being handled (see game/rng.js)
const clients = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(c) ? makeCode() : c;
}
function sendTo(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
const { d, rd, modVal } = require('./game/dice');
const {
  CAREERS, NOVICE_PATHS, EXPERT_PATHS, MASTER_PATHS, CASTINGS_TABLE, TRADITIONS, CAREER_PATHS, pathAllowed, pathLabel, traditionAllowed,
  XP_THRESHOLDS, POISON_CAP, NODE_TYPES, SCROLL_SPELLS_LIST, LOOT_CONS_LIST,
  WEAPON_BASES, ARMOR_BASES, LEGENDARY_ITEMS, SHOP_CONSUMABLES, SCROLL_SPELLS_SHOP, ENEMY_DROPS,
  CHARMS, CHARM_SHOP_KEYS, COOLDOWNS, cooldownFor, } = require('./game/data');

// Game logic split into modules under game/ (see each file's header).
const combatMod = require('./game/combat');
const { rollD20boons, rollAttack, rollEnemyAttack, addBuff, addDebuff, tickBuffs, SELF_TICK_DOTS, tickDebuffs, getBuffVal, applyPoison, applyBleed, applyBurn, getDebuffVal } = combatMod;
const pathsMod = require('./game/paths');
const { checkLevelUp, getPathHpGain, applyLevelGains, applyTalentList, applyNovicePath, grantTradition, applyExpertPath, applyMasterPath, teachLore, givePathGift, getTargetEnemy } = pathsMod;
const nodesMod = require('./game/nodes');
const { pickThreeNodes, restorePower, crossroadsFor, showPathChoices, resolvePath, startNodeContent, enterNode, _runNodeContent, resolveUnknownEvent, buildLootOptions, genSpecialWpn, genSpecialArmor } = nodesMod;
const turnsMod = require('./game/turns');
const { buildTurnOrder, getCurrentTurn, autoSkipStunnedPlayer, advanceTurn, TURN_LIMIT_MS, startTurnTimer, endRound, fireEnemyTurn, finishEnemyTurn, checkDeath } = turnsMod;
const itemsMod = require('./game/items');
const { genLegendaryItem, genWpn, genArmor, genShopScroll, buildPlayerShop, addToInventory, applyLegendaryArmourPassive, applyWpnSpecial, equipItem, handleBuy, SELL_RATE, itemValue, sellPrice, unequipCharm, handleSell, useItemLogic, rollEnemyDrop } = itemsMod;
const actionsMod = require('./game/actions');
const { actAttack, actCastSpell, isUnholy, actUseTalent, engineerRoundTick } = actionsMod;

// Difficulty levels unlocked with Renown (tracked per player in their browser).
const DIFFICULTIES = [
  { id:0, name:'Standard', hp:1,    dmg:0, reward:1 },
  { id:1, name:'Grim',     hp:1.25, dmg:1, reward:1.5 },
  { id:2, name:'Doom',     hp:1.5,  dmg:2, reward:2 },
];
function initGameState() {
  return {
    depth:0, inCombat:false, enemy:null, enemies:[], activeEnemyIdx:0, phase:'lobby', difficulty:0, daily:false, endless:false, rng:rng.makeRng(),
    playersActedThisRound:[], enemyHasActed:false, roundNumber:0, turnOrder:[], activeTurnIdx:0,
    log:[], pathChoices:null, pathVotes:{}, bossNode:false,
    bossCount:0, lootRoom:null, lootPicked:[], _anyPlayerHitThisTurn:false,
    lastPowerRestoreDepth:0, packCooldown:0,
  };
}
function publicState(room) {
  return {
    gs: { ...room.gs, spoils: undefined, rng: undefined, turnMsLeft: room.gs.turnDeadline ? Math.max(0, room.gs.turnDeadline - Date.now()) : null },
    players: room.players.map(p => ({
      id:p.id, name:p.name, career:p.career, ready:p.ready,
      char:p.char, isHost:p.id===room.hostId, connected:p.connected, frame:p.frame||null, title:p.title||null,
    })),
    hostId: room.hostId,
  };
}

// ─── GAME MODULES ─────────────────────────────────────────────────────────────
const heirlooms = require('./game/heirlooms'); // gear of each people (game/heirlooms.js)
// castings: spell pools · spawn: picking and scaling enemies · records: daily run
// and run logging · character: building characters · zones: the three regions ·
// campfire: rest or upgrade. Each gets the server helpers it needs via bind().
const { maxCastings, uniqRanks, refreshCastingPools, restoreCastingPools, castingsLeft, spendCasting, regainCasting, getSpellsForPower } = require('./game/castings');
const spawn = require('./game/spawn');
const { enemyDmgDice, endlessTier, runWon, scaleEnemy, pickEnemy } = spawn;
const records = require('./game/records');
const { hasDaily, startDailyRun, applyDailyToEnemies, chronicleLine, recordRunEnd } = records;
const character = require('./game/character');
const { applyLoneSurvivor, buildChar, talentHeal } = character;
const zones = require('./game/zones');
const campfire = require('./game/campfire');

// Enemy mechanics, gear rules and shared helpers live in game/.
const { pickRandom, aliveEnemies } = require('./game/util');
const gear = require('./game/gear');
const { applyCharm, hasRangedWeapon, armorTraits, charmKey, cleanseCurses, gearRoundTick, gearVsEnemyAttack, immuneToPoison, isCursed, makeCharm, makeCursedItem, resetGearCombatState, resistsInsanity, rollTraits, weaponTraits } = gear;
const events = require('./game/events');
const enemies = require('./game/enemies');
const { enemyAfterHit, enemyDamageMods, enemyDefence, enemyOnWeaponHit, enemyPostTurn, enemyPreTurn, isEnemyHidden, onCombatStart, onEnemyDeath, prepareEnemy, refreshEnemyAuras, sortTurnOrder } = enemies;
spawn.bind({ prepareEnemy, foes });
records.bind({ addLog, addToInventory });
character.bind({ addLog });
campfire.bind({ addLog, addBuff, cleanseCurses, restorePower, dark, foes });
enemies.bind({ addLog, addBuff, addDebuff, checkDeath, resolveEnemyDeath, scaleEnemy, hasRelic, dark });
relics.bind({ addLog, refreshCastingPools, genLegendaryItem, addToInventory, showPathChoices });
foes.bind({ addLog, checkDeath, resolveEnemyDeath, summonEnemy: enemies.summonEnemy, isBlocking: enemies.isBlocking, immuneToPoison, pickEnemy, relics, dark, refreshEnemyAuras: enemies.refreshEnemyAuras });
dark.bind({ addLog, addBuff, addDebuff, resistsInsanity, refreshCastingPools });
events.bind({ foes, dark, startFight:(room,kind)=>startNodeContent(room,kind), addLog, addBuff, checkDeath, addToInventory, genArmor, genWpn, refreshCastingPools, SCROLL_SPELLS_LIST, makeCharm: gear.makeCharm, makeCursedItem: gear.makeCursedItem });

// ─── ABILITY COOLDOWNS ─────────────────────────────────────────────────────────
// Called at the end of every combat round. An ability used this round starts its
// cooldown; when the count runs out its "used" marker clears and it's ready again.
function tickCooldowns(room){
  const ready=[];
  room.players.forEach(p=>{
    const c=p.char; if(!c||!c.alive) return;
    const cd=c._cd||(c._cd={});
    for(const [k,def] of Object.entries(COOLDOWNS)){
      if(!c[k]) continue;
      const used=!!c[def.flag];
      if(cd[k]!=null){
        if(!used){ delete cd[k]; continue; } // refreshed early (Divine Favour, a rest...)
        cd[k]--;
        if(cd[k]<=0){ c[def.flag]=false; delete cd[k]; ready.push(`${p.name}'s ${labelOf(k)}`); }
      } else if(used) cd[k]=cooldownFor(c,k);
    }
  });
  if(ready.length) addLog(room,`⏳ Ready again: ${ready.join(', ')}.`,'sys');
}
function labelOf(k){ return k.replace(/([A-Z])/g,' $1').replace(/^./,ch=>ch.toUpperCase()); }

// ─── LEAVING ──────────────────────────────────────────────────────────────────
// In the lobby a player is simply removed. Mid-run their character stays behind:
// the party carries on and the seat is free for someone else to take over
// straight away. If nobody is left, the room (and a solo run) is closed.
function leaveRoom(ws){
  const ctx=clients.get(ws); clients.delete(ws);
  const room=ctx&&rooms.get(ctx.roomCode); if(!room) return;
  const player=room.players.find(p=>p.id===ctx.playerId); if(!player) return;
  const gs=room.gs;
  if(gs.phase==='lobby'){
    room.players=room.players.filter(p=>p!==player);
  } else {
    player.connected=false; player.ws=null; player.disconnectedAt=0; player.takenOver=true; player.token=uuidv4();
    if(!['gameover','victory','practiceDone'].includes(gs.phase)) addLog(room,`🚪 <strong>${player.name}</strong> leaves the warband.`,'sys');
  }
  const here=room.players.filter(p=>p.connected);
  if(!here.length){ if(room._turnTimer) clearTimeout(room._turnTimer); rooms.delete(room.code); persist.scheduleSave(rooms); return; }
  if(room.hostId===player.id) room.hostId=here[0].id;
  if(gs.phase!=='lobby') { try{ unblockAfterDisconnect(room,player); }catch(e){ console.error('Leave error:',e); } }
  broadcastState(room.code);
}

// ─── QUICK CHAT AND PRACTICE ──────────────────────────────────────────────────
const EMOTES = { heal:'Heal me!', focus:'Focus the boss!', wait:'Wait for me!', back:'Fall back!', nice:'Well fought!', ready:'Ready!' };
function startPractice(room){
  const gs=room.gs; const p=room.players[0];
  p.ready=true; gs.practice=true; gs.depth=1;
  addLog(room,'🎓 <strong>Practice fight.</strong> One easy foe, nothing to lose. Follow the tips above the actions.','loot');
  _runNodeContent(room,gs,'combat',1);
  gs.enemies.forEach(e=>{ e.maxHp=Math.max(6,Math.round(e.maxHp*0.7)); e.hp=e.maxHp; });
}

// ─── JOINING A RUN IN PROGRESS ────────────────────────────────────────────────
// A newcomer takes over the character of someone who left (gone for 20s+).
const SEAT_GRACE_MS = 20 * 1000;
function takeOverSeat(ws, room, name){
  const now=Date.now();
  const free=room.players.filter(p=>!p.connected&&p.char&&now-(p.disconnectedAt||0)>=SEAT_GRACE_MS);
  const seat=free.find(p=>p.char.alive)||free[0];
  if(!seat){ sendTo(ws,{type:'ERROR',payload:{msg:'That run is under way and no seat is free. A seat opens when a player has been gone for 20 seconds.'}}); return; }
  if(seat.ws&&seat.ws!==ws){ clients.delete(seat.ws); }
  const oldName=seat.name; seat.name=cleanName(name,'Player');
  seat.ws=ws; seat.connected=true; seat.token=uuidv4(); seat.takenOver=true;
  clients.set(ws,{roomCode:room.code,playerId:seat.id});
  sendTo(ws,{type:'ROOM_JOINED',payload:{code:room.code,playerId:seat.id,token:seat.token,rejoined:true}});
  addLog(room,`🛡 <strong>${seat.name}</strong> takes up ${oldName}'s arms and joins the warband.`,'loot');
  resumeRoom(room);
  broadcastState(room.code);
}

// ─── BATTLE SPOILS & AFTERMATH ───────────────────────────────────────────────
// XP and silver earned in a fight are banked here and only paid out when the
// fight ends, so levelling up and path choices happen after the battle, followed
// by a short summary screen ("aftermath") that every player confirms.
function invCounts(char){ const m={}; (char.inventory||[]).forEach(i=>{ m[i.name]=(m[i.name]||0)+(i.qty||1); }); return m; }
function startSpoils(room){
  const gs=room.gs;
  gs.spoils={ xp:{}, silver:{}, enemies:[], inv:{}, rounds:0 };
  room.players.forEach(p=>{ if(p.char) gs.spoils.inv[p.id]=invCounts(p.char); });
  return gs.spoils;
}
function finishCombat(room, outcome){
  const gs=room.gs, sp=gs.spoils; gs.spoils=null;
  if(!sp) return;
  const rewards={};
  room.players.forEach(p=>{
    if(!p.char) return;
    const mult=DIFFICULTIES[gs.difficulty||0].reward*(hasDaily(gs,'richVeins')?1.5:1);
    const xp=Math.round((sp.xp[p.id]||0)*mult), silver=Math.round((sp.silver[p.id]||0)*mult);
    p.char.xp+=xp; p.char.gold+=silver;
    const before=sp.inv[p.id]||{}, now=invCounts(p.char), items=[];
    Object.entries(now).forEach(([n,q])=>{ const gained=q-(before[n]||0); if(gained>0) items.push(gained>1?`${n} ×${gained}`:n); });
    const levelUps=[];
    for(let guard=0;guard<10;guard++){
      const lv=checkLevelUp(p.char); if(!lv.leveled) break;
      levelUps.push({level:lv.newLevel,hp:lv.hpGain});
      addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP)${p.char.pendingLevelUp?' — choose a path!':''}`,'spell');
      if(p.char.pendingLevelUp) break;
    }
    rewards[p.id]={ name:p.name, xp, silver, items, levelUps, choosePath:!!p.char.pendingLevelUp, hp:p.char.health, maxHp:p.char.maxHealth };
  });
  const totalXp=Object.values(rewards).reduce((a,r)=>Math.max(a,r.xp),0);
  if(totalXp>0||outcome==='won') addLog(room,`⚔ Battle ${outcome==='won'?'won':'escaped'} — spoils divided.`,'loot');
  if(runWon(gs)) return; // the end screen takes over
  gs.aftermath={ outcome, enemies:sp.enemies, rewards, ready:[] };
  gs.phase='aftermath';
}
function aftermathReady(room){
  const gs=room.gs; if(gs.phase!=='aftermath'||!gs.aftermath) return;
  const here=room.players.filter(p=>p.char&&p.connected);
  if(!here.every(p=>gs.aftermath.ready.includes(p.id))) return;
  gs.aftermath=null; gs.phase='event';
  if(gs.practice){ gs.phase='practiceDone'; addLog(room,'🎓 Practice complete. You are ready for the road.','loot'); return; }
  if(runWon(gs)){ gs.phase='victory'; addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit'); return; }
  // Elites and bosses reward a relic choice (and a boss in a party, a Champion's Prize to roll for).
  if(gs._relicAfterFight){ const prize=gs._prizeAfterFight; gs._relicAfterFight=false; gs._prizeAfterFight=false; if(relics.offerRelics(room,'path',prize)) return; }
  showPathChoices(room);
}

function resolveEnemyDeath(room, deadEnemy) {
  room.players.forEach(p=>{ if(p.char&&p.char.alive) affixes.onEnemyDeath(p.char); }); // Blood Ruby
  room.players.forEach(p=>{ if(p.char&&p.char.alive&&hasRelic(p.char,'bloodChalice')&&(deadEnemy||room.gs.enemy)) p.char._ledgerCharge=true; });
  room.players.forEach(p=>{ if(p.char&&p.char.activeBuffs){ const had=p.char.activeBuffs.some(b=>b.name==='Rattled');
    p.char.activeBuffs=p.char.activeBuffs.filter(b=>b.name!=='Rattled'); if(had) addLog(room,`${p.name} steels their nerve.`,'sys'); } });
  const gs=room.gs;
  const e=deadEnemy||gs.enemy;
  const sanctifyActive=room.players.some(p=>p.char&&p.char.sanctify);
  const isSanctified=sanctifyActive&&e&&(e.chaos||e.undead||(e.tags&&(e.tags.includes('chaos')||e.tags.includes('undead'))));
  if(isSanctified) addLog(room,`✝ <strong>Sanctify!</strong> ${e.name} cannot trigger death abilities!`,'spell');
  if(e&&e.undying&&!e._undyingUsed&&d(6)===6&&!isSanctified){
    e._undyingUsed=true; e.hp=1;
    addLog(room,`💀 <strong>Undying!</strong> ${e.name} refuses to stay dead — rises at 1 HP!`,'chaos');
    return false; // enemy survived — callers must NOT treat this as a death
  }
  // Several effects (Holy Fervor, procs, DoTs) can report the same kill: only process it once,
  // otherwise XP, gold, legendaries and the boss counter are awarded twice.
  if(e){ if(e._deathResolved) return true; e._deathResolved=true; }
  addLog(room,`⚔ <strong>${e.name}</strong> is slain! FOR SIGMAR!`,'crit');
  if(!isSanctified) onEnemyDeath(room,e);
  refreshEnemyAuras(room.gs); // bonuses that came from the fallen enemy (or from having it nearby) go away
  // Fallen allies are dragged back only once the LAST enemy falls (not mid-fight)
  const _combatOver=!(gs.enemies||[]).some(en=>en&&en!==e&&en.hp>0);
  if(_combatOver) room.players.forEach(p=>{
    if(p.char&&(!p.char.alive||p.char.pendingRevive)){
      p.char.health=1; p.char.alive=true; p.char.pendingRevive=false;
      addLog(room,`${p.name} dragged back from death — 1 HP!`,'heal');
    }
  });
  if(e&&e.tags&&e.tags.includes('skaven')){
    room.players.filter(p=>p.char&&p.char.alive&&p.char._armorPackScorn).forEach(p=>{
      p.char.health=Math.min(p.char.maxHealth,p.char.health+1);
    });
  }
  const survivors=room.players.filter(p=>p.char&&p.char.alive);
  const xpEach=(e.xp||1) * (e.isElite ? 2 : 1); // Elite rooms give double XP
  let goldTotal;
  if (e.threat==='Boss' && gs.bossCount===0) {
    goldTotal = 150 * survivors.length; // 150 per survivor — boss 1
  } else if (e.threat==='Boss' && gs.bossCount===1) {
    goldTotal = 200 * survivors.length; // 200 per survivor — boss 2
  } else if (e.threat==='Boss' && gs.bossCount===2) {
    goldTotal = 300 * survivors.length; // 300 per survivor — boss 3 (Saurian Ancient)
  } else {
    goldTotal=e.gold?Math.floor((e.gold[0]+Math.floor(Math.random()*(e.gold[1]-e.gold[0]+1)))*0.5):0;
  }
  goldTotal=Math.round(goldTotal*foes.silverMult(gs));
  const goldEach=Math.floor(goldTotal/Math.max(1,survivors.length));
  foes.onFoeDeath(room,e);

  if(e&&(e.isElite||e.threat==='Boss')){ gs._relicAfterFight=true; if(e.threat==='Boss') gs._prizeAfterFight=true; }
  const lastWords=e.threat==='Boss'&&lore.last(e.name);
  if(lastWords){ addLog(room,`🗣 <strong>${e.name}:</strong> <em>“${lastWords}”</em>`,'boss'); gs.bossBanner={name:e.name,text:lastWords,ts:Date.now(),dying:true}; }
  if(e.threat==='Boss'&&gs.curseStacks){ gs.curseStacks=0; addLog(room,'🕯 With the boss slain, the curse on the road lifts.','heal'); }
  if(e.threat==='Boss'){
    const bossIdx=gs.bossCount; // 0 = boss1 just killed, 1 = boss2, 2 = boss3
    gs.bossCount++;
    survivors.forEach(p=>{
      const leg=genLegendaryItem(bossIdx);
      addToInventory(p.char, leg.name, leg);
      addLog(room,`🏆 <strong>${p.name}</strong> claims <em style="color:#e8c050">${leg.name}</em> — ${leg.desc}`,'loot');
    });
    if(gs.endless&&gs.bossCount>=3) gs._pendingMutator=true;
    if(gs.endless&&gs.bossCount>=3) addLog(room,`♾ <strong>Endless.</strong> The road goes deeper. From here every foe is stronger (tier ${endlessTier(gs.bossCount)}), and so is the gear you find.`,'chaos');
  }
  // XP and silver are banked in the battle's spoils and paid out when the fight ends.
  const sp=gs.spoils||startSpoils(room);
  sp.enemies.push(e.name);
  survivors.forEach(p=>{
    sp.xp[p.id]=(sp.xp[p.id]||0)+xpEach;
    sp.silver[p.id]=(sp.silver[p.id]||0)+Math.floor((charmKey(p.char)==='ranaldCoin'?goldEach*1.5:goldEach)*affixes.silverMult(p.char));
    if(_combatOver) resetCombatState(p);
  });
  rollEnemyDrop(e, room);
  // Elites and bosses sometimes carry an heirloom taken from one of your people.
  if(!e.summoned&&Math.random()<(e.threat==='Boss'?0.5:(e.isElite||e.threat==='Elite')?0.15:0)){ const owner=pickRandom(room.players.filter(p=>p.char&&p.char.alive)); const h=owner&&heirlooms.roll(owner.char,gs.bossCount||0); if(h){ addToInventory(owner.char,h.name,h); addLog(room,`🏺 ${e.name} was carrying <strong>${h.name}</strong>, an heirloom of ${heirlooms.PEOPLE_NAMES[h.people]} — ${owner.name} takes it back.`,'loot'); } }
  gs.enemies=(gs.enemies||[]).filter(en=>en!==e&&en.hp>0);
  refreshEnemyAuras(gs);
  if(gs.enemies&&gs.enemies.length>0){
    // Other enemies remain: retarget and let the current round continue normally
    gs.enemy=gs.enemies[0]; gs.activeEnemyIdx=0;
    addLog(room,`<strong>${gs.enemies[0].name}</strong> remains! (${gs.enemies[0].hp}/${gs.enemies[0].maxHp} HP)`,'sys');
    return;
  }
  // Reset enemy per-combat flags
  gs._nextCombatHalfHP=false;
  gs.inCombat=false; gs.enemy=null; gs.enemies=[]; gs.phase='event';
  gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.packCooldown=0;
  finishCombat(room,'won');
  if(runWon(gs)){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');broadcastState(room.code);return;}
}

// Everything that lasts "one combat" is cleared here (called when combat ends by victory or by fleeing)
function resetCombatState(p){
  p.char._evadeRound=null;
  // Every recharging ability is ready again for the next fight, with no countdown carried over.
  for(const def of Object.values(COOLDOWNS)) p.char[def.flag]=false;
  p.char._cd={};
    resetGearCombatState(p.char);
    if(p.char._vigorBonus){ p.char.maxHealth-=p.char._vigorBonus; p.char.health=Math.min(p.char.health,p.char.maxHealth); p.char._vigorBonus=0; } // Vigor lasts one combat
    p.char.sharpeningStone=false;
    p.char.divineSmiteUsed=false; p.char._divineSmiteCount=0;
    p.char.spellsurgeUsed=false;
    p.char.pacedStrikesUsed=false;
    p.char.catchBreathUsed=false;
    p.char.nimbleUsed=false;
    p.char.sharedUsed=false;
    p.char.spellRecoveryUsed=false;
    p.char.rageBoon=false;
    p.char.catastropheUsed=false;
    p.char.overcastUsed=false;
    p.char._quickstrikeUsed=false;
    p.char.trickeryUsed=false;
    p.char._trickeryFirstHit=false;
    if(p.char._stampedeDef){ p.char._stampedeDef=false; p.char.defense+=1; } // Stampede only lasts the combat
    p.char._trickeryPoisonProc=0;
    p.char._spellboundCastingUsed=false;
    p.char._spellboundR0Used=false;
    p.char._bloodscentFired=false;
    p.char._dwarfForgedStunUsed=false;
    p.char._righteousBonusDmg=false;
    p.char._wpnOpeningShotFired=false;
    p.char._wpnReloading=false;
    p.char._wpnSpellbladeUsed=false;
    p.char._wpnSmiteUsed=false;
    p.char._wpnRuneStrikeUsed=false;
    p.char._wpnCleaveReady=false;
    p.char._wpnCleaveBonus=false;
    p.char._wpnRiposteUsedThisRound=false;
    p.char._wpnArcaneFocusMissed=false;
    p.char._wpnHolySmokeProc=false;
    p.char._venomHitUsed=false;
    p.char._layOnHandsCount=0;
    p.char._smokeScreenUsed=false;
    p.char._shadowOpeningUsed=false;
    p.char._overloadUsed=false;
    p.char._darkPactUsed=false;
    p.char._preparedSpellUsed=false;
    p.char._triageUsed=false;
    p.char._evilEyeUsed=false;
    p.char._foresightUsed=false;
    p.char._revelationUsed=false;
    p.char._shieldBashUsed=false; p.char._curseUsed=false; p.char._arcaneSurgeUsed=false; p.char._glamourUsed=false; p.char._misdirectArmed=false; p.char._volatileFormUsed=false; p.char._tauntReadyRound=0; if(p.char.activeBuffs){ p.char.activeBuffs.filter(b=>b.taunting&&b.defBonus).forEach(b=>{ p.char.defense-=b.defBonus; }); p.char.activeBuffs=p.char.activeBuffs.filter(b=>!b.taunting); } p.char._entangleUsed=false; p.char._freeCastArmed=false;
      p.char._smokeScreenUsed=false;
      p.char._quickstrikeUsed=false;
      p.char._shadowOpeningUsed=false;
      p.char._deadAimArmed=false;
      p.char._druidsFuryUsed=false;
      if(p.char._warpstoneKillStr){ p.char.attrs.str-=p.char._warpstoneKillStr; } // Warpstone STR lasts one combat
      p.char._warpstoneKillStr=0;
      p.char._poisonedStacks=0;
      p.char._primordialTalismanUsed=false;
      p.char._chainbreakerCritProc=false;
      p.char._pacedHitCount=0;
      p.char._endureUsed=false;
    p.char._bodyguardUsed=false;
    p.char._perfectDefenceUsed=false;
    p.char._battleOrdersUsed=false;
    p.char._interceptUsed=false;
    p.char._devastatingChargeUsed=false;
    p.char._killingMomentumUsed=false;
    p.char._warCryUsed=false;
    p.char._shadowStepUsed=false;
    p.char._acrobaticRiposteUsed=false;
    p.char._flickerUsed=false;
    p.char._cleanupUsed=false;
    p.char._deadAimUsed=false;
    p.char._overchargeUsed=false;
    p.char._uncontrolledPowerUsed=false;
    p.char._counterspellUsed=false;
    p.char._doubleChargeCount=0;
    p.char._esotericKnowledgeUsed=false;
    p.char._spellEchoUsed=false;
    p.char._graceUsed=false;
    p.char._banishUsed=false;
    p.char._relentlessCount=0; if(p.char._relentlessAtk){ p.char.weaponAtkBonus=(p.char.weaponAtkBonus||0)-p.char._relentlessAtk; p.char._relentlessAtk=0; }
    p.char._fadedLastRound=false;
    p.char.rageTriggerActive=false;
    p.char._huntersMarkTarget=null; p.char._condemnTargetId=null; p.char._condemnUsed=false; p.char._doubleChargeUsed=false; p.char._firstVolleyUsed=false;
    p.char._cd={}; p.char._blockUsed=false; p.char._reviveUsed=false; // every ability is ready when a fight begins
    p.char._markHereticTarget=null;
    p.char._sacredGroundUsed=false;
    p.char._divineFavourUsed=false;
    p.char._devastatingChargeArmed=false;
    p.char._devastatingChargeProc=false;
    p.char._uncontrolledPowerArmed=false;
    p.char._darkPactArmed=false;
    p.char._pressAdvantageReady=false;
    p.char._foresightActive=null;
    p.char._relentlessLast=null;
    p.char._intercepActive=null; p.char._phantomStrikeUsed=false;
    if(p.char._legBerserkBonusActive){ p.char.weaponAtkBonus=Math.max(0,p.char.weaponAtkBonus-2); p.char._legBerserkBonusActive=false; }
    p.char._legShroudActive=false; p.char._legBerserkUsed=false; p.char._legAncientScaleUsed=false; p.char._legShroudUsed=false; p.char._legBeastlordMaulUsed=false; p.char._legVenomFangProc=false; p.char._legVarghulfLeech=0;
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
// ─── INPUT SAFETY ─────────────────────────────────────────────────────────────
// Names end up in the HTML game log, so strip anything that could become markup.
function cleanName(n, fallback){
  const s=String(n==null?'':n).replace(/[\u0000-\u001f\u007f<>&"'`\\]/g,'').replace(/\s+/g,' ').trim().slice(0,20);
  return s||fallback;
}
// Per-connection token bucket: ~15 messages a second sustained, bursts of 40.
// A client that keeps flooding is disconnected.
const RATE = { perSec: 15, burst: 40, strikes: 3 };
function allowMessage(ws){
  const now=Date.now(), b=ws._bucket||(ws._bucket={tokens:RATE.burst,at:now,strikes:0,warned:0});
  b.tokens=Math.min(RATE.burst,b.tokens+(now-b.at)/1000*RATE.perSec); b.at=now;
  if(b.tokens>=1){ b.tokens-=1; return true; }
  if(now-b.warned>1000){ b.warned=now; b.strikes++; }
  if(b.strikes>=RATE.strikes){ try{ ws.close(1008,'Too many messages'); }catch(e){ /* already closed */ } }
  return false;
}
const MAX_ROOMS_PER_CONNECTION = 5;

// Every message is handled with its room's random generator active.
function handleMessage(ws,msg){
  const ctx=clients.get(ws), room=ctx&&rooms.get(ctx.roomCode);
  return rng.withRoom(room,()=>handleMessageInner(ws,msg));
}
function handleMessageInner(ws,msg){
  if(!msg||typeof msg!=='object'||typeof msg.type!=='string') return;
  const type=msg.type, payload=(msg.payload&&typeof msg.payload==='object')?msg.payload:{}, ctx=clients.get(ws);
  // Browsers ask for state patches; anything that doesn't (bots, tools) gets full states.
  if(type==='HELLO'){ ws._patches=!!payload.patches; return; }
  if(type==='RESYNC'){ const room=ctx&&rooms.get(ctx.roomCode); if(room) statesync.resync(ws,room,publicState(room)); return; }
  if(type==='CREATE_ROOM'){
    ws._roomsMade=(ws._roomsMade||0)+1;
    if(ws._roomsMade>MAX_ROOMS_PER_CONNECTION){ sendTo(ws,{type:'ERROR',payload:{msg:'Too many rooms created from this connection. Refresh the page to start again.'}}); return; }
    const code=makeCode(),playerId=uuidv4();
    const room={code,hostId:playerId,players:[],gs:initGameState()};
    rooms.set(code,room); clients.set(ws,{roomCode:code,playerId});
    const token=uuidv4();
    room.players.push({id:playerId,token,ws,name:cleanName(payload.name,'Host'),career:null,char:null,ready:false,connected:true});
    sendTo(ws,{type:'ROOM_CREATED',payload:{code,playerId,token}});
    broadcastState(code); return;
  }
  if(type==='JOIN_ROOM'){
    const code=String(payload.code||'').toUpperCase().slice(0,8),room=rooms.get(code);
    if(!room){sendTo(ws,{type:'ERROR',payload:{msg:'Room not found.'}});return;}
    if(room.players.filter(p=>p.connected).length>=4){sendTo(ws,{type:'ERROR',payload:{msg:'Room full.'}});return;}
    if(room.gs.phase!=='lobby'){ takeOverSeat(ws,room,payload.name); return; }
    const playerId=uuidv4(), token=uuidv4(); clients.set(ws,{roomCode:code,playerId});
    room.players.push({id:playerId,token,ws,name:cleanName(payload.name,'Player'),career:null,char:null,ready:false,connected:true});
    sendTo(ws,{type:'ROOM_JOINED',payload:{code,playerId,token}});
    broadcastState(code); return;
  }
  if(type==='REJOIN'){
    const code=String((payload&&payload.code)||'').toUpperCase(), room=rooms.get(code);
    const player=room&&room.players.find(p=>p.id===(payload&&payload.playerId));
    // A seat someone else has taken over only answers to its new token.
    if(!player||(player.token&&payload.token!==player.token&&player.takenOver)){ sendTo(ws,{type:'REJOIN_FAILED'}); return; }
    if(player.ws&&player.ws!==ws){ clients.delete(player.ws); try{ player.ws.close(); }catch(e){} }
    player.ws=ws; player.connected=true; clients.set(ws,{roomCode:code,playerId:player.id});
    sendTo(ws,{type:'ROOM_JOINED',payload:{code,playerId:player.id,token:player.token,rejoined:true}});
    if(room.gs.phase!=='lobby') addLog(room,`${player.name} rejoins the warband.`,'sys');
    resumeRoom(room);
    broadcastState(code); return;
  }
  if(type==='SELECT_CAREER'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId); if(!player)return;
    if(!payload||!CAREERS[payload.career]){sendTo(ws,{type:'ERROR',payload:{msg:'Unknown career.'}});return;}
    if(room.gs.phase!=='lobby') return; // no class swaps mid-run
    player.career=payload.career; player.char=buildChar(payload.career); player.ready=false;
    const _careerToNovice={warrior:'warrior',rogue:'rogue',wizard:'magician',priest:'priest',witchhunter:'witchhunter',slayer:'slayer',engineer:'engineer',waywatcher:'waywatcher'}; // extend if new careers added
    const _noviceId=_careerToNovice[payload.career]||payload.career;
    applyNovicePath(player.char, _noviceId);
    player.char.pendingLevelUp=false; // novice already applied
    const sc=payload.startingCharm;
    player.frame=['bronze','silver','gold'].includes(payload.frame)?payload.frame:null;
    player.title=typeof payload.title==='string'?payload.title.replace(/[<>&"]/g,'').slice(0,30):null;
    if(payload.startRelic) relics.grantStartRelic(player.char);
    if(sc&&CHARM_SHOP_KEYS.includes(sc)){ const ch=gear.makeCharm(sc); player.char.inventory.push({name:ch.name,qty:1,type:'charm',itemObj:ch,sellCost:3}); equipItem(player.char,player.char.inventory.length-1); }
    broadcastState(ctx.roomCode); return;
  }
  if(type==='SET_DIFFICULTY'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room||room.gs.phase!=='lobby'||room.hostId!==ctx.playerId)return;
    const lvl=Number(payload&&payload.level); if(!DIFFICULTIES[lvl])return;
    room.gs.difficulty=lvl; broadcastState(ctx.roomCode); return;
  }
  if(type==='SET_DAILY'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room||room.hostId!==ctx.playerId||room.gs.phase!=='lobby')return;
    room.gs.daily=!!(payload&&payload.on); if(room.gs.daily) room.gs.endless=false; broadcastState(ctx.roomCode); return;
  }
  if(type==='SET_ENDLESS'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room||room.hostId!==ctx.playerId||room.gs.phase!=='lobby')return;
    room.gs.endless=!!(payload&&payload.on); if(room.gs.endless) room.gs.daily=false; broadcastState(ctx.roomCode); return;
  }
  if(type==='PLAYER_READY'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId); if(!player||!player.career)return;
    player.ready=true;
    const connected=room.players.filter(p=>p.connected);
    if(connected.length>=1&&connected.every(p=>p.ready)){
      room.gs.phase='path';
      addLog(room,'⚔ The warband descends into Reikland\'s darkness.');
      if(connected.length===1) applyLoneSurvivor(room,connected[0]);
      if(room.gs.daily) startDailyRun(room);
      showPathChoices(room);
    }
    broadcastState(ctx.roomCode); return;
  }
  // ── Leaving a room or quitting a run ──
  if(type==='LEAVE_ROOM'){ leaveRoom(ws); return; }
  // ── Quick chat ──
  if(type==='EMOTE'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId); const text=EMOTES[payload.id];
    if(!player||!text) return;
    const now=Date.now(); if(now-(player._lastEmote||0)<2500) return; player._lastEmote=now;
    addLog(room,`💬 <strong>${player.name}</strong>: ${text}`,'emote');
    broadcastState(ctx.roomCode); return;
  }
  // ── Accounts (name + PIN keep Renown on the server) ──
  if(type==='ACCOUNT_LOGIN'){
    ws._loginTries=(ws._loginTries||0)+1;
    if(ws._loginTries>10){ sendTo(ws,{type:'ACCOUNT_ERROR',payload:{msg:'Too many attempts. Refresh the page to try again.'}}); return; }
    const r=accounts.login(payload.name,String(payload.pin==null?'':payload.pin),payload.local);
    sendTo(ws,r.ok?{type:'ACCOUNT_OK',payload:{...r.ok,created:!!r.created}}:{type:'ACCOUNT_ERROR',payload:{msg:r.error}}); return;
  }
  if(type==='ACCOUNT_RESUME'){ const r=accounts.resume(payload.token); sendTo(ws,r.ok?{type:'ACCOUNT_OK',payload:r.ok}:{type:'ACCOUNT_SIGNED_OUT'}); return; }
  if(type==='ACCOUNT_LOGOUT'){ accounts.logout(payload.token); return; }
  if(type==='ACCOUNT_ACH'){ const r=accounts.syncAchievements(payload&&payload.token,payload&&payload.achievements); if(r.ok) sendTo(ws,{type:'ACCOUNT_OK',payload:r.ok}); return; }
  if(type==='ACCOUNT_RUN'){ const r=accounts.recordRun(payload.token,payload.rec,payload.earned,payload.achievements); if(r.ok) sendTo(ws,{type:'ACCOUNT_OK',payload:r.ok}); return; }
  // ── Practice fight: a solo room with one easy fight and a coach ──
  if(type==='START_PRACTICE'){
    if(!CAREERS[payload.career]){ sendTo(ws,{type:'ERROR',payload:{msg:'Unknown career.'}}); return; }
    handleMessageInner(ws,{type:'CREATE_ROOM',payload:{name:payload.name}});
    const c2=clients.get(ws), room=c2&&rooms.get(c2.roomCode); if(!room||room.players.length!==1) return;
    handleMessageInner(ws,{type:'SELECT_CAREER',payload:{career:payload.career}});
    startPractice(room); broadcastState(room.code); return;
  }
  if(type==='PLAYER_ACTION'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room)return;
    handlePlayerAction(room,ctx.playerId,payload,ws);
    broadcastState(ctx.roomCode); return;
  }
}

function handlePlayerAction(room,playerId,payload,ws){
  const{action,data}=payload;
  const player=room.players.find(p=>p.id===playerId);
  if(!player||!player.char)return;
  const gs=room.gs, char=player.char;

  if(action==='VOTE_PATH'){
    if(gs.phase!=='path'||!gs.pathChoices)return;
    gs.pathVotes[playerId]=data.nodeType;
    addLog(room,`${player.name} votes: <strong>${data.nodeType}</strong>.`,'sys');
    const alive=room.players.filter(p=>p.char&&p.char.alive&&p.connected);
    if(alive.every(p=>gs.pathVotes[p.id]))resolvePath(room);
    return;
  }
  if(action==='APPLY_PATH'||action==='CHOOSE_PATH'){
    if(!char.pendingLevelUp){
      return;
    }
    const tier=char.pendingPathTier||'novice';

    if(tier==='tradition'){
      if(!data.pathId.startsWith('tradition:')){
        return;
      }
      const tradId=data.pathId.replace('tradition:','');
      if(!traditionAllowed(char,tradId)){ sendTo(ws,{type:'ERROR',payload:{msg:'Your order does not teach that lore.'}}); return; }
      const trad=TRADITIONS[tradId];
      if(trad && !char.traditions.includes(tradId)){
        grantTradition(char, tradId);
        addLog(room,`${player.name} discovers the <strong>${trad.label}</strong> tradition — all eligible spells granted!`,'spell');
      } else if(!trad){
        addLog(room,`Unknown tradition: ${tradId}`,'sys');
      } else {
        addLog(room,`${player.name} already knows the ${trad.label} tradition.`,'sys');
      }
      char.pendingSpellChoices=Math.max(0,(char.pendingSpellChoices||1)-1);
      if(char.pendingSpellChoices>0){
        addLog(room,`${player.name}: ${char.pendingSpellChoices} tradition choice${char.pendingSpellChoices>1?'s':''} remaining.`,'sys');
      } else {
        char.pendingLevelUp=false; char.pendingPathTier=null;
      }
    }
    else if(tier==='novice'){applyNovicePath(char,data.pathId);addLog(room,`${player.name} walks the <strong>${data.pathId}</strong> novice path.`,'spell');}
    else if(tier==='expert'||tier==='master'){
      if(!pathAllowed(char.career,tier,data.pathId)){ sendTo(ws,{type:'ERROR',payload:{msg:'That path is not open to your career.'}}); return; }
      if(tier==='expert') applyExpertPath(char,data.pathId); else applyMasterPath(char,data.pathId);
      addLog(room,`${player.name} ${tier==='expert'?'becomes':'ascends as'} a <strong>${pathLabel(char.career,tier,data.pathId)}</strong>.`,'spell');
      if(char._armourRemovedNote){ addLog(room,`🛡 ${player.name} ${char._armourRemovedNote}.`,'loot'); delete char._armourRemovedNote; }
    }
    if(!char.pendingLevelUp){ const _lv=checkLevelUp(char); if(_lv.leveled) addLog(room,`🌟 ${player.name} reaches <strong>Level ${_lv.newLevel}</strong>! (+${_lv.hpGain} max HP)${char.pendingLevelUp?' — Choose a path!':''}`,'spell'); }
    return;
  }
  if(action==='TARGET_ENEMY'){
    if(!gs.inCombat||!gs.enemies||gs.enemies.length<=1) return;
    const idx=parseInt(data.idx)||0;
    if(idx>=0&&idx<gs.enemies.length&&gs.enemies[idx].hp>0){
      if(isEnemyHidden(gs.enemies[idx],gs)){ addLog(room,`${gs.enemies[idx].name} is out of reach — it can't be targeted right now.`,'sys'); return; }
      gs.activeEnemyIdx=idx;
      gs.enemy=gs.enemies[idx];
      addLog(room,`${player.name} targets <strong>${gs.enemy.name}</strong>.`,'sys');
    }
    return;
  }
  if(action==='BUY_ITEM'){handleBuy(room,player,data.itemId);return;}
  if(action==='CHOOSE_STAT'){
    const char2=player.char;
    const attr=data.attr;
    if(!char2.pendingStatBoost){sendTo(player.ws,{type:'ERROR',payload:{msg:'No stat boost pending.'}});return;}
    if(!['str','agi','int','wil'].includes(attr)){sendTo(player.ws,{type:'ERROR',payload:{msg:'Invalid attribute.'}});return;}
    char2.pendingStatBoost=false;
    char2.attrs[attr]++;
    if(attr==='agi'){ char2.baseAgiDef=char2.attrs.agi; char2.defense++; } // Defence (dodging) comes from AGI
    addLog(room,`${player.name}: +1 ${attr.toUpperCase()} (now ${char2.attrs[attr]}).`,'loot');
    broadcastState(room.code); return;
  }
  if(action==='SELL_ITEM'){handleSell(room,player,data.invIndex);return;}
  if(action==='LEAVE_SHOP'){
    char.merchantStock=null;
    const stillShopping=room.players.filter(p=>p.char&&p.char.alive&&p.connected&&p.char.merchantStock);
    if(stillShopping.length===0){gs.phase='event';addLog(room,'The warband leaves the merchant.','sys');}
    else addLog(room,`${player.name} is done shopping.`,'sys');
    return;
  }
  if(action==='PICK_LOOT'){
    if(gs.phase!=='loot'||!gs.lootRoom||gs.lootPicked.includes(playerId))return;
    gs.lootPicked.push(playerId);
    const opts=char.lootOptions||{}; char.lootOptions=null;
    if(data.pick==='coins'){char.gold+=gs.lootRoom.coins;addLog(room,`${player.name} takes ${gs.lootRoom.coins} silver.`,'loot');}
    else if(data.pick==='consumable'&&opts.consumable){
      if(opts.consumable==='Spell Scroll'&&opts.scrollSpell){const sn=`Scroll: ${opts.scrollSpell.name}`;addToInventory(char,sn);char.scrollSpells[sn]=opts.scrollSpell;addLog(room,`${player.name} takes ${sn}.`,'loot');}
      else{addToInventory(char,opts.consumable);addLog(room,`${player.name} takes ${opts.consumable}.`,'loot');}
    }
    else if(data.pick==='weapon'&&opts.weapon){addToInventory(char,opts.weapon.name,opts.weapon);addLog(room,`${player.name} takes ${opts.weapon.name}.`,'loot');}
    else if(data.pick==='armor'&&opts.armor){addToInventory(char,opts.armor.name,opts.armor);addLog(room,`${player.name} takes ${opts.armor.name}.`,'loot');}
    else if(data.pick==='charm'&&opts.charm){addToInventory(char,opts.charm.name,opts.charm);addLog(room,`${player.name} takes ${opts.charm.name}.`,'loot');}
    else if(data.pick==='heirloom'&&opts.heirloom){addToInventory(char,opts.heirloom.name,opts.heirloom);addLog(room,`🏺 ${player.name} takes the heirloom <strong>${opts.heirloom.name}</strong>.`,'loot');}
    else{addLog(room,`${player.name} takes nothing.`,'sys');}
    const alive=room.players.filter(p=>p.char&&p.char.alive&&p.connected);
    if(alive.every(p=>gs.lootPicked.includes(p.id))){gs.phase='event';gs.lootRoom=null;addLog(room,'Loot divided. Press onward.','sys');}
    return;
  }
  if(action==='CAMPFIRE'){ campfire.choose(room,playerId,data&&data.choice,data&&data.slot); return; }
  if(action==='PICK_RELIC'){ relics.pickRelic(room,playerId,data&&data.key); return; }
  if(action==='VOTE_PRIZE'){ relics.votePrize(room,playerId,data&&data.choice); return; }
  if(action==='SET_ROW'){ const r=data&&data.row; const was=char.row;
    const err=rows.setRow(room,player,r,gs.phase==='combat'?getCurrentTurn(gs):null);
    if(err){ sendTo(ws,{type:'ERROR',payload:{msg:err}}); return; }
    if(was!==r) addLog(room,`${player.name} ${r==='back'?'falls back to the <strong>back line</strong>':'steps up to the <strong>front line</strong>'}.`,'sys'); return; }
  if(action==='UNEQUIP_CHARM'){ const r=unequipCharm(char); if(r) addLog(room,`${player.name}: ${r}.`,'loot'); return; }
  if(action==='EQUIP_ITEM'){
    const idx=data.inventoryIndex;
    if(idx===undefined||idx<0||idx>=char.inventory.length)return;
    const _it=char.inventory[idx]&&char.inventory[idx].itemObj;
    const result=equipItem(char,idx);
    if(result)addLog(room,`${player.name}: ${result}.`,'loot');
    if(_it&&_it.cursed&&!_it._corrupted&&[char.equippedCharm,char.equippedWeapon,char.equippedArmor].includes(_it)){ _it._corrupted=true; dark.gainCorruption(room,player,1,_it.name); }
    return;
  }
  if(action==='CHOOSE_EVENT'){ events.voteChoice(room,playerId,data&&data.option); return; }
  if(action==='CONTINUE_AFTERMATH'){
    if(gs.phase!=='aftermath'||!gs.aftermath) return;
    if(!gs.aftermath.ready.includes(playerId)) gs.aftermath.ready.push(playerId);
    aftermathReady(room); return;
  }
  if(action==='PRESS_ONWARD'){
    if(gs.phase!=='event') return;
    if(runWon(gs)){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');return;}
    showPathChoices(room); return;
  }
  if(action==='USE_ITEM_OOC'){useItemLogic(room,player,data.itemName,false);return;}

  if(gs.phase!=='combat'||!gs.inCombat)return;
  if(!char.alive)return;
  const _stunBuff = (char.activeBuffs||[]).find(b=>b.skipTurn);
  if(_stunBuff){
    _stunBuff.duration--;
    if(_stunBuff.duration<=0) char.activeBuffs = char.activeBuffs.filter(b=>!b.skipTurn);
    addLog(room,`💫 ${player.name} is stunned and loses their action!${_stunBuff.duration>0?` (${_stunBuff.duration} more turn)`:''}`,'sys');
    if(!gs.playersActedThisRound.includes(playerId)) gs.playersActedThisRound.push(playerId);
    if(gs.turnOrder&&gs.turnOrder.length) advanceTurn(room);
    broadcastState(room.code); return;
  }
  if(gs.turnOrder && gs.turnOrder.length) {
    const _cur = getCurrentTurn(gs);
    if (!_cur || _cur.type !== 'player' || _cur.id !== playerId) {
      sendTo(ws, {type:'ERROR', payload:{msg:"It's not your turn yet!"}});
      return;
    }
  } else if(gs.playersActedThisRound.includes(playerId)) {
    sendTo(ws, {type:'ERROR', payload:{msg:'Already acted this round.'}});
    return;
  }
  let acted=false;
  const ctx={room,playerId,data,ws,player,gs,char};

  if(action==='ATTACK'){
    const r=actAttack(ctx);
    if(r===undefined) return;
    acted=r;
  }
  else if(action==='PASS_TURN'){
    addLog(room,`${player.name} passes their turn.`,'sys');
    acted=true;
  }
  else if(action==='CAST_SPELL'){
    if(charmKey(char)==='brassSkull'){ addLog(room,`💀 The Brass Skull of Khorne will not allow ${player.name} to cast spells.`,'sys'); return; }
    const r=actCastSpell(ctx);
    if(r===undefined) return;
    acted=r;
    if(r && charmKey(char)==='warpAmulet' && d(6)===1){ dark.gainCorruption(room,player,1,'the Warpstone Amulet'); }
  }
  else if(action==='USE_TALENT'){
    const r=actUseTalent(ctx);
    if(r===undefined) return;
    acted=r;
  }
  else if(action==='USE_ITEM'){const consumed=useItemLogic(room,player,data.itemName,true);acted=consumed&&!char.quickHands; if(consumed&&char.quickHands) addLog(room,`🤲 Quick Hands — ${player.name} keeps their action.`,'sys');}
  else if(action==='USE_ITEM_ALLY'){
    const targetPlayer=room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive);
    if(!targetPlayer){addLog(room,`${player.name}: target not found.`,'sys');return;}
    const tchar=targetPlayer.char;
    const idx=char.inventory.findIndex(i=>i.name===data.itemName); if(idx===-1)return;
    if(data.itemName==='Healing Draught'){const h=rd(1,6)+(tchar.level||1);tchar.health=Math.min(tchar.maxHealth,tchar.health+h);addLog(room,`${player.name} gives Healing Draught to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');}
    else if(data.itemName==='Greater Healing Draught'){const h=rd(2,6)+2*(tchar.level||1);tchar.health=Math.min(tchar.maxHealth,tchar.health+h);addLog(room,`${player.name} gives Greater Healing to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');}
    else{addLog(room,`${player.name}: can't use that on an ally.`,'sys');return;}
    char.inventory[idx].qty--; if(char.inventory[idx].qty<=0) char.inventory.splice(idx,1);
    acted=false;
  }
  else if(action==='FLEE'){
    if((gs.enemies||[]).some(e=>e&&e.hp>0&&e.threat==='Boss')){addLog(room,`${player.name}: no escape from a boss!`,'dmg');return;}
    const base=d(20),total=base+modVal(char.attrs.agi);
    if(total>=10){
      const hit=char.shadowstep?0:rd(1,4);
      if(hit){char.health=Math.max(0,char.health-hit);addLog(room,`${player.name} flees! Takes <strong>${hit}</strong> opportunity dmg.`,'dmg');checkDeath(room,player);}
      else addLog(room,`${player.name} slips away unharmed (Shadowstep).`,'dmg');
      gs.inCombat=false;gs.enemy=null;gs.enemies=[];gs.turnOrder=[];gs.phase='event';gs.playersActedThisRound=[];gs.enemyHasActed=false;gs.packCooldown=0;
      room.players.forEach(p=>{ if(!p.char) return;
        if(!p.char.alive||p.char.pendingRevive){ p.char.health=Math.max(1,p.char.health); p.char.alive=true; p.char.pendingRevive=false; addLog(room,`${p.name} is dragged away by the warband — 1 HP.`,'heal'); }
        resetCombatState(p); });
      finishCombat(room,'fled'); addLog(room,'Warband escapes.','sys');return;
    } else {addLog(room,`${player.name} fails to flee (${total}<DC10).`,'sys');acted=true;}
  }

  if(acted){
    char._hitSinceTurn=false;
    if(action!=='ATTACK' && char.equippedWeapon && char.equippedWeapon.special && char.equippedWeapon.special.key==='khornateAxe' && char.alive){
      const kd=rd(1,6); char.health=Math.max(0,char.health-kd);
      addLog(room,`🪓 <strong>Khornate Axe!</strong> Blood for the Blood God — ${player.name} didn't attack and takes <strong class="num-dmg">−${kd}</strong>.`,'chaos');
      checkDeath(room,player);
    }
    if(!gs.playersActedThisRound.includes(playerId)) gs.playersActedThisRound.push(playerId);
    if(gs.turnOrder && gs.turnOrder.length) {
      advanceTurn(room);
    }
  }
}

// ─── SAVED ROOMS ──────────────────────────────────────────────────────────────
// Rooms come back from disk after a restart with everyone disconnected; players
// reclaim their seat with REJOIN. A fight that was mid enemy-turn resumes then.
function restoreRooms(){
  persist.loadRooms().forEach(r=>{
    const room={code:r.code,hostId:r.hostId,touchedAt:r.touchedAt,gs:r.gs,_needsResume:true,
      players:r.players.map(p=>({...p,ws:null,connected:false,disconnectedAt:Date.now()}))};
    if(room.gs.phase==='dying') room.gs.phase='gameover';
    rooms.set(room.code,room);
  });
  if(rooms.size) console.log(`Restored ${rooms.size} saved room(s).`);
}
function resumeRoom(room){
  if(!room._needsResume) return;
  room._needsResume=false;
  const gs=room.gs;
  if(gs.inCombat&&gs.phase==='combat'){
    const cur=getCurrentTurn(gs);
    if(cur&&cur.type==='enemy'){ gs.activeTurnIdx=Math.max(-1,(gs.activeTurnIdx||0)-1); advanceTurn(room); }
  }
}
// Drop rooms that have been empty for a long time.
function sweepRooms(){
  const now=Date.now();
  for(const [code,room] of rooms){
    if(!room.players.some(p=>p.connected)&&now-(room.touchedAt||0)>persist.MAX_AGE_MS) rooms.delete(code);
  }
}

wss.on('connection',ws=>{
  ws.on('message',raw=>{ if(!allowMessage(ws)) return; let msg; try{ msg=JSON.parse(raw); }catch(e){ return; } try{handleMessage(ws,msg);}catch(e){console.error('WS error:',e);}});
  ws.on('close',()=>{
    const ctx=clients.get(ws);if(!ctx)return;
    const room=rooms.get(ctx.roomCode);
    if(room){const player=room.players.find(p=>p.id===ctx.playerId);if(player){player.connected=false;player.disconnectedAt=Date.now();addLog(room,`${player.name} disconnected.`,'sys');try{unblockAfterDisconnect(room,player);}catch(e){console.error('Disconnect unblock error:',e);}broadcastState(ctx.roomCode);}
    room.touchedAt=Date.now(); persist.scheduleSave(rooms);}
    clients.delete(ws);
  });
});

// ─── ROOM BROADCAST, LOG AND GAME OVER ────────────────────────────────────────
function addLog(room,msg,type=''){if(!room||!room.gs)return;room.gs.log.push({msg,type,ts:Date.now()});if(room.gs.log.length>200)room.gs.log=room.gs.log.slice(-200);}

function triggerGameover(room){
  const gs=room.gs;
  gs.phase='dying';
  gs.inCombat=false;
  const logs=[...gs.log].reverse();
  const lastBlow=logs.find(l=>l.type==='dmg-taken');
  const lastDoT=logs.find(l=>l.type==='spell'&&l.msg&&(l.msg.includes('Bleed')||l.msg.includes('Burn')||l.msg.includes('Poison')));
  gs.deathCause=(lastBlow||lastDoT||logs.find(l=>l.type==='chaos'))?.msg||null;
  addLog(room,'💀 <strong>The warband has fallen...</strong>','death');
  broadcastState(room.code);
  setTimeout(()=>{
    if(gs.phase!=='dying') return; // already resolved
    gs.phase='gameover';
    broadcastState(room.code);
  },3500);
}

function broadcastState(roomCode){const room=rooms.get(roomCode);if(!room)return;room.players.forEach(p=>{ if(p.char&&p.char.inventory) p.char.inventory.forEach(i=>{ i.sellCost=sellPrice(i); }); }); // players see what each item sells for
if((room.gs.phase==='gameover'||room.gs.phase==='victory')&&!room.gs._recorded)recordRunEnd(room);room.touchedAt=Date.now();persist.scheduleSave(rooms);statesync.broadcast(room,publicState(room));}

// When someone drops, re-check anything that was waiting on them
function unblockAfterDisconnect(room, player){
  const gs=room.gs;
  const here=room.players.filter(p=>p.char&&p.char.alive&&p.connected);
  if(!here.length) return;
  if(gs.phase==='aftermath') aftermathReady(room);
  else if(gs.phase==='relic'&&gs.relic) relics.maybeFinish(room);
  else if(gs.phase==='campfire'&&gs.campfire) campfire.maybeFinish(room);
  else if(gs.phase==='choice'&&gs.choice&&here.every(p=>gs.choice.votes[p.id])) events.resolveChoice(room);
  else if(gs.phase==='path'&&gs.pathChoices&&here.every(p=>gs.pathVotes[p.id])) resolvePath(room);
  else if(gs.phase==='loot'&&gs.lootRoom&&here.every(p=>gs.lootPicked.includes(p.id))){ gs.phase='event'; gs.lootRoom=null; addLog(room,'Loot divided. Press onward.','sys'); }
  else if(gs.phase==='merchant'&&!here.some(p=>p.char.merchantStock)){ gs.phase='event'; addLog(room,'The warband leaves the merchant.','sys'); }
  else if(gs.phase==='combat'&&gs.inCombat){ const cur=getCurrentTurn(gs); if(cur&&cur.type==='player'&&cur.id===player.id) advanceTurn(room); }
}

// Hand every split-out module the helpers it uses. Runs once all of server.js
// has been evaluated, so constants defined anywhere in this file are ready.
const MODULE_API = { refreshEnemyAuras, ARMOR_BASES, CAREERS, CHARMS, CHARM_SHOP_KEYS, DIFFICULTIES, ENEMY_DROPS, EXPERT_PATHS, LEGENDARY_ITEMS, LOOT_CONS_LIST, MASTER_PATHS, NODE_TYPES, NOVICE_PATHS, POISON_CAP, SCROLL_SPELLS_LIST, SCROLL_SPELLS_SHOP, SELF_TICK_DOTS, SHOP_CONSUMABLES, TRADITIONS, WEAPON_BASES, XP_THRESHOLDS, addBuff, addDebuff, addLog, advanceTurn, aliveEnemies, applyBleed, applyBurn, applyCharm, applyDailyToEnemies, applyPoison, armorTraits, broadcastState, buildPlayerShop, buildTurnOrder, campfire, castingsLeft, charmKey, checkDeath, cleanseCurses, d, dark, enemyAfterHit, enemyDamageMods, enemyDefence, enemyOnWeaponHit, enemyPostTurn, enemyPreTurn, engineerRoundTick, events, foes, gearRoundTick, gearVsEnemyAttack, getSpellsForPower, getTargetEnemy, hasRangedWeapon, hasRelic, immuneToPoison, isCursed, isEnemyHidden, labelOf, lore, makeCharm, makeCursedItem, maxCastings, modVal, onCombatStart, pickEnemy, pickRandom, rd, refreshCastingPools, regainCasting, relics, resolveEnemyDeath, restoreCastingPools, rollAttack, rollEnemyAttack, rollTraits, scaleEnemy, sendTo, sortTurnOrder, spendCasting, startSpoils, talentHeal, tickBuffs, tickCooldowns, tickDebuffs, traditionAllowed, triggerGameover, uniqRanks, uuidv4, weaponTraits, zones };
[combatMod, pathsMod, nodesMod, turnsMod, itemsMod, actionsMod].forEach(m => m.bind(MODULE_API));

// Start the server when run directly (node server.js). Tests require() this file
// instead and drive the game through the exported functions.
if (require.main === module) {
  restoreRooms();
  setInterval(sweepRooms, 10 * 60 * 1000).unref();
  // Save immediately when Railway stops the container for a redeploy.
  ['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => { persist.saveNow(rooms); process.exit(0); }));
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => { console.log(`Shadows Over Reikland on 0.0.0.0:${PORT}`); });
}

module.exports = { app, server, rooms, clients, enemies, gear, events, runlog, relics, lore, accounts, chronicleLine, endlessTier, runWon, foes, dark, engineerRoundTick, cleanName, leaveRoom, tickCooldowns, unequipCharm, sellPrice, allowMessage, RATE,
  startTurnTimer, recordRunEnd, takeOverSeat, applyDailyToEnemies, startDailyRun, TURN_LIMIT_MS,
  _runNodeContent, actAttack, actCastSpell, actUseTalent, addBuff, addDebuff, addLog, addToInventory, advanceTurn, aftermathReady, applyBleed, applyBurn, applyExpertPath, applyLegendaryArmourPassive, applyLevelGains, applyMasterPath, applyNovicePath, applyPoison, applyTalentList, applyWpnSpecial, autoSkipStunnedPlayer, broadcastState, buildChar, buildLootOptions, buildPlayerShop, buildTurnOrder, castingsLeft, checkDeath, checkLevelUp, endRound, enemyDmgDice, enterNode, equipItem, finishCombat, finishEnemyTurn, fireEnemyTurn, genArmor, genLegendaryItem, genShopScroll, genSpecialArmor, genSpecialWpn, genWpn, getBuffVal, getCurrentTurn, getDebuffVal, getPathHpGain, getSpellsForPower, getTargetEnemy, grantTradition, handleBuy, handleMessage, handlePlayerAction, handleSell, initGameState, invCounts, makeCode, maxCastings, pickEnemy, pickThreeNodes, publicState, refreshCastingPools, regainCasting, resetCombatState, resolveEnemyDeath, resolvePath, resolveUnknownEvent, restoreCastingPools, restorePower, restoreRooms, resumeRoom, rollAttack, rollD20boons, rollEnemyAttack, rollEnemyDrop, scaleEnemy, sendTo, showPathChoices, spendCasting, startNodeContent, startSpoils, sweepRooms, talentHeal, tickBuffs, tickDebuffs, triggerGameover, unblockAfterDisconnect, uniqRanks, useItemLogic };
