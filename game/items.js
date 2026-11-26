'use strict';
// Gear generation, the merchant, equipping and using items, enemy drops.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let ARMOR_BASES, CHARM_SHOP_KEYS, ENEMY_DROPS, LEGENDARY_ITEMS, SCROLL_SPELLS_SHOP, SHOP_CONSUMABLES, WEAPON_BASES, addBuff, addDebuff, addLog, applyCharm, broadcastState, charmKey, checkDeath, cleanseCurses, d, getTargetEnemy, isCursed, makeCharm, makeCursedItem, maxCastings, modVal, pickRandom, rd, resolveEnemyDeath, rollTraits, sendTo, uniqRanks, uuidv4;
function bind(api) {
  ({ ARMOR_BASES, CHARM_SHOP_KEYS, ENEMY_DROPS, LEGENDARY_ITEMS, SCROLL_SPELLS_SHOP, SHOP_CONSUMABLES, WEAPON_BASES, addBuff, addDebuff, addLog, applyCharm, broadcastState, charmKey, checkDeath, cleanseCurses, d, getTargetEnemy, isCursed, makeCharm, makeCursedItem, maxCastings, modVal, pickRandom, rd, resolveEnemyDeath, rollTraits, sendTo, uniqRanks, uuidv4 } = api);
}
// ─── MERCHANT & ITEMS ───────────────────────────────────────────────────────
function genLegendaryItem(bossIndex) {
  const key = bossIndex===0?'boss1':bossIndex===1?'boss2':'boss3';
  const pool = LEGENDARY_ITEMS[key];
  const tmpl = pool[Math.floor(Math.random()*pool.length)];
  const item = JSON.parse(JSON.stringify(tmpl));
  item.id = (item.type==='weapon'?'lw':'la') + uuidv4();
  item.sellCost = 5; // legendaries can be sold for more
  item.cost = 0; // not purchasable
  item.bought = false;
  return item;
}

function genWpn(bossCount=0){
  const light=WEAPON_BASES.filter(b=>['1d6','1d8','2d4'].includes(b.dice)), heavy=WEAPON_BASES.filter(b=>!['1d6','1d8','2d4'].includes(b.dice));
  const pool=bossCount>0&&d(5)===1?heavy:light;
  const b=pool[Math.floor(Math.random()*pool.length)], bonus=d(6);
  const specDesc2=b.special?` — ${b.special.desc}`:''; return rollTraits({id:'w'+uuidv4(),name:b.name,dice:b.dice,stat:b.stat,bonus,dmgType:b.dmgType,special:b.special||null,cost:Math.max(5,(heavy.includes(b)?20:15)+bonus*8+(b.special?10:0)),sellCost:3,bought:false,type:'weapon',desc:`${b.dice}+${bonus} · ${b.stat.toUpperCase()} · ${b.dmgType}${specDesc2}`},'weapon');
}
function genArmor(bossCount=0){
  const basePool=ARMOR_BASES.filter(ab=>!ab.special);
  const specialPool=ARMOR_BASES.filter(ab=>ab.special);
  let pool=basePool;
  if(bossCount>=1&&d(4)===1) pool=[...basePool,...specialPool]; // 25% chance of special post-boss-1
  if(bossCount>=2&&d(3)===1) pool=[...basePool,...specialPool,...specialPool]; // more common post-boss-2
  const b=pool[Math.floor(Math.random()*pool.length)];
  let bonus;
  if(bossCount===0){ bonus=d(4); if(b.def+bonus>6) bonus=Math.max(1,6-b.def); }
  else { bonus=d(5)===1?d(2)+4:d(4); }
  const specDesc=b.special?` — ${b.special.desc}`:''; return rollTraits({id:'a'+uuidv4(),name:b.name,defBonus:b.def+bonus,special:b.special||null,cost:Math.max(5,20+bonus*10+(b.special?15:0)),sellCost:3,bought:false,type:'armor',desc:`+${b.def+bonus} Defense${specDesc}`},'armor');
}
function genShopScroll(){
  const sp=SCROLL_SPELLS_SHOP[Math.floor(Math.random()*SCROLL_SPELLS_SHOP.length)];
  return{id:'sc'+uuidv4(),name:`Scroll: ${sp.name}`,spell:sp,cost:35,sellCost:3,bought:false,type:'scroll',desc:sp.desc};
}
function buildPlayerShop(bossCount=0){
  const hd1={id:'hd1'+uuidv4(),name:'Healing Draught',cost:10,sellCost:3,desc:'Heal 1d6 + your level HP',bought:false,type:'consumable'};
  const hd2={id:'hd2'+uuidv4(),name:'Healing Draught',cost:10,sellCost:3,desc:'Heal 1d6 + your level HP',bought:false,type:'consumable'};
  const otherPool=SHOP_CONSUMABLES.filter(c=>c.name!=='Healing Draught').sort(()=>Math.random()-0.5);
  const other=otherPool[0]?{id:'c'+uuidv4(),name:otherPool[0].name,cost:otherPool[0].cost,sellCost:3,desc:otherPool[0].desc,bought:false,type:'consumable'}:hd1;
  return{
    weaponEnhance:{id:'we'+uuidv4(),name:'Weapon Enhancement',desc:'+1 dmg AND +1 to hit on equipped weapon (cap +6)',cost:30,bought:false,type:'enhance'},
    statBoost:    {id:'sb'+uuidv4(),name:'+1 Primary Stat',desc:'Increase highest attribute by 1',cost:35,bought:false,type:'statboost'},
    weapon1:genWpn(bossCount),weapon2:genWpn(bossCount),armor:genArmor(bossCount),
    charm:Object.assign(makeCharm(pickRandom(CHARM_SHOP_KEYS)),{cost:28}),
    consumables:[hd1,hd2,other],scroll:genShopScroll(),
  };
}

