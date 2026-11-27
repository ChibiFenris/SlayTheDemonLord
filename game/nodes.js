'use strict';
const heirlooms = require('./heirlooms');
const armour = require('./armour');
// The road: path votes, room contents, unknown-room encounters and loot rooms.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let ARMOR_BASES, CHARM_SHOP_KEYS, DIFFICULTIES, LOOT_CONS_LIST, NODE_TYPES, SCROLL_SPELLS_LIST, WEAPON_BASES, addDebuff, addLog, advanceTurn, applyDailyToEnemies, buildPlayerShop, buildTurnOrder, campfire, d, dark, events, foes, hasRelic, lore, makeCharm, maxCastings, onCombatStart, pickEnemy, pickRandom, refreshCastingPools, relics, restoreCastingPools, rollTraits, startSpoils, uniqRanks, uuidv4, zones;
function bind(api) {
  ({ ARMOR_BASES, CHARM_SHOP_KEYS, DIFFICULTIES, LOOT_CONS_LIST, NODE_TYPES, SCROLL_SPELLS_LIST, WEAPON_BASES, addDebuff, addLog, advanceTurn, applyDailyToEnemies, buildPlayerShop, buildTurnOrder, campfire, d, dark, events, foes, hasRelic, lore, makeCharm, maxCastings, onCombatStart, pickEnemy, pickRandom, refreshCastingPools, relics, restoreCastingPools, rollTraits, startSpoils, uniqRanks, uuidv4, zones } = api);
}
// ─── PATH/NODE LOGIC ─────────────────────────────────────────────────────────
function pickThreeNodes() {
  const pool=[...NODE_TYPES], chosen=[];
  while(chosen.length<3){const i=Math.floor(Math.random()*pool.length);const t=pool.splice(i,1)[0];if(!chosen.includes(t))chosen.push(t);}
  return chosen;
}

function restorePower(room, reason) {
  let restored=false;
  room.players.forEach(p=>{
    if(!p.char||!p.char.alive) return;
    const poolsSpent=p.char.knownSpells&&p.char.knownSpells.some(sp=>(p.char.castingPools||{})[sp.name]<maxCastings(p.char.power,sp.rank));
    if(poolsSpent||p.char.spellRecoveryUsed){ restoreCastingPools(p.char); p.char.spellRecoveryUsed=false; restored=true; }
  });
  if(restored) addLog(room,`✨ ${reason} — all spellcasters regain power.`,'spell');
}

// The choices offered when entering `depth`. Boss depths are fixed; from depth 3
// one choice is sometimes a Cursed Path.
function crossroadsFor(depth, endless, gs){
  if(depth%10===0&&(depth<=30||endless)) return ['boss'];
  let c=pickThreeNodes();
  if(gs&&foes.hasMutator(gs,'plunder')) c=c.map(t=>t==='rest'?'merchant':t);
  if(depth>=3&&Math.random()<0.22) c[Math.floor(Math.random()*3)]='cursed';
  return c;
}
function showPathChoices(room) {
  const gs=room.gs; gs.pathVotes={};
  // Endless: after each boss past the third the warband picks a mutator first.
  if(gs._pendingMutator){ gs._pendingMutator=false; events.startChoiceEvent(room,'endlessMutator'); return; }
  const nextDepth=gs.depth+1;
  gs.road=(gs.road||[]).filter(r=>r.depth>gs.depth);
  const planned=gs.road[0]&&gs.road[0].depth===nextDepth?gs.road.shift():null;
  const isBossDepth = gs.depth>0 && gs.depth%10===9 && (gs.endless || gs.bossCount<3);
  const isFinalBoss = !gs.endless && gs.depth>=29 && gs.bossCount<3; // only trigger if haven't beaten boss 3 yet
  if (isBossDepth || isFinalBoss) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    const msg = isFinalBoss
      ? '💀 The Final Darkness awaits — there is no retreat.'
      : '💀 A monstrous power bars your path. Face it or fall.';
    addLog(room,msg,'chaos');
  } else {
    gs.phase='path'; gs.bossNode=false; gs.pathChoices=planned&&planned.choices[0]!=='boss'?planned.choices:crossroadsFor(nextDepth,gs.endless,gs).filter(t=>t!=='boss');
    if(!gs.pathChoices.length) gs.pathChoices=pickThreeNodes();
    addLog(room,'The warband reaches a crossroads. Each warrior votes for their path.','sys');
  }
  // Keep two crossroads of the road ahead visible.
  while(gs.road.length<2){ const dd=nextDepth+1+gs.road.length; if(dd>30&&!gs.endless) break; gs.road.push({depth:dd,choices:crossroadsFor(dd,gs.endless,gs)}); }
}

