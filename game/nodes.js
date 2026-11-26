'use strict';
// The road: path votes, room contents, unknown-room encounters and loot rooms.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let ARMOR_BASES, CHARM_SHOP_KEYS, DIFFICULTIES, LOOT_CONS_LIST, NODE_TYPES, SCROLL_SPELLS_LIST, WEAPON_BASES, addBuff, addLog, addToInventory, advanceTurn, applyDailyToEnemies, buildPlayerShop, buildTurnOrder, cleanseCurses, d, events, makeCharm, makeCursedItem, maxCastings, onCombatStart, pickEnemy, pickRandom, rd, refreshCastingPools, restoreCastingPools, rollTraits, startSpoils, uniqRanks, uuidv4;
function bind(api) {
  ({ ARMOR_BASES, CHARM_SHOP_KEYS, DIFFICULTIES, LOOT_CONS_LIST, NODE_TYPES, SCROLL_SPELLS_LIST, WEAPON_BASES, addBuff, addLog, addToInventory, advanceTurn, applyDailyToEnemies, buildPlayerShop, buildTurnOrder, cleanseCurses, d, events, makeCharm, makeCursedItem, maxCastings, onCombatStart, pickEnemy, pickRandom, rd, refreshCastingPools, restoreCastingPools, rollTraits, startSpoils, uniqRanks, uuidv4 } = api);
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

function showPathChoices(room) {
  const gs=room.gs; gs.pathVotes={};
  const isBossDepth = gs.depth>0 && gs.depth%10===9 && gs.bossCount<3;
  const isFinalBoss = gs.depth>=29 && gs.bossCount<3; // only trigger if haven't beaten boss 3 yet
  if (isBossDepth || isFinalBoss) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    const msg = isFinalBoss
      ? '💀 The Saurian Ancient stirs. The Final Darkness awaits — there is no retreat.'
      : '💀 A monstrous power bars your path. Face it or fall.';
    addLog(room,msg,'chaos');
  } else {
    gs.phase='path'; gs.bossNode=false; gs.pathChoices=pickThreeNodes();
    addLog(room,'The warband reaches a crossroads. Each warrior votes for their path.','sys');
  }
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
    }
    const diff=DIFFICULTIES[gs.difficulty||0];
    if(diff.id>0) gs.enemies.forEach(e=>{ e.maxHp=Math.round(e.maxHp*diff.hp); e.hp=e.maxHp; e.dmgBonus=(e.dmgBonus||0)+diff.dmg; e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`; });
    applyDailyToEnemies(gs, gs.enemies);
    if(gs._nextCombatHalfHP){ gs._nextCombatHalfHP=false; gs.enemies.forEach(e=>{e.hp=Math.ceil(e.hp/2); e.maxHp=e.hp;}); addLog(room,`🔴 Ritual disruption — enemies enter at half HP!`,'chaos'); }
    gs.inCombat=true; gs.phase='combat'; gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.roundNumber=1;
    onCombatStart(room);
    startSpoils(room);
    // Castings refill at the start of every fight (spells of the same rank share one pool)
    room.players.forEach(p=>{ if(p.char&&p.char.alive&&p.char.knownSpells&&p.char.knownSpells.length) restoreCastingPools(p.char); });
    room.players.filter(p=>p.char&&p.char.alive&&p.char.preparedSpell).forEach(p=>{
      const r1=p.char.knownSpells&&p.char.knownSpells.find(sp=>sp.rank===1);
      if(r1){ if(!p.char.castingPools) refreshCastingPools(p.char); p.char.castingPools['R'+r1.rank]=(p.char.castingPools['R'+r1.rank]||0)+1; addLog(room,`📚 <strong>Prepared Spell!</strong> ${p.name} has ${r1.name} ready — one free cast this combat.`,'spell'); }
    });
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
  if(nodeType==='rest') {
    gs.phase='event';
    room.players.forEach(p=>{ if(p.char) p.char.activeBuffs=(p.char.activeBuffs||[]).filter(b=>b.duration<100); });
    addLog(room,'🔥 A campfire. The warband rests.','heal');
    room.players.forEach(p=>{
      if(!p.char||!p.char.alive) return;
      const amt=Math.ceil(p.char.maxHealth*0.5);
      p.char.health=Math.min(p.char.maxHealth,p.char.health+amt);
      p.char.catchBreathUsed=false; p.char.nimbleUsed=false; p.char.sharedUsed=false;
      p.char.pacedStrikesUsed=false; p.char.rageBoon=false; p.char.metamagicUsed=false; p.char.overcastUsed=false;
      p.char.trickeryUsed=false; p.char.sharpeningStone=false;
      p.char.divineSmiteUsed=false;
      cleanseCurses(p.char,true);
    p.char.massHealUsed=false;
    p.char.resurrectionUsed=false;
      p.char._divineSmiteCount=0;
      // unstoppableUsed intentionally NOT reset per-combat (once per run)
    p.char.rallyingUsed=false;
    p.char.spellsurgeUsed=false;
    p.char.miracleUsed=false;
      p.char.conditions=p.char.conditions.filter(c=>c==='Diseased');
    (p.char.activeBuffs||[]).forEach(b=>{ if(b.defBonus) p.char.defense-=b.defBonus; }); // undo buff defence before clearing
    p.char.activeBuffs=[];
      addLog(room,`${p.name} recovers ${amt} HP.`,'heal');
    });
    restorePower(room,'Rest site');
    room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,'Well Rested',{atkBoon:1,consumeOnAttack:true},99);});
    addLog(room,'Rest complete — warband ready. First attack next combat has 1 boon.','sys');
    return;
  }
  if(nodeType==='merchant') {
    gs.phase='merchant';
    room.players.forEach(p=>{if(p.char&&p.char.alive) p.char.merchantStock=buildPlayerShop(gs.bossCount);});
    addLog(room,'🛒 A merchant appears. Each warrior browses their own wares.','sys');
    return;
  }
  if(nodeType==='loot') {
    gs.phase='loot';
    const coins=25+Math.floor(Math.random()*26); // 25-50 silver
    gs.lootRoom={coins}; gs.lootPicked=[];
    room.players.forEach(p=>{if(p.char&&p.char.alive) p.char.lootOptions=buildLootOptions(gs.bossCount);});
    addLog(room,`📦 A cache! ${coins} coins — each warrior finds their own haul.`,'loot');
    return;
  }
  if(nodeType==='unknown') {
    gs.phase='event';
    const r=d(14);
    if(r<=2){ startNodeContent(room,'combat'); return; }
    else if(r<=4){ startNodeContent(room,'loot'); return; }
    else if(r<=5){ startNodeContent(room,'rest'); return; }
    else if(d(2)===1){ events.startChoiceEvent(room); }
    else { resolveUnknownEvent(room); }
    return;
  }
}

// ─── UNKNOWN ROOM ENCOUNTERS ─────────────────────────────────────────────────
function resolveUnknownEvent(room){
  const gs=room.gs;
  const alive=room.players.filter(p=>p.char&&p.char.alive);
  const roll=d(15); // events 11–14 were unreachable with a d10
  if(roll===15){
    const target=alive[Math.floor(Math.random()*alive.length)];
    const key=pickRandom(['khornateAxe','nurgleMask','shroudFlies','warpAmulet','tzeentchLens']);
    const item=makeCursedItem(key);
    addToInventory(target.char,item.name,item);
    addLog(room,`⛓ <strong>Cursed Reliquary.</strong> Behind a ring of black candles, ${target.name} finds <strong>${item.name}</strong>. Powerful… and cursed: once worn it can't be removed until you rest. (In inventory.)`,'chaos');
    return;
  }
  if(roll===1){
    const heal=rd(1,6)+3;
    alive.forEach(p=>{p.char.health=Math.min(p.char.maxHealth,p.char.health+heal);addBuff(p.char,'Shrine Blessing',{atkBoon:1,consumeOnAttack:true},99);});
    addLog(room,`⛪ <strong>Shrine of Sigmar!</strong> The warband prays — each warrior heals <strong>${heal} HP</strong> and gains 1 boon on their next attack!`,'heal');
    return;
  }
  if(roll===2){
    alive.forEach(p=>{addBuff(p.char,'Rattled',{bane:1},500);});
    addLog(room,`☠ <strong>The Hanging Cage.</strong> A grim warning. All warriors are Rattled — 1 bane on all attacks until they draw first blood.`,'chaos');
    return;
  }
  if(roll===3){
    const pool=['Healing Draught','Incendiary Flask','Sharpening Stone','Antitoxin'];
    alive.forEach(p=>{const item=pool[Math.floor(Math.random()*pool.length)];addToInventory(p.char,item);});
    addLog(room,`⚗ <strong>Alchemist's Cache!</strong> The warband rifles through an abandoned stash — each warrior finds a useful item.`,'loot');
    return;
  }
  if(roll===4){
    const target=alive[Math.floor(Math.random()*alive.length)];
    const attrs=['str','agi','int','wil'];
    const attr=attrs[Math.floor(Math.random()*attrs.length)];
    target.char.attrs[attr]+=1;
    addBuff(target.char,'Warpstone Power',{atkBoon:1},99); // boon lasts next combat only (99 rounds clears at combat end)
    addBuff(target.char,'Corrupted',{bane:1},999);
    addLog(room,`💎 <strong>Warpstone Fragment!</strong> ${target.name} reaches for the glowing stone — +1 ${attr.toUpperCase()} permanently and 1 boon on all attacks next combat. Corrupted condition gained.`,'chaos');
    return;
  }
  if(roll===5){
    const target=alive[Math.floor(Math.random()*alive.length)];
    target.char.weaponAtkBonus++;
    addLog(room,`👻 <strong>The Veteran's Ghost.</strong> A fallen soldier shares one last lesson with ${target.name} — permanent +1 to hit.`,'loot');
    return;
  }
  if(roll===6){
    const coins=rd(1,6)*5;
    alive.forEach(p=>{p.char.gold+=coins;});
    gs._nextCombatFirstEnemyStunned=true;
    addLog(room,`🐀 <strong>Skaven Ambush — Failed!</strong> The ratmen fled. Each warrior claims ${coins} silver from their abandoned traps. The first enemy next combat starts stunned.`,'loot');
    return;
  }
  if(roll===7){
    alive.forEach(p=>{p.char.maxHealth=Math.max(1,p.char.maxHealth-3);p.char.health=Math.min(p.char.health,p.char.maxHealth);addBuff(p.char,'Corrupted',{bane:1},2);});
    const runeTarget=alive[Math.floor(Math.random()*alive.length)];
    runeTarget.char.attrs.int=(runeTarget.char.attrs.int||10)+1;
    addLog(room,`🔮 <strong>Ruinous Altar.</strong> All warriors lose 3 max HP until next rest and gain 1 bane for 2 rounds. But ${runeTarget.name} gains <strong>+1 INT</strong> permanently from dark knowledge.`,'chaos');
    return;
  }
  if(roll===8){
    const heal=rd(2,6);
    alive.forEach(p=>{p.char.health=Math.min(p.char.maxHealth,p.char.health+heal);});
    const lucky=alive[Math.floor(Math.random()*alive.length)];
    addToInventory(lucky.char,'Greater Healing Draught');
    addLog(room,`🏥 <strong>Field Hospital Ruins!</strong> All warriors heal <strong>${heal} HP</strong>. ${lucky.name} finds a Greater Healing Draught.`,'heal');
    return;
  }
  if(roll===9){
    alive.forEach(p=>{addBuff(p.char,'Shaken',{bane:1},1);if(p.char.spellcaster){p.char.power+=1;if(p.char.castingPools){Object.keys(p.char.castingPools).forEach(k=>{p.char.castingPools[k]=Math.min(p.char.castingPools[k]+1,maxCastings(p.char.power,0));});}addLog(room,`🌊 ${p.name} gains +1 Power from the Well.`,'loot');}else{p.char.gold+=5;addLog(room,`🌊 ${p.name} claims 5 silver from the depths.`,'loot');}});
    addLog(room,`🌊 <strong>The Whispering Well.</strong> All spellcasters gain +1 Power. Non-spellcasters gain 5 gold. All are Shaken — 1 bane on next attack.`,'loot');
    return;
  }
  if(roll===11){ events.startChoiceEvent(room,'chaosRitual'); return; }
  if(roll===12){
    // Injured Survivor
    const cost=15;
    addLog(room,`🧑 <strong>Injured Survivor!</strong> A wounded soldier. Spend ${cost} silver to heal all 1d6 and gain +1 boon next combat.`,'sys');
    const canAfford=alive.every(p=>p.char.gold>=cost);
    if(canAfford){
      alive.forEach(p=>{p.char.gold-=cost; const h=rd(1,6); p.char.health=Math.min(p.char.maxHealth,p.char.health+h); addBuff(p.char,'Aided',{atkBoon:1,consumeOnAttack:true},99); addLog(room,`${p.name} spends ${cost}s — +${h} HP, 1 boon next attack.`,'heal');});
    } else {
      addLog(room,`The warband cannot afford to help. The soldier fades.`,'sys');
    }
    return;
  }
  if(roll===13){
    // Armourers Workshop
    const wp=alive[Math.floor(Math.random()*alive.length)];
    wp.char.weaponDmgBonus=(wp.char.weaponDmgBonus||0)+1;
    addLog(room,`🔨 <strong>Armourer's Workshop!</strong> ${wp.name} sharpens their weapon on the abandoned grinding wheel — <strong>+1 permanent weapon damage</strong>.`,'loot');
    return;
  }
  if(roll===14){
    // The Black Market
    const bm=Math.ceil(Math.random()*3);
    if(bm===1){
      if(alive[0]&&alive[0].char.inventory.length){
        const item=alive[0].char.inventory[Math.floor(Math.random()*alive[0].char.inventory.length)];
        const val=(item.sellCost||3)*3;
        alive[0].char.gold+=val; alive[0].char.inventory=alive[0].char.inventory.filter(i=>i!==item);
        addLog(room,`🕵 <strong>Black Market!</strong> Sold ${item.name} for triple value — ${val} silver.`,'loot');
      } else { alive.forEach(p=>{p.char.gold+=15;}); addLog(room,`🕵 <strong>Black Market!</strong> Nothing to sell — mysterious benefactor pays 15 silver each.`,'loot'); }
    } else if(bm===2){
      const sc=SCROLL_SPELLS_LIST[Math.floor(Math.random()*SCROLL_SPELLS_LIST.length)];
      const buyer=alive.find(p=>p.char.gold>=15);
      if(buyer){ buyer.char.gold-=15; const sn=`Scroll: ${sc.name}`; addToInventory(buyer.char,sn); buyer.char.scrollSpells[sn]=sc;
        addLog(room,`🕵 <strong>Black Market!</strong> ${buyer.name} buys a ${sn} for 15 silver.`,'loot'); }
      else addLog(room,`🕵 <strong>Black Market!</strong> A scroll-seller eyes your empty purses and moves on.`,'sys');
    } else {
      alive.forEach(p=>{p.char.gold+=30;p.char.maxHealth=Math.max(1,p.char.maxHealth-5);p.char.health=Math.min(p.char.health,p.char.maxHealth);});
      addLog(room,`🕵 <strong>Black Market!</strong> A shadowy deal — each warrior gains 30 silver but loses 5 max HP permanently.`,'chaos');
    }
    return;
  }
  if(roll===10){
    const coins=rd(2,6)*5;
    alive.forEach(p=>{p.char.gold+=coins;addBuff(p.char,'Negotiated Edge',{atkBoon:1},2);});
    addLog(room,`⚔ <strong>Mercenary Standoff.</strong> You negotiate passage for ${coins} silver — and they share something useful. All warriors gain 1 boon for 2 rounds.`,'loot');
    return;
  }
}