function addToInventory(char,name,itemObj=null){
  if(itemObj&&(itemObj.type==='weapon'||itemObj.type==='armor'||itemObj.type==='charm')){
    char.inventory.push({name:itemObj.name,qty:1,type:itemObj.type,itemObj,sellCost:3});
  } else {
    const ex=char.inventory.find(i=>i.name===name&&!i.itemObj);
    if(ex) ex.qty++;
    else char.inventory.push({name,qty:1,sellCost:3});
  }
}

function applyLegendaryArmourPassive(char, key, equip){
  if(key==='extinctionAegis'){ char._legExtinctionAegis=equip; }
  if(key==='ancientScale'){ char._legAncientScale=equip; if(!equip){ char._legAncientScaleUsed=false; } }
  if(key==='shroudUndeath'){ char._legShroud=equip; if(!equip){ char._legShroudUsed=false; } }
  if(key==='bloodDrinker'){ char._legBloodDrinker=equip; }
  if(key==='ratkingCrown'){ char._legRatking=equip; }
  if(key==='berserkPlate'){ char._legBerserk=equip; if(!equip){ char._legBerserkUsed=false; } }
}
function applyWpnSpecial(char, special, equip){
  if(!special) return;
  const v=equip;
  if(special.key==='bladeguard'){
    if(v){ char._wpnBladeguard=true; if(!char._wpnBladeguardDef){ char._wpnBladeguardDef=true; char.defense++; } }
    else { char._wpnBladeguard=false; if(char._wpnBladeguardDef){ char._wpnBladeguardDef=false; char.defense=Math.max(char.baseAgiDef||0,char.defense-1); } }
  }
  if(special.key==='greatBlade'){
    if(v&&!char._wpnGreatBladeDef){ char._wpnGreatBladeDef=true; char.defense-=1; }
    if(!v&&char._wpnGreatBladeDef){ char._wpnGreatBladeDef=false; char.defense+=1; }
  }
  if(special.key==='longbow')      char._wpnLongbow=v;
  if(special.key==='channelFaith') char._wpnChannelFaith=v;
  if(special.key==='holySmoke')    char._wpnHolySmoke=v;
  if(special.key==='blessedStrike')char._wpnBlessedStrike=v;
  if(special.key==='arcaneFocus')  char._wpnArcaneFocus=v;
  if(special.key==='spellblade')   { char._wpnSpellblade=v; if(!v) char._wpnSpellbladeUsed=false; }
  if(special.key==='smiteTheFallen'){ char._wpnSmite=v; if(!v) char._wpnSmiteUsed=false; }
  if(special.key==='sunder')       char._wpnSunder=v;
  if(special.key==='openingShot')  { char._wpnOpeningShot=v; if(!v){ char._wpnOpeningShotFired=false; char._wpnReloading=false; } }
  if(special.key==='marksmanship') char._wpnMarksmanship=v;
  if(special.key==='cleave')       char._wpnCleave=v;
  if(special.key==='reach')        char._wpnReach=v;
  if(special.key==='riposte')      { char._wpnRiposte=v; if(!v) char._wpnRiposteReady=false; }
  if(special.key==='silverEdge')   char._wpnSilverEdge=v;
  if(special.key==='unstableCharge')char._wpnUnstable=v;
  if(special.key==='runeStrike')   { char._wpnRuneStrike=v; if(!v) char._wpnRuneStrikeUsed=false; }
  if(special.key==='venomFang')    { char._legVenomFang=v; }
  if(special.key==='beastlordMaul'){ char._legBeastlordMaul=v; if(!v) char._legBeastlordMaulUsed=false; }
  if(special.key==='varghulfTalon'){ char._legVarghulfTalon=v; }
  if(special.key==='chainbreaker') { char._legChainbreaker=v; }
  if(special.key==='sunstoneBlade'){ char._legSunstoneBlade=v; }
  if(special.key==='primordialStaff'){ char._legPrimordialStaff=v; }
}