function resolvePath(room) {
  const gs=room.gs, votes=Object.values(gs.pathVotes); if(!votes.length) return;
  const tally={}; votes.forEach(v=>{tally[v]=(tally[v]||0)+1;});
  const maxV=Math.max(...Object.values(tally));
  const winners=Object.keys(tally).filter(k=>tally[k]===maxV);
  const chosen=winners[Math.floor(Math.random()*winners.length)];
  const voteStr=Object.entries(gs.pathVotes).map(([id,v])=>{const p=room.players.find(p=>p.id===id);return`${p?p.name:'?'}→${v}`;}).join(', ');
  if(winners.length>1) addLog(room,`Split vote (${voteStr}). Fate chooses: <strong>${chosen}</strong>!`,'sys');
  else addLog(room,`Path chosen: <strong>${chosen}</strong>. (${voteStr})`,'sys');
  if(gs.phase!=='path') return; // guard: don't resolve if phase changed
  enterNode(room,chosen);
}

function startNodeContent(room, nodeType) {
  const gs=room.gs;
  const playerCount=room.players.filter(p=>p.connected&&p.char&&p.char.alive).length;
  _runNodeContent(room, gs, nodeType, playerCount);
}

function enterNode(room, nodeType) {
  const gs=room.gs; gs.depth++; gs.pathChoices=null; gs.pathVotes={};
  // Crossing into a new region.
  const z=zones.zoneFor(gs.depth);
  if(gs.zoneId!==z.id){ gs.zoneId=z.id; addLog(room,`${z.icon} <strong>${z.name}.</strong> ${z.blurb}`,'boss'); gs.bossBanner={name:`${z.icon} ${z.name}`,text:z.blurb,ts:Date.now(),zone:true}; }
  const playerCount=room.players.filter(p=>p.connected&&p.char&&p.char.alive).length;
  _runNodeContent(room, gs, nodeType, playerCount);
}

