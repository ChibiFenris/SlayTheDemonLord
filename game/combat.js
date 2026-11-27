'use strict';
const heirlooms = require('./heirlooms');
const affixes = require('./affixes');
// Attack and damage rolls, buffs and debuffs, damage over time.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let CAREERS, CHARMS, POISON_CAP, addLog, armorTraits, charmKey, d, enemyDefence, gearVsEnemyAttack, hasRangedWeapon, modVal, rd, weaponTraits;
function bind(api) {
  ({ CAREERS, CHARMS, POISON_CAP, addLog, armorTraits, charmKey, d, enemyDefence, gearVsEnemyAttack, hasRangedWeapon, modVal, rd, weaponTraits } = api);
}
// ─── COMBAT ROLLS ────────────────────────────────────────────────────────────
function rollD20boons(boons, banes) {
  const net=boons-banes, base=d(20);
  if (net>0) { const bd=[]; for(let i=0;i<Math.min(net,4);i++) bd.push(d(6)); const best=Math.max(...bd); return {base,final:Math.min(20,base+best),boonDie:best,baneDie:0}; }
  if (net<0) { const bd=[]; for(let i=0;i<Math.min(-net,4);i++) bd.push(d(6)); const best=Math.max(...bd); return {base,final:Math.max(1,base-best),boonDie:0,baneDie:best}; }
  return {base,final:base,boonDie:0,baneDie:0};
}