function equipItem(char, inventoryIndex) {
  const entry=char.inventory[inventoryIndex]; if(!entry||!entry.itemObj) return false;
  const item=entry.itemObj;
  // Cursed gear locks its slot until you rest or use a Sigmar's Token.
  const slot=item.type==='weapon'?'weapon':item.type==='armor'?'armor':item.type==='charm'?'charm':null;
  if(slot&&char._curseLock&&char._curseLock[slot]){
    const cur=slot==='weapon'?char.equippedWeapon:slot==='armor'?char.equippedArmor:char.equippedCharm;
    return `can't remove the cursed ${cur?cur.name:'item'} — rest at a campfire or use a Sigmar's Token first`;
  }
  if(slot&&isCursed(item)){ char._curseLock=char._curseLock||{}; char._curseLock[slot]=true; }
  if(item.type==='charm'){
    if(char.equippedCharm){
      applyCharm(char, char.equippedCharm, false);
      char.inventory.push({name:char.equippedCharm.name,qty:1,type:'charm',itemObj:char.equippedCharm,sellCost:3});
    }
    char.equippedCharm=item; char.inventory.splice(inventoryIndex,1);
    applyCharm(char, item, true);
    return `Equipped ${item.name}${item.cursed?' (cursed!)':''} — ${item.desc}`;
  }
  if(item.type==='weapon'){
    if(char.equippedWeapon){
      applyWpnSpecial(char, char.equippedWeapon.special, false);
      char.inventory.push({name:char.equippedWeapon.name,qty:1,type:'weapon',itemObj:char.equippedWeapon,sellCost:3});
    }
    char.equippedWeapon=item; char.inventory.splice(inventoryIndex,1);
    applyWpnSpecial(char, item.special, true);
    const specNote=item.special?` [${item.special.desc.split('.')[0]}]`:'';
    return `Equipped ${item.name} (${item.dice}+${item.bonus})${specNote}`;
  }
  if(item.type==='armor'){
    const oldBonus=char.equippedArmor?char.equippedArmor.defBonus:0;
    if(char.equippedArmor){
      if(char.equippedArmor.legendary && char.equippedArmor.special) applyLegendaryArmourPassive(char, char.equippedArmor.special.key, false);
      const olds=char.equippedArmor.special;
      if(olds){
        if(olds.key==='fireImmune')          char._armorFireImmune=false;
        if(olds.key==='dwarfForged')         char._armorFlatDR=false;
        if(olds.key==='lastTarget')          char._armorLastTarget=false;
        if(olds.key==='chaosWard')           char._armorChaosWard=false;
        if(olds.key==='packScorn')           char._armorPackScorn=false;
        if(olds.key==='spellbound')          char._armorSpellbound=false;
        if(olds.key==='bloodscent')          char._armorBloodscent=false;
        if(olds.key==='righteousSuffering')  char._armorRighteous=false;
        if(olds.key==='shieldBlock')         char._armorShieldBlock=false;
        if(olds.key==='witchCoat')           char._armorWitchCoat=false;
      }
      char.inventory.push({name:char.equippedArmor.name,qty:1,type:'armor',itemObj:char.equippedArmor,sellCost:3});
    }
    char.equippedArmor=item;
    char.defense+= (item.defBonus||0) - oldBonus; // swap armour only; keep talent/buff/debuff defence changes
    if(item.legendary && item.special) applyLegendaryArmourPassive(char, item.special.key, true);
    if(item.special){
      const sp=item.special.key;
      if(sp==='fireImmune')         char._armorFireImmune=true;
      if(sp==='dwarfForged')        char._armorFlatDR=true;
      if(sp==='lastTarget')         char._armorLastTarget=true;
      if(sp==='chaosWard')          char._armorChaosWard=true;
      if(sp==='packScorn')          char._armorPackScorn=true;
      if(sp==='spellbound')         char._armorSpellbound=true;
      if(sp==='bloodscent')         char._armorBloodscent=true;
      if(sp==='righteousSuffering') char._armorRighteous=true;
      if(sp==='shieldBlock')        char._armorShieldBlock=true;
      if(sp==='witchCoat')          char._armorWitchCoat=true;
    }
    char.inventory.splice(inventoryIndex,1);
    const specNote=item.special?` [${item.special.desc}]`:'';
    return `Equipped ${item.name} (+${item.defBonus} Def, now ${char.defense})${specNote}`;
  }
  return false;
}