function _runNodeContent(room, gs, nodeType, playerCount) {
  if(nodeType==='combat'||nodeType==='elite'||nodeType==='boss') {
    const isBoss=nodeType==='boss', isElite=nodeType==='elite';
    gs.enemies=[];
    gs.activeEnemyIdx=0;
    if(isElite && Math.random()<0.5){
      const e1=pickEnemy(gs.depth,false,false,playerCount,gs.bossCount);
      const e2=pickEnemy(gs.depth,false,false,playerCount,gs.bossCount);
      e1.id='e1'; e2.id='e2'; e1.isElite=true; e2.isElite=true; // double XP for elite room
      if(playerCount===1){ [e1,e2].forEach(e=>{ e.maxHp=e.hp=Math.round(e.maxHp*0.7); }); foes.applyEliteAffix(e1); } // alone: a smaller pair, and only one of them has an elite trait
      else { foes.applyEliteAffix(e1); foes.applyEliteAffix(e2); }
      gs.enemies=[e1,e2];
      gs.enemy=gs.enemies[0];
      addLog(room,`⚔ Elite Encounter — Two enemies appear!`,'dmg');
      gs.enemies.forEach(e=>addLog(room,`&nbsp;▸ <strong>${e.name}</strong> (${e.hp}/${e.maxHp} HP, DMG: ${e.dmgDisplay})`,'dmg'));
    } else {
      const e=pickEnemy(gs.depth,isElite,isBoss,playerCount,gs.bossCount);
      e.id='e0';
      gs.enemies=[e];
      gs.enemy=e;
      const tag=isBoss?'⚠ BOSS — ':isElite?'Elite — ':'';
      addLog(room,`⚔ ${tag}<strong>${e.name}</strong> appears! DMG: ${e.dmgDisplay}`,'dmg');
      const line=isBoss&&lore.intro(e.name);
      if(line){ addLog(room,`🗣 <strong>${e.name}:</strong> <em>“${line}”</em>`,'boss'); gs.bossBanner={name:e.name,text:line,ts:Date.now()}; }
    }
    const diff=DIFFICULTIES[gs.difficulty||0];
    if(diff.id>0) gs.enemies.forEach(e=>{ e.maxHp=Math.round(e.maxHp*diff.hp); e.hp=e.maxHp; e.dmgBonus=(e.dmgBonus||0)+diff.dmg; e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`; });
    applyDailyToEnemies(gs, gs.enemies);
    // Cursed Path: tougher foes until the next boss falls.
    if(gs.curseStacks){ gs.enemies.forEach(e=>{ e.maxHp=Math.round(e.maxHp*(1+0.15*gs.curseStacks)); e.hp=e.maxHp; e.dmgBonus=(e.dmgBonus||0)+gs.curseStacks; e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`; }); }
    // Relics that act when a fight begins.
    room.players.forEach(p=>{ const c=p.char; if(!c||!c.alive) return;
      // Fight-start passives.
      c._devastatingChargeProc=!!c.devastatingCharge; // Devastating Charge: first hit each fight
      c._overcastFired=0;                              // Overcast: first attack spell(s) each fight
      c._vengeanceLowFired=false; c._lastRitesFired=false; c.rageTriggerActive=false;
      heirlooms.fightStart(c);
    });
    if(room.players.some(p=>p.char&&p.char.alive&&hasRelic(p.char,'tollingBell'))) gs.enemies.forEach(e=>addDebuff(e,'Shaken',{bane:1,consumeOnAttack:true},2));
    if(gs._nextCombatHalfHP){ gs._nextCombatHalfHP=false; gs.enemies.forEach(e=>{e.hp=Math.ceil(e.hp/2); e.maxHp=e.hp;}); addLog(room,`🔴 Ritual disruption — enemies enter at half HP!`,'chaos'); }
    gs.inCombat=true; gs.phase='combat'; gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.roundNumber=1;
    foes.onFightStart(room);
    dark.onFightStart(room);
    if(isBoss) room.players.filter(p=>p.char&&p.char.alive).forEach(p=>dark.gainInsanity(room,p,1));
    onCombatStart(room);
    startSpoils(room);
    // Castings refill at the start of every fight (spells of the same rank share one pool)
    room.players.forEach(p=>{ if(p.char&&p.char.alive&&p.char.knownSpells&&p.char.knownSpells.length) restoreCastingPools(p.char); });
    room.players.filter(p=>p.char&&p.char.alive&&p.char.preparedSpell).forEach(p=>{
      const r1=p.char.knownSpells&&p.char.knownSpells.find(sp=>sp.rank===1);
      if(r1){ if(!p.char.castingPools) refreshCastingPools(p.char); p.char.castingPools['R'+r1.rank]=(p.char.castingPools['R'+r1.rank]||0)+1; addLog(room,`📚 <strong>Prepared Spell!</strong> ${p.name} has ${r1.name} ready — one free cast this combat.`,'spell'); }
    });
    room.players.filter(p=>p.char&&p.char.alive&&hasRelic(p.char,'quicksilver')&&p.char.castingPools).forEach(p=>{ Object.keys(p.char.castingPools).forEach(k=>{ p.char.castingPools[k]++; }); });
    room.players.filter(p=>p.char&&p.char.alive&&p.char._legPrimordialStaff).forEach(p=>{
      if(!p.char.castingPools) refreshCastingPools(p.char);
      uniqRanks((p.char.knownSpells||[]).filter(sp=>sp.rank===1)).forEach(sp=>{ p.char.castingPools['R'+sp.rank]=(p.char.castingPools['R'+sp.rank]||0)+3; });
    });
    buildTurnOrder(room);
    const _ft=gs.turnOrder[0];
    addLog(room,`--- Round 1 begins --- ${_ft?_ft.name+"'s turn":'Warriors act'} ---`,'sys');
    if(_ft&&_ft.type==='enemy'){ gs.activeTurnIdx=-1; advanceTurn(room); } // enemy has the first strike
    return;
  }
  if(nodeType==='rest') { campfire.startCampfire(room); return; }
  if(nodeType==='merchant') {
    gs.phase='merchant';
    room.players.forEach(p=>{ if(!p.char||!p.char.alive) return;
      const st=buildPlayerShop(gs.bossCount,p.char), f=dark.shopFactor(p.char)*(foes.hasMutator(gs,'plunder')?0.5:1);
      if(Math.random()<0.3){ const h=heirlooms.roll(p.char,gs.bossCount); if(h){ h.cost=60+20*Math.min(3,gs.bossCount||0); st.heirloom=h; } } // a merchant sometimes has something from home
      if(f!==1) Object.values(st).flat().forEach(it=>{ if(it&&typeof it.cost==='number') it.cost=Math.max(1,Math.round(it.cost*f)); });
      p.char.merchantStock=st; });
    gs.merchantVisits=(gs.merchantVisits||0)+1;
    addLog(room,`🛒 ${lore.merchantGreeting(gs.merchantVisits)}`,'sys');
    return;
  }
  if(nodeType==='loot') {
    gs.phase='loot';
    const coins=25+Math.floor(Math.random()*26); // 25-50 silver
    gs.lootRoom={coins}; gs.lootPicked=[];
    room.players.forEach(p=>{if(p.char&&p.char.alive){ p.char.lootOptions=buildLootOptions(gs.bossCount,p.char); if(Math.random()<(gs.bossCount?0.35:0.25)) p.char.lootOptions.heirloom=heirlooms.roll(p.char,gs.bossCount); }});
    addLog(room,`📦 A cache! ${coins} coins — each warrior finds their own haul.`,'loot');
    return;
  }
  if(nodeType==='cursed') {
    gs.curseStacks=Math.min(2,(gs.curseStacks||0)+1); gs.cursedTaken=(gs.cursedTaken||0)+1;
    addLog(room,`☠ <strong>The Cursed Path.</strong> Dark power seeps into the road — enemies are stronger until the next boss falls (${gs.curseStacks===2?'doubly cursed':'cursed'}). But the dead leave gifts behind.`,'chaos');
    room.players.filter(p=>p.char&&p.char.alive).forEach(p=>dark.gainCorruption(room,p,1,'the Cursed Path'));
    if(!relics.offerRelics(room,'event')) gs.phase='event';
    return;
  }
  if(nodeType==='unknown') {
    gs.phase='event';
    const r=d(14);
    if(r<=2){ startNodeContent(room,'combat'); return; }
    else if(r<=4){ startNodeContent(room,'loot'); return; }
    else if(r<=5){ startNodeContent(room,'rest'); return; }
    else { resolveUnknownEvent(room); }
    return;
  }
}

