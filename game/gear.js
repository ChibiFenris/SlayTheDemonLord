'use strict';
// Item traits, charms and cursed gear: the rules behind the extra loot.
const { v4: uuidv4 } = require('uuid');
const { d } = require('./dice');
const { alivePlayers, pickRandom } = require('./util');
const { CHARMS, WEAPON_TRAITS, ARMOR_TRAITS, CURSED_GEAR } = require('./data');
const heirlooms = require('./heirlooms');

// ═════════════════════════════════════════════════════════════════════════════
// ITEM TRAITS, CHARMS AND CURSED GEAR
// ═════════════════════════════════════════════════════════════════════════════
const RANGED_KEYS=['openingShot','marksmanship','longbow'];
// Bows, guns and the Witch Hunter's crossbow work from the back row without penalty.
function hasRangedWeapon(c){
  const w=c.equippedWeapon; if(!w) return false;
  if(w.special&&RANGED_KEYS.includes(w.special.key)) return true;
  if(w.dmgType==='piercing') return true;
  return /bow|pistol|gun|sling|javelin|blunderbuss|handgun/i.test(w.name||'');
}
function weaponTraits(c){ return (c.equippedWeapon&&c.equippedWeapon.traits)||[]; }
function armorTraits(c){ return (c.equippedArmor&&c.equippedArmor.traits)||[]; }
function charmKey(c){ return c&&c.equippedCharm?c.equippedCharm.key:null; }
function weaponIsHoly(c){
  const w=c.equippedWeapon; if(!w) return false;
  const k=w.special&&w.special.key;
  return weaponTraits(c).includes('blessed')||['blessedStrike','silverEdge','smiteTheFallen','channelFaith','holySmoke'].includes(k);
}
function resistsInsanity(c){ return armorTraits(c).includes('warded')||!!c._armorWitchCoat||heirlooms.resistsInsanity(c); }
function immuneToPoison(c){ return !!(c._nurgleMark||(c.equippedArmor&&c.equippedArmor.special&&c.equippedArmor.special.key==='nurgleMask')); }
function isCursed(item){ return !!(item&&(item.cursed||(item.special&&/^Cursed/.test(item.special.desc||'')))); }