function handleBuy(room,player,itemId){
  const char=player.char, stock=char.merchantStock;
  if(!stock){sendTo(player.ws,{type:'ERROR',payload:{msg:'No shop open.'}});return;}
  const all=[stock.weaponEnhance,stock.statBoost,stock.weapon1,stock.weapon2,stock.armor,stock.charm,stock.scroll,...stock.consumables].filter(Boolean);
  const item=all.find(i=>i.id===itemId);
  if(!item||item.bought){sendTo(player.ws,{type:'ERROR',payload:{msg:'Already purchased.'}});return;}
  if(char.gold<item.cost){sendTo(player.ws,{type:'ERROR',payload:{msg:`Need ${item.cost} ss, have ${char.gold}.`}});return;}
  char.gold-=item.cost; item.bought=true;
  if(item.type==='enhance'){
    if(char.equippedWeapon){
      const w=char.equippedWeapon;
      const currentBonus=w.bonus||0;
      if(currentBonus>=6){
        char.weaponAtkBonus++;
        addLog(room,`${player.name}: Weapon Enhancement — ${w.name} damage capped at +6. +1 to hit granted instead.`,'loot');
      } else {
        w.bonus=currentBonus+1;
        char.weaponAtkBonus++;
        addLog(room,`${player.name}: Weapon Enhancement — ${w.name} now ${w.dice}+${w.bonus} dmg, +1 to hit (total +${char.weaponAtkBonus}).`,'loot');
      }
    } else {
      char.weaponDmgBonus++;
      char.weaponAtkBonus++;
      addLog(room,`${player.name}: Weapon Enhancement — +1 dmg and +1 to hit stored (equip a weapon to apply).`,'loot');
    }
  }
  else if(item.type==='statboost'){
    char.pendingStatBoost=true;
    sendTo(player.ws,{type:'STAT_CHOICE',payload:{attrs:char.attrs}});
    addLog(room,`${player.name} visits the apothecary — choose an attribute to increase.`,'loot');
  }
  else if(item.type==='weapon'){addToInventory(char,item.name,item);addLog(room,`${player.name} buys ${item.name} (${item.dice}+${item.bonus}) — in inventory.`,'loot');}
  else if(item.type==='armor'){addToInventory(char,item.name,item);addLog(room,`${player.name} buys ${item.name} (+${item.defBonus} Def) — in inventory.`,'loot');}
  else if(item.type==='charm'){addToInventory(char,item.name,item);addLog(room,`${player.name} buys ${item.name} — in inventory.`,'loot');}
  else if(item.type==='scroll'){addToInventory(char,item.name);char.scrollSpells[item.name]=item.spell;addLog(room,`${player.name} buys ${item.name}.`,'loot');}
  else if(item.type==='consumable'){addToInventory(char,item.name);addLog(room,`${player.name} buys ${item.name}.`,'loot');}
}

function handleSell(room,player,invIndex){
  const char=player.char;
  if(invIndex<0||invIndex>=char.inventory.length) return;
  const item=char.inventory[invIndex];
  if(item.itemObj){
    if(char.equippedWeapon&&item.itemObj.id===char.equippedWeapon.id){sendTo(player.ws,{type:'ERROR',payload:{msg:'Unequip first.'}});return;}
    if(char.equippedArmor&&item.itemObj.id===char.equippedArmor.id){sendTo(player.ws,{type:'ERROR',payload:{msg:'Unequip first.'}});return;}
    if(char.equippedCharm&&item.itemObj.id===char.equippedCharm.id){sendTo(player.ws,{type:'ERROR',payload:{msg:'Unequip first.'}});return;}
  }
  char.gold+=1;
  char.inventory[invIndex].qty--;
  if(char.inventory[invIndex].qty<=0) char.inventory.splice(invIndex,1);
  addLog(room,`${player.name} sells ${item.name} for 1 silver.`,'loot');
}

