'use strict';
// Combat flow: turn order, the party turn timer, enemy turns, rounds and deaths.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let SELF_TICK_DOTS, addBuff, addDebuff, addLog, aliveEnemies, applyPoison, broadcastState, charmKey, d, dark, enemyAfterHit, enemyDamageMods, enemyPostTurn, enemyPreTurn, engineerRoundTick, gearRoundTick, hasRelic, immuneToPoison, rd, resolveEnemyDeath, rollAttack, rollEnemyAttack, scaleEnemy, sortTurnOrder, tickBuffs, tickCooldowns, tickDebuffs, triggerGameover;
function bind(api) {
  ({ SELF_TICK_DOTS, addBuff, addDebuff, addLog, aliveEnemies, applyPoison, broadcastState, charmKey, d, dark, enemyAfterHit, enemyDamageMods, enemyPostTurn, enemyPreTurn, engineerRoundTick, gearRoundTick, hasRelic, immuneToPoison, rd, resolveEnemyDeath, rollAttack, rollEnemyAttack, scaleEnemy, sortTurnOrder, tickBuffs, tickCooldowns, tickDebuffs, triggerGameover } = api);
}
// ─── COMBAT FLOW: TURN ORDER ───────────────────────────────────────────────────────

function buildTurnOrder(room) {
  if(room.gs._nextCombatFirstEnemyStunned){
    room.gs._nextCombatFirstEnemyStunned=false;
    const firstEnemy=(room.gs.enemies||[]).find(e=>e&&e.hp>0);
    if(firstEnemy){ addDebuff(firstEnemy,'Ambush Stun',{skipTurn:true},1); addLog(room,`🐀 Ambush! ${firstEnemy.name} walked into a trap — stunned first turn!`,'sys'); }
  }
  const gs = room.gs;
  const order = [];
  room.players.filter(p => p.char && p.char.alive).forEach(p => {
    order.push({ type: 'player', id: p.id, name: p.name });
  });
  (gs.enemies || []).filter(e => e && e.hp > 0).forEach(e => {
    order.push({ type: 'enemy', id: e.id || e.name, name: e.name });
  });
  gs.turnOrder = sortTurnOrder(gs, order);
  if (gs._enemiesFirst) { // an event gave the enemy the first strike
    gs._enemiesFirst = false;
    gs.turnOrder = [...gs.turnOrder.filter(t => t.type === 'enemy'), ...gs.turnOrder.filter(t => t.type !== 'enemy')];
    addLog(room, '⚠ The enemy strikes first!', 'dmg');
  }
  gs.activeTurnIdx = 0;
}

function getCurrentTurn(gs) {
  if (!gs.turnOrder || !gs.turnOrder.length) return null;
  return gs.turnOrder[gs.activeTurnIdx] || null;
}

// A stunned player's turn is skipped automatically (same as enemies).
function autoSkipStunnedPlayer(room, playerId){
  const gs=room.gs; const p=room.players.find(pl=>pl.id===playerId);
  if(!p||!p.char||!p.char.alive) return false;
  if(!p.connected){ // disconnected players don't hold up the fight
    addLog(room,`${p.name} is absent — turn skipped.`,'sys');
    setTimeout(()=>{ try{ if(gs.inCombat) advanceTurn(room); broadcastState(room.code); }catch(e){ console.error('Skip error:',e); } },300);
    return true;
  }
  const st=(p.char.activeBuffs||[]).find(b=>b.skipTurn);
  if(!st) return false;
  st.duration--;
  if(st.duration<=0) p.char.activeBuffs=p.char.activeBuffs.filter(b=>!b.skipTurn);
  addLog(room,`💫 ${p.name} is stunned and loses their action!${st.duration>0?` (${st.duration} more turn)`:''}`,'sys');
  broadcastState(room.code);
  setTimeout(()=>{ try{ if(gs.inCombat) advanceTurn(room); broadcastState(room.code); }catch(e){ console.error('Stun skip error:',e); } },700);
  return true;
}

function advanceTurn(room) {
  const gs = room.gs;
  if (!gs.turnOrder) return;
  if (!gs.inCombat || gs.phase === 'victory' || gs.phase === 'gameover' || gs.phase === 'dying') return;
  gs.activeTurnIdx++;
  while (gs.activeTurnIdx < gs.turnOrder.length) {
    const slot = gs.turnOrder[gs.activeTurnIdx];
    if (slot.type === 'player') {
      const p = room.players.find(pl => pl.id === slot.id);
      if (p && p.char && p.char.alive) break;
    } else {
      const e = (gs.enemies || []).find(e => e && (e.id === slot.id || e.name === slot.name));
      if (e && e.hp > 0) break;
      if (e && e.hp <= 0) gs.enemies = gs.enemies.filter(en => en !== e);
    }
    gs.activeTurnIdx++;
  }

  if (gs.activeTurnIdx >= gs.turnOrder.length) {
    endRound(room);
    return;
  }

  const cur = gs.turnOrder[gs.activeTurnIdx];
  if (cur.type === 'enemy') {
    const ae = (gs.enemies || []).find(e => e && (e.id === cur.id || e.name === cur.name) && e.hp > 0);
    if (ae) {
      addLog(room, `--- ${ae.name}'s turn ---`, 'sys');
      broadcastState(room.code); // show "enemy attacking" before delay
      setTimeout(() => {
        try {
          if (!gs.inCombat) return;
          const stillAlive = (gs.enemies || []).find(e => e && (e.id === cur.id || e.name === cur.name) && e.hp > 0);
          if (stillAlive) fireEnemyTurn(room, stillAlive);
          else advanceTurn(room);
          broadcastState(room.code);
        } catch(e){ console.error('Enemy turn error:', e); try{ advanceTurn(room); }catch(e2){} broadcastState(room.code); }
      }, 800);
    } else {
      advanceTurn(room); // skip dead enemy
    }
  } else {
    gs.playersActedThisRound = gs.playersActedThisRound.filter(id => id !== cur.id);
    addLog(room, `--- ${cur.name}'s turn ---`, 'sys');
    const _cp = room.players.find(pl => pl.id === cur.id);
    if (_cp && _cp.char && _cp.char.activeBuffs) _cp.char.activeBuffs = _cp.char.activeBuffs.filter(b => !b.blocking); // Block lasts until your next turn
    if (autoSkipStunnedPlayer(room, cur.id)) return;
    startTurnTimer(room, cur);
    broadcastState(room.code);
  }
}