// ─── LOOT ROOM ───────────────────────────────────────────────────────────────
function buildLootOptions(bossCount=0) {
  const useScroll=d(6)>=4;
  const consumable=useScroll?'Spell Scroll':LOOT_CONS_LIST[Math.floor(Math.random()*LOOT_CONS_LIST.length)];
  const scrollSpell=useScroll?SCROLL_SPELLS_LIST[Math.floor(Math.random()*SCROLL_SPELLS_LIST.length)]:null;
  const charm=Math.random()<0.35?makeCharm(pickRandom(CHARM_SHOP_KEYS)):null;
  return {consumable,scrollSpell,weapon:genSpecialWpn(bossCount),armor:genSpecialArmor(bossCount),charm};
}
function genSpecialWpn(bossCount=0){
  const specials=WEAPON_BASES.filter(b=>b.special);
  const pool=bossCount===0?specials.filter(b=>['1d6','1d8','2d4'].includes(b.dice)):specials;
  const base=pool[Math.floor(Math.random()*pool.length)];
  const bonus=bossCount===0?d(3):bossCount===1?d(2)+2:d(2)+4;
  return rollTraits({id:'w'+uuidv4(),name:base.name,dice:base.dice,stat:base.stat,bonus,dmgType:base.dmgType,special:base.special,cost:0,sellCost:3,bought:false,type:'weapon',desc:`${base.dice}+${bonus} · ${base.stat.toUpperCase()} · ${base.dmgType} — ${base.special.desc}`},'weapon');
}
function genSpecialArmor(bossCount=0){
  const specials=ARMOR_BASES.filter(ab=>ab.special);
  const base=specials[Math.floor(Math.random()*specials.length)];
  const bonus=bossCount===0?d(3):bossCount===1?d(2)+1:d(3)+2;
  const totalDef=base.def+bonus;
  return rollTraits({id:'a'+uuidv4(),name:base.name,defBonus:totalDef,special:base.special,cost:0,sellCost:3,bought:false,type:'armor',desc:`+${totalDef} Defense — ${base.special.desc}`},'armor');
}

module.exports = { bind, pickThreeNodes, restorePower, showPathChoices, resolvePath, startNodeContent, enterNode, _runNodeContent, resolveUnknownEvent, buildLootOptions, genSpecialWpn, genSpecialArmor };