// ─── ITEM USE ─────────────────────────────────────────────────────────────────
function useItemLogic(room,player,itemName,inCombat=false){
  const char=player.char;
  const idx=char.inventory.findIndex(i=>i.name===itemName);
  if(idx===-1) return false;
  let consumed=true;
  const _morr=charmKey(char)==='morrFeather'?2:0; // Morr's Raven Feather: draughts heal 2 less
  if(itemName==='Healing Draught'){const h=Math.max(1,rd(1,6)+(char.level||1)-_morr);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} drinks Healing Draught — +<strong>${h}</strong> HP.`,'heal');}
  else if(itemName==='Greater Healing Draught'){const h=Math.max(1,rd(2,6)+2*(char.level||1)-_morr);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} drinks Greater Healing — +<strong>${h}</strong> HP.`,'heal');}
  else if(itemName==='Flask of Oil'||itemName==='Incendiary Flask'){const _te=getTargetEnemy(room.gs);if(inCombat&&_te){let dmg=rd(2,6);if(char._armorFireImmune){dmg+=rd(1,6);}// Dragonscale bonus
_te._burnedThisRound=true;_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} throws Flask of Oil — <strong>${dmg}</strong> fire dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}else{consumed=false;}}
  else if(itemName==='Fire Jar'||itemName==='Daemon Fire'){const _te=getTargetEnemy(room.gs);if(inCombat&&_te){if(_te.immuneFire){addLog(room,`🔥 ${_te.name} is immune to fire!`,'spell');}else{const dmg=rd(3,6);_te._burnedThisRound=true;_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} smashes Fire Jar — <strong>${dmg}</strong> fire dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}}else{consumed=false;}}
  else if(itemName==='Lucky Pendant'){char.luckyPendant=true;addLog(room,`${player.name} activates Lucky Pendant — next attack is a CRIT!`,'loot');}
  else if(itemName==='Sharpening Stone'){char.sharpeningStone=true;addLog(room,`${player.name} uses Sharpening Stone — +1d6 dmg this combat!`,'loot');}
  else if(itemName==='Antitoxin'){char._poisonedStacks=0; if(char.activeBuffs) char.activeBuffs=char.activeBuffs.filter(b=>!b.bane||b.name!=='Plagued'); if(char.conditions) char.conditions=char.conditions.filter(c=>c!=='Poisoned'); addLog(room,`🧪 <strong>Antitoxin!</strong> ${player.name} clears all poison!`,'heal');}
  else if(itemName==='Smoke Bomb'){if(inCombat){(room.gs.enemies||[]).filter(e=>e&&e.hp>0).forEach(e=>{if(!e.activeDebuffs)e.activeDebuffs=[];e.activeDebuffs.push({name:'Smoked',bane:2,duration:1});}); addLog(room,`💨 <strong>Smoke Bomb!</strong> All enemies have 2 banes next round!`,'spell');}else{consumed=false;}}
  else if(itemName==="Sigmar's Token"){const th=rd(1,6)+3;char.health=Math.min(char.maxHealth,char.health+th);if(char.activeBuffs&&char.activeBuffs.length)char.activeBuffs=char.activeBuffs.filter(b=>b.duration>=500||!b.bane);if(char.conditions&&char.conditions.length)char.conditions.pop();cleanseCurses(char,false);addLog(room,`✝ <strong>Sigmar's Token!</strong> +${th} HP, one debuff removed and any curse loosened — cursed gear can be taken off.`,'heal');}
  else if(itemName==='Troll Blood'){
    if(!inCombat){consumed=false;addLog(room,`${player.name}: Troll Blood only works in the heat of battle.`,'sys');}
    else{addBuff(char,'Troll Blood',{regenHp:3,defBonus:-2},3);char.defense-=2;addLog(room,`🧪 <strong>Troll Blood!</strong> ${player.name}'s wounds start knitting (+3 HP a round for 3 rounds) — but their skin goes soft (−2 Defence).`,'heal');}
  }
  else if(itemName==='Dwarf Ale'){const h=Math.max(1,rd(2,6)-_morr);char.health=Math.min(char.maxHealth,char.health+h);addBuff(char,'Tipsy',{bane:1,consumeOnAttack:true},3);addLog(room,`🍺 <strong>Dwarf Ale!</strong> ${player.name} heals <strong>${h}</strong> — and their next swing will be a bit wobbly (1 bane).`,'heal');}
  else if(itemName==='Warpstone Dust'){
    if(!inCombat){consumed=false;addLog(room,`${player.name}: save the Warpstone Dust for a fight.`,'sys');}
    else{addBuff(char,'Warpstone Dust',{dmgBonus:2},10);char.corruption=(char.corruption||0)+1;addLog(room,`☢ <strong>Warpstone Dust!</strong> ${player.name} snorts the glowing powder — +2 damage this fight, and 1 Corruption.`,'chaos');}
  }
  else if(itemName==='Black Lotus Oil'){char._lotusHits=3;addLog(room,`🪷 <strong>Black Lotus Oil!</strong> ${player.name} coats their blade — the next 3 hits each add 3 poison.`,'chaos');}
  else if(itemName==='Holy Water'){
    const _te=getTargetEnemy(room.gs);
    if(!inCombat||!_te){consumed=false;}
    else{
      const holy=_te.undead||_te.chaos||(_te.tags&&(_te.tags.includes('undead')||_te.tags.includes('chaos')));
      if(holy){const dmg=rd(3,6);_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`💧 <strong>Holy Water!</strong> ${_te.name} hisses and smokes — <strong class="num-dmg">−${dmg}</strong> → ${_te.hp}/${_te.maxHp} HP`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);}}
      else addLog(room,`💧 The Holy Water splashes harmlessly off ${_te.name}.`,'sys');
    }
  }
  else if(itemName==='Hellfire Bomb'){
    if(!inCombat){consumed=false;}
    else{
      const targets=(room.gs.enemies||[]).filter(e=>e&&e.hp>0);
      targets.forEach(e=>{const dmg=rd(4,6);e._burnedThisRound=true;e.hp=Math.max(0,e.hp-dmg);addLog(room,`💣 Hellfire engulfs ${e.name} — <strong class="num-dmg">−${dmg}</strong> → ${e.hp}/${e.maxHp} HP`,'spell');});
      const back=rd(1,6);char.health=Math.max(0,char.health-back);addLog(room,`💣 <strong>Hellfire Bomb!</strong> ${player.name} is caught in the blast — <strong class="num-dmg">−${back}</strong>.`,'dmg');
      targets.filter(e=>e.hp<=0).forEach(e=>resolveEnemyDeath(room,e));
      checkDeath(room,player);
    }
  }
  else if(itemName==='Fly Agaric'){
    if(!inCombat){consumed=false;}
    else{char._freeCastArmed=true;char._agaricBoost=true;const fa=rd(1,4);char.health=Math.max(1,char.health-fa);addLog(room,`🍄 <strong>Fly Agaric!</strong> ${player.name}'s vision swims (−${fa} HP) — their next spell is free and deals +1d6.`,'spell');}
  }
  else if(itemName.startsWith('Scroll:')){
    const spell=char.scrollSpells[itemName];
    if(!spell){addLog(room,`${player.name}: scroll crumbles.`,'sys');return false;}
    if(spell.type==='heal'){const[n,sh]=spell.dmgDice.split('d').map(Number);const roll=rd(n,sh);const wilBonus=Math.max(0,modVal(char.attrs.wil));const faithBonus=char._wpnChannelFaith?wilBonus:0;const amt=roll+4+faithBonus;char.health=Math.min(char.maxHealth,char.health+amt);addLog(room,`${player.name} reads ${itemName} — ${n}d${sh}(${roll})+4${faithBonus?'+'+faithBonus+' faith':''} = +<strong>${amt}</strong> HP.`,'heal');}
    else if(inCombat){
      const _te=getTargetEnemy(room.gs);
      const gs=room.gs;
      const alive2=gs.enemies&&gs.enemies.filter(e=>e&&e.hp>0)||(_te?[_te]:[]);
      const[sn,ss]=spell.dmgDice.split('d').map(Number);
      if(spell.cleanse){
        const healTarget=player; // Shallya's Touch via scroll always heals self (USE_ITEM path)
        const ht=healTarget&&healTarget.char?healTarget.char:char;
        const htName=healTarget&&healTarget.name?healTarget.name:player.name;
        ht.activeBuffs=(ht.activeBuffs||[]).filter(b=>!(b.bane||b.skipTurn||b.dmgPenalty||b.dotDmg)); // remove harmful effects only
        ht.conditions=[];
        const healAmt=rd(3,6)+Math.max(0,modVal(char.attrs.wil))+(char.divineVessel?rd(1,6):0);
        ht.health=Math.min(ht.maxHealth,ht.health+healAmt);
        addLog(room,`${player.name} reads <strong>Shallya's Touch</strong> — all debuffs cleansed from ${htName} and healed <strong>${healAmt} HP</strong>!`,'heal');
        return true;
      }
      if(spell.sigmarsShield){ room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{ addBuff(p.char,"Sigmar's Shield",{defBonus:2},2); p.char.defense+=2; }); addLog(room,`🛡 <strong>Sigmar's Shield!</strong> All allies +2 Defence for 2 rounds!`,'spell'); return; }
      if(spell.plagueWind){ (gs.enemies||[]).filter(e=>e&&e.hp>0).forEach(e=>{ e._poisonStacks=(e._poisonStacks||0)+3; addLog(room,`☠ Plague Wind poisons ${e.name} — 3 stacks!`,'spell'); }); addLog(room,`☠ <strong>Plague Wind!</strong> All enemies gain 3 poison stacks!`,'spell'); return; }
      if(spell.battleHymn){ room.players.filter(p=>p.char&&p.char.alive).forEach(p=>addBuff(p.char,'Battle Hymn',{atkBonus:2},2)); addLog(room,`📣 <strong>Battle Hymn!</strong> All allies +2 ATK for 2 rounds!`,'spell'); return; }
      if(spell.veilShadows){
        alive2.forEach(e=>{ addDebuff(e,'Veiled',{bane:2},1); });
        addLog(room,`${player.name} reads <strong>Veil of Shadows</strong> — all enemies have 2 banes on attack rolls this round!`,'spell');
        broadcastState(room.code);
        return true;
      }
      if(spell.wallFaith){
        room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{ addBuff(p.char,'Wall of Faith',{defBonus:3,atkBoon:1},3); p.char.defense+=3; });
        addLog(room,`${player.name} reads <strong>Wall of Faith</strong> — all allies gain +3 Defense and 1 boon for 3 rounds!`,'spell');
        return true;
      }
      if(spell.bonePrison&&_te&&_te.hp>0){
        addDebuff(_te,'Bone Prison',{skipTurn:true},1);
        addLog(room,`${player.name} reads <strong>Bone Prison</strong> — ${_te.name} is STUNNED and loses their next turn!`,'spell');
        return true;
      }
      if(spell.earthshatter&&_te&&_te.hp>0){
        let dmg=rd(sn,ss)+(char.attrs&&char.attrs.int?Math.max(0,modVal(char.attrs.int)):0);
        if(_te.ac>=16) dmg=Math.floor(dmg*1.5);
        _te.hp=Math.max(0,_te.hp-dmg);
        addDebuff(_te,'Prone',{bane:1},2);
        addLog(room,`${player.name} reads <strong>Earthshatter</strong> — <strong>${dmg}</strong> dmg! ${_te.name} is Prone (1 bane 2 rounds)!`,'spell');
        if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}
        return true;
      }
      if(_te){
        const targets=spell.allTargets?alive2:[_te];
        targets.forEach(_t=>{
          if(!_t||_t.hp<=0) return;
          let dmg=rd(sn,ss)+(char.attrs&&char.attrs.int?Math.max(0,modVal(char.attrs.int)):0);
          if(spell.holyBonus&&(_t.undead||_t.chaos||(_t.tags&&(_t.tags.includes('undead')||_t.tags.includes('chaos'))))) dmg=Math.floor(dmg*(spell.daemonBonus?2:1.5)); // daemonBonus=×2, holyBonus alone=×1.5
          _t.hp=Math.max(0,_t.hp-dmg);
          addLog(room,`${player.name} reads <strong>${spell.name}</strong> — <strong>${dmg}</strong> dmg to ${_t.name}!`,'spell');
          if(_t.hp<=0){
            resolveEnemyDeath(room,_t);
            if(char.surge){ if(char.castingPools&&char.knownSpells){char.knownSpells.filter(sp=>sp.rank<=1).forEach(sp=>{char.castingPools['R'+sp.rank]=maxCastings(char.power,sp.rank);});} addLog(room,`⚡ <strong>Surge!</strong> ${player.name} regains all rank-0 and rank-1 castings!`,'spell'); }
            if(char.lifeDrain){ const ld=rd(1,4); char.health=Math.min(char.maxHealth,char.health+ld); addLog(room,`💀 <strong>Life Drain!</strong> ${player.name} absorbs life — +${ld} HP!`,'heal'); }
            if(char.undyingHunger&&_t&&_t._dotKilled){ if(char.castingPools&&char.knownSpells){uniqRanks(char.knownSpells).forEach(sp=>{if((char.castingPools['R'+sp.rank]||0)<maxCastings(char.power,sp.rank)){char.castingPools['R'+sp.rank]=(char.castingPools['R'+sp.rank]||0)+1;}});} const uhH=rd(1,6)+Math.max(0,modVal(char.attrs.int)); char.health=Math.min(char.maxHealth,char.health+uhH); addLog(room,`💀 <strong>Undying Hunger!</strong> ${player.name} feasts on the DoT kill — +1 all castings, +<strong>${uhH} HP</strong>!`,'heal'); }
          }
        });
        if(spell.deathWind){
          const anyKilled=targets.some(_t=>_t.hp<=0);
          if(anyKilled){
            const aliveP=room.players.filter(p=>p.char&&p.char.alive);
            const ally=aliveP[Math.floor(Math.random()*aliveP.length)];
            if(ally){const heal=rd(1,6);ally.char.health=Math.min(ally.char.maxHealth,ally.char.health+heal);addLog(room,`💀 Winds of Death restores <strong>${heal}</strong> HP to ${ally.name}!`,'heal');}
          }
        }
        if(spell.boltStorm){ alive2.filter(e=>e&&e.hp>0).forEach(e=>{ addDebuff(e,'Bolt-Stunned',{skipTurn:true},2); addLog(room,`⚡ Bolt Storm stuns <strong>${e.name}</strong>!`,'spell'); }); }
        // chainReaction 25% handled below after spell resolves
          if(char.chainReaction && targets.some(_t=>_t.hp<=0)){
          const adj=(gs.enemies||[]).find(e=>e&&e.hp>0&&!targets.includes(e));
          if(adj){ const arc=rd(1,6); adj.hp=Math.max(0,adj.hp-arc);
            addLog(room,`⚡ <strong>Chain Reaction!</strong> Lightning arcs to ${adj.name} — <strong class="num-dmg">−${arc}</strong> dmg!`,'spell');
            if(adj.hp<=0){resolveEnemyDeath(room,adj);if(!gs.inCombat){return true;}}
          }
        }
        if(char.ballLightning && targets.some(_t=>_t.hp<=0)){
          const adj2=(gs.enemies||[]).find(e=>e&&e.hp>0&&!targets.includes(e));
          if(adj2){ const arc2=rd(1,6); adj2.hp=Math.max(0,adj2.hp-arc2);
            addLog(room,`⚡ <strong>Ball Lightning!</strong> Arcs to ${adj2.name} — <strong class="num-dmg">−${arc2}</strong>!`,'spell');
            if(adj2.hp<=0){resolveEnemyDeath(room,adj2);if(!gs.inCombat){return true;}}
          }
        }
        return true;
      }
    }
    else{consumed=false; addLog(room,`${player.name}: ${itemName} can only be used in combat.`,'sys');}
  } else {consumed=false;}
  if(consumed){char.inventory[idx].qty--;if(char.inventory[idx].qty<=0)char.inventory.splice(idx,1);}
  return consumed;
}