// ─── UNKNOWN ROOM ENCOUNTERS ─────────────────────────────────────────────────
// Every unknown room is now a choice: the warband decides what to do.
function resolveUnknownEvent(room){
  events.startChoiceEvent(room);
}

// ─── LOOT ROOM ───────────────────────────────────────────────────────────────
function buildLootOptions(bossCount=0,c=null) {
  const useScroll=d(6)>=4;
  const consumable=useScroll?'Spell Scroll':LOOT_CONS_LIST[Math.floor(Math.random()*LOOT_CONS_LIST.length)];
  const scrollSpell=useScroll?SCROLL_SPELLS_LIST[Math.floor(Math.random()*SCROLL_SPELLS_LIST.length)]:null;
  const charm=Math.random()<0.35?makeCharm(pickRandom(CHARM_SHOP_KEYS)):null;
  return {consumable,scrollSpell,weapon:genSpecialWpn(bossCount),armor:genSpecialArmor(bossCount,c),charm};
}
function genSpecialWpn(bossCount=0){
  const specials=WEAPON_BASES.filter(b=>b.special);
  const pool=bossCount===0?specials.filter(b=>['1d6','1d8','2d4'].includes(b.dice)):specials;
  const base=pool[Math.floor(Math.random()*pool.length)];
  const bonus=bossCount===0?d(3):bossCount===1?d(2)+2:d(2)+4;
  return rollTraits({id:'w'+uuidv4(),name:base.name,dice:base.dice,stat:base.stat,bonus,dmgType:base.dmgType,special:base.special,cost:0,sellCost:3,bought:false,type:'weapon',desc:`${base.dice}+${bonus} · ${base.stat.toUpperCase()} · ${base.dmgType} — ${base.special.desc}`},'weapon');
}
function genSpecialArmor(bossCount=0,c=null){
  let specials=ARMOR_BASES.filter(ab=>ab.special);
  if(c){ const ok=specials.filter(b=>armour.TYPES[armour.typeOf(b.name)].rank<=armour.maxRank(c)); if(ok.length) specials=ok; }
  const base=specials[Math.floor(Math.random()*specials.length)];
  const bonus=bossCount===0?d(3):bossCount===1?d(2)+1:d(3)+2;
  const totalDef=base.def+bonus;
  return rollTraits({id:'a'+uuidv4(),name:base.name,defBonus:totalDef,special:base.special,cost:0,sellCost:3,bought:false,type:'armor',desc:`+${totalDef} Defense — ${base.special.desc}`},'armor');
}

module.exports = { bind, pickThreeNodes, restorePower, crossroadsFor, showPathChoices, resolvePath, startNodeContent, enterNode, _runNodeContent, resolveUnknownEvent, buildLootOptions, genSpecialWpn, genSpecialArmor };
