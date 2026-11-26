'use strict';
// Player combat actions: attacking, casting spells and using talents.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let TRADITIONS, addBuff, addDebuff, addLog, advanceTurn, applyBleed, applyBurn, applyPoison, castingsLeft, charmKey, checkDeath, d, enemyOnWeaponHit, getTargetEnemy, hasRelic, maxCastings, modVal, rd, refreshCastingPools, regainCasting, resolveEnemyDeath, rollAttack, spendCasting, talentHeal, uniqRanks;
function bind(api) {
  ({ TRADITIONS, addBuff, addDebuff, addLog, advanceTurn, applyBleed, applyBurn, applyPoison, castingsLeft, charmKey, checkDeath, d, enemyOnWeaponHit, getTargetEnemy, hasRelic, maxCastings, modVal, rd, refreshCastingPools, regainCasting, resolveEnemyDeath, rollAttack, spendCasting, talentHeal, uniqRanks } = api);
}
// ─── COMBAT ACTIONS ──────────────────────────────────────────────────────────
// Weapon attack against the current target. Returns true when the action used the turn; undefined aborts with no turn spent.
function actAttack({room,playerId,data,ws,player,gs,char}){
  let acted=false;
  const targetEnemy=getTargetEnemy(gs);
  // Condemn: once the condemned foe is gone, the mark passes to whoever the Witch Hunter attacks next.
  if(char._condemnTargetId&&targetEnemy&&targetEnemy.id!==char._condemnTargetId){
    const ce=(gs.enemies||[]).find(e=>e&&e.id===char._condemnTargetId);
    if(!ce||ce.hp<=0){ char._condemnTargetId=targetEnemy.id; addDebuff(targetEnemy,'Condemned',{condemned:true},99); addLog(room,`⚖ The mark of condemnation passes to <strong>${targetEnemy.name}</strong>.`,'crit'); }
  }
  if(!targetEnemy){addLog(room,'No target.','sys');return;}
  if(char._wpnReloading){ addLog(room,`${player.name} is <strong>reloading</strong> — cannot attack this round!`,'sys'); char._wpnReloading=false; advanceTurn(room); return; }
  let extraBoons=(char.career==='rogue'&&gs.roundNumber===1)?1:0;
  if(char._wpnReach && gs.roundNumber===1) extraBoons++;
  if(char._wpnMarksmanship && gs.roundNumber===1) extraBoons++;
  if(char._wpnLongbow && gs.roundNumber===1) extraBoons++;
  if(char._wpnLongbow && char._hitSinceTurn) extraBoons--;
  const openingFires=char._wpnOpeningShot && gs.roundNumber===1 && !char._wpnOpeningShotFired;
  if(openingFires){ extraBoons+=2; char._wpnOpeningShotFired=true; char._wpnReloading=true; }
  if(char._wpnCleaveReady){ char._wpnCleaveReady=false; char._wpnCleaveBonus=true; }
  char._serratedProc=false; char._venomousProc=false;
  let r=rollAttack(char,targetEnemy,extraBoons);
  if(!r.hit && charmKey(char)==='tzeentchLens' && !char._lensUsed){
    char._lensUsed=true; addLog(room,`👁 <strong>Tzeentch's Lens</strong> twists fate — ${player.name} rerolls the miss!`,'spell');
    char._brittleProc=false; char._flailProc=false;
    r=rollAttack(char,targetEnemy,extraBoons);
  }
  if(r.fumble){
    addLog(room,`${player.name} <em>fumbles!</em> d20 rolled 1 — automatic miss.`,'sys');
    if(char._brittleProc&&char.equippedWeapon){ char._brittleProc=false; char.equippedWeapon.bonus=Math.max(-2,(char.equippedWeapon.bonus||0)-1); addLog(room,`🔨 <strong>Brittle!</strong> ${char.equippedWeapon.name} chips — now ${char.equippedWeapon.dice}${char.equippedWeapon.bonus>=0?'+':''}${char.equippedWeapon.bonus}.`,'sys'); }
    if(char._flailProc){ char._flailProc=false; const fs=rd(1,6); char.health=Math.max(0,char.health-fs); addLog(room,`⛓ The flail swings back — ${player.name} takes <strong class="num-dmg">−${fs}</strong>!`,'dmg'); checkDeath(room,player); }
  } else if(r.hit){
      if(char._chainbreakerCritProc && r.crit){ char._chainbreakerCritProc=false; addDebuff(targetEnemy,'Prone',{skipTurn:true},1); addLog(room,`🔨 <strong>Chainbreaker Crit!</strong> ${targetEnemy.name} is knocked Prone!`,'crit'); }
    let finalDmg=r.dmg;
    if(char._wpnCleaveBonus){ char._wpnCleaveBonus=false; finalDmg+=rd(1,6); }
    if(char._devastatingChargeProc){ char._devastatingChargeProc=false; const dc=rd(1,6); finalDmg+=dc; addDebuff(targetEnemy,'Prone',{bane:1},1); addLog(room,`🐎 <strong>Devastating Charge!</strong> +${dc} dmg and ${targetEnemy.name} is Prone!`,'crit'); }
    if(char._legBeastlordMaul && !char._legBeastlordMaulUsed && r.crit){
      char._legBeastlordMaulUsed=true;
      const bd=rd(2,6); finalDmg+=bd;
      addDebuff(targetEnemy,'Maul Stun',{skipTurn:true},1);
      addLog(room,`🐂 <strong>Beastlord Maul!</strong> CRIT — +${bd} bonus dmg and ${targetEnemy.name} is <strong>STUNNED</strong>!`,'crit');
    }
    if(char._wpnRuneStrike && !char._wpnRuneStrikeUsed){
      char._wpnRuneStrikeUsed=true;
      char._wpnRuneStrikeActive=true; // flag checked in rollAttack — nullifies enemy DR flags
      addLog(room,`⚡ <strong>Rune Strike!</strong> ${player.name} cuts through ${targetEnemy.name}'s defences — all DR ignored!`,'crit');
    }
    // Primordial Roar: halve player damage if buff active
    const _prBuff=(char.activeBuffs||[]).find(b=>b.dmgReductionPct);
    if(_prBuff){ finalDmg=Math.max(1,Math.floor(finalDmg*(1-_prBuff.dmgReductionPct))); }
    finalDmg=enemyOnWeaponHit(room, player, targetEnemy, finalDmg);
    targetEnemy.hp=Math.max(0, targetEnemy.hp-finalDmg);
    const cl=r.forceCrit?' ⚡ Lucky Pendant CRIT!':r.crit?' 💥 CRITICAL HIT!':'';
    const boonStr=r.boonInfo?(r.final!==r.base?`${r.boonInfo}→<strong>${r.final}</strong>`:`${r.boonInfo}`):'';
    const rollBreak=`d20:<strong>${r.base}</strong>${boonStr}+atk<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${targetEnemy.ac}</strong>`;
    const dmgBreak=r.dmgParts.length?` [dmg: ${r.dmgParts.join(' ')} = <strong>${r.dmg}</strong>]`:'';
    addLog(room,`${player.name} ${r.crit?'<strong>CRITS</strong>':'hits'} ${targetEnemy.name} — <strong class="num-dmg">−${finalDmg} dmg</strong>${cl} [${rollBreak}]${dmgBreak} → ${targetEnemy.name} ${targetEnemy.hp}/${targetEnemy.maxHp} HP`,r.crit?'crit':'dmg');
    if(targetEnemy.hp>0){
      if(char.deathblow){ const stacks=r.crit?4:2; applyPoison(targetEnemy,stacks,room); }
      if(char.venomOnFirstHit && !char._venomHitUsed){ char._venomHitUsed=true; applyPoison(targetEnemy,char.lingeringMagic?8:4,room); addLog(room,`💀 <strong>Venom on First Hit!</strong> ${player.name}'s first strike applies 4 poison stacks to ${targetEnemy.name}!`,'spell'); }
      if(char._trickeryPoisonProc && targetEnemy.hp>0){ const ts=char._trickeryPoisonProc; char._trickeryPoisonProc=0; applyPoison(targetEnemy,ts,room); } else { char._trickeryPoisonProc=0; }
      if(char.assassination){
        if(targetEnemy.hp<targetEnemy.maxHp*0.5){ const ab=rd(1,6)+3;targetEnemy.hp=Math.max(0,targetEnemy.hp-ab);addLog(room,`🗡 <strong>Assassination!</strong> Enemy below 50% HP — <strong class="num-dmg">-${ab}</strong> bonus dmg!`,'crit'); }
        else { applyPoison(targetEnemy,2,room); addLog(room,`🗡 <strong>Assassination!</strong> Enemy above 50% HP — 2 poison stacks!`,'chaos'); }
      }
      if(char._wpnHolySmokeProc){ char._wpnHolySmokeProc=false; applyPoison(targetEnemy,1,room); } // War Censer
      if(char._serratedProc&&finalDmg>0){ applyBleed(targetEnemy,room); }
      if(char._venomousProc&&finalDmg>0){ applyPoison(targetEnemy,1,room); }
      if(char._lotusHits>0&&finalDmg>0){ char._lotusHits--; applyPoison(targetEnemy,3,room); addLog(room,`🪷 Black Lotus Oil — 3 poison (${char._lotusHits} coated hit${char._lotusHits===1?'':'s'} left).`,'chaos'); }
      if(char.poisonBlade){ applyPoison(targetEnemy,char.lingeringMagic?4:2,room); }
      if(char._legVenomFangProc){ char._legVenomFangProc=false; applyPoison(targetEnemy,3,room); }
              if(char.layOnHands&&finalDmg>0&&(char._layOnHandsCount||0)<2){char._layOnHandsCount=(char._layOnHandsCount||0)+1;const lhH=rd(1,6)+Math.max(0,modVal(char.attrs.wil));char.health=Math.min(char.maxHealth,char.health+lhH);addLog(room,`🙏 <strong>Lay on Hands!</strong> ${player.name} heals <strong>${lhH}</strong> HP (1d6+WIL) [${char._layOnHandsCount}/2]!`,'heal');}
      if(char._wpnSpellblade && !char._wpnSpellbladeUsed && char.knownSpells && char.knownSpells.length){
        char._wpnSpellbladeUsed=true;
        const r0sp=(char.knownSpells.filter(sp=>sp.rank===0&&sp.type==='attack')[0])||char.knownSpells[0];
        if(r0sp){
          const[sbn,sbs]=r0sp.dmg?r0sp.dmg.split('d').map(Number):[1,6];
          const sbDmg=rd(sbn||1,sbs||6)+Math.max(0,modVal(char.attrs.int));
          targetEnemy.hp=Math.max(0,targetEnemy.hp-sbDmg);
          addLog(room,`✨ <strong>Spellblade!</strong> ${player.name} channels <strong>${r0sp.name}</strong> — +<strong class="num-dmg">${sbDmg}</strong> bonus dmg!`,'spell');
        }
      }
      if(char._wpnSmite && !char._wpnSmiteUsed && targetEnemy.hp>0){
        const isHolyTarget=targetEnemy.undead||targetEnemy.chaos||(targetEnemy.tags&&(targetEnemy.tags.includes('undead')||targetEnemy.tags.includes('chaos')));
        if(isHolyTarget && char.castingPools){
          const anySpell=char.knownSpells&&char.knownSpells.find(sp=>sp.rank>=1&&(char.castingPools['R'+sp.rank]||0)>0);
          if(anySpell){
            char._wpnSmiteUsed=true;
            char.castingPools['R'+anySpell.rank]--;
            const smiteDmg=rd(3,6);
            targetEnemy.hp=Math.max(0,targetEnemy.hp-smiteDmg);
            addLog(room,`✝ <strong>Smite the Fallen!</strong> ${player.name} invokes Sigmar — +<strong class="num-dmg">${smiteDmg}</strong> holy dmg!`,'crit');
          }
        }
      }
      if(char._wpnSunder && r.crit && !targetEnemy._sundered){ targetEnemy._sundered=true; targetEnemy.ac=Math.max(1,targetEnemy.ac-2); addLog(room,`🔨 <strong>Sunder!</strong> ${targetEnemy.name}'s armour cracked — AC reduced to ${targetEnemy.ac}!`,'crit'); } // Warhammer
      if(char.flameEdge && r.hit){
        // Weapon attack is now fire damage — trigger burningSoul if target already burning
        const _feBonusSoul=(char.burningSoul&&(targetEnemy.activeDebuffs||[]).some(d=>d.name==='Burn'))?rd(1,6):0;
        if(_feBonusSoul){ finalDmg+=_feBonusSoul; }
        applyBurn(targetEnemy,1,room);
        addLog(room,`🔥 <strong>Flame Edge!</strong> ${player.name}'s weapon deals fire damage${_feBonusSoul?` +${_feBonusSoul} Burning Soul`:''} — 1 Burn applied to ${targetEnemy.name}!`,'spell');
      }
      if(char.resonance && ((targetEnemy._poisonStacks||0)>0||(targetEnemy.activeDebuffs||[]).some(d=>d.name==='Bleed'||d.name==='Burn'))){ finalDmg+=rd(1,6); addLog(room,`💥 <strong>Resonance!</strong> +1d6 bonus on afflicted target.`,'spell'); }
      if(char.hex && (targetEnemy.activeDebuffs||[]).some(d=>d.isEvilEye||d.curse)){ finalDmg+=4; addLog(room,`🌙 <strong>Hex!</strong> ${targetEnemy.name} is cursed — +4 dmg!`,'chaos'); }
      if(char.huntersMark){
        if(!char._huntersMarkTarget && r.hit){ char._huntersMarkTarget=targetEnemy; addLog(room,`🎯 <strong>Hunter's Mark!</strong> ${player.name}'s first hit marks ${targetEnemy.name} — +2 dmg!`,'sys'); }
        if(char._huntersMarkTarget===targetEnemy){ finalDmg+=2; }
      }
      // Witch Hunter and Slayer hit bonuses
      if(r.hit){
        if(char._condemnTargetId && targetEnemy.id===char._condemnTargetId){
          const cd=rd(1,6)+(char.judgement?2:0); finalDmg+=cd;
          addLog(room,`⚖ <strong>Condemned!</strong> +${cd} dmg to ${targetEnemy.name}.`,'crit');
          if(char.burnTheWitch) applyBurn(targetEnemy,1,room);
        }
        if(char.silverShot && isUnholy(targetEnemy)){ finalDmg+=2; }
        if(char.slayerOath && (targetEnemy.threat==='Boss'||targetEnemy.isElite)){ const so=rd(1,6); finalDmg+=so; addLog(room,`🪓 <strong>Slayer's Oath!</strong> +${so} dmg against a worthy foe.`,'crit'); }
        if(char.deathWish && char.health < char.maxHealth/2){ finalDmg+=2; }
        // Relics on a hit
        if(hasRelic(char,'vampireFang')) char.health=Math.min(char.maxHealth,char.health+1);
        if(r.crit&&hasRelic(char,'stormstone')){ const ss=rd(1,6); finalDmg+=ss; addLog(room,`⚡ <strong>Stormstone!</strong> +${ss} on the critical hit.`,'crit'); }
        if(hasRelic(char,'hunterTrophy')&&(targetEnemy.threat==='Boss'||targetEnemy.isElite)) finalDmg+=rd(1,6);
        // Combos: setting up a foe for the rest of the warband pays off.
        const _deb=targetEnemy.activeDebuffs||[];
        if(_deb.some(d=>d.skipTurn)){ const ex=rd(1,6); finalDmg+=ex; addLog(room,`💥 <strong>Exploit!</strong> ${targetEnemy.name} is helpless — +${ex} dmg.`,'crit'); }
        if(_deb.some(d=>d.condemned)&&_deb.some(d=>d.name==='Burn')){ const pg=rd(1,6); finalDmg+=pg; addLog(room,`🔥 <strong>Purge!</strong> The condemned burns — +${pg} holy dmg.`,'crit'); }
        if((targetEnemy._poisonStacks||0)>0&&_deb.some(d=>d.name==='Bleed')){ finalDmg+=2; addLog(room,`🩸 <strong>Festering!</strong> Poison in an open wound — +2 dmg.`,'chaos'); }
      }
      if(char.markHeretic && r.hit && !char._markHereticTarget){ char._markHereticTarget=targetEnemy; addLog(room,`⚖ <strong>Mark Heretic!</strong> ${targetEnemy.name} is marked — attacks gain +2 boons!`,'sys'); }
      if(char.markHeretic && char._markHereticTarget && targetEnemy!==char._markHereticTarget && r.hit){ char._markHereticTarget=targetEnemy; }
      if(char.relentless){ char._relentlessCount=Math.min(5,(char._relentlessCount||0)+1); if(r.hit){ finalDmg+=char._relentlessCount; } else { char.weaponAtkBonus=(char.weaponAtkBonus||0)+1; } }
      if(char.pressTheAdvantage && r.hit){ char._pressAdvantageReady=true; }
      if(char.bleedOnCrit && r.crit && (((char.equippedWeapon&&char.equippedWeapon.dmgType)==='slashing')||!char.equippedWeapon)){
        applyBleed(targetEnemy,room);
        if(char.bleedDeep||char.deepBleed) applyBleed(targetEnemy,room);
      }
      if(char.bleedOnHit && r.hit){
        applyBleed(targetEnemy,room);
        if(char.bleedDeep||char.deepBleed) applyBleed(targetEnemy,room);
      }
      if(char.pacedStrikes && r.hit){
        char._pacedHitCount=(char._pacedHitCount||0)+1;
        if(char._pacedHitCount%2===0){ applyBleed(targetEnemy,room); applyBleed(targetEnemy,room); addLog(room,`⚔ <strong>Paced Strikes!</strong> Every 2nd hit — <strong>2 Bleed</strong> applied to ${targetEnemy.name}!`,'sys'); }
      }
      if(char.holyFervor && r.hit && targetEnemy){
        const _wilMod=modVal(char.attrs.wil); const _hfDmg=rd(1,3)+_wilMod; const _hfHeal=rd(1,3); // heal is flat 1d3 (no WIL scaling)
        targetEnemy.hp=Math.max(0,targetEnemy.hp-_hfDmg);
        char.health=Math.min(char.maxHealth,char.health+_hfHeal);
        addLog(room,`✨ <strong>Holy Fervor!</strong> ${player.name}'s strike channels Sigmar — <strong class="num-dmg">−${_hfDmg}</strong> holy, +<strong>${_hfHeal} HP</strong>!`,'heal');
        if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);}
      }
      // Druids Fury bonuses
      const _dfuryBuff=(char.activeBuffs||[]).find(b=>b.druidsFuryActive);
      if(_dfuryBuff && r.hit){
        const _dfuryDmg=rd(1,6); finalDmg+=_dfuryDmg;
        applyBleed(targetEnemy,room); applyBleed(targetEnemy,room);
        addLog(room,`🌿 <strong>Druids Fury!</strong> +${_dfuryDmg} wild dmg + 2 Bleed!`,'crit');
      }
      if(char.druidFervor && r.hit && targetEnemy){
        const _dfBest=Math.max(modVal(char.attrs.wil),modVal(char.attrs.int));
        const _dfVal=4+_dfBest;
        targetEnemy.hp=Math.max(0,targetEnemy.hp-_dfVal);
        char.health=Math.min(char.maxHealth,char.health+_dfVal);
        addLog(room,`🌿 <strong>Druid Fervor!</strong> ${player.name}'s strike channels nature — <strong class="num-dmg">−${_dfVal}</strong> nature dmg, +<strong>${_dfVal} HP</strong>!`,'heal');
        if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);}
      }
      if(char._legSunstoneBlade && r.crit && gs.enemies && gs.enemies.length>1){
        gs.enemies.filter(e2=>e2&&e2.hp>0&&e2!==targetEnemy).forEach(e2=>{
          const splash=rd(1,6); e2.hp=Math.max(0,e2.hp-splash);
          addLog(room,`☀ <strong>Sunstone Blade!</strong> ${e2.name} scorched — <strong class="num-dmg">−${splash}</strong> fire!`,'crit');
          if(e2.hp<=0) resolveEnemyDeath(room,e2);
        });
      }
      if(char._wpnMarksmanship && r.crit){ addDebuff(targetEnemy,'Marksmanship',{bane:1},1); addLog(room,`🎯 Marksmanship crit! ${targetEnemy.name} has 1 bane on their next attack.`,'sys'); }
      if(char._wpnUnstable && r.crit){ addDebuff(targetEnemy,'Acid Splash',{dotDmg:rd(1,6),name:'Acid Splash'},1); addLog(room,`⚗ Unstable Charge! ${targetEnemy.name} will take acid splash dmg next turn.`,'spell'); }
    } else {
      char._trickeryPoisonProc=0; char._wpnHolySmokeProc=false;
      if(char.frenzy && char.rageBoon){ char.rageBoon=true; addLog(room,`🔥 <strong>Frenzy!</strong> ${player.name}'s kill extends the rage!`,'chaos'); }
      if(char._wpnCleave){ char._wpnCleaveReady=true; addLog(room,`🪓 Cleave! ${player.name}'s next attack deals +1d6 bonus dmg.`,'crit'); }
      if(char._legVarghulfLeech && char._legVarghulfLeech>0){
        const l=char._legVarghulfLeech; char._legVarghulfLeech=0;
        char.health=Math.min(char.maxHealth,char.health+l);
        addLog(room,`🩸 Varghulf's Talon leeches <strong>${l} HP</strong>!`,'heal');
      }
      if(char._legVenomFang){ addBuff(char,'Fang Kill',{atkBoon:1,consumeOnAttack:true},99); addLog(room,`🐀 <strong>Gnashteeth's Fang!</strong> ${player.name} gains 1 boon on next attack!`,'loot'); }
      if(char._legVarghulfTalon){ char.health=char.maxHealth; addLog(room,`🩸 <strong>Varghulf's Talon!</strong> ${player.name} <strong>fully heals</strong> on kill!`,'heal'); }
      if(char.inspire){ room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{ addBuff(p.char,'Inspired',{atkBoon:2},1); }); addLog(room,`👑 <strong>Inspire!</strong> ${player.name}'s kill inspires all allies — <strong>2 boons</strong> on next action!`,'crit'); }
      if(char.righteousFury){ const rfHeal=rd(1,6)+Math.max(0,modVal(char.attrs.wil)); room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{ p.char.health=Math.min(p.char.maxHealth,p.char.health+rfHeal); }); addLog(room,`✨ <strong>Righteous Fury!</strong> ${player.name}'s kill empowers all — <strong>+${rfHeal} HP</strong> (1d6+WIL) to all allies!`,'heal'); }
      if(char.purgeTheWicked && char._markHereticTarget && targetEnemy===char._markHereticTarget){ const ph=rd(1,6); room.players.filter(p=>p.char&&p.char.alive).forEach(p=>p.char.health=Math.min(p.char.maxHealth,p.char.health+ph)); addLog(room,`⚖ <strong>Purge the Wicked!</strong> ${player.name} kills the heretic — all allies +${ph} HP!`,'heal'); char._markHereticTarget=null; }
      if(char.skirmish && r.hit && char._huntersMarkTarget && targetEnemy===char._huntersMarkTarget){ applyPoison(targetEnemy,2,room); addLog(room,`🏹 <strong>Skirmish!</strong> ${player.name} hits the marked ${targetEnemy.name} — <strong>2 poison stacks</strong>!`,'spell'); }
      if(char.cleanup && !char._cleanupUsed){
        const next=(gs.enemies||[]).find(e=>e&&e.hp>0&&e!==targetEnemy);
        if(next){ char._cleanupUsed=true; const rc=rollAttack(char,next,0);
          if(rc.hit){
            let cd=rc.dmg; if(char.blessedBlade&&(next.undead||next.chaos)) cd+=(next.damageReduction||0);
            next.hp=Math.max(0,next.hp-cd);
            addLog(room,`💀 <strong>Cleanup!</strong> ${player.name} immediately strikes ${next.name} — <strong class="num-dmg">−${cd}</strong> dmg!`,'crit');
            if(next.hp<=0){resolveEnemyDeath(room,next);}
          }
        }
      }
      if(char.vanish){ addBuff(char,'Vanish',{enemyBane:2},1); addLog(room,`🌑 <strong>Vanish!</strong> ${player.name} disappears into shadow — enemies have 2 banes vs them next round!`,'sys'); }
      if(char.killingMomentum && !char._killingMomentumUsed){
        const nxt=(gs.enemies||[]).find(e=>e&&e.hp>0&&e!==targetEnemy);
        if(nxt){ char._killingMomentumUsed=true; const rk=rollAttack(char,nxt,0);
          if(rk.hit){
            nxt.hp=Math.max(0,nxt.hp-rk.dmg);
            addLog(room,`🐎 <strong>Killing Momentum!</strong> ${player.name} charges ${nxt.name} — <strong class="num-dmg">−${rk.dmg}</strong> dmg!`,'crit');
            if(nxt.hp<=0){resolveEnemyDeath(room,nxt);}
          }
        }
      }
      if(char._legWarpstoneGauntlet && targetEnemy && targetEnemy.hp<=0 && (char._warpstoneKillStr||0)<3){ char._warpstoneKillStr=(char._warpstoneKillStr||0)+1; char.attrs.str+=1; addLog(room,`💎 <strong>Warpstone Gauntlet!</strong> ${(player&&player.name)||'Warrior'} gains +1 STR from the kill (${char._warpstoneKillStr}/3)!`,'crit'); }
    if(char.deadMansHand && targetEnemy && targetEnemy.hp<=0){ const dmhHeal=rd(2,6)+Math.max(0,modVal(char.attrs.agi)); char.health=Math.min(char.maxHealth,char.health+dmhHeal); addLog(room,`☠ <strong>Dead Man's Hand!</strong> ${player.name} kills ${targetEnemy.name} and heals <strong>${dmhHeal}</strong> HP (2d6+AGI)!`,'heal'); }
    }
    if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
  } else {
    const rerollBuff=(char.activeBuffs||[]).find(b=>b.rerollMiss);
    if(rerollBuff){
      addLog(room,`${player.name} misses — <strong>Rewrite Moment</strong> triggers, rerolling!`,'spell');
      const r2=rollAttack(char,targetEnemy,extraBoons);
      if(r2.hit){
        targetEnemy.hp=Math.max(0, targetEnemy.hp-r2.dmg);
        const dmgBreak2=r2.dmgParts.length?` [dmg: ${r2.dmgParts.join(' ')} = <strong>${r2.dmg}</strong>]`:'';
        addLog(room,`${player.name} reroll ${r2.crit?'<strong>CRITS</strong>':'hits'} ${targetEnemy.name} — <strong class="num-dmg">−${r2.dmg} dmg</strong>${dmgBreak2} → ${targetEnemy.name} ${Math.max(0,targetEnemy.hp)}/${targetEnemy.maxHp} HP`,r2.crit?'crit':'dmg');
        if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
      } else {
        addLog(room,`${player.name} reroll also misses.`,'sys');
      }
    } else {
      addLog(room,`${player.name} <em>misses</em> — d20:<strong>${r.base}</strong>${r.boonInfo?`${r.boonInfo}→<strong>${r.final}</strong>`:''}+<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${targetEnemy.ac}</strong>.`,'sys');
      if(char.quickStep && !(char.activeBuffs||[]).some(b=>b.name==='Quick Step')){ addBuff(char,'Quick Step',{defBonus:2},1); char.defense+=2; addLog(room,`👟 ${player.name} Quick Steps — +2 Defense this round!`,'sys'); }
    }
  }
  if(char.bladestorm && r.hit && targetEnemy && targetEnemy.hp>0){
    let bsBoon=char.weaponTraining?1:0; let bsBoonStride=0;
    for(let bsi=0;bsi<1;bsi++){ // Bladestorm: 1 bonus strike after initial hit (2 total)
      if(targetEnemy.hp<=0) break;
      addLog(room,`🌪 ${player.name} <strong>Bladestorm</strong> — second strike!`,'crit');
      if(char.unrelenting) bsBoonStride++;
      const rbs=rollAttack(char,targetEnemy,bsBoon+bsBoonStride);
      if(rbs.fumble){
        addLog(room,`Bladestorm fumbles!`,'sys');
      } else if(rbs.hit){
        targetEnemy.hp=Math.max(0,targetEnemy.hp-rbs.dmg);
        const bsBreak=rbs.dmgParts.length?` [${rbs.dmgParts.join(' ')} = <strong>${rbs.dmg}</strong>]`:'';
        addLog(room,`Bladestorm ${rbs.crit?'<strong>CRITS</strong>':'hits'} — <strong class="num-dmg">−${rbs.dmg} dmg</strong>${bsBreak} → ${targetEnemy.name} ${Math.max(0,targetEnemy.hp)}/${targetEnemy.maxHp} HP`,rbs.crit?'crit':'dmg');
        if(char._trickeryPoisonProc){ const ts=char._trickeryPoisonProc; char._trickeryPoisonProc=0; if(targetEnemy.hp>0){ applyPoison(targetEnemy,ts,room); } }
        if(char._wpnHolySmokeProc){ char._wpnHolySmokeProc=false; if(targetEnemy.hp>0) applyPoison(targetEnemy,1,room); }
        if(char._legVenomFangProc){ char._legVenomFangProc=false; if(targetEnemy.hp>0) applyPoison(targetEnemy,2,room); }
        if(char._legVarghulfTalon && targetEnemy.hp<=0){ char.health=char.maxHealth; addLog(room,`🩸 <strong>Varghulf's Talon!</strong> ${player.name} <strong>fully heals</strong> on kill!`,'heal'); }
        if(char.flurryBleed && rbs.hit && targetEnemy.hp>0){ applyBleed(targetEnemy,room); addLog(room,`🩸 <strong>Flurry Bleed!</strong> ${player.name}'s bladestorm hit applies Bleed!`,'spell'); }
        if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
      } else {
        addLog(room,`Bladestorm strike misses — d20:${rbs.base}+${rbs.atkMod>=0?'+':''}${rbs.atkMod}=${rbs.total} vs Def${targetEnemy.ac}.`,'sys');
      }
    }
  }
  if(char.sweepingBlow && r.hit && gs.enemies && gs.enemies.length>1){
    gs.enemies.filter(e=>e&&e.hp>0&&e!==targetEnemy).forEach(se=>{
      const sweepDmg=Math.max(1,Math.floor(r.dmg*0.75));
      se.hp=Math.min(se.maxHp,se.hp-sweepDmg);
      addLog(room,`💥 Sweeping Blow hits <strong>${se.name}</strong> — <strong class="num-dmg">−${sweepDmg}</strong> dmg → ${Math.max(0,se.hp)}/${se.maxHp} HP`,'crit');
      if(se.hp<=0){const sdied=resolveEnemyDeath(room,se);if(sdied!==false&&!gs.inCombat)return;}
    });
  }
  if(char.quickstrike && gs.roundNumber===1 && !char._quickstrikeUsed && targetEnemy && targetEnemy.hp>0){
    char._quickstrikeUsed=true;
    addLog(room,`⚡ ${player.name} <strong>Quick Strike</strong> — bonus attack!`,'crit');
    const qsBoon=(char.weaponTraining?1:0)+(char._wpnReach&&gs.roundNumber===1?1:0)+(char._wpnMarksmanship&&gs.roundNumber===1?1:0);
    if(char._devastatingChargeArmed){ char._devastatingChargeArmed=false; char._devastatingChargeProc=true; }
    const rqs=rollAttack(char,targetEnemy,qsBoon);
    if(rqs.fumble){
      addLog(room,`Quick Strike fumbles!`,'sys');
    } else if(rqs.hit){
      targetEnemy.hp=Math.max(0,targetEnemy.hp-rqs.dmg);
      const qsBreak=rqs.dmgParts.length?` [${rqs.dmgParts.join(' ')} = <strong>${rqs.dmg}</strong>]`:'';
      addLog(room,`Quick Strike ${rqs.crit?'<strong>CRITS</strong>':'hits'} — <strong class="num-dmg">−${rqs.dmg} dmg</strong>${qsBreak} → ${targetEnemy.name} ${Math.max(0,targetEnemy.hp)}/${targetEnemy.maxHp} HP`,rqs.crit?'crit':'dmg');
      if(rqs.hit && char._trickeryPoisonProc && targetEnemy.hp>0){ const ts=char._trickeryPoisonProc; char._trickeryPoisonProc=0; applyPoison(targetEnemy,ts,room); }
      if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
    } else {
      addLog(room,`Quick Strike misses — d20:${rqs.base}+${rqs.atkMod>=0?'+':''}${rqs.atkMod}=${rqs.total} vs Def${targetEnemy.ac}.`,'sys');
    }
  }
  acted=true;
  return acted;
}