// ─── ENEMY DROP WEAPONS ─────────────────────────────────────────────────────
function rollEnemyDrop(enemy, room){
  const drops=ENEMY_DROPS[enemy.name];
  if(!drops||enemy.summoned) return;
  drops.forEach(drop=>{
    if(Math.random()>drop.chance) return;
    const living=room.players.filter(p=>p.char&&p.char.alive);
    if(!living.length) return;
    const recipient=living[Math.floor(Math.random()*living.length)];
    if(drop.type==='consumable'){
      addToInventory(recipient.char,drop.name);
      addLog(room,`💀 ${enemy.name} drops <strong>${drop.name}</strong>! ${recipient.name} picks it up.`,'loot');
      return;
    }
    let item;
    if(drop.type==='charm') item=makeCharm(drop.key);
    else if(drop.type==='cursed') item=makeCursedItem(drop.key);
    else if(drop.type==='weapon'){
      item=rollTraits({id:'w'+uuidv4(),name:drop.name,dice:drop.dice,stat:drop.stat,bonus:drop.bonus,dmgType:drop.dmgType,special:drop.special,cost:0,sellCost:3,bought:false,type:'weapon',desc:`${drop.dice}+${drop.bonus} · ${drop.stat.toUpperCase()} · ${drop.dmgType} — ${drop.special.desc}`},'weapon');
    } else {
      const totalDef=(drop.def||2)+d(2);
      item=rollTraits({id:'a'+uuidv4(),name:drop.name,defBonus:totalDef,special:drop.special,cost:0,sellCost:3,bought:false,type:'armor',desc:`+${totalDef} Defense — ${drop.special.desc}`},'armor');
    }
    addToInventory(recipient.char,item.name,item);
    addLog(room,`💀 ${enemy.name} drops <strong>${item.name}</strong>${item.cursed?' <em>(cursed)</em>':''}! ${recipient.name} picks it up.`,'loot');
  });
}

module.exports = { bind, genLegendaryItem, genWpn, genArmor, genShopScroll, buildPlayerShop, addToInventory, applyLegendaryArmourPassive, applyWpnSpecial, equipItem, handleBuy, handleSell, useItemLogic, rollEnemyDrop };