// ─── TURN TIMER ───────────────────────────────────────────────────────────────
// In a party, a player who doesn't act within the limit loses their turn, so one
// idle player can't stall everyone. Solo games have no timer.
const TURN_LIMIT_MS = 60 * 1000;
function startTurnTimer(room, cur){
  const gs = room.gs;
  if (room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
  const present = room.players.filter(p => p.connected && p.char && p.char.alive);
  if (present.length < 2 || process.env.NO_TURN_TIMER) { gs.turnDeadline = null; return; } // simulations turn it off
  gs.turnDeadline = Date.now() + TURN_LIMIT_MS;
  const idx = gs.activeTurnIdx, round = gs.roundNumber;
  const t = setTimeout(() => {
    room._turnTimer = null;
    try {
      const now = gs.turnOrder && gs.turnOrder[gs.activeTurnIdx];
      if (!gs.inCombat || gs.phase !== 'combat' || gs.activeTurnIdx !== idx || gs.roundNumber !== round || !now || now.id !== cur.id) return;
      gs.turnDeadline = null;
      addLog(room, `⌛ ${cur.name} hesitates too long — the moment passes.`, 'sys');
      advanceTurn(room);
      broadcastState(room.code);
    } catch (e) { console.error('Turn timer error:', e); }
  }, TURN_LIMIT_MS);
  if (t.unref) t.unref();
  room._turnTimer = t;
}

function endRound(room) {
  const gs = room.gs;
  if (!gs.inCombat || gs.phase === 'victory' || gs.phase === 'gameover' || gs.phase === 'dying') return;
  gs.totalRounds = (gs.totalRounds || 0) + 1;
  tickCooldowns(room);
  dark.onRoundEnd(room);
  engineerRoundTick(room);
  room.players.forEach(p => {
      if (!p.char || !p.char.alive) return;
      tickBuffs(p.char);
      if (p.char.health <= 0 && p.char.alive) { checkDeath(room, p); } // DoT (Bleed/Burn/Chilled) kill check
      if (immuneToPoison(p.char)) p.char._poisonedStacks = 0;
      if (p.char._poisonedStacks && p.char._poisonedStacks > 0 && !p.char.fortitude) {
        const _ppd = p.char._poisonedStacks;
        p.char.health = Math.max(0, p.char.health - _ppd);
        addLog(room, `☠ <strong>Poison</strong> (${p.char._poisonedStacks} stk) — <strong class="num-dmg">\u2212${_ppd}</strong> to ${p.name} \u2192 ${p.char.health}/${p.char.maxHealth} HP`, 'spell');
        p.char._poisonedStacks = Math.max(0, p.char._poisonedStacks - 2);
        if (p.char.health <= 0) checkDeath(room, p);
      }
    });
  gearRoundTick(room);
  (gs.enemies || []).filter(en=>en&&en.hp>0).forEach(en => {
    en._guardUsed = false; // Halberd Guard resets each round
    tickDebuffs(en);
    if(en._mistFormRounds>0) en._mistFormRounds--;
    // poison damage + decay handled in fireEnemyTurn (during enemy's turn)
  });
  if (gs.packCooldown > 0) {
    gs.packCooldown--;
    if (gs.packCooldown === 0) addLog(room, 'Call the Pack cooldown lifted.', 'sys');
  }
  gs.playersActedThisRound = [];
  gs.enemyHasActed = false;
  room.players.forEach(p=>{ if(p.char&&p.char.fadePassive){ p.char._fadedLastRound=(p.char.activeBuffs||[]).some(b=>b.name==='Quick Step');
    p.char._wasAttackedThisRound=false; } });
  room.players.forEach(p=>{ if(p.char) { p.char._killedThisTurn=false;
    p.char.trickeryUsed=false;
    p.char._wpnRiposteUsedThisRound=false;
    p.char._wpnCleaveReady=false;
    p.char._wpnCleaveBonus=false; } }); // trickeryUsed still resets for future use; _trickeryFirstHit persists for combat
  gs.roundNumber = (gs.roundNumber || 1) + 1;
  addLog(room, `--- Round ${gs.roundNumber} begins ---`, 'sys');
  buildTurnOrder(room);
  if (!gs.turnOrder.length) {
    triggerGameover(room); return;
  }
  const first = gs.turnOrder[0];
  if (first.type === 'enemy') {
    addLog(room, `--- ${first.name}'s turn ---`, 'sys');
    broadcastState(room.code); // show "enemy attacking" before delay
    setTimeout(() => {
      try {
        if (!gs.inCombat) return;
        const ae = (gs.enemies || []).find(e => e && (e.id === first.id || e.name === first.name) && e.hp > 0);
        if (ae) fireEnemyTurn(room, ae);
        else advanceTurn(room);
        broadcastState(room.code);
      } catch(e){ console.error('Enemy turn error:', e); try{ advanceTurn(room); }catch(e2){} broadcastState(room.code); }
    }, 800);
  } else {
    gs.playersActedThisRound = gs.playersActedThisRound.filter(id => id !== first.id);
    addLog(room, `--- ${first.name}'s turn ---`, 'sys');
    if (autoSkipStunnedPlayer(room, first.id)) return;
    broadcastState(room.code);
  }
}

function fireEnemyTurn(room, ae) {
  const gs = room.gs;
  if (!gs.inCombat || !ae || ae.hp <= 0) { advanceTurn(room); return; }

  if (ae.tags && ae.tags.includes('undead') && ae.hp < ae.maxHp * 0.3 && !ae._undeathUsed) {
    ae._undeathUsed = true;
    const h = rd(2, 6);
    ae.hp = Math.min(ae.maxHp, ae.hp + h);
    addLog(room, `Undeath! ${ae.name} surges — heals ${h} HP!`, 'chaos');
  }
  if (ae.regen && ae.hp < ae.maxHp) {
    let regenAmt;
    if(ae._regenOverride && ae._regenOverrideTurns>0){ regenAmt=ae._regenOverride; ae._regenOverrideTurns--; if(ae._regenOverrideTurns<=0) ae._regenOverride=0; } else { regenAmt=rd(1,6); }
    ae.hp = Math.min(ae.maxHp, ae.hp + regenAmt);
    addLog(room, `💚 ${ae.name} regenerates <strong>${regenAmt}</strong> HP.`, 'chaos');
  }
  if (ae._poisonStacks && ae._poisonStacks > 0) {
    const pdmg = ae._poisonStacks; // 1 dmg per stack (flat)
    if(ae._poisonStacks>=10 && ae.maxHp>1){ ae.maxHp=Math.max(1,ae.maxHp-1); addLog(room,`☠ <strong>Wasting Sickness!</strong> ${ae.name} loses 1 max HP from virulent poison!`,'chaos'); }
    ae.hp = Math.max(0, ae.hp - pdmg);
    addLog(room, `☠ <strong>Poison</strong> (${ae._poisonStacks} stk${ae._poisonStacks>=5?' · <span style="color:#ff9944">bane</span>':''}${ae._poisonStacks>=10?' · <span style="color:#cc4444">wasting</span>':''}) — <strong class="num-dmg">−${pdmg}</strong> to ${ae.name} → ${ae.hp}/${ae.maxHp} HP`, 'spell');
    ae._poisonStacks = Math.max(0, ae._poisonStacks - 2); // decay 2 stacks/round
    if(ae._poisonStacks > 0) addLog(room,`☠ Poison fades — ${ae._poisonStacks} stack${ae._poisonStacks!==1?'s':''} remaining.`,'sys');
    else addLog(room,`☠ Poison on ${ae.name} cleared.`,'sys');
    if (ae.hp <= 0) {
      const died = resolveEnemyDeath(room, ae);
      if (died !== false) { advanceTurn(room); return; }
    }
  }
  const newDots = (ae.activeDebuffs||[]).filter(d=>d.bleedDice||d.burnDice||d.dotDmg);
  for(const dbt of newDots){
    if(dbt.dotDmg && dbt.name!=='Bleed' && dbt.name!=='Burn'){
      if(ae.fortitude && dbt.name==='Bleed'){dbt.duration=0;continue;}
      const ddmg=dbt.dotDmg; ae.hp=Math.max(0,ae.hp-ddmg);
      addLog(room,`❄ <strong>${dbt.name}</strong> — <strong class="num-dmg">−${ddmg}</strong> to ${ae.name} → ${ae.hp}/${ae.maxHp} HP`,'spell');
      dbt.duration--;
      if(ae.hp<=0){const died=resolveEnemyDeath(room,ae);if(died!==false){advanceTurn(room);return;}}
    } else if(dbt.name==='Bleed'){
      if(ae.fortitude){dbt.duration=0;continue;} // fortitude: immune to Bleed
      const dmg=Array.from({length:dbt.bleedDice},()=>Math.ceil(Math.random()*3)).reduce((a,b)=>a+b,0);
      ae.hp=Math.max(0,ae.hp-dmg);
      addLog(room,`🩸 <strong>Bleed</strong> (${dbt.bleedDice}d3) — <strong class="num-dmg">−${dmg}</strong> to ${ae.name} → ${ae.hp}/${ae.maxHp} HP`,'spell');
      dbt.duration--;
      if(ae.hp<=0){const died=resolveEnemyDeath(room,ae);if(died!==false){advanceTurn(room);return;}}
    } else if(dbt.name==='Burn'){
      const dice=dbt.burnDice||1;
      const dmg=Array.from({length:dice},()=>Math.ceil(Math.random()*6)).reduce((a,b)=>a+b,0);
      ae.hp=Math.max(0,ae.hp-dmg);
      addLog(room,`🔥 <strong>Burn</strong> (${dice}d6→${Math.max(0,dice-1)}d6) — <strong class="num-dmg">−${dmg}</strong> to ${ae.name} → ${ae.hp}/${ae.maxHp} HP`,'spell');
      room.players.filter(p=>p.char&&p.char.alive&&p.char.hungeringFlame).forEach(p=>{ const leech=Math.max(1,Math.floor(dmg/2));
    p.char.health=Math.min(p.char.maxHealth,p.char.health+leech); });
      dbt.burnDice=Math.max(0,dice-1);
      if(dbt.burnDice<=0) dbt.duration=0; // mark for removal
      else dbt.duration=99; // keep alive
      if(ae.hp<=0){const died=resolveEnemyDeath(room,ae);if(died!==false){advanceTurn(room);return;}}
    }
  }

  ae.activeDebuffs = (ae.activeDebuffs || []).filter(d => !(SELF_TICK_DOTS.has(d.name) && d.duration <= 0) && !(d.name==='Bleed'&&d.duration<=0) && !(d.name==='Burn'&&d.burnDice<=0));
  if (!gs.inCombat) return;

  if (ae.stunImmune && (ae.activeDebuffs||[]).some(d=>d.skipTurn)) {
    ae.activeDebuffs = ae.activeDebuffs.filter(d=>!d.skipTurn);
    addLog(room, `💀 ${ae.name} doesn't flinch — the dead can't be stunned!`, 'sys');
  }
  const stunned = (ae.activeDebuffs || []).find(d => d.skipTurn);
  if (stunned && ae._windup) { ae._windup=null; addLog(room, `💫 <strong>${ae.name}</strong> is staggered — its ${ae.telegraph?'big attack':'attack'} is lost!`, 'crit'); }
  if (stunned) {
    stunned.duration--;
    if(stunned.duration<=0) ae.activeDebuffs = ae.activeDebuffs.filter(d => !d.skipTurn); // remove when expired
    addLog(room, `💫 <strong>${ae.name}</strong> is stunned — loses its action this turn! (${stunned.duration>0?stunned.duration+' turn(s) remaining':'last turn'})`, 'sys');
    advanceTurn(room);
    return;
  }

  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) { triggerGameover(room); return; }

  // ── Signature mechanics (may replace the normal attack) ───────────────────
  const plan = enemyPreTurn(room, ae, alive);
  if (plan === 'done' || ae.hp <= 0 || !gs.inCombat) { finishEnemyTurn(room, ae); return; }

  // ── Pre-attack passives ───────────────────────────────────────────────────

  if (ae.stampede && !ae._stampedeUsed && gs.roundNumber === 1) {
    ae._stampedeUsed = true;
    alive.forEach(p => {
      p.char.defense = Math.max(1, (p.char.defense||10) - 1);
      p.char._stampedeDef = true;
      addLog(room, `🐂 <strong>Stampede!</strong> ${ae.name} crashes through — ${p.name} loses <strong>-1 Defence</strong> for the rest of combat!`, 'chaos');
    });
  }
  if (ae.primordialRoar && !ae._roarUsed && gs.roundNumber === 1) {
    ae._roarUsed = true;
    alive.forEach(p => {
      addBuff(p.char, 'Primordial Roar', {dmgReductionPct:0.5}, 3);
    });
    addLog(room, `🦎 <strong>Primordial Roar!</strong> ${ae.name} bellows — all players deal <strong>half damage</strong> for 3 rounds!`, 'chaos');
  }
  if (ae.warlordCommand && !ae._commandUsed) {
    ae._commandUsed = true; // Spawn 2 clanrats
    if(ae.warlordPackStart){
      for(let _wi=0;_wi<2;_wi++){
        const _wc=scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:2,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
          room.players.filter(p=>p.connected&&p.char&&p.char.alive).length,false,gs.bossCount);
        _wc.id='wpack_'+Date.now()+_wi; gs.enemies.push(_wc);
      }
      addLog(room,`⚔ <strong>Warlord's Command!</strong> ${ae.name} signals — <strong>2 Skaven Clanrats</strong> pour from the shadows!`,'chaos');
    } else {
      (gs.enemies||[]).forEach(e => { if(e&&e!==ae&&e.tags&&e.tags.includes('skaven')&&e.hp>0){e.atk=(e.atk||0)+1;} });
      addLog(room, `⚔ <strong>Warlord's Command!</strong> ${ae.name} rallies the skaven — all skaven +1 ATK!`, 'chaos');
    }
  }
  if (ae.packInstinct) {
    const skavenCount = (gs.enemies||[]).filter(e=>e&&e.hp>0&&e.tags&&e.tags.includes('skaven')).length;
    ae._packBonus = skavenCount >= 2 ? 1 : 0;
  }
  if (ae.scurryAway) {
    const clanratsAlive = (gs.enemies||[]).filter(e=>e&&e.hp>0&&e.name==='Skaven Clanrat').length;
    ae._scurryDefBonus = clanratsAlive>0 ? 3 : 0;
  }
  ae._chosenThisRound=false;
  if (ae.seethingRage && !ae._rageActive && ae.hp < ae.maxHp * 0.4) {
    ae._rageActive = true;
    const clanrats=(gs.enemies||[]).filter(e=>e&&e.hp>0&&e.name==='Skaven Clanrat');
    const defBonus=clanrats.length*2;
    if(defBonus>0){ ae.ac=(ae.ac||15)+defBonus; addLog(room,`⚔ <strong>Skaven Warlord's Decree!</strong> ${ae.name} — +${defBonus} Defence from ${clanrats.length} clanrats!`,'chaos'); }
    clanrats.forEach(c=>{ c.dmgBonus=(c.dmgBonus||0)+2; addLog(room,`🐀 Clanrat surges — +2 damage!`,'chaos'); });
    if(!clanrats.length) addLog(room,`⚔ <strong>Skaven Warlord's Decree!</strong> ${ae.name} — no clanrats to rally.`,'chaos');
  }
  if (ae.extinctionPulse && !ae._pulseUsed && ae.hp < ae.maxHp * 0.3) {
    ae._pulseUsed = true;
    alive.forEach(p => { addBuff(p.char, 'Blinded', {bane:3}, 2); });
    ae._regenOverride = 12; // boost regen to 12 HP for 2 turns
    ae._regenOverrideTurns = 2;
    addLog(room, `💥 <strong>Extinction Pulse!</strong> All players are <strong>Blinded for 2 rounds</strong>! Saurian regenerates <strong>+12 HP/round</strong> for 2 rounds!`, 'chaos');
  }
  if (ae.mistForm && !ae._mistUsed && ae.hp < ae.maxHp * 0.25) {
    ae._mistUsed = true;
    if(!ae.activeDebuffs) ae.activeDebuffs=[];
    ae._mistFormRounds=2; // halves damage the Vampire takes (see rollAttack / spells)
    addLog(room, `🌫 <strong>Mist Form!</strong> ${ae.name} — takes half damage for 2 rounds!`, 'chaos');
  }
  if (ae.bloodlust && !ae._bloodlustActive && ae.hp < ae.maxHp * 0.5) {
    ae._bloodlustActive = true;
    ae.atk = (ae.atk||0) + 2; // approx +2 boons via ATK bonus
    ae.ac = Math.max(1, (ae.ac||16) - 2);
    addLog(room, `🩸 <strong>Bloodlust!</strong> ${ae.name} tastes blood — <strong>+2 boons on attacks, −2 Defence</strong> for the rest of combat!`, 'chaos');
  }
  if (ae.belowRoar && !ae._roarActive && ae.hp < ae.maxHp * 0.5) {
    ae._roarActive = true;
    room.players.filter(p=>p.char&&p.char.alive).forEach(p => { addBuff(p.char,'Roared',{bane:1},1); });
    addLog(room, `🐂 <strong>Bellowing Roar!</strong> All warriors have 1 bane on next attack!`, 'chaos');
  }

  // ── Determine attack multiplier ───────────────────────────────────────────
  if (ae.frenzyMulti && !ae._frenzyOnceUsed && ae.hp < ae.maxHp * (ae.frenzyMulti.threshold||0.5)) {
    ae._frenzyOnceUsed = true;
    ae.lifeLeechFrac = 0.35; // increase leech to 35%
    ae._frenzyNextHit = true; // next attack auto-hits
    addLog(room, `😤 <strong>Frenzy!</strong> ${ae.name} — next attack ALWAYS lands, life leech increased to <strong>35%</strong>!`, 'chaos');
  }
  const baseAttacks = plan.attacks || ae.attacks || (ae.multi ? 2 : 1);

  // Targets: everyone by default; some enemies pick (lowest HP, random shots, boss specials).
  // Taunt: while a warrior is Taunting, enemies attack only them (unless the attack ignores Taunt).
  const _targets = plan.targets ? plan.targets.filter(p => p && p.char && p.char.alive) : alive.slice();
  const _taunter = alive.find(p => (p.char.activeBuffs||[]).some(b => b.taunting));
  alive.length = 0;
  if (_taunter && !plan.ignoreTaunt) alive.push(_taunter);
  else {
    // Rows: melee attackers can only reach the front row while anyone stands in it.
    const front = _targets.filter(p => p.char.row !== 'back');
    alive.push(...((!ae.ranged && !plan.targets && front.length) ? front : _targets));
  }
  // ── Attack loop ───────────────────────────────────────────────────────────
  if(alive.length>1) alive.sort((a,b)=>(a.char._armorLastTarget?1:0)-(b.char._armorLastTarget?1:0));
  if(alive.length>1) alive.sort((a,b)=>((b.char.bodyguard)?1:0)-((a.char.bodyguard)?1:0));
  alive.forEach(p => {
    const auraBonus  = room.players.some(q=>q.char&&q.char.alive&&q.char.holyAura)?2:0;
    const shieldBonus = p.char.shieldwall ? 2 : 0;
    const ignoresDef  = (ae.ignoresDef || 0) + (ae.hellblade && p.char.equippedArmor ? (p.char.equippedArmor.defBonus||0) : 0); // Hellblade ignores armour
    if(p.char.flicker && !p.char._flickerUsed){ p.char._flickerUsed=true; addLog(room,`🤸 <strong>Flicker!</strong> ${p.name} simply isn't there — attack negated!`,'spell'); return; }
    const aegisBonus  = room.players.some(q=>q.char&&q.char.alive&&q.char._legExtinctionAegis)?2:0;
    const wardBonus   = room.players.some(q=>q.char&&q.char.alive&&q.char.ward)?1:0; // Ward talent
    if(p.char._legShroud && p.char.health>0 && p.char.health<=Math.floor(p.char.maxHealth*0.25)){
      p.char._legShroudActive=true;
    } else { p.char._legShroudActive=false; }
    const defTotal    = Math.max(10, p.char.defense + auraBonus + shieldBonus + aegisBonus + wardBonus - ignoresDef);

    for (let atk_i = 0; atk_i < baseAttacks; atk_i++) {
      if (!p.char.alive) break;

      const atkBase  = ae.atk;
      const atkBonus = ae._packBonus || 0;
      const hasExtraBoon = ae._rageActive || plan.extraBoon;
      const aeProxy = {...ae, atk: atkBase + atkBonus};

      const recklessBoon = ae.recklessCharge && !ae._recklessUsed && gs.roundNumber === 1;
      if (recklessBoon && atk_i === 0) ae._recklessUsed = true;

      if (ae.scurryAway && !ae._scurryUsed) {
        if (!ae._scurryRolled) { ae._scurryRolled = true; ae._scurryDodging = Math.random() < 0.4; }
        if (ae._scurryDodging) {
          ae._scurryUsed = true; ae._scurryDodging = false;
          addLog(room, `💨 <strong>Scurry Away!</strong> ${ae.name} vanishes — attack missed!`, 'chaos');
          continue;
        }
      }

      const _pcView = {...p.char, defense: defTotal};
      const r = rollEnemyAttack(aeProxy, _pcView, hasExtraBoon || recklessBoon, room);
      p.char._evadeRound = _pcView._evadeRound;
      ['activeDebuffs','_frenzyNextHit'].forEach(k=>{ ae[k]=aeProxy[k]; }); // state consumed on the proxy must persist
      p.char._foresightActive = _pcView._foresightActive; // Foresight is consumed on the copy — sync it back

      if (r.hit) {
        let dmg = r.dmg;
        if (ae.recklessCharge && recklessBoon)                        { dmg += rd(1,6); }
        if (ae._rageActive)                                           { dmg += rd(1,6); }
        dmg = enemyDamageMods(room, ae, p, dmg, r, plan);
        const isImmune = (p.char.activeBuffs||[]).some(b=>b.immune);
        const drBuff   = (p.char.activeBuffs||[]).find(b=>b.damageReduction);
        if (isImmune)  { dmg = 0; addLog(room, `🛡 ${p.name} is IMMUNE — blocked!`, 'spell'); }
        else if (drBuff){ dmg = Math.floor(dmg * (1 - drBuff.damageReduction)); }
        if(p.char._armorFlatDR && dmg>0){ dmg=Math.max(0,dmg-1); }
        if(p.char._armorChaosWard && ae.chaos && dmg>0){ dmg=Math.max(0,dmg-2); }
        if (ae.tags && ae.tags.includes('beast') && ae.hp < ae.maxHp * 0.5) { dmg += 3; }

        if(p.char.endure && dmg>0) dmg=Math.max(0,dmg-1);
        if(p.char.fortressStance && dmg>0 && p.char.health<=Math.floor(p.char.maxHealth*0.5)) dmg=Math.max(0,Math.floor(dmg*0.9));
        if(p.char.perfectDefence && !p.char._perfectDefenceUsed && dmg>0){ p.char._perfectDefenceUsed=true; addLog(room,`🛡 <strong>Perfect Defence!</strong> ${p.name} negates the hit entirely!`,'spell'); dmg=0; }
        // Endure: if hit would drop below 35% HP, halve it BEFORE applying
        if(p.char.endure && !p.char._endureUsed && dmg>0 && (p.char.health-dmg) < p.char.maxHealth*0.35){
          p.char._endureUsed=true; dmg=Math.ceil(dmg/2);
          addLog(room,`💪 <strong>Endure!</strong> ${p.name} endures — damage halved to ${dmg}!`,'sys');
        }
        if(p.char.natureBond && dmg>0){ const nbS=rd(1,6); applyPoison(ae,nbS,room); addLog(room,`🌿 <strong>Nature Bond!</strong> ${ae.name} receives <strong>${nbS}</strong> poison stacks (1d6)!`,'spell'); }
        if(p.char._legPrimordialTalisman&&!p.char._primordialTalismanUsed&&dmg>0){p.char._primordialTalismanUsed=true;const _pth=Math.ceil(dmg*0.5);p.char.health=Math.min(p.char.maxHealth,p.char.health+_pth);addLog(room,`🛡 <strong>Primordial Talisman!</strong> ${p.name} absorbs hit — heals ${_pth} HP!`,'heal');dmg=0;}
        if(p.char.bodyguard&&r.hit&&dmg>0){const rbDmg=Math.ceil(dmg/2);ae.hp=Math.max(0,ae.hp-rbDmg);addLog(room,`🔄 <strong>Rebound!</strong> ${p.name} reflects <strong class="num-dmg">-${rbDmg}</strong> damage back at ${ae.name}!`,'crit');if(ae.hp<=0)resolveEnemyDeath(room,ae);}
        if(p.char.sacredAegis&&r.hit){const saDmg=rd(1,6);ae.hp=Math.max(0,ae.hp-saDmg);addLog(room,`⚡ <strong>Sacred Aegis!</strong> ${ae.name} takes <strong class="num-dmg">-${saDmg}</strong> holy retribution for striking ${p.name}!`,'spell');if(ae.hp<=0){resolveEnemyDeath(room,ae);}}
        if(p.char.rageTrigger && dmg>=1 && !p.char.rageBoon && !p.char.rageTriggerActive){ p.char.rageTriggerActive=true;
    p.char.rageBoon=true; addLog(room,`🔥 <strong>Rage Trigger!</strong> ${p.name} is hit — next attack +1 boon +1d6!`,'chaos'); }
        if(p.char.rage && dmg>0 && !p.char.rageBoon){ p.char.rageBoon=true; addLog(room,`🔥 ${p.name} RAGES — next attack +1 boon +1d6!`,'crit'); }
        if(p.char._armorRighteous && dmg>=5){ p.char._righteousBonusDmg=true; }

        if(p.char._legBerserk && !p.char._legBerserkUsed && p.char.health>0 && p.char.health<=Math.floor(p.char.maxHealth*0.5)){
          p.char._legBerserkUsed=true;
    p.char.weaponAtkBonus+=2;
    p.char._legBerserkBonusActive=true;
          addLog(room,`⚔ <strong>Berserk Plate!</strong> ${p.name} enters a fury — +2 ATK for this combat!`,'chaos');
        }
        if(p.char._legAncientScale && !p.char._legAncientScaleUsed && dmg>0){
          p.char._legAncientScaleUsed=true;
          dmg=0; // negate the hit (damage is applied after this point)
          addLog(room,`🦎 <strong>Scale of the Ancient!</strong> ${p.name} negates the hit entirely!`,'spell');
        }
        if(p.char._armorBloodscent && p.char.health>0 && p.char.health<=Math.floor(p.char.maxHealth*0.25) && !p.char._bloodscentFired){
          p.char._bloodscentFired=true;
          room.players.filter(q=>q.char&&q.char.alive).forEach(q=>{ addBuff(q.char,'Bloodscent',{atkBoon:1},1); });
          addLog(room,`🐾 <strong>Bloodscent!</strong> ${p.name}'s wounds ignite the warband — all allies gain 1 boon!`,'chaos');
        }
        p.char.health = Math.max(0, p.char.health - dmg); // APPLY DAMAGE
        // Bloodied (a quarter of max HP or less), first time this fight: Vengeance and Last Rites answer.
        if(p.char.health>0&&p.char.health<=p.char.maxHealth/4){
          if(p.char.vengeancePassive&&!p.char._vengeanceLowFired){ p.char._vengeanceLowFired=true; p.char._vengeanceReady=true; addLog(room,`⚔ <strong>Vengeance!</strong> ${p.name} is bloodied — 2 boons on their next attack.`,'crit'); }
          const _lr=!p.char._lastRitesFired&&room.players.find(q=>q.char&&q.char.alive&&q.char.lastRites);
          if(_lr){ p.char._lastRitesFired=true; const h=rd(1,6)+Math.max(0,((_lr.char.attrs&&_lr.char.attrs.wil)||10)-10); p.char.health=Math.min(p.char.maxHealth,p.char.health+h); addLog(room,`⛪ <strong>Last Rites!</strong> ${_lr.name}'s prayer steadies ${p.name} — <strong class="num-heal">+${h} HP</strong>.`,'heal'); }
        }
        if(dmg>0) gs._anyPlayerHitThisTurn=true;
        checkDeath(room, p);
        if(!p.char.alive && !p.char.pendingRevive){ p.char.pendingRevive=true; }
        const critLabel = r.crit ? ' 💥 CRIT!' : '';
        const dmgBreak  = `${ae.dmgNum}d${ae.dmgSides}(${r.dmgRoll})${ae.dmgBonus?'+'+ae.dmgBonus:''}${r.critRoll?'+'+r.critRoll+' crit':''}`;
        if(p.char.fadePassive) p.char._wasAttackedThisRound=true;
        addLog(room, `${ae.name} hits <strong>${p.name}</strong> — <strong class="num-dmg">-${dmg} dmg</strong>${critLabel} [d20:<strong>${r.base}</strong>+atk<strong>${aeProxy.atk>=0?'+':''}${aeProxy.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${defTotal}</strong>] [${dmgBreak}] → ${p.name} <strong>${p.char.health}</strong>/${p.char.maxHealth} HP`, 'dmg-taken');

        // ── On-hit abilities (skip if player already dead) ───────────────
        if (!p.char.alive) { checkDeath(room, p); }
        // Counterspell: a ward on this warrior swallows the blow's special effects.
        const _csWard=p.char.alive&&(p.char.activeBuffs||[]).find(x=>x.counterspellWard);
        if(_csWard){ p.char.activeBuffs=p.char.activeBuffs.filter(x=>x!==_csWard); p.char._hitSinceTurn=true; addLog(room,`🚫 <strong>Counterspell!</strong> The ward around ${p.name} flares — ${ae.name}'s blow carries no curse, poison or other effect.`,'spell'); }
        else {
          if (p.char.alive && ae.lifeLeech) {
            const frac = ae.lifeLeechFrac || 0.25;
            if (ae.lifeLeechFrac && ae.lifeLeechFrac <= 0.25) { ae._leechAccum = (ae._leechAccum||0) + dmg; } // accumulate leech for sustain-type (Varghulf)
            else { const l = Math.floor(dmg * frac); ae.hp = Math.min(ae.maxHp, ae.hp+l); addLog(room, `🩸 ${ae.name} leeches <strong>${l}</strong> HP.`, 'chaos'); }
          }
          if (p.char.alive && ae.insanityAtk && d(6) >= 4) dark.gainInsanity(room, p, 1, `the terror of ${ae.name}`);
          if (p.char.alive && ae.bloodOnHit && r.hit) { addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room,`🩸 <strong>Bloodgreed!</strong> ${ae.name} — 1 Bleed!`,'chaos'); }
          if (p.char.alive && ae.virulentBlade && r.hit) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+3; addLog(room,`☠ <strong>Virulent Blade!</strong> ${ae.name}'s plague blade applies <strong>3 poison stacks</strong> to ${p.name}!`,'chaos'); }
          if (p.char.alive && ae.crushingTail && r.hit && Math.random()<0.20) { addBuff(p.char,'Stunned',{skipTurn:true},2); addLog(room,`🦎 <strong>Crushing Tail!</strong> ${p.name} is STUNNED by the Saurian's tail sweep!`,'chaos'); }
          if (ae.critMajorBleed && r.hit) { addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room, `🩸 <strong>Frenzied Rending!</strong> ${p.name} is Bleeding (1d3/round for 2 rounds)!`, 'chaos'); }
          if (p.char.alive && ae.skavencunning && r.hit) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+2; addLog(room,`🐀 <strong>Skaven Cunning!</strong> ${ae.name} poisons ${p.name} — 2 poison stacks!`,'chaos'); }
          if (p.char.alive && ae.poisonBlade) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+ae.poisonBlade; addLog(room,`☠ <strong>Poison Blade!</strong> ${ae.name} poisons ${p.name} — <strong>${ae.poisonBlade}</strong> poison stacks!`,'chaos'); }
          enemyAfterHit(room, ae, p, dmg, r, plan);
        }
        if (p.char.rage && dmg > 0 && !p.char.rageBoon) { p.char.rageBoon=true; addLog(room,`🔥 ${p.name} RAGES — next attack +1 boon +1d6!`,'crit'); }
        checkDeath(room, p);

      } else {
        if (!r.skipped && ae.hp>0 && p.char.alive && (p.char._wpnRiposte||p.char.acrobaticRiposte) && !p.char._wpnRiposteUsedThisRound){
          p.char._wpnRiposteUsedThisRound=true; // once per round
          const rr=rollAttack(p.char, ae, p.char._wpnRiposte?1:0);
          if(rr.hit){ ae.hp=Math.max(0,ae.hp-rr.dmg); addLog(room,`⚔ <strong>Riposte!</strong> ${p.name} counters ${ae.name} — <strong class="num-dmg">−${rr.dmg}</strong> → ${ae.hp}/${ae.maxHp} HP`,'crit'); if(ae.hp<=0) resolveEnemyDeath(room,ae); }
          else addLog(room,`⚔ ${p.name}'s riposte misses ${ae.name}.`,'sys');
        }
        if (!r.skipped) addLog(room, `${ae.name} <em>misses</em> <strong>${p.name}</strong> — d20:<strong>${r.base}</strong>+atk<strong>${aeProxy.atk>=0?'+':''}${aeProxy.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${defTotal}</strong>.`, 'sys');
      }
    }
  });

  if (ae.hp <= 0) { advanceTurn(room); return; } // killed by a riposte during its own attack
  // ── Post-attack ───────────────────────────────────────────────────────────
  if (ae._leechAccum > 0) {
    const l = Math.floor(ae._leechAccum * (ae.lifeLeechFrac||0.25));
    ae.hp = Math.min(ae.maxHp, ae.hp+l);
    addLog(room, `🩸 ${ae.name} leeches <strong>${l}</strong> HP.`, 'chaos');
    ae._leechAccum = 0;
  }
  if (ae.packBoss) {
    const ratio = ae.hp / ae.maxHp;
    const threshold = ratio < 0.6 && !ae._pack60 ? '_pack60' : ratio < 0.3 && !ae._pack30 ? '_pack30' : null;
    const _ap = room.players.filter(p=>p.char&&p.char.alive).length;
    if (threshold) ae[threshold] = true;
    if (threshold && gs.enemies && gs.enemies.length < 5 && aliveEnemies(gs).length <= _ap) {
      const clanrat = scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:0,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
        room.players.filter(p=>p.connected&&p.char&&p.char.alive).length, false, gs.bossCount);
      clanrat.id='pack_'+Date.now(); gs.enemies.push(clanrat);
      addLog(room, `🐀 <strong>Call the Pack!</strong> ${ae.name} summons a Skaven Clanrat!`, 'chaos');
    }
  }
  if (ae.callsPack && ae.hp<ae.maxHp*0.6&&!(gs.packCooldown>0)&&gs.enemies&&gs.enemies.length<4) {
    gs.packCooldown=4;
    const clanrat=scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:0,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
      room.players.filter(p=>p.connected&&p.char&&p.char.alive).length,false,gs.bossCount);
    clanrat.id='pack_'+Date.now(); gs.enemies.push(clanrat);
    addLog(room, `🐀 <strong>Call the Pack!</strong> ${ae.name} summons a Skaven Clanrat! (3-round cooldown)`, 'chaos');
  }
  if (ae.skavenPackTactics && !ae._packTacticsApplied) {
    ae._packTacticsApplied = true;
    for(let _pi=0;_pi<2;_pi++){
      const clanrat=scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:0,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
        room.players.filter(p=>p.connected&&p.char&&p.char.alive).length,false,gs.bossCount);
      clanrat.id='pack_'+Date.now()+_pi; gs.enemies.push(clanrat);
    }
    addLog(room, `🐀 <strong>Skaven Pack Tactics!</strong> ${ae.name} enters battle with <strong>two Skaven Clanrats</strong>!`, 'chaos');
  }
  if (ae.packLeader && !ae._packLeaderApplied) {
    ae._packLeaderApplied = true;
    (gs.enemies||[]).forEach(e=>{ if(e&&e!==ae&&e.tags&&e.tags.includes('skaven')&&e.hp>0){ e.atk=(e.atk||0)+2; } });
    addLog(room, `🐀 <strong>Pack Leader!</strong> ${ae.name} — all skaven allies gain +2 ATK!`, 'chaos');
  }
  const nowAlive = room.players.filter(p => p.char && p.char.alive);
  if (!nowAlive.length) { triggerGameover(room); return; }
  room.players.forEach(p => { if (p.char && !p.char.alive) p.char.pendingRevive = true; });

  if(gs._anyPlayerHitThisTurn && room.players.some(p=>p.char&&p.char._legBloodDrinker)){
    room.players.filter(p=>p.char&&p.char.alive&&p.char._legBloodDrinker).forEach(p=>{
      const h=rd(1,6);
    p.char.health=Math.min(p.char.maxHealth,p.char.health+h);
      addLog(room,`🩸 <strong>Blood Drinker's Plate!</strong> ${p.name} draws vitality — +${h} HP.`,'heal');
    });
  }
  gs._anyPlayerHitThisTurn=false; // reset for next enemy turn

  enemyPostTurn(room, ae);
  advanceTurn(room);
}
// Shared ending for enemy turns that skipped the normal attack loop.
function finishEnemyTurn(room, ae){
  if (!room.gs.inCombat) return;
  const nowAlive = room.players.filter(p => p.char && p.char.alive);
  if (!nowAlive.length) { triggerGameover(room); return; }
  room.players.forEach(p => { if (p.char && !p.char.alive) p.char.pendingRevive = true; });
  enemyPostTurn(room, ae);
  advanceTurn(room);
}