// Cast a known spell (attack, heal or utility). Returns true when the action used the turn; undefined aborts with no turn spent.
function actCastSpell({room,playerId,data,ws,player,gs,char}){
  let acted=false;
  const spell=char.knownSpells.find(s=>s.name===data.spellName); if(!spell)return;
  const _armedFree=!!char._freeCastArmed; if(_armedFree) char._freeCastArmed=false;
  const freeCast=_armedFree||(char.spellsurge&&!char.spellsurgeUsed&&data.useSurge)||(char.metamagic&&!char.metamagicUsed&&data.useMetamagic);
  if(_armedFree){addLog(room,`✨ ${player.name}'s spell costs no casting!`,'spell');}
  else if(freeCast){if(data.useMetamagic&&char.metamagic&&!char.metamagicUsed){char.metamagicUsed=true; if(char.chaosTouch){char._chaosTouchActive=true; setTimeout(()=>{char._chaosTouchActive=false;},100);}addLog(room,`${player.name} uses Metamagic — free cast!`,'spell');}else{char.spellsurgeUsed=true;addLog(room,`${player.name} uses Spell Surge!`,'spell');}}
  else {
    if(!char.castingPools) refreshCastingPools(char);
    const spellboundFree=spell.rank===1&&char._armorSpellbound&&!char._spellboundCastingUsed;
    if(spellboundFree){ char._spellboundCastingUsed=true; addLog(room,`✨ Spellbound — free rank-1 casting!`,'spell'); }
    else {
      const avail=castingsLeft(char,spell.name,spell.rank);
      const spellboundR0=spell.rank===0&&char._armorSpellbound&&!char._spellboundR0Used&&avail<=0;
      if(spellboundR0){ char._spellboundR0Used=true; addLog(room,`✨ Spellbound — bonus rank-0 casting!`,'spell'); }
      else if(avail<=0){
        addLog(room,`${player.name}: no castings left for ${spell.name} (0/${maxCastings(char.power,spell.rank)}).`,'sys');return;
      } else {
        if(!spendCasting(char,spell.name,spell.rank)){addLog(room,`${player.name}: casting failed.`,'sys');return;}
      }
    }
  }

  const arcaneFocusBoon=char._wpnArcaneFocus && char._wpnArcaneFocusMissed;
  const arcaneFocusIntBonus=arcaneFocusBoon?Math.max(0,modVal(char.attrs.int)):0;
  if(arcaneFocusBoon){ char._wpnArcaneFocusMissed=false; addLog(room,`✨ <strong>Arcane Focus!</strong> ${player.name}'s spell is empowered (+${arcaneFocusIntBonus} INT bonus dmg).`,'spell'); }
  if(spell.type==='heal'||spell.heal){
    const targetPlayer=data.targetId?room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive):null;
    const target=targetPlayer?targetPlayer.char:char;
    const targetName=targetPlayer?targetPlayer.name:player.name;
    const wilMod=Math.max(0,modVal(char.attrs.wil));
    const channelFaithBonus=char._wpnChannelFaith?wilMod:0; // Blessed Staff: +WIL mod to healing
    const strMod=Math.max(0,modVal(char.attrs.str));
    let amt=0;
    const dStr=spell.dmg||'1d6';
    if(dStr==='max'){
      amt=target.maxHealth-target.health;
      target.health=target.maxHealth;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — fully restored to ${target.maxHealth} HP!`,'heal');
    } else if(dStr==='2d6_wil2_multi'||spell.multiTarget){
      room.players.forEach(p=>{
        if(p.char&&p.char.alive){
          const roll=rd(2,6); const h=roll+wilMod+channelFaithBonus;
          p.char.health=Math.min(p.char.maxHealth,p.char.health+h);
          addLog(room,`${p.name} healed <strong>${h}</strong> HP (2d6(${roll})+${wilMod}).`,'heal');
        }
      });
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies healed!`,'heal');
    } else if(dStr==='1d6_wil2'){  // Minor Healing
      const roll=rd(1,6); amt=roll+wilMod;
      target.health=Math.min(target.maxHealth,target.health+amt);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 1d6(${roll})+${wilMod} WIL = +<strong>${amt}</strong> HP.`,'heal');
    } else if(dStr==='2d6_wil2'){  // Light Healing
      const roll=rd(2,6); amt=roll+wilMod;
      target.health=Math.min(target.maxHealth,target.health+amt);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 2d6(${roll})+${wilMod} WIL = +<strong>${amt}</strong> HP.`,'heal');
    } else if(dStr==='3d6_wil2'){  // Moderate Healing
      const roll=rd(3,6); amt=roll+wilMod;
      target.health=Math.min(target.maxHealth,target.health+amt);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 3d6(${roll})+${wilMod} WIL = +<strong>${amt}</strong> HP.`,'heal');
    } else if(dStr==='1d6_str2'){  // Close Wounds (Battle)
      const roll=rd(1,6); amt=roll+strMod;
      target.health=Math.min(target.maxHealth,target.health+amt);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 1d6(${roll})+${strMod} STR = +<strong>${amt}</strong> HP.`,'heal');
    } else if(dStr==='1d6_wil'){   // Cure heal portion
      const roll=rd(1,6); amt=roll+wilMod;
      target.health=Math.min(target.maxHealth,target.health+amt);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 1d6(${roll})+${wilMod} WIL = +<strong>${amt}</strong> HP.`,'heal');
    } else if(spell.name==='Mass Heal'){
      if(char.massHealUsed){addLog(room,`${player.name}: Mass Heal already used.`,'sys');return;}
      char.massHealUsed=true;
      room.players.forEach(p=>{ if(p.char&&p.char.alive){const h=rd(1,6);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} healed for ${h} HP.`,'heal');} });
    } else if(spell.name==='Miracle Heal'){
      if(char.miracleUsed){addLog(room,`${player.name}: Miracle Heal already used.`,'sys');return;}
      char.miracleUsed=true; target.health=target.maxHealth;
      addLog(room,`${player.name} casts Miracle Heal on ${targetName} — fully restored!`,'heal');
    } else {
      const hr=Math.max(1,Math.floor(target.maxHealth/4));
      if(dStr==='berries'){
        const wilMod=Math.max(0,modVal(char.attrs.wil));
        let totalHeal=0;
        for(let i=1;i<=3;i++){const roll=rd(1,3);const h=roll+wilMod;totalHeal+=h;addLog(room,`Berry ${i}: 1d3(${roll})+${wilMod}=<strong>${h}</strong> HP.`,'heal');}
        target.health=Math.min(target.maxHealth,target.health+totalHeal);
        addLog(room,`${player.name} casts <strong>Healing Berries</strong> — total +<strong>${totalHeal}</strong> HP.`,'heal');
      } else if(dStr==='half_rate')       {const amt=Math.max(1,Math.floor(hr/2));target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');}
      else if(dStr==='rate')       {target.health=Math.min(target.maxHealth,target.health+hr);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${hr}</strong> HP.`,'heal');}
      else if(dStr==='double_rate'){const amt=hr*2;target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');}
      else if(dStr==='triple_rate'){const amt=hr*3;target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');}
      else { const m=dStr.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);if(m){const wilMod=Math.max(0,modVal(char.attrs.wil));const roll=rd(parseInt(m[1]),parseInt(m[2]));const amt=roll+parseInt(m[3]||0)+wilMod+channelFaithBonus;target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');} }
    }
    if(char.protectiveBlessing && target && target.health>0){ addBuff(target,'Protective Blessing',{defBonus:2},1); target.defense+=2; addLog(room,`🛡 <strong>Protective Blessing!</strong> ${targetName} gains +2 Defence this round.`,'spell'); }
  }
  else if(spell.type==='utility'){
    const te=getTargetEnemy(gs);
    const _ufBonus=char.utilityFocus?1:0;
    if(spell.defBonus){
      addBuff(char,spell.name+' (Def)',{defBonus:spell.defBonus},3);
      char.defense+=spell.defBonus;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +${spell.defBonus} Defence for 3 rounds.`,'spell');
    } else if(spell.healthBonus){
      addBuff(char,spell.name+' (HP)',{tempHp:spell.healthBonus},8);
      char.health=Math.min(char.maxHealth+spell.healthBonus,char.health+spell.healthBonus);
      char.maxHealth+=spell.healthBonus;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +${spell.healthBonus} max Health for 8 rounds.`,'spell');
    } else if(spell.direBeast){
      addBuff(char,'Dire Beast (+1d6/atk)',{dmgBonus:rd(1,6)},5);
      addLog(room,`${player.name} casts <strong>Dire Beast</strong> — transformed! All attacks +1d6 for 5 rounds!`,'spell');
    } else if(spell.dmgBuff){
      addBuff(char,spell.name+' (+1d6 dmg)',{dmgBonus:rd(1,6),consumeOnHit:true},99);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — next attack +1d6 damage.`,'spell');
    } else if(spell.atkBoon){
      addBuff(char,spell.name+' (atk boon)',{atkBoon:1,consumeOnAttack:true},99);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — 1 boon on next attack.`,'spell');
    } else if(spell.battleProwessSpell){
      addBuff(char,spell.name,{battleProwess:true,atkBoon:1},7+_ufBonus);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — 1 boon and +1d6 on every attack for 7 rounds!`,'spell');
    } else if(spell.groupBoon){
      room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,spell.name+' (boon)',{atkBoon:1},1);});
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies gain 1 boon this round.`,'spell');
    } else if(spell.groupDefBonus){
      room.players.forEach(p=>{if(p.char&&p.char.alive){addBuff(p.char,spell.name+' (Def)',{defBonus:spell.groupDefBonus},3);p.char.defense+=spell.groupDefBonus;}});
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies +${spell.groupDefBonus} Defense.`,'spell');
    } else if(spell.enemyBane){
      if(te){addDebuff(te,spell.name+' (bane)',{bane:2,consumeOnMiss:true},99);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${te.name} attacks with 2 banes until it misses.`,'spell');}
    } else if(spell.enemyMiss||spell.skipEnemy||spell.vanish){
      if(te){addDebuff(te,spell.name+' (skip)',{skipTurn:true},1);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${te.name} loses next action!`,'spell');}
    } else if(spell.untouchable){
      addBuff(char,spell.name+' (untouchable)',{defBonus:15},1);
      char.defense+=15;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — untouchable this round!`,'spell');
    } else if(spell.fullBuff){
      addBuff(char,spell.name,{defBonus:2,atkBoon:1},3+_ufBonus);
      char.defense+=2;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +2 Defense and 1 boon for 2 rounds.`,'spell');
    } else if(spell.reroll){
      addBuff(char,spell.name+' (reroll)',{reroll:true},3);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — may reroll dice for 2 rounds.`,'spell');
    } else if(spell.sanctuary){
      addBuff(char,spell.name+' (hidden)',{sanctuary:true,defBonus:5},3);
      char.defense+=5;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — hidden from enemies for 2 rounds (+5 Def).`,'spell');
    } else if(spell.forceField){
      addBuff(char,spell.name+' (shield)',{forceField:10},5);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — Force Field absorbs 10 damage!`,'spell');
    } else if(spell.speedBuff){
      addBuff(char,spell.name+' (speed)',{speedBuff:true},5);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +10 Speed for 4 rounds.`,'spell');
    } else if(spell.cure){
      const wilMod2=Math.max(0,modVal(char.attrs.wil));
      const hadDebuffs=(char.activeDebuffs&&char.activeDebuffs.length>0)||(char.conditions&&char.conditions.length>0);
      if(char.activeDebuffs) char.activeDebuffs=[];
      if(char.conditions)    char.conditions=[];
      const roll2=rd(1,6); const h2=roll2+wilMod2;
      char.health=Math.min(char.maxHealth,char.health+h2);
      addLog(room,`${player.name} casts <strong>Cure</strong> — ${hadDebuffs?'all debuffs cleared! ':''}heals 1d6(${roll2})+${wilMod2} = +<strong>${h2}</strong> HP.`,'heal');
    } else if(spell.shadowBlade){
      addBuff(char,'Nightfall Blade (+1d6)',{dmgBonus:rd(1,6)},5);
      addLog(room,`${player.name} casts <strong>Nightfall Blade</strong> — weapon hits +1d6 for 5 rounds!`,'spell');
    } else if(spell.mightyAtk){
      addBuff(char,'Mighty Attack',{dmgBonus:rd(2,6+_ufBonus),atkBoon:2,consumeOnHit:true},99);
      addLog(room,`${player.name} casts <strong>Mighty Attack</strong> — next attack: +2d6 and 2 boons!`,'spell');
    } else if(spell.forceFieldNew){
      addBuff(char,'Force Field (35% DR)',{damageReduction:0.35},2);
      addLog(room,`${player.name} casts <strong>Force Field</strong> — 35% less damage for 2 rounds!`,'spell');
    } else if(spell.sanctuaryNew){
      room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,'Sanctuary (35% DR)',{damageReduction:0.35},2);});
      addLog(room,`${player.name} casts <strong>Sanctuary</strong> — all allies take 35% less damage for 2 rounds!`,'spell');
    } else if(spell.vigorNew){
      char.maxHealth+=10; char.health=Math.min(char.maxHealth,char.health+10); char._vigorBonus=(char._vigorBonus||0)+10;
      addLog(room,`${player.name} casts <strong>Vigor</strong> — max HP +10 for rest of combat!`,'spell');
    } else if(spell.protectiveFieldNew){
      room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,'Protective Field (Immune)',{immune:true},1);});
      addLog(room,`${player.name} casts <strong>Protective Field</strong> — all allies IMMUNE to damage for 1 round!`,'spell');
    } else if(spell.figmentNew){
      if(te){addDebuff(te,'Figment',{bane:1,consumeOnMiss:true},99);addLog(room,`${player.name} casts <strong>Figment</strong> — ${te.name} attacks with 1 bane until it misses!`,'spell');}
    } else if(spell.vertigoNew){
      addBuff(char,'Vertigo (2 boons)',{atkBoon:2,consumeOnAttack:true},99);
      addLog(room,`${player.name} casts <strong>Vertigo</strong> — 2 boons on your next attack!`,'spell');
    } else if(spell.glamerNew){
      if(te){addDebuff(te,'Glamer (miss)',{skipTurn:true},1);addLog(room,`${player.name} casts <strong>Glamer</strong> — ${te.name} next attack misses!`,'spell');}
    } else if(spell.mistFormNew){
      addBuff(char,'Mist Form (35% DR)',{damageReduction:0.35},3);
      addLog(room,`${player.name} casts <strong>Mist Form</strong> — 35% less damage for 3 rounds!`,'spell');
    } else if(spell.swiftnessNew){
      addBuff(char,'Swiftness (+1 boon)',{atkBoon:1},3);
      addLog(room,`${player.name} casts <strong>Swiftness</strong> — +1 boon on attacks for 3 rounds!`,'spell');
    } else if(spell.rewriteNew){
      addBuff(char,'Rewrite Moment (reroll misses)',{rerollMiss:true},3);
      addLog(room,`${player.name} casts <strong>Rewrite Moment</strong> — missed attacks are rerolled for 3 rounds!`,'spell');
    } else if(spell.minorParadoxNew){
      uniqRanks(char.knownSpells).forEach(sp=>{
        if(sp.rank<=2&&char.castingPools){
          const max=maxCastings(char.power,sp.rank);
          char.castingPools['R'+sp.rank]=Math.min(max,(char.castingPools['R'+sp.rank]||0)+1);
        }
      });
      addLog(room,`${player.name} casts <strong>Minor Paradox</strong> — regained 1 casting of every rank 0-2 spell!`,'spell');
    } else if(spell.precognitionNew){
      addBuff(char,'Precognition',{atkBoon:2,defBonus:4},3+_ufBonus);
      char.defense+=4;
      addLog(room,`${player.name} casts <strong>Precognition</strong> — 2 boons on your attacks and +4 Defence for 3 rounds!`,'spell');
    } else {
      addLog(room,`${player.name} casts <strong>${spell.name}</strong>.`,'spell');
    }
  } else { // attack
    const spellTarget=getTargetEnemy(gs);
    if(!spellTarget){addLog(room,`${player.name}: no target.`,'sys');return;}
    const _volatile=!!(char.volatileForm&&!char._volatileFormUsed&&!spell.aoe); if(_volatile){ char._volatileFormUsed=true; addLog(room,`💥 <strong>Volatile Form!</strong> ${player.name}'s spell bursts across ALL enemies!`,'spell'); }
    const isAoe=!!(spell.aoe)||_volatile;
    const aoeTargets=isAoe?(gs.enemies||[]).filter(e=>e&&e.hp>0):[spellTarget];
    const dStr=spell.dmg||spell.dmgDice||'1d6';
    const dMatch=dStr.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
    let total=0; let _primaryApplied=false; // dice branch applies damage to the main target itself
    if(dMatch){
      const n=parseInt(dMatch[1]),sd=parseInt(dMatch[2]),b=parseInt(dMatch[3]||0);
      const roll=rd(n,sd);
      const wilSpells=["Sigmar's Smite",'Radiation','Minor Healing','Vitality Burst'];
      const intMod=wilSpells.includes(spell.name)
        ? Math.max(0,modVal(char.attrs.wil))   // WIL×1
        : Math.max(0,modVal(char.attrs.int));    // INT×1
      let burnBonus=0;
      const fireNames=['Flame Missile','Meteor','Fiery Volley','Fireball','Immolate','Fire Blast','Burning Hands','Firewall'];
      // burningSoul: +1d6 only if target already burning (rewards Burn synergy)
      if(char.burningSoul&&fireNames.includes(spell.name)){
        const _alreadyBurning=(spellTarget.activeDebuffs||[]).some(d=>d.name==='Burn');
        if(_alreadyBurning) burnBonus=rd(1,6);
      }
      const overcastBuff=(char.activeBuffs||[]).find(b=>b.overcastDmg);
      if(overcastBuff){
        const oc=rd(2,6); total+=oc;
        char.activeBuffs=char.activeBuffs.filter(b=>!b.overcastDmg);
        char.overcastUsed=false; // reset for next combat
        if(char.castingPools&&char.castingPools['R'+spell.rank]>0) char.castingPools['R'+spell.rank]--;
        addLog(room,`💥 Overcast! +${oc} extra damage!`,'crit');
        if(char.forceOfWill && spellTarget && d(20)>=11){ addDebuff(spellTarget,'Stunned',{skipTurn:true},1); addLog(room,`🧠 <strong>Force of Will!</strong> ${spellTarget.name} is stunned by the overcast!`,'crit'); }
      }
      total=roll+b+intMod+burnBonus+(arcaneFocusIntBonus||0);
      if(char._agaricBoost){ char._agaricBoost=false; const ab=rd(1,6); total+=ab; addLog(room,`🍄 Fly Agaric visions — +${ab} damage!`,'spell'); }
      if(char._legPrimordialStaff && spell.rank===0) total*=2;
      // overload is now a USE_TALENT active (see USE_TALENT handler)
      if(char._uncontrolledPowerArmed){ char._uncontrolledPowerArmed=false; total*=2; const bk=rd(1,6); char.health=Math.max(0,char.health-bk); addLog(room,`🌪 <strong>Uncontrolled Power!</strong> ${player.name} takes ${bk} backlash!`,'chaos'); }
      if(char.resonance&&((spellTarget._poisonStacks||0)>0||(spellTarget.activeDebuffs||[]).some(d=>d.name==='Bleed'||d.name==='Burn'))){ total+=rd(1,6); addLog(room,`💥 <strong>Resonance!</strong> +1d6 on afflicted target.`,'spell'); }
      if(char._misdirectArmed&&spell.type==='attack'){ char._misdirectArmed=false; const _md=rd(1,6); total+=_md; addLog(room,`🎭 <strong>Misdirection!</strong> The foe overreached — +${_md} damage.`,'spell'); }
      if(char.arcaneSurge&&!char._arcaneSurgeUsed&&spell.type==='attack'){ char._arcaneSurgeUsed=true; const _as=rd(1,6); total+=_as; addLog(room,`✴ <strong>Arcane Surge!</strong> ${player.name}'s opening spell surges — +${_as} damage!`,'spell'); }
      if(spell.lifeLeech){const heal=Math.floor(total/4);char.health=Math.min(char.maxHealth,char.health+heal);addLog(room,`${player.name} leeches ${heal} HP (¼)!`,'heal');}
      const spellTradKey=Object.keys(TRADITIONS).find(k=>TRADITIONS[k].spells&&TRADITIONS[k].spells.some(s=>s.name===spell.name));
      const spellElem=(TRADITIONS[spellTradKey]||{}).elemType||'arcane';
      const eTags=(spellTarget.tags)||[];
      const WEAKNESSES={
        fire:      {tags:['undead','fire-weak'], mult:2},
        holy:      {tags:['chaos'], mult:2},
        lightning: {tags:['skaven'], mult:2},
        dark:      {tags:['beast'], mult:2},
        arcane:    {tags:['skaven','chaos','undead','beast'], mult:1.25},
      };
      const weakRule=WEAKNESSES[spellElem];
      const isWeak=weakRule&&eTags.some(t=>weakRule.tags.includes(t));
      if(!isWeak && char.elementalAttunement){ total=Math.floor(total*1.25); addLog(room,`🔮 <strong>Elemental Attunement!</strong> Spell reshaped to the foe's weakness — ×1.25.`,'spell'); }
      if(isWeak){
        let mult=weakRule.mult;
        const label=mult>=2.5?`×${mult} ENHANCED`:mult===2?'×2 WEAKNESS':'×1.25 Arcane';
        total=Math.floor(total*mult);
        addLog(room,`⚡ <strong>Elemental ${label}!</strong> [${spellElem}] vs [${eTags.join('/')}]`,'crit');
      }
      if(spell.tripleHit){
        let tripleTotal=total; // first hit already rolled
        for(let i=2;i<=3;i++){
          const hr2=rd(n,sd)+b; // INT and Burning Soul count once per cast, not per missile
          tripleTotal+=hr2;
        }
        total=tripleTotal;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> [${spellElem}] — 3 hits = <strong>${total}</strong> total dmg!`,'spell');
      } else {
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> [${spellElem}] — ${n}d${sd}(${roll})${b?'+'+b:''}+${intMod} INT${burnBonus?'+'+burnBonus+' burn':''} = <strong>${total}</strong> dmg!`,'spell');
      }
      if(spellTarget._mistFormRounds>0){ total=Math.ceil(total/2); addLog(room,`🌫 ${spellTarget.name} is in Mist Form — spell damage halved to ${total}.`,'chaos'); }
      // Primordial Roar: halve player spell damage
      {const _prRB=(char.activeBuffs||[]).find(b2=>b2.dmgReductionPct);if(_prRB){const _old=total;total=Math.max(1,Math.floor(total*(1-_prRB.dmgReductionPct)));addLog(room,`🦎 <strong>Primordial Roar!</strong> ${player.name}\'s spell halved — ${_old}→${total}!`,'chaos');}}
      spellTarget.hp=Math.max(0,spellTarget.hp-total); _primaryApplied=true;
      if(isAoe&&spellTarget.swarm&&spellTarget.hp>0){ spellTarget.hp=Math.max(0,spellTarget.hp-total); addLog(room,`🐀 The swarm scatters into the blast — double damage!`,'spell'); }
      if(spell.doubleHit && spellTarget.hp>0){
        const roll2=rd(n,sd);
        const hit2=roll2+b; // INT counts once per cast
        spellTarget.hp=Math.max(0,spellTarget.hp-hit2);
        addLog(room,`⚡ <strong>Second fork!</strong> ${n}d${sd}(${roll2})${b?'+'+b:''} = <strong class="num-dmg">−${hit2}</strong> → ${spellTarget.name} ${spellTarget.hp}/${spellTarget.maxHp} HP`,'spell');
        total+=hit2;
      }
    } else {
      total=parseInt(dStr)||0;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — <strong>${total}</strong> dmg!`,'spell');
    }
    const _hitTargets=isAoe?aoeTargets:[spellTarget];
    _hitTargets.forEach(_t=>{ if(_t===spellTarget&&_primaryApplied) return; if(_t.hp>0){ const _sw=(isAoe&&_t.swarm)?total:0; if(_sw) addLog(room,`🐀 The swarm scatters into the blast — double damage!`,'spell'); _t.hp=Math.max(0,_t.hp-total-_sw); if(isAoe&&_hitTargets.length>1) addLog(room,`  ↳ ${_t.name}: <strong class="num-dmg">−${total}</strong> → ${_t.hp}/${_t.maxHp} HP`,'spell'); } });
    { const _spellKills=_hitTargets.filter(_t=>_t&&_t.hp<=0).length; // heal-on-spell-kill talents
      for(let _k=0;_k<_spellKills;_k++){
        if(char.spellLeech){ const sl=rd(1,6); char.health=Math.min(char.maxHealth,char.health+sl); addLog(room,`🩸 <strong>Spell Leech!</strong> ${player.name} drains the dying foe — +${sl} HP!`,'heal'); }
        if(char.lifeDrain){ const ld=rd(1,4); char.health=Math.min(char.maxHealth,char.health+ld); addLog(room,`💀 <strong>Life Drain!</strong> ${player.name} absorbs life — +${ld} HP!`,'heal'); }
      } }
    if(isAoe){ _hitTargets.filter(_t=>_t.hp<=0).forEach(_t=>{ resolveEnemyDeath(room,_t); }); if(!gs.inCombat){acted=true;return;} }
    // CANNIBALIZE MAGIC: regain casting on hit
    if(spell.name==='Cannibalize Magic' && total>0 && spellTarget){
      // Regain 1 rank-1 casting on hit
      const r1sp=(char.knownSpells||[]).find(sp=>sp.rank===1);
      if(r1sp&&char.castingPools){
        const max1=maxCastings(char.power,1);
        if((char.castingPools['R'+r1sp.rank]||0)<max1){
          char.castingPools['R'+r1sp.rank]=(char.castingPools['R'+r1sp.rank]||0)+1;
          addLog(room,`💀 <strong>Cannibalize Magic!</strong> ${player.name} devours the target's essence — regains a rank-1 casting!`,'spell');
        }
      }
    }
    if(char.spellEcho&&!char._spellEchoUsed&&spell.type==='attack'&&total>0){
      char._spellEchoUsed=true;
      const echo=Math.floor(total/2);
      spellTarget.hp=Math.max(0,spellTarget.hp-echo);
      addLog(room,`🌟 <strong>Spell Echo!</strong> ${player.name}'s spell echoes for <strong class="num-dmg">−${echo}</strong> more!`,'spell');
    }

    const _dotTargets=isAoe?_hitTargets.filter(t=>t.hp>0):[spellTarget];
    if(spell.applyBurn){
      const _burnStart=spell.burnDiceOverride||2;
      _dotTargets.forEach(t=>applyBurn(t,_burnStart,room,char));
    }
    if(char.burnOnSpell&&spell.type==='attack'&&!spell.applyBurn){ _dotTargets.filter(t=>t.hp>0).forEach(t=>applyBurn(t,1,room)); }
    if(spell.applyChilled){
      _dotTargets.forEach(t=>{ const ex=t.activeDebuffs&&t.activeDebuffs.find(d=>d.name==='Chilled'); if(ex){ex.duration=2;} else{addDebuff(t,'Chilled',{dotDmg:rd(1,3),bane:1},2); addLog(room,`❄ ${t.name} is CHILLED — 1d3/round + 1 bane for 2 rounds!`,'spell');} });
    }
    // SLOW: Freezing Fog adds an extra bane on attacks (slowed movement)
    if(spell.slowDebuff && spellTarget && spellTarget.hp>0){
      addDebuff(spellTarget,'Slowed',{bane:1},2);
      addLog(room,`🐢 <strong>Slowed!</strong> ${spellTarget.name} — movement hindered, 1 bane on attacks for 2 rounds!`,'spell');
    }
    if(spell.applyBlinded||spell.blind){
      const existing=spellTarget.activeDebuffs&&spellTarget.activeDebuffs.find(d=>d.name==='Blinded');
      if(existing){ existing.duration=1; }
      else { addDebuff(spellTarget,'Blinded',{bane:3,consumeOnMiss:true},99); }
      addLog(room,`💥 ${spellTarget.name} is BLINDED — 3 banes on its attacks until it misses!`,'spell');
    }
    if(spell.boneSplinters && spellTarget.hp>0 && spellTarget.hp<=Math.floor(spellTarget.maxHp*0.25)){
      const killRoll=d(20);
      addLog(room,`💀 Bone Splinters kill check: d20 = <strong>${killRoll}</strong> (need 10+)...`,'spell');
      if(killRoll>=10){ spellTarget.hp=0; addLog(room,`💀 <strong>INSTANT KILL!</strong> ${spellTarget.name}'s bones explode!`,'crit'); }
    }
    if(spell.applyBleed){ _dotTargets.forEach(t=>applyBleed(t,room)); }
    if(spell.applyMajorBleed){ _dotTargets.forEach(t=>{ applyBleed(t,room); applyBleed(t,room); }); } // Major Bleed = 2 applications
    // PRONE: knock down — 1 bane on next attack (consumed on miss)
    if(spell.prone && spellTarget && spellTarget.hp>0){
      addDebuff(spellTarget,'Prone',{bane:1,consumeOnMiss:true},99);
      addLog(room,`🪨 <strong>Prone!</strong> ${spellTarget.name} is knocked down — 1 bane on next attack!`,'spell');
    }
    if(spell.stunCheck){
      const stunRoll=d(20);
      addLog(room,`⚡ Stun check: d20=${stunRoll} (need 15+)...`,'spell');
      if(stunRoll>=15){addDebuff(spellTarget,'Stunned',{skipTurn:true},2);addLog(room,`💥 ${spellTarget.name} is STUNNED — loses next action!`,'crit');}
    }
    if(spell.lightningDoubleCheck){
      const dblRoll=d(20);
      addLog(room,`⚡ Double-strike check: d20=${dblRoll} (need 15+)...`,'spell');
      if(dblRoll>=15){spellTarget.hp=Math.max(0,spellTarget.hp-total);addLog(room,`⚡ <strong>DOUBLE STRIKE!</strong> Hits again for ${total} more damage!`,'crit');}
    }
    // doubleHit handled inside dMatch block
    if(spell.wrathNature){
      addDebuff(spellTarget,'Vine Snare',{bane:2},3);
      addLog(room,`🌿 ${spellTarget.name} is ensnared — 2 banes on its attacks for 3 rounds!`,'spell');
    }
    if(spell.chaosBolt&&total>0){
      const chRoll=d(20);
      addLog(room,`🎲 Chaos roll: d20 = <strong>${chRoll}</strong> (need 12+)...`,'spell');
      if(chRoll>=12){ const ex=rd(2,6); spellTarget.hp=Math.max(0,spellTarget.hp-ex); addLog(room,`🌀 <strong>Chaos surge!</strong> +${ex} extra chaos damage!`,'crit'); }
    }
    if(spell.healthPenalty&&spellTarget){
      spellTarget.maxHp=Math.max(1,spellTarget.maxHp-spell.healthPenalty);
      spellTarget.hp=Math.min(spellTarget.maxHp,spellTarget.hp);
      addDebuff(spellTarget,'Enervated',{},99);
      addLog(room,`${spellTarget.name} max HP reduced by ${spell.healthPenalty} for the rest of combat!`,'spell');
    }

    addLog(room,`${spellTarget.name}: <strong>${Math.max(0,spellTarget.hp)}</strong>/${spellTarget.maxHp} HP remaining.`,'sys');
    // fire immunity removed — all enemies take fire damage
    if(spellTarget.hp<=0){resolveEnemyDeath(room,spellTarget);return;}
    // Overload: cast twice
    const _overloadBuff=(char.activeBuffs||[]).find(b=>b.overloadReady);
    if(_overloadBuff&&spell.type==='attack'){
      char.activeBuffs=char.activeBuffs.filter(b=>!b.overloadReady);
      const _ov_intMod=Math.max(0,modVal(char.attrs.int));
      const _ovM=(spell.dmg||spell.dmgDice||'1d6').match(/^(\d+)d(\d+)(?:\+(\d+))?$/)||[0,1,6,0];
      const _ov_roll=rd(+_ovM[1],+_ovM[2]); let _ov_total=_ov_roll+(+_ovM[3]||0)+_ov_intMod;
      if(spellTarget&&spellTarget.hp>0){
        spellTarget.hp=Math.max(0,spellTarget.hp-_ov_total);
        addLog(room,`💥 <strong>Overload echo!</strong> Spell fires again — <strong class="num-dmg">-${_ov_total}</strong> to ${spellTarget.name}!`,'spell');
        if(spellTarget.hp<=0){resolveEnemyDeath(room,spellTarget);}
      }
    }
  } // end attack spell else
  acted=true;
  return acted;
}