function rollAttack(char, enemy, extraBoons=0) {
  const wpn=char.equippedWeapon;
  const wpnStat=wpn?wpn.stat:(CAREERS[char.career].weaponStr?'str':'agi');
  const wpnDice=(wpn&&wpn.dice)?wpn.dice:'1d6';
  const wpnDmgBonus=((wpn&&wpn.bonus)?wpn.bonus:0)+char.weaponDmgBonus;
  const [num,sides]=wpnDice.split('d').map(Number);
  const warCryBonus=(char.activeBuffs||[]).reduce((a,b)=>a+(b.atkBonus||0),0);
  const warCryDmgBonus=(char.activeBuffs||[]).reduce((a,b)=>a+(b.dmgBonus||0),0);
  const _wt=weaponTraits(char), _at=armorTraits(char), _ch=charmKey(char);
  const _charmAtk=(CHARMS[_ch]&&CHARMS[_ch].atkMod)||0;
  const traitAtk=(_wt.includes('balanced')?1:0)-(_wt.includes('clumsy')?1:0)+_charmAtk-(_at.includes('heavy')&&wpnStat==='agi'?1:0)
    +((wpn&&wpn.special&&wpn.special.key==='flailSwing'&&enemy&&enemy.ac>=15)?2:0);
  const atkMod=modVal(char.attrs[wpnStat])+char.weaponAtkBonus+warCryBonus+traitAtk+(char.hawkEye&&char.row==='back'?(char.career==='woodelf'?1:2):0)+heirlooms.attackMods(char).atk; // Hawk Eye (+1 for Wood Elves, who already shoot with +4 AGI)
  let boons=0, banes=0;
  const _ax=affixes.attackMods(char); boons+=_ax.boons; banes+=_ax.banes;
  if(_wt.includes('unwieldy')&&!char._unwieldyUsed){ char._unwieldyUsed=true; banes++; }
  if(char.row==='back'&&!hasRangedWeapon(char)) banes++; // swinging a melee weapon from the back row
  if(char.valourOfAges&&enemy&&(enemy.isElite||enemy.threat==='Boss'||enemy.threat==='Elite')) boons++; // High Elf: Valour of Ages

  const _isChaos=enemy&&(enemy.chaos||(enemy.tags&&enemy.tags.includes('chaos')));
  if(_ch==='witchSeal'){ if(_isChaos) boons++; else banes++; }
  if(char._armorWitchCoat&&_isChaos) boons++;
  const _eDef=enemy?enemyDefence(char,enemy):{banes:0,ac:0}; banes+=_eDef.banes;
  if (char.weaponTraining) boons++;
  if (char.swiftFeet) boons+=2;
  if ((char.vigil||char._allyVigil) && char.health===char.maxHealth) boons++; // Vigil: anyone at full HP
  if (char._vengeanceReady){ char._vengeanceReady=false; boons+=2; } // vengeancePassive: 2 boons after ally falls
  if ((char.rage||char.rageTrigger)&&char.rageBoon) { boons++; } // rage boon — dmg applied on hit, flag cleared there
  if (char.stimulantBoon>0) { boons++; char.stimulantBoon--; }
  if (extraBoons) boons+=extraBoons;
  // activeBuffs: atkBoon bonuses (from Shrine Blessing, Well Rested, etc.)
  banes+=getBuffVal(char,'atkBane'); // atkBoon buffs are added once below via getBuffVal
  if(enemy && (enemy.activeDebuffs||[]).some(d=>d.curse)) boons++; // Curse: +1 boon vs cursed target
  // holyFervor now adds dmg+heal on hit (handled in ATTACK handler), not a boon
  if(char._legRatking && enemy && enemy.tags && enemy.tags.includes('skaven')) boons++; // extra boon vs skaven
  if(char.exploitWeakness && enemy && (enemy._poisonStacks||0)>=5) boons++;
  if(char.markHeretic && char._markHereticTarget && enemy===char._markHereticTarget) boons+=2;
  if(char._legRatking) boons+=1; // Ratking Crown: +1 boon on all attacks
  if(char.shadowOpening && !char._shadowOpeningUsed){ char._shadowOpeningUsed=true; boons++; }
  if(char.firstVolley && !char._firstVolleyUsed){ char._firstVolleyUsed=true; boons++; } // Witch Hunter: First Volley
  if(enemy && char._condemnTargetId && enemy.id===char._condemnTargetId) boons++; // Witch Hunter: Condemn
  if(char.deathWish && char.health < char.maxHealth/2) boons++; // Slayer: Death Wish
  if(char.shadowStep) boons++; // shadowStep: all attacks have +1 boon
  const forceCritDeadAim=char._deadAimArmed; if(forceCritDeadAim){ char._deadAimArmed=false; }
  if(char._pressAdvantageReady){ char._pressAdvantageReady=false; boons++; } // boon vs undead/chaos
  if (char.warlordAura||char._allyAura) boons++; // Warlord Aura: the Warlord and every ally
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned'))    banes++;
  // skavencunning now applies poison on hit (handled in enemy attack section)
  const baneBuff = getBuffVal(char, 'bane');
  if (baneBuff) banes += baneBuff;
  const forceCrit=char.luckyPendant||forceCritDeadAim; if(char.luckyPendant) char.luckyPendant=false;
  const atkBuff=getBuffVal(char,'atkBoon'); boons+=atkBuff;
  const _hm=heirlooms.attackMods(char); boons+=_hm.boons; // heirlooms (Reiksguard Plate...)
  let {base,final,boonDie,baneDie}=rollD20boons(boons,banes);
  const _fs=(char.activeBuffs||[]).find(b=>b.foresightRerolls>0); // Foresight: roll twice, keep the higher
  if(_fs){ const r2=rollD20boons(boons,banes); if(r2.final>final){ ({base,final,boonDie,baneDie}=r2); } _fs.foresightRerolls--; if(_fs.foresightRerolls<=0) char.activeBuffs=char.activeBuffs.filter(b=>b!==_fs); }
  char.activeBuffs=(char.activeBuffs||[]).filter(b=>!b.consumeOnAttack);
  const _keen=_wt.includes('keen')||(wpn&&wpn.special&&wpn.special.key==='twinBlades')||_hm.keen;
  const fumble=(base===1||(_ax.fumbleOn2&&base===2))&&!forceCrit, crit=forceCrit||base===20||(_keen&&base>=19);
  const phantomThisHit=char.phantomStrike&&!char._phantomStrikeUsed;
  if(phantomThisHit) char._phantomStrikeUsed=true;
  const _arcaneIgnoreAC=char.arcaneStrike&&(Math.random()<(0.04*(1+Math.max(0,modVal(char.attrs.int)))));
  const _enemyAC=(enemy.ac||0)+((enemy.scurryAway&&enemy._scurryDefBonus)||0)+_eDef.ac; // Scurry Away / Shield Wall
  const total=final+atkMod, hit=!fumble&&(crit||total>=_enemyAC||phantomThisHit||_arcaneIgnoreAC);
  if(_arcaneIgnoreAC&&!phantomThisHit) { } // logged below if hit
  let dmg=0, dmgParts=[];
  if (hit) {
    const weapRoll=rd(num,sides);
    if(warCryDmgBonus>0){dmg+=warCryDmgBonus;dmgParts.push(`+${warCryDmgBonus} buffs`);}    const statBonus=Math.max(0,modVal(char.attrs[wpnStat]));
    dmg=weapRoll+statBonus+wpnDmgBonus;
    dmgParts.push(`${num}d${sides}(${weapRoll})`);
    if(statBonus)  dmgParts.push(`+${statBonus} stat`);
    if(wpnDmgBonus)dmgParts.push(`+${wpnDmgBonus} wpn`);
    if (crit)           { const r=rd(num,sides); dmg+=r; dmgParts.push(`+${r} crit`); }
    // arcaneStrike: 4% + 4%/INT-mod chance to ignore enemy AC — checked in rollAttack hit determination
    if (char.combatProwess)   { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} prowess`); }
    if (char.combatExpertise) {
      // Expertise: only procs when enemy is STUNNED — requires active setup
      const _expProc = enemy && (
        (enemy.activeDebuffs||[]).some(d=>d.name==='Stunned'||d.skipTurn)
      );
      if (_expProc) { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} expertise`); }
    }
    if (char.sharpeningStone) { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} sharpened`); }
    if (char.trickery) {
      if (!char._trickeryFirstHit) { char._trickeryFirstHit=true; char._trickeryPoisonProc=3; }
      else { char._trickeryPoisonProc=2; }
    }
    // dmgBonus buffs are already counted above (warCryDmgBonus)
    if(_wt.includes('vicious')){ dmg+=1; dmgParts.push('+1 vicious'); }
    if(_wt.includes('notched')){ dmg-=1; dmgParts.push('−1 notched'); }
    if(_wt.includes('blessed')&&enemy&&(enemy.undead||_isChaos||(enemy.tags&&enemy.tags.includes('undead')))){ dmg+=2; dmgParts.push('+2 blessed'); }
    if(_ch==='brassSkull'){ const bs=d(3); dmg+=bs; dmgParts.push(`+${bs} Khorne`); }
    if(_ch==='wolfTotem'&&char.health<char.maxHealth*0.5){ dmg+=2; dmgParts.push('+2 wolf'); }
    if(_ch==='ironTooth'){ dmg-=1; dmgParts.push('−1 iron tooth'); }
    if(_wt.includes('serrated')) char._serratedProc=true;
    if(_wt.includes('venomous')) char._venomousProc=true;
    if(enemy && enemy._mistFormRounds>0){ dmg=Math.ceil(dmg/2); dmgParts.push('½ mist'); }
    if(enemy && enemy.ancientScales && Math.random()<0.10){ dmg=0; dmgParts.push('deflected by Ancient Scales'); }
    if(enemy && (enemy.activeDebuffs||[]).some(d=>d.curse)){dmg+=1;dmgParts.push('+1 curse');}
    char.activeBuffs=(char.activeBuffs||[]).filter(b=>!b.consumeOnHit);
    if(char._wpnHolySmoke && enemy) { char._wpnHolySmokeProc=true; } // applied after hit in ATTACK handler
    if(char._wpnBlessedStrike && enemy && (enemy.undead||enemy.chaos||(enemy.tags&&(enemy.tags.includes('undead')||enemy.tags.includes('chaos'))))){ const bs=rd(1,6); dmg+=bs; dmgParts.push(`+${bs} blessed`); }
    if(char._righteousBonusDmg){ char._righteousBonusDmg=false; const rb=rd(1,6); dmg+=rb; dmgParts.push(`+${rb} righteous`); }
    const battleProwessBuff=(char.activeBuffs||[]).some(b=>b.battleProwess);
    if(battleProwessBuff){const r=rd(1,6);dmg+=r;dmgParts.push(`+${r} prowess`);}
    if(char._legVenomFang){ char._legVenomFangProc=true; } // poison applied in ATTACK handler
    if(char._legChainbreaker && crit){ char._chainbreakerCritProc=true; } // applied in ATTACK handler
      if(char._legSunstoneBlade){ const fd=Math.max(0,modVal(char.attrs.int)); if(fd>0){dmg+=fd; dmgParts.push(`+${fd} fire`);} }
    if(char._legVarghulfTalon && dmg>0){ char._legVarghulfLeech=Math.max(1,Math.floor(dmg*0.25)); } // applied in ATTACK handler
    const wpnType=(wpn&&wpn.dmgType)||'slashing';
    if(enemy){
      if(wpnType==='slashing'&&enemy.ac<=14){ dmg=Math.floor(dmg*1.5); dmgParts.push('×1.5 Slash'); }
      else if(wpnType==='blunt'&&enemy.ac>=16){ dmg=Math.floor(dmg*1.5); dmgParts.push('×1.5 Blunt'); }
      if(wpnType==='blunt'&&enemy.weakToBlunt){ dmg=Math.floor(dmg*1.5); dmgParts.push('×1.5 Blunt (Brittle Bones)'); }
    }
    const pacedBuff=(char.activeBuffs||[]).find(b=>b.pacedDmg);
    if(pacedBuff){ const pr=rd(3,6);dmg+=pr;dmgParts.push(`+${pr} Paced Strikes`); char.activeBuffs=char.activeBuffs.filter(b=>!b.pacedDmg); }
    if((char.rage||char.rageTrigger)&&char.rageBoon){ const rb=rd(1,6);dmg+=rb;dmgParts.push(`+${rb} rage`);char.rageBoon=false;char._rageSpent=true; } // consume rage proc
    const corrodedBuff=(char.activeBuffs||[]).find(b=>b.dmgPenalty);
    if(corrodedBuff&&dmg>0){ dmg=Math.max(0,dmg-corrodedBuff.dmgPenalty); }
    if(char._wpnRuneStrikeActive && enemy && enemy.damageReduction){ dmg+=enemy.damageReduction; dmgParts.push(`+${enemy.damageReduction} rune`); char._wpnRuneStrikeActive=false; }
    if(char.toughness){dmg=Math.max(0,Math.floor(dmg*0.9));}
    dmg=Math.max(1,dmg);
  }
  const net=boons-banes; const boonInfo=net>0?` (+${boonDie} boon)`:net<0?` (-${baneDie} bane)`:''; // shows actual die rolled
  const wpnLabel=wpn?`${wpn.name} (${wpnDice}+${wpnDmgBonus}) [${(wpn&&wpn.dmgType)||'slashing'}]`:'Unarmed (1d6)';
  if(!hit && !fumble && char._wpnArcaneFocus) char._wpnArcaneFocusMissed=true;
  if(fumble && wpn && _wt.includes('brittle')) char._brittleProc=true;
  if(fumble && wpn && wpn.special && wpn.special.key==='flailSwing') char._flailProc=true;
    if(char.weaponMaster && hit){ const maxRoll=num*sides+wpnDmgBonus; const minAllowed=Math.ceil(maxRoll/2); if(dmg<minAllowed){dmg=minAllowed;dmgParts.push(`(min ${minAllowed})`);} }
  return {hit,crit,fumble,base,final,total,dmg,dmgParts,atkMod,boonInfo,forceCrit,wpnLabel};
}

function rollEnemyAttack(enemy, char, hasBoon=false, room=null) {
  if(enemy.skavenDiscipline){ hasBoon=true; }
  if(enemy.plagueFrenzy && char._poisonedStacks && char._poisonedStacks>=5){ hasBoon=true; }
  const hasSkavenDiscipline=enemy&&enemy.skavenDiscipline;
  const baneDebuff=getDebuffVal(enemy,'bane');
  if(enemy.stunImmune) enemy.activeDebuffs=(enemy.activeDebuffs||[]).filter(d=>!d.skipTurn);
  const skipDebuff=(enemy.activeDebuffs||[]).find(d=>d.skipTurn);
  if(skipDebuff){ skipDebuff.duration--; if(skipDebuff.duration<=0) enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>!d.skipTurn); return {hit:false,crit:false,dmg:0,dmgRoll:0,critRoll:0,total:0,base:0,skipped:true}; }
  if((char.activeBuffs||[]).some(b=>b.immuneThisRound)){ return {hit:false,crit:false,dmg:0,dmgRoll:0,critRoll:0,total:0,base:0,skipped:true,immune:true}; }
  if(char.glamourVeil&&!char._glamourUsed){ char._glamourUsed=true; if(room) addLog(room,`🪞 <strong>Glamour Veil!</strong> ${enemy.name} strikes an illusion — the attack passes harmlessly through.`,'spell'); return {hit:false,crit:false,dmg:0,dmgRoll:0,critRoll:0,total:0,base:0,boonInfo:' (Glamour Veil)'}; }
  // Evasion: only the first attack against the Roadwarden each round is hampered.
  const _evRound=room&&room.gs?room.gs.roundNumber:null;
  // A Taunting Sentinel keeps full Evasion against every attack.
  const _sentinelGuard=char.masterPath==='myrmidon'&&(char.activeBuffs||[]).some(b=>b.taunting);
  const evasionBane=char.evasion&&(_sentinelGuard||_evRound===null||char._evadeRound!==_evRound)?1:0;
  if(evasionBane&&_evRound!==null&&!_sentinelGuard) char._evadeRound=_evRound;
  const poisonBane=(enemy&&enemy._poisonStacks&&enemy._poisonStacks>=5)?1:0; // Poison threshold: 5+ stacks
  const packScornBane=char._armorPackScorn&&enemy&&enemy.tags&&enemy.tags.includes('skaven')?1:0;
  const shroudBane=char._legShroudActive?1:0; // Shroud of Undeath: below 25% HP enemies have 1 bane
  const ratkingBane=char._legRatking&&enemy&&enemy.tags&&enemy.tags.includes('skaven')?2:0; // Ratking Crown: 2 banes vs skaven
  const sacredAegisBane=0; // sacredAegis now retaliates damage instead of bane
  const vanishBane=(char.activeBuffs||[]).reduce((a,b)=>a+(b.enemyBane||0),0);
  const gearMod=gearVsEnemyAttack(enemy, char, room);
  const totalBanes=baneDebuff+evasionBane+packScornBane+shroudBane+ratkingBane+poisonBane+sacredAegisBane+vanishBane+gearMod.banes;
  // Revelation: forceReroll — enemy rerolls and takes the worse result
  const _revDebuff=(enemy.activeDebuffs||[]).find(d=>d.forceReroll&&(d.rerollCount||0)>0);
  if(_revDebuff){ _revDebuff.rerollCount--; if(_revDebuff.rerollCount<=0) _revDebuff.duration=0; }
  if(enemy._frenzyNextHit){ enemy._frenzyNextHit=false; return {hit:true,crit:false,dmg:rd(enemy.dmgNum,enemy.dmgSides)+enemy.dmgBonus,dmgRoll:0,critRoll:0,total:99,base:20,boonInfo:' (Frenzy — auto-hit)'}; }
  const targetPoisoned=char&&(char._poisonedStacks||0)>=5;
  const effectiveHasBoon=hasBoon||hasSkavenDiscipline||(enemy&&enemy.plagueFrenzy&&targetPoisoned);
  const roll1=d(20);
  let boonBonus=effectiveHasBoon?d(6):0;
  if(enemy&&enemy.plagueFrenzy&&targetPoisoned){ boonBonus=Math.max(boonBonus,d(6)); addLog(room,`🐀 <strong>Plague Frenzy!</strong> ${enemy.name} surges — +2 boons on poisoned foe!`,'chaos'); }
  let rawBase=effectiveHasBoon?Math.min(20,roll1+boonBonus):roll1;
  if(_revDebuff){ const reroll2=d(20); rawBase=Math.min(rawBase,reroll2); if(room) addLog(room,`📖 <strong>Revelation!</strong> ${enemy.name} rerolls — takes ${rawBase} (worse of ${Math.max(rawBase,reroll2)}/${reroll2})!`,'spell'); }
  const baneRoll=totalBanes>0?Math.max(...Array.from({length:Math.min(totalBanes,4)},()=>d(6))):0; // SotDL: highest bane d6 subtracted
  const boonInfo=hasBoon?` (+boon)`:totalBanes>0?` (-${baneRoll} bane)`:''
  const adjBase=totalBanes>0?Math.max(1,rawBase-baneRoll):rawBase;
  let finalBase=adjBase;
  if(char._foresightActive){ char._foresightActive=false; const reroll=d(20); finalBase=Math.min(adjBase,reroll); addLog(room,`👁 <strong>Foresight!</strong> Rerolled — takes ${finalBase} (worse of ${adjBase}/${reroll})!`,'spell'); }
  const total2=finalBase+enemy.atk+gearMod.atk, crit2=finalBase===20;
  const hit=finalBase!==1&&(crit2||total2>=char.defense);
  let dmg=0, dmgRoll=0, critRoll=0;
  if (hit) {
    dmgRoll=rd(enemy.dmgNum,enemy.dmgSides);
    dmg=dmgRoll+enemy.dmgBonus;
    if (crit2) { critRoll=rd(enemy.dmgNum,enemy.dmgSides); dmg+=critRoll; }
    if((enemy.activeDebuffs||[]).some(d=>d.rerollDmgLower)||(char.activeBuffs||[]).some(b=>b.interceptGuard)){ const alt=rd(enemy.dmgNum,enemy.dmgSides)+enemy.dmgBonus; dmg=Math.min(dmg,alt); }
    if (char.toughness) dmg=Math.max(0,Math.floor(dmg*0.9));
    dmg=Math.max(1,dmg);
  }
  if(!hit && char.misdirection) char._misdirectArmed=true;
  if(!hit && enemy && enemy.activeDebuffs){
    enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>!d.consumeOnMiss);
  }
  return {hit,crit:crit2,dmg,dmgRoll,critRoll,total:total2,base:adjBase,boonInfo};
}

// ─── BUFF / DEBUFF SYSTEM ────────────────────────────────────────────────────
let _buffId=0;
function addBuff(char, name, effects, duration=1){
  if(effects&&effects.skipTurn&&affixes.resistStun(char)) return; // Steadfast armour
  if(effects&&effects.skipTurn&&((char.mutations||[]).includes('ironSkull')||(char.relics||[]).includes('pilgrimBoots')||char.stubborn)) return; // Horned Skull, Iron-shod Boots, Dwarven stubbornness: can't be stunned
  if(!char.activeBuffs) char.activeBuffs=[];
  char.activeBuffs.push({id:_buffId++, name, duration, ...effects});
}
function addDebuff(enemy, name, effects, duration=1){
  if(effects&&effects.skipTurn&&enemy.disciplined) return; // Black Orcs don't flinch
  if(!enemy.activeDebuffs) enemy.activeDebuffs=[];
  enemy.activeDebuffs.push({id:_buffId++, name, duration, ...effects});
}
function tickBuffs(char){
  if(!char.activeBuffs) return;
  char.activeBuffs.filter(b=>b.regenHp&&b.duration>0).forEach(b=>{ char.health=Math.min(char.maxHealth,char.health+(b.regenHp||0)); });
  if(char.alive!==false) char.activeBuffs.filter(b=>b.regenPerRound&&b.duration>0).forEach(b=>{ const [n,sd]=String(b.regenDice||'1d6').split('d').map(Number); char.health=Math.min(char.maxHealth,char.health+rd(n||1,sd||6)); }); // Triage, Sacred Ground
  // Tick DoT buffs on players (Bleed applied by enemies — fortitude blocks Bleed)
  char.activeBuffs.filter(b=>b.dotDmg&&b.duration>0&&!(char.fortitude&&b.name==='Bleed')).forEach(b=>{ char.health=Math.max(0,char.health-b.dotDmg); });
  char.activeBuffs=char.activeBuffs.filter(b=>{
    if(b.skipTurn) return b.duration>0; // stuns count down on the player's turn, not at round end
    b.duration--;
    if(b.duration<=0){
      // lingeringMagic: DoT doubling handled in applyBurn/applyPoison/applyBleed
      if(b.defBonus) char.defense=Math.max(1, char.defense-b.defBonus);
      if(b.name==='Corroded') char._corroded=false; // allow reapplication next hit
      return false;
    }
    return true;
  });
}
const SELF_TICK_DOTS=new Set(['Grave Grasp','Acid Splash']); // Chilled now handled by fireEnemyTurn dotDmg loop // Bleed/Burn now use new scalable system // Poison uses stack-based system, handled separately
function tickDebuffs(enemy){
  if(!enemy.activeDebuffs) return;
  enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>{
    // Bleed, Burn, dotDmg, and skipTurn debuffs manage their own expiry in fireEnemyTurn — skip here
    if(d.name==='Bleed'||d.name==='Burn'||d.dotDmg||d.skipTurn) return d.duration>0;
    if(SELF_TICK_DOTS.has(d.name)){ d.duration--; return d.duration>0; }
    d.duration--;
    return d.duration>0;
  });
}
function getBuffVal(char, key){ return (char.activeBuffs||[]).filter(b=>b[key]).reduce((s,b)=>s+b[key],0); }
// ─── DAMAGE OVER TIME (poison / bleed / burn) ──────────────────────────────────────────────────────────
function applyPoison(enemy, stacks, room) {
  enemy._poisonStacks = Math.min(POISON_CAP, (enemy._poisonStacks||0) + stacks); // capped
  addLog(room, `☠ <strong>Poison!</strong> ${enemy.name} — <strong>${enemy._poisonStacks}</strong> stack${enemy._poisonStacks!==1?'s':''} (+${stacks} new)!`, 'spell');
}

function applyBleed(enemy, room) {
  const existing = (enemy.activeDebuffs||[]).find(d=>d.name==='Bleed');
  if(existing){
    existing.bleedDice = Math.min((existing.bleedDice||1)+1, 4);
    existing.duration  = 3; // refresh
    addLog(room,`🩸 <strong>Bleed worsens!</strong> ${enemy.name} — now ${existing.bleedDice}d3/round!`,'spell');
  } else {
    enemy.activeDebuffs = enemy.activeDebuffs||[];
    enemy.activeDebuffs.push({id:Math.random(),name:'Bleed',bleedDice:1,duration:3});
    addLog(room,`🩸 <strong>Bleeding!</strong> ${enemy.name} — 1d3/round for 3 rounds!`,'spell');
  }
}

function applyBurn(enemy, startDice, room, caster=null) {
  enemy._burnedThisRound=true; // stops River Troll regeneration
  const existing = (enemy.activeDebuffs||[]).find(d=>d.name==='Burn');
  if(existing){
    if(caster&&caster.conflagration){
      existing.burnDice=4; addLog(room,`🔥 <strong>Conflagration!</strong> ${enemy.name} reset to 4d6 Burn!`,'spell');
    } else {
      existing.burnDice = Math.min(Math.max(existing.burnDice, startDice)+1, 4);
      addLog(room,`🔥 <strong>Burn intensifies!</strong> ${enemy.name} — now ${existing.burnDice}d6 this round!`,'spell');
    }
  } else {
    enemy.activeDebuffs = enemy.activeDebuffs||[];
    enemy.activeDebuffs.push({id:Math.random(),name:'Burn',burnDice:startDice||2,duration:99});
    addLog(room,`🔥 <strong>Burning!</strong> ${enemy.name} — ${startDice||2}d6 now, fading each round!`,'spell');
  }
}
function getDebuffVal(enemy, key){ return (enemy.activeDebuffs||[]).filter(d=>d[key]).reduce((s,d)=>s+d[key],0); }

module.exports = { bind, rollD20boons, rollAttack, rollEnemyAttack, addBuff, addDebuff, tickBuffs, SELF_TICK_DOTS, tickDebuffs, getBuffVal, applyPoison, applyBleed, applyBurn, getDebuffVal };