function checkDeath(room, player) {
  if(player.char.health<=0&&player.char.alive){
    if(hasRelic(player.char,'phoenixFeather')&&!player.char._phoenixUsed){
      player.char._phoenixUsed=true; player.char.health=1;
      addLog(room,`🪶 <strong>Phoenix Feather!</strong> The feather burns away — ${player.name} rises with 1 HP!`,'heal');
      return;
    }
    if(charmKey(player.char)==='boneRosary'&&!player.char._rosaryUsed&&room.gs.inCombat){
      player.char._rosaryUsed=true; player.char.health=1;
      addLog(room,`📿 <strong>Bone Rosary!</strong> The beads crack — ${player.name} clings on at 1 HP!`,'heal');
      return;
    }
    if(player.char._morrWard&&room.gs.inCombat){
      player.char._morrWard=false; player.char.health=1;
      addLog(room,`🕯 <strong>Morr turns away.</strong> ${player.name} should have died — and stands at 1 HP.`,'heal');
      return;
    }
    if(room.players.some(p=>p.char&&p.char.alive&&p.char.grace&&!p.char._graceUsed)){
      const graceUser=room.players.find(p=>p.char&&p.char.alive&&p.char.grace&&!p.char._graceUsed);
      if(graceUser){ graceUser.char._graceUsed=true; player.char.health=1; addLog(room,`🕊 <strong>Grace!</strong> ${graceUser.name}'s faith catches ${player.name} — survives at 1 HP!`,'heal'); return; }
    }
    if((player.char.activeBuffs||[]).some(b=>b.resurrectionShield)){
      player.char.health=Math.floor(player.char.maxHealth*0.5);
      player.char.activeBuffs=player.char.activeBuffs.filter(b=>!b.resurrectionShield);
      player.char.alive=true; player.char.health=Math.ceil(player.char.maxHealth/2);
      addBuff(player.char,'Resurrected',{atkBoon:2},1);
      addLog(room,`✨ <strong>Resurrection Shield!</strong> ${player.name} is saved by Sigmar's grace — ${player.char.health} HP and 2 boons!`,'heal');
      return;
    }
    player.char.alive=false; player.char.health=0; player.char._killedThisTurn=true;
    addLog(room,`💀 <strong>${player.name}</strong> has fallen!`,'death');
    room.players.filter(o=>o!==player&&o.char&&o.char.alive).forEach(o=>dark.gainInsanity(room,o,1,`seeing ${player.name} fall`));
    if(player.char.unstoppable&&!player.char.unstoppableUsed){
      player.char.unstoppableUsed=true; player.char.alive=true; player.char.health=1;
      addLog(room,`💪 <strong>Unstoppable!</strong> ${player.name} survives the killing blow at 1 HP! (once per run)`,'crit');
    }
    room.players.filter(p=>p.char&&p.char.alive&&p.char.vengeancePassive&&p.id!==player.id).forEach(p=>{ p.char._vengeanceReady=true; });
    // Last Rites now answers when a warrior is bloodied (see enemy hits), not when they fall.
    if(player.char._legShroud&&!player.char._legShroudUsed){
      player.char._legShroudUsed=true; player.char.alive=true;
      player.char.health=rd(1,6);
      addLog(room,`🌑 <strong>Shroud of Undeath!</strong> ${player.name} rises from death at ${player.char.health} HP!`,'chaos');
    }
  }
}

module.exports = { bind, buildTurnOrder, getCurrentTurn, autoSkipStunnedPlayer, advanceTurn, TURN_LIMIT_MS, startTurnTimer, endRound, fireEnemyTurn, finishEnemyTurn, checkDeath };