// Roll 0–2 traits onto a freshly generated weapon or armour piece.
function rollTraits(item, kind){
  const table=kind==='weapon'?WEAPON_TRAITS:ARMOR_TRAITS;
  const r=Math.random(); const n=r<0.5?0:r<0.85?1:2;
  const traits=[];
  for(let i=0;i<n;i++){
    const good=Math.random()<0.65;
    const pool=Object.keys(table).filter(k=>table[k].good===good&&!traits.includes(k));
    if(pool.length) traits.push(pickRandom(pool));
  }
  if(!traits.length) return item;
  item.traits=traits;
  if(kind==='armor'){
    if(traits.includes('reinforced')) item.defBonus+=1;
    if(traits.includes('rusted')) item.defBonus=Math.max(1,item.defBonus-1);
  }
  const lead=table[traits[0]].label;
  item.name=`${lead} ${item.name}`;
  const tdesc=traits.map(t=>`${table[t].label} (${table[t].desc})`).join(', ');
  item.desc=(kind==='armor'?`+${item.defBonus} Defense`:item.desc.split(' — ')[0])+(item.special?` — ${item.special.desc}`:'')+` · Traits: ${tdesc}`;
  if(item.cost) item.cost=Math.max(5,item.cost+traits.reduce((a,t)=>a+(table[t].good?8:-6),0));
  return item;
}
function makeCharm(key){
  const C=CHARMS[key];
  return {id:'c'+uuidv4(),type:'charm',key,name:C.name,desc:C.desc,cursed:!!C.cursed,cost:0,sellCost:3,bought:false};
}
function makeCursedGear(key){
  const g=CURSED_GEAR[key];
  if(g.type==='weapon') return {id:'w'+uuidv4(),type:'weapon',name:g.name,dice:g.dice,stat:g.stat,bonus:g.bonus,dmgType:g.dmgType,special:g.special,cursed:true,cost:0,sellCost:3,bought:false,desc:`${g.dice}+${g.bonus} · ${g.stat.toUpperCase()} · ${g.dmgType} — ${g.special.desc}`};
  const def=g.def+d(2);
  return {id:'a'+uuidv4(),type:'armor',name:g.name,defBonus:def,special:g.special,cursed:true,cost:0,sellCost:3,bought:false,desc:`+${def} Defense — ${g.special.desc}`};
}
function makeCursedItem(key){ return CHARMS[key]?makeCharm(key):makeCursedGear(key); }
function applyCharm(c, charm, on){
  if(!charm) return;
  const C=CHARMS[charm.key]||{};
  const s=on?1:-1;
  heirlooms.applyCharm(c, charm, on);
  if(C.defMod) c.defense+=s*C.defMod;
  if(charm.key==='warpAmulet'){ c.power=Math.max(0,(c.power||0)+s); }
  if(charm.key==='tzeentchLens'){
    if(on){ const cut=Math.floor(c.maxHealth*0.25); c._lensDrain=cut; c.maxHealth-=cut; c.health=Math.min(c.health,c.maxHealth); }
    else { c.maxHealth+=(c._lensDrain||0); c._lensDrain=0; }
  }
}
// Rest at a campfire (or Sigmar's Token): lift curse locks and undo lingering drains.
function cleanseCurses(c, full){
  if(c._curseLock) c._curseLock={};
  if(full){
    if(c._barrowDrain){ c.maxHealth+=c._barrowDrain; c._barrowDrain=0; }
    if(c._nurgleDrain){ c.maxHealth+=c._nurgleDrain; c._nurgleDrain=0; }
  }
}
// End of each combat round: trickle effects from gear.
function gearRoundTick(room){
  alivePlayers(room).forEach(p=>{
    const c=p.char;
    if((armorTraits(c).includes('sanctified')||charmKey(c)==='grailToken')&&c.health<c.maxHealth) c.health=Math.min(c.maxHealth,c.health+1);
    if(c.equippedArmor&&c.equippedArmor.special&&c.equippedArmor.special.key==='shroudFlies'&&c.health>1) c.health-=1;
    heirlooms.roundTick(c);
  });
}
// Per-fight cleanup for charm/trait state.
function resetGearCombatState(c){
  if(c._gambler){ c.attrs[c._gambler.up]-=2; c.attrs[c._gambler.down]+=1; c._gambler=null; }
  c._unwieldyUsed=false; c._shieldBlockUsed=false; c._lensUsed=false; c._rosaryUsed=false; c._lotusHits=0; c._hitSinceTurn=false;
}
// Enemy attack-roll modifiers that come from the player's gear.
function gearVsEnemyAttack(enemy, c, room){
  let atk=0, banes=0;
  const ch=charmKey(c);
  if(ch==='wolfTotem') atk+=1;
  if(ch==='morrFeather'&&enemy.tags&&enemy.tags.includes('undead')) banes++;
  if(c.equippedArmor&&c.equippedArmor.special&&c.equippedArmor.special.key==='shroudFlies') banes++;
  if(armorTraits(c).includes('creaking')&&room&&room.gs&&room.gs.roundNumber===1) atk+=1;
  banes+=heirlooms.banesAgainst(c);
  if(enemy.skirmisher&&c.equippedWeapon&&c.equippedWeapon.special&&RANGED_KEYS.includes(c.equippedWeapon.special.key)) banes++;
  return {atk,banes};
}

module.exports = { RANGED_KEYS, hasRangedWeapon, applyCharm, armorTraits, charmKey, cleanseCurses, gearRoundTick, gearVsEnemyAttack, immuneToPoison, isCursed, makeCharm, makeCursedGear, makeCursedItem, resetGearCombatState, resistsInsanity, rollTraits, weaponIsHoly, weaponTraits };