// Activate a combat talent. Returns true when the action used the turn; undefined aborts with no turn spent.
// Undead, daemons and the servants of Chaos (Silver Shot).
function isUnholy(e){
  if(!e) return false;
  if(e.undead) return true;
  const tags=e.tags||[];
  return tags.includes('undead')||tags.includes('chaos')||tags.includes('daemon')||/undead|daemon|chaos/i.test(e.type||'');
}

function actUseTalent({room,playerId,data,ws,player,gs,char}){
  let acted=false;
  const t=data.talent;
  // Block: a free action every career has. Halves the damage you take until your next turn.
  if(t==='block'){
    if(char._blockUsed){ addLog(room,`${player.name}: Block is recharging.`,'sys'); return; }
    char._blockUsed=true; addBuff(char,'Blocking',{blocking:true},3);
    addLog(room,`🛡 <strong>Block!</strong> ${player.name} raises their guard — damage taken is halved until their next turn.`,'spell');
    return false;
  }
  // Revive: every career can drag a fallen ally back into the fight. Uses your turn; long cooldown.
  if(t==='revive'){
    if(char._reviveUsed){ addLog(room,`${player.name}: Revive is recharging.`,'sys'); return; }
    const fallen=room.players.filter(p=>p.char&&!p.char.alive&&p.id!==playerId);
    const tgt=(data.targetId&&fallen.find(p=>p.id===data.targetId))||fallen[0];
    if(!tgt){ addLog(room,`${player.name}: nobody has fallen.`,'sys'); return; }
    char._reviveUsed=true;
    tgt.char.alive=true; tgt.char.pendingRevive=false; tgt.char.health=Math.max(1,Math.ceil(tgt.char.maxHealth*0.25));
    addLog(room,`🙏 <strong>Revive!</strong> ${player.name} hauls ${tgt.name} back to their feet — <strong class="num-heal">${tgt.char.health} HP</strong>.`,'heal');
    return true;
  }
  // Condemn is a free action: marking a target doesn't use your turn.
  if(t==='condemn'){
    if(!char.condemn){ addLog(room,`${player.name} cannot Condemn.`,'sys'); return; }
    if(char._condemnUsed){ addLog(room,`${player.name}: Condemn is recharging.`,'sys'); return; }
    const te=getTargetEnemy(gs); if(!te||te.hp<=0) return;
    char._condemnUsed=true; char._condemnTargetId=te.id;
    (te.activeDebuffs=te.activeDebuffs||[]).filter(d=>d.condemned).forEach(d=>{ d.duration=0; });
    addDebuff(te,'Condemned',{condemned:true},99);
    addLog(room,`⚖ <strong>Condemn!</strong> ${player.name} names ${te.name} a heretic — +1 boon and +1d6 on every hit${char.judgement?' (+2 Judgement)':''}.`,'crit');
    return false;
  }
  const _lowestAlly=()=>{ const tp=data.targetId&&room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive); if(tp) return tp; return room.players.filter(p=>p.char&&p.char.alive).sort((a,b)=>a.char.health/a.char.maxHealth-b.char.health/b.char.maxHealth)[0]; };
  if(t==='taunt'){
    if(!char.taunt){addLog(room,`${player.name} does not have Taunt.`,'sys');return;}
    if((char._tauntReadyRound||0)>gs.roundNumber){addLog(room,`${player.name}: Taunt is ready again in round ${char._tauntReadyRound}.`,'sys');return;}
    char._tauntReadyRound=gs.roundNumber+3;
    addBuff(char,'Taunting',{taunting:true},2);
    addLog(room,`📯 <strong>Taunt!</strong> ${player.name} roars a challenge — all enemies attack only ${player.name} for 2 rounds!`,'crit');
    acted=true;
  }
  else if(t==='metamagic'||t==='spellsurge'){
    const usedKey=t==='metamagic'?'metamagicUsed':'spellsurgeUsed';
    if(!char[t]||char[usedKey]){addLog(room,`${player.name}: ${t==='metamagic'?'Metamagic':'Spell Surge'} is not available.`,'sys');return;}
    char[usedKey]=true; char._freeCastArmed=true;
    addLog(room,`✨ <strong>${t==='metamagic'?'Metamagic':'Spell Surge'}!</strong> ${player.name}'s next spell costs no casting.`,'spell');
    return; // no action cost
  }
  if(t==='miracleHeal'){
    if(!char.miracleHeal||char.miracleUsed){addLog(room,`${player.name}: Miracle Heal is not available.`,'sys');return;}
    const mt=_lowestAlly(); if(!mt) return; char.miracleUsed=true;
    mt.char.health=mt.char.maxHealth; addLog(room,`🌟 <strong>Miracle Heal!</strong> ${player.name} restores ${mt.name} to full HP!`,'heal');
    if(char.protectiveBlessing){ addBuff(mt.char,'Protective Blessing',{defBonus:2},1); mt.char.defense+=2; }
    acted=true;
  }
  else if(t==='resurrection'){
    if(!char.resurrection||char.resurrectionUsed){addLog(room,`${player.name}: Resurrection is not available.`,'sys');return;}
    const rt=_lowestAlly(); if(!rt) return; char.resurrectionUsed=true;
    addBuff(rt.char,'Resurrection Shield',{resurrectionShield:true},99);
    addLog(room,`✨ <strong>Resurrection!</strong> ${player.name} blesses ${rt.name} — the next killing blow leaves them at half HP instead.`,'heal');
    acted=true;
  }
  else if(t==='entangle'){
    if(!char.entangle||char._entangleUsed){addLog(room,`${player.name}: Entangle is not available.`,'sys');return;}
    const et=getTargetEnemy(gs); if(!et){addLog(room,'No enemy to entangle.','sys');return;}
    char._entangleUsed=true; addDebuff(et,'Rooted',{skipTurn:true},1);
    addLog(room,`🌿 <strong>Entangle!</strong> Roots seize ${et.name} — it loses its next action!`,'spell');
    acted=true;
  }
  else     if(t==='shieldBash'){
    if(char._shieldBashUsed){addLog(room,`${player.name}: Shield Bash already used this combat.`,'sys');return;}
    if(!char.shieldBash){addLog(room,`${player.name} does not have Shield Bash.`,'sys');return;}
    const _sbEnemy=getTargetEnemy(gs);
    if(!_sbEnemy){addLog(room,'No enemy to bash!','sys');return;}
    char._shieldBashUsed=true;
    addDebuff(_sbEnemy,'Stunned',{skipTurn:true},2);
    addLog(room,`🛡 <strong>Shield Bash!</strong> ${player.name} slams shield into ${_sbEnemy.name} — <strong>STUNNED</strong> for 2 turns!`,'crit');
    acted=true;
  }
  else if(t==='curse'&&!char._curseUsed&&char.curse){
    char._curseUsed=true;
    const ce=getTargetEnemy(gs);
    if(!ce){addLog(room,'No target to curse.','sys');return;}
    addDebuff(ce,'Curse',{curse:true,atkBoon:-1,bonusDmg:1},9999);
    addLog(room,`🎃 <strong>Curse!</strong> ${player.name} curses ${ce.name} — all attacks gain 1 boon and +1 damage until it dies!`,'spell');
    acted=true;
  }
  else if(t==='catchBreath'){if(char.catchBreathUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.catchBreathUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Catch Your Breath — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}
  else if(t==='nimbleRecovery'){if(char.nimbleUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.nimbleUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Nimble Recovery — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}
  else if(t==='sharedRecovery'){if(char.sharedUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.sharedUsed=true;room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{const h=talentHeal(char);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);});addLog(room,`${player.name} uses Shared Recovery — all allies healed 1d6+attr×2 HP!`,'heal');}
  else if(t==='spellRecovery'){if(char.spellRecoveryUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.spellRecoveryUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);if(char.castingPools){char.knownSpells.filter(sp=>sp.rank===0).forEach(sp=>{char.castingPools['R'+sp.rank]=maxCastings(char.power,0);});} addLog(room,`${player.name} uses Spell Recovery — +<strong>${h}</strong> HP + all rank-0 castings restored!`,'spell');}
  else if(t==='divineSmite'){if(char.divineSmiteUsed){addLog(room,`${player.name}: Divine Smite is recharging.`,'sys');return;}char._divineSmiteCount=(char._divineSmiteCount||0)+1;char.divineSmiteUsed=true;const _te=getTargetEnemy(gs);if(!_te)return;
    const isEvil=_te.undead||_te.chaos||(_te.tags&&(_te.tags.includes('undead')||_te.tags.includes('chaos')));
    const smiteDice=char.wrathOfSigmar?6:3;
    const smiteRoll=rollAttack(char,_te,0);
    if(smiteRoll.hit){
      const holyDmg=rd(smiteDice||3,6);
      const totalSmite=smiteRoll.dmg+holyDmg;
      _te.hp=Math.max(0,_te.hp-totalSmite);
  if(char.holyFire&&isEvil&&_te.hp>0){ applyBurn(_te,2,room); addLog(room,`🔥 <strong>Holy Fire!</strong> Divine wrath ignites ${_te.name}!`,'spell'); }
      addLog(room,`⚡ <strong>${player.name}</strong> calls Divine Smite — ${smiteRoll.dmgParts.join(' ')}=<strong>${smiteRoll.dmg}</strong> weapon + <strong>${holyDmg}</strong> holy = <strong class="num-dmg">−${totalSmite}</strong> total → ${_te.name} ${_te.hp}/${_te.maxHp} HP`,'crit');
    } else {
      addLog(room,`${player.name} calls Divine Smite but misses (d20:${smiteRoll.base}+${smiteRoll.atkMod} vs Def${_te.ac}).`,'sys');
    }
    if(_te.hp<=0){resolveEnemyDeath(room,_te);return;}}
  else if(t==='overcharge'){
    if(!char.overcharge){addLog(room,`${player.name}: no Overcharge.`,'sys');return;}
    if(char._overchargeUsed){addLog(room,`${player.name}: Overcharge already used this combat.`,'sys');return;}
    char._overchargeUsed=true;
    // Arm the overcast buff — next rank-0 spell deals +2d6 and doesn't spend a casting
    addBuff(char,'Overcharge (+2d6)',{overcastDmg:true},1);
    addLog(room,`⚡ <strong>${player.name} Overcharges!</strong> Next rank-0 spell: +2d6 damage, free cast!`,'crit');
    acted=true;
  }
  else if(t==='overcast'){
    if(!char.overcast){addLog(room,`${player.name}: no Overcast.`,'sys');return;}
    const maxOvercast=(char.doubleCharge?2:1);
    if(char.overcastUsed&&(char._doubleChargeCount||0)>=maxOvercast){addLog(room,`${player.name}: Overcast already armed (${maxOvercast} uses max).`,'sys');return;}
    char.overcastUsed=true;
    addBuff(char,'Overcast (+2d6)',{overcastDmg:true},1);
    addLog(room,`${player.name} arms <strong>Overcast</strong> — next spell spends 2 castings, deals +2d6!`,'spell');
  }
  else if(t==='bloodOffering'){
    if(!char.bloodOffering){addLog(room,`${player.name}: no Blood Offering.`,'sys');return;}
    const boCost=rd(1,6); char.health=Math.max(1,char.health-boCost);
    uniqRanks(char.knownSpells).forEach(sp=>{
      if(sp.rank<=2&&char.castingPools){
        const max=maxCastings(char.power,sp.rank);
        char.castingPools['R'+sp.rank]=Math.min(max,(char.castingPools['R'+sp.rank]||0)+1);
      }
    });
    addLog(room,`${player.name} uses Blood Offering — loses <strong>${boCost}</strong> HP, regains 1 casting of all rank 0-2 spells!`,'chaos');
    acted=true;
  }
  else if(t==='catastrophe'){
    if(!char.catastrophe){addLog(room,`${player.name}: no Catastrophe.`,'sys');return;}
    if(char.catastropheUsed){addLog(room,`${player.name}: Catastrophe already used.`,'sys');return;}
    char.catastropheUsed=true;
    const enemies=gs.enemies&&gs.enemies.length>0?gs.enemies.filter(e=>e&&e.hp>0):[gs.enemy].filter(Boolean);
    if(!enemies.length){addLog(room,'No enemies.','sys');return;}
    const dmg=rd(10,6);
    enemies.forEach(e=>{
      e.hp=Math.max(0,e.hp-dmg);
      addLog(room,`💥 Catastrophe hits <strong>${e.name}</strong> — <strong class="num-dmg">−${dmg} dmg</strong> → ${Math.max(0,e.hp)}/${e.maxHp} HP`,'crit');
      if(e.hp<=0){resolveEnemyDeath(room,e);}
    });
    acted=true;
  }
  else if(t==='deadAim'){
    if(!char.deadAim){addLog(room,`${player.name}: no Dead Aim.`,'sys');return;}
    if(char._deadAimUsed){addLog(room,`${player.name}: Dead Aim already used this combat.`,'sys');return;}
    char._deadAimUsed=true;
    char._deadAimArmed=true;
    addLog(room,`🎯 <strong>${player.name}</strong> takes Dead Aim — next attack is a guaranteed critical hit!`,'crit');
    acted=true;
  }
  else if(t==='rallyingCry'){if(char.rallyingUsed){addLog(room,`${player.name}: Rallying Cry already used.`,'sys');return;}char.rallyingUsed=true;room.players.forEach(p=>{if(p.char&&p.char.alive){const h=talentHeal(p.char);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} rallies — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}});}
  else if(t==='massHeal'){if(char.massHealUsed){addLog(room,`${player.name}: Mass Heal already used.`,'sys');return;}char.massHealUsed=true;
    const mhDice=char.triage?2:1; // Shallya path healer gets enhanced 2d6
    room.players.forEach(p=>{if(p.char&&p.char.alive){const h=rd(mhDice,6);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} healed <strong>${h}</strong> HP.`,'heal');
      if(char.overflowingGrace&&p.char.activeBuffs){const before=p.char.activeBuffs.length;p.char.activeBuffs=p.char.activeBuffs.filter((b,i)=>i!==p.char.activeBuffs.findIndex(x=>x.bane||x.skipTurn||x.dmgPenalty));if(p.char.activeBuffs.length<before)addLog(room,`✨ Grace removes a debuff from ${p.name}!`,'heal');}
    }});if(char.battleMedic){const bmH=rd(1,6);char.health=Math.min(char.maxHealth,char.health+bmH);addLog(room,`💊 <strong>Battle Medic!</strong> ${player.name} heals <strong>${bmH}</strong> HP from treating allies!`,'heal');}addLog(room,`${player.name} uses <strong>Mass Heal</strong>!`,'heal');}
  else if(t==='markHeretic'){
    const _te=getTargetEnemy(gs); if(!_te)return;
    char._markHereticTarget=_te; addLog(room,`⚖ <strong>Mark Heretic!</strong> ${player.name} marks ${_te.name} — crits auto-Bleed, cannot flee!`,'sys');
  }
  else if(t==='smokeScreen'){
    if(char._smokeScreenUsed){addLog(room,`${player.name}: Smoke Screen already used.`,'sys');return;}
    char._smokeScreenUsed=true;
    (gs.enemies||[]).filter(e=>e&&e.hp>0).forEach(e=>addDebuff(e,'Smoke Screen',{bane:3},2));
    addLog(room,`💨 <strong>Smoke Screen!</strong> All enemies have 3 banes for 2 rounds!`,'spell');
  }
  else if(t==='evilEye'){
    if(char._evilEyeUsed){addLog(room,`${player.name}: Evil Eye already used.`,'sys');return;}
    const _te=getTargetEnemy(gs); if(!_te)return;
    char._evilEyeUsed=true;
    addDebuff(_te,'Evil Eye',{bane:2,isEvilEye:true},4);
    addLog(room,`🌙 <strong>Evil Eye!</strong> ${_te.name} has 2 banes on attacks for 3 rounds!`,'chaos');
  }
  else if(t==='foresight'&&!char._foresightUsed&&char.foresight){
    char._foresightUsed=true;
    const fP=room.players.find(p=>p.id===(data.targetId||player.id))||player;
    if(fP&&fP.char){addBuff(fP.char,'Foresight',{foresightRerolls:2,rerollHigher:true},99);addLog(room,`🔮 <strong>Foresight!</strong> ${fP.name} — next 2 attack rolls reroll, take higher!`,'spell');}
    acted=true;
  }
  else if(t==='revelation'&&!char._revelationUsed&&char.revelation){
    char._revelationUsed=true;
    const re=getTargetEnemy(gs);
    if(re){addDebuff(re,'Revelation',{forceReroll:true,rerollCount:2},99);addLog(room,`📖 <strong>Revelation!</strong> ${re.name} exposed — next 2 attack rolls reroll, take worse!`,'spell');}
    acted=true;
  }
  else if(t==='triage'&&!char._triageUsed&&char.triage){
    char._triageUsed=true;
    room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{addBuff(p.char,'Triage Regen',{regenPerRound:true,regenDice:'1d6'},2);});
    addLog(room,`💉 <strong>Triage!</strong> ${player.name} channels Shallya — all allies <strong>regen 1d6 HP/round</strong> for 2 turns!`,'heal');
    acted=true;
  }
  else if(t==='sacredGround'){
    if(char._sacredGroundUsed){addLog(room,`${player.name}: Sacred Ground already used.`,'sys');return;}
    char._sacredGroundUsed=true;
    room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{addBuff(p.char,'Sacred Ground',{regenPerRound:true,regenDice:'1d6'},2);addBuff(p.char,'Sacred Ground Boons',{atkBoon:3},2);});
    addLog(room,`⛪ <strong>Sacred Ground!</strong> ${player.name} consecrates the ground — all allies regen 1d6 HP/round and gain 3 boons for 2 rounds!`,'heal');
  }
  else if(t==='divineFavour'){ char._divineFavourUsed=true;
    char.catchBreathUsed=false;char.nimbleUsed=false;char.sharedUsed=false;char.spellRecoveryUsed=false;
    char.resurrectionUsed=false;char.massHealUsed=false;char._shieldBashUsed=false;char._darkPactUsed=false;char._triageUsed=false;
    if((char._divineSmiteCount||0)>0)char._divineSmiteCount--;char.divineSmiteUsed=false;
    regainCasting(char,0);
    addLog(room,`🙏 <strong>Divine Favour!</strong> ${player.name} — all 1×/combat abilities refreshed + 1 rank-0 casting!`,'spell');
    acted=true;
  }
  else if(t==='warCry'){
    if(char._warCryUsed){addLog(room,`${player.name}: War Cry already used.`,'sys');return;}
    char._warCryUsed=true;
    room.players.filter(p=>p.char&&p.char.alive).forEach(p=>addBuff(p.char,'War Cry',{atkBonus:2},1));
    addLog(room,`👑 <strong>War Cry!</strong> All allies gain +2 ATK for this round!`,'crit');
  }
  else if(t==='devastatingCharge'){
    if(char._devastatingChargeUsed){addLog(room,`${player.name}: Devastating Charge already used.`,'sys');return;}
    if(gs.roundNumber!==1){addLog(room,`${player.name}: Devastating Charge is only usable on round 1!`,'sys');return;}
    char._devastatingChargeUsed=true; char._devastatingChargeArmed=true;
    addLog(room,`🐎 <strong>Devastating Charge!</strong> ${player.name} arms a devastating charge — next attack +1d6 and Prone!`,'crit');
  }
  else if(t==='counterspell'){
    if(char._counterspellUsed){addLog(room,`${player.name}: Counterspell already used.`,'sys');return;}
    char._counterspellUsed=true; char._counterspellActive=true;
    addLog(room,`🔵 <strong>Counterspell!</strong> ${player.name} readies a counterspell — the next enemy on-hit ability will be negated!`,'spell');
  }
  else if(t==='banish'){
    if(char._banishUsed){addLog(room,`${player.name}: Banish already used.`,'sys');return;}
    const _te=getTargetEnemy(gs); if(!_te)return;
    if(!(_te.chaos||_te.undead||(_te.tags&&(_te.tags.includes('chaos')||_te.tags.includes('undead'))))){addLog(room,`${player.name}: Banish only works on Chaos or Undead!`,'sys');return;}
    char._banishUsed=true;
    addDebuff(_te,'Banished',{skipTurn:true},1);
    addLog(room,`✝ <strong>Banish!</strong> ${player.name} banishes ${_te.name} — loses next action!`,'spell');
  }
  else if(t==='overload'&&!char._overloadUsed&&char.overload){
    char._overloadUsed=true;
    addBuff(char,'Overload',{overloadReady:true},99);
    addLog(room,`💥 <strong>Overload!</strong> ${player.name} primes their magic — next spell will cast twice!`,'spell');
    acted=false;
  }
  else if(t==='druidsFury'&&!char._druidsFuryUsed&&char.druidsFury){
    char._druidsFuryUsed=true;
    addBuff(char,'Druids Fury',{druidsFuryActive:true,druidsFuryRounds:2,atkBoon:2},2);
    addLog(room,`🌿 <strong>Druids Fury!</strong> ${player.name} channels the wild — +1d6 dmg, +2 boons and 2 Bleed per hit for 2 rounds!`,'crit');
    acted=false;
  }
  else if(t==='darkPact'){
    if(char._darkPactUsed){addLog(room,`${player.name}: Dark Pact already used this combat.`,'sys');return;}
    char._darkPactUsed=true; char._darkPactArmed=true;
    const bk=rd(1,6); char.health=Math.max(0,char.health-bk);
    addLog(room,`🩸 <strong>Dark Pact!</strong> ${player.name} loses ${bk} HP — next spell costs no casting! (no action cost)`, 'chaos');
    acted=false; // no action cost
  }
  else if(t==='uncontrolledPower'){
    if(char._uncontrolledPowerUsed){addLog(room,`${player.name}: Uncontrolled Power already used.`,'sys');return;}
    char._uncontrolledPowerUsed=true; char._uncontrolledPowerArmed=true;
    addLog(room,`🌪 <strong>Uncontrolled Power!</strong> ${player.name} unleashes unstable magic — next spell deals double dice but takes 1d6 backlash!`,'chaos');
  }
  else if(t==='esotericKnowledge'){
    if(char._esotericKnowledgeUsed){addLog(room,`${player.name}: Esoteric Knowledge already used.`,'sys');return;}
    char._esotericKnowledgeUsed=true; char._esotericScrollArmed=true;
    addLog(room,`📜 <strong>Esoteric Knowledge!</strong> ${player.name} can use a scroll spell this combat without consuming it!`,'spell');
  }
  else if(t==='doubleCharge'){
    if(char._doubleChargeUsed){addLog(room,`${player.name}: Double Charge is recharging.`,'sys');return;}
    if(char.overcastUsed){addLog(room,`${player.name}: Overcast already armed this round.`,'sys');return;}
    char._doubleChargeCount=(char._doubleChargeCount||0)+1; char._doubleChargeUsed=true; char.overcastUsed=false;
    addLog(room,`🌀 <strong>Double Charge!</strong> ${player.name} rearms Overcast!`,'spell');
  }
  else if(t==='intercept'){
    if(char._interceptUsed){addLog(room,`${player.name}: Intercept already used.`,'sys');return;}
    char._interceptUsed=true; char._interceptActive=true;
    addLog(room,`⚡ <strong>Intercept!</strong> ${player.name} will redirect the next attack aimed at an ally!`,'sys');
  }
  else if(t==='battleOrders'){
    if(char._battleOrdersUsed){addLog(room,`${player.name}: Battle Orders already used.`,'sys');return;}
    char._battleOrdersUsed=true;
    const ally=room.players.find(p=>p.id!==playerId&&p.char&&p.char.alive&&gs.playersActedThisRound.includes(p.id));
    if(!ally){addLog(room,`${player.name}: No acted allies to grant an extra action.`,'sys');return;}
    gs.playersActedThisRound=gs.playersActedThisRound.filter(id=>id!==ally.id);
    addLog(room,`⚡ <strong>Battle Orders!</strong> ${player.name} commands ${ally.name} — they may act again!`,'crit');
  }
  return acted;
}

module.exports = { bind, actAttack, actCastSpell, isUnholy, actUseTalent };
