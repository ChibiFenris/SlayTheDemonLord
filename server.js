process.on('uncaughtException', err => { console.error('UNCAUGHT:', err); }); // log and keep serving other rooms
process.on('unhandledRejection', err => { console.error('UNHANDLED REJECTION:', err); });

const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/health', (req, res) => res.send('OK'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const clients = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(c) ? makeCode() : c;
}
function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
const { d, rd, modVal } = require('./game/dice');
const {
  CAREERS, NOVICE_PATHS, EXPERT_PATHS, MASTER_PATHS, CASTINGS_TABLE, TRADITIONS,
  ENEMY_POOLS, XP_THRESHOLDS, POISON_CAP, NODE_TYPES, SCROLL_SPELLS_LIST, LOOT_CONS_LIST,
  WEAPON_BASES, ARMOR_BASES, LEGENDARY_ITEMS, SHOP_CONSUMABLES, SCROLL_SPELLS_SHOP, ENEMY_DROPS,
} = require('./game/data');

function initGameState() {
  return {
    depth:0, inCombat:false, enemy:null, enemies:[], activeEnemyIdx:0, phase:'lobby',
    playersActedThisRound:[], enemyHasActed:false, roundNumber:0, turnOrder:[], activeTurnIdx:0,
    log:[], pathChoices:null, pathVotes:{}, bossNode:false,
    bossCount:0, lootRoom:null, lootPicked:[], _anyPlayerHitThisTurn:false,
    lastPowerRestoreDepth:0, packCooldown:0,
  };
}
function publicState(room) {
  return {
    gs: room.gs,
    players: room.players.map(p => ({
      id:p.id, name:p.name, career:p.career, ready:p.ready,
      char:p.char, isHost:p.id===room.hostId, connected:p.connected,
    })),
    hostId: room.hostId,
  };
}

// ─── SPELL CASTINGS (shared per rank, refilled each fight) ─────────────────
function maxCastings(power, rank) {
  const row = CASTINGS_TABLE[Math.min(power, 10)] || CASTINGS_TABLE[0];
  return row[Math.min(rank, 3)] || 0;
}

// Spells of the same rank share one casting pool (castingPools.R0..R3).
function uniqRanks(spells){ const seen=new Set(); return (spells||[]).filter(sp=>!seen.has(sp.rank)&&seen.add(sp.rank)); }

function refreshCastingPools(char) {
  if (!char.castingPools) char.castingPools = {};
  char.knownSpells.forEach(sp => {
    if (char.castingPools['R'+sp.rank] === undefined) {
      char.castingPools['R'+sp.rank] = maxCastings(char.power, sp.rank);
    }
  });
}

function restoreCastingPools(char) {
  char.castingPools = {};
  char.knownSpells.forEach(sp => {
    char.castingPools['R'+sp.rank] = maxCastings(char.power, sp.rank);
  });
}

function castingsLeft(char, spellName, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  const v = char.castingPools['R'+rank];
  return v !== undefined ? v : maxCastings(char.power, rank);
}

function spendCasting(char, spellName, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  if (char.castingPools['R'+rank] === undefined) {
    char.castingPools['R'+rank] = maxCastings(char.power, rank);
  }
  if (char.castingPools['R'+rank] > 0) {
    char.castingPools['R'+rank]--;
    return true;
  }
  return false;
}

function regainCasting(char, maxRank) {
  if (!char.castingPools) refreshCastingPools(char);
  let bestSpell = null, bestRank = 99;
  char.knownSpells.forEach(sp => {
    if (sp.rank <= maxRank && sp.rank < bestRank) {
      const max = maxCastings(char.power, sp.rank);
      if ((char.castingPools['R'+sp.rank] || 0) < max) {
        bestSpell = sp; bestRank = sp.rank;
      }
    }
  });
  if (bestSpell) { char.castingPools['R'+bestSpell.rank]++; return bestRank; }
  return -1;
}

// ─── SPELL TRADITIONS ─────────────────────────────────────────────────────────

function getSpellsForPower(traditionId, power) {
  const t = TRADITIONS[traditionId];
  if (!t) return [];
  return t.spells.filter(s => s.rank === 0 || s.rank <= power);
}

// ─── ENEMY SCALING & SELECTION ──────────────────────────────────────────────

function enemyDmgDice(threat, isElite, bossCount) {
  if (threat === 'Boss') {
    if (bossCount === 0) return {n:1,s:6,b:3}; // Boss 1: 1d6+3
    if (bossCount === 1) return {n:2,s:6,b:3}; // Boss 2: 2d6+3 (avg 10, harder)
    return {n:2,s:6,b:4};                       // Boss 3 (Saurian): 2d6+4 (final boss, hardest)
  }
  if (bossCount === 0) return {n:1,s:6,b:0};
  if (bossCount === 1) return {n:2,s:6,b:0};
  return {n:2,s:6,b:2}; // zone 3: extra +2 damage for high-tier enemies
}

function scaleEnemy(tmpl, playerCount, isElite, bossCount) {
  const e = JSON.parse(JSON.stringify(tmpl));
  const bossHpMult = bossCount>=2 ? 1.40 : bossCount===1 ? 1.25 : 1.0; // tougher scaling post-boss
  const bossHpFlat = bossCount >= 2 ? 30 : bossCount === 1 ? 15 : 0; // +15 post-boss1, +30 post-boss2
  e.hp = e.maxHp = Math.round(e.hp * (1 + (playerCount-1)*0.9) * bossHpMult) + bossHpFlat;
  e.conditions = []; e.activeDebuffs = []; e.isElite = isElite;
  const dd = enemyDmgDice(e.threat, isElite, bossCount);
  e.dmgNum=dd.n; e.dmgSides=dd.s; e.dmgBonus=dd.b;
  if (isElite && e.threat!=='Boss') {
    e.hp = e.maxHp = Math.round(e.hp * 1.5); // 1.5× HP for elites
    e.atk = (e.atk||0) + 2;
    e.dmgBonus = (e.dmgBonus||0) + 3;
    e.threat='Elite';
  }
  e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`;
  return e;
}

function pickEnemy(depth, isElite, isBoss, playerCount, bossCount) {
  let pool;
  if (isBoss) {
    if (depth >= 30)         pool=ENEMY_POOLS.boss3;
    else if (bossCount===0)  pool=ENEMY_POOLS.boss1;
    else if (bossCount===1)  pool=ENEMY_POOLS.boss2;
    else                     pool=ENEMY_POOLS.boss3;
  }
  else if (depth>20) pool=isElite?ENEMY_POOLS.high:ENEMY_POOLS.high;
  else if (depth>10) pool=isElite?ENEMY_POOLS.mid:ENEMY_POOLS.mid;
  else               pool=isElite?ENEMY_POOLS.low:ENEMY_POOLS.low;
  const validPool = pool.filter(e => e && e.threat && e.name && e.hp); // safety: skip non-enemy items
  if (!validPool.length) { console.error('pickEnemy: no valid enemies in pool', pool); return scaleEnemy(pool[0], playerCount, isElite, bossCount); }
  return scaleEnemy(validPool[Math.floor(Math.random()*validPool.length)], playerCount, isElite, bossCount);
}

// ─── CHARACTER BUILDER ───────────────────────────────────────────────────────
function buildChar(career) {
  const c = CAREERS[career];
  const attrs = {...c.startAttrs};
  const baseDefense = attrs.agi + c.armorDef;
  const wpnDmgStr=c.weaponDmg||'1d6'; const wpnBonusParts=wpnDmgStr.split('+'); const wpnDicePart=wpnBonusParts[0]; const wpnStartBonus=parseInt(wpnBonusParts[1]||'0')||0;
  const _wpnStat=c.weaponIntBased?'int':c.weaponWilBased?'wil':c.weaponStr?'str':'agi';
  const _wpnType=c.weaponStr||c.weaponIntBased?'blunt':'slashing';
  const startWpn = {id:'w_start_'+uuidv4(),name:'Starting Weapon',dice:wpnDicePart,stat:_wpnStat,bonus:wpnStartBonus,dmgType:_wpnType,type:'weapon',desc:`${wpnDmgStr}+${wpnStartBonus} — starting gear`};
  const startArmor = c.armorDef>0 ? {id:'a_start_'+uuidv4(),name:'Starting Armour',defBonus:c.armorDef,type:'armor',desc:`+${c.armorDef} Defense`} : null;
  return {
    career, attrs,
    health:c.startHp, maxHealth:c.startHp,
    defense:baseDefense, baseAgiDef:attrs.agi,
    perception:attrs.int,
    power:0, maxPower:0, castingPools:{}, castingsUsed:0, // castingsUsed kept for compat
    insanity:0, corruption:0, conditions:[], activeBuffs:[], _poisonedStacks:0,
    inventory:[
      {name:'Healing Draught',qty:2},
      {itemObj:startWpn,name:startWpn.name,qty:1,type:'weapon'},
      ...(startArmor?[{itemObj:startArmor,name:startArmor.name,qty:1,type:'armor'}]:[]),
    ],
    gold:15,
    level:1, xp:0,
    novicePath:null, expertPath:null, masterPath:null,
    pendingLevelUp:false, pendingPathTier:null,  // 'novice'|'expert'|'master'
    weaponTraining:false, catchBreath:false, catchBreathUsed:false,
    combatProwess:false, combatExpertise:false,
    pacedStrikes:false, pacedStrikesUsed:false,
    rage:false, rageBoon:false,
    quickStep:false,
    bloodOffering:false,
    utilityFocus:false,
    assassination:false,
    swiftFeet:false,
    trickery:false, trickeryUsed:false, _trickeryPoisonProc:0, _trickeryFirstHit:false,
    nimbleRecovery:false, nimbleUsed:false,
    spellRecovery:false, spellRecoveryUsed:false,
    sharedRecovery:false, sharedUsed:false,
    shieldwall:false, toughness:false,
    quickstrike:false, evasion:false, _quickstrikeUsed:false,
    deathblow:false, shadowstep:false,
    overcast:false, metamagic:false, metamagicUsed:false,
    burningSoul:false, firewall:false, curse:false, _curseUsed:false, _curseTarget:null, _pacedHitCount:0,
    weaponMaster:false,
    druidFervor:false, druidsFury:false, _druidsFuryUsed:false, _druidsFuryRounds:0,
    holyFervor:false, divineSmite:false, divineSmiteUsed:false,
    massHeal:false, massHealUsed:false, resurrection:false, resurrectionUsed:false,
    warlordAura:false, unstoppable:false, unstoppableUsed:false,
    rallyingCry:false, rallyingUsed:false, sweepingBlow:false,
    phantomStrike:false, _phantomStrikeUsed:false, bladestorm:false,
    spellsurge:false, spellsurgeUsed:false, catastrophe:false,
    holyAura:false, miracleHeal:false, miracleUsed:false,
    equippedWeapon:startWpn, equippedArmor:startArmor,
    weaponDmgBonus:0, weaponAtkBonus:0,
    // Talent flags
    pendingStatBoost:false, bleedOnCrit:false, bleedOnHit:false, deepBleed:false, venomOnFirstHit:false,
    poisonBlade:false, burnOnSpell:false, _venomHitUsed:false,
    // Defence passives
    ironResolve:false, bulwark:false, rageTrigger:false,
    frenzy:false, huntersMark:false, _huntersMarkTarget:null, skirmish:false, pressTheAdvantage:false, weaponAptitude:false,
    layOnHands:false, _layOnHandsCount:0, sacredAegis:false, fadePassive:false, _fadedLastRound:false, smokeScreen:false,
    _smokeScreenUsed:false,
    // Rogue talents
    shadowOpening:false, _shadowOpeningUsed:false, deadMansHand:false, quickHands:false, exploitWeakness:false,

    // Arcane talents
    arcaneStrike:false, flameEdge:false,
    // Fire talents
    conflagration:false, overload:false, _overloadUsed:false,
    resonance:false, surge:false, chainReaction:false, darkPact:false, _darkPactUsed:false, hungeringFlame:false,
    preparedSpell:false, _preparedSpellUsed:false, lingeringMagic:false,
    // Support talents
    triage:false, _triageUsed:false, natureBond:false,
    evilEye:false, _evilEyeUsed:false, hex:false, divineFavour:false,
    // Divine talents
    foresight:false, _foresightUsed:false,
    revelation:false, _revelationUsed:false, righteousFury:false, wrathOfSigmar:false,
    // Martial masters
    shieldBash:false, _shieldBashUsed:false,
    fortressStance:false, bodyguard:false, _bodyguardUsed:false, perfectDefence:false, _perfectDefenceUsed:false, vengeancePassive:false,
    relentless:false, _relentlessCount:0, battleOrders:false, _battleOrdersUsed:false,
    // Command talents
    intercept:false, _interceptUsed:false,
    devastatingCharge:false, _devastatingChargeUsed:false, killingMomentum:false, _killingMomentumUsed:false, inspire:false, warCry:false,
    _warCryUsed:false, markHeretic:false, _markHereticTarget:null, purgeTheWicked:false,
    // Shadow talents
    shadowStep:false, _shadowStepUsed:false,
    vanish:false, acrobaticRiposte:false, _acrobaticRiposteUsed:false, flicker:false, _flickerUsed:false,
    // Executioner talents
    cleanup:false,
    _cleanupUsed:false, deadAim:false, _deadAimUsed:false, unrelenting:false, flurryBleed:false,
    // Arcane masters
    elementalAttunement:false, _volatileFormUsed:false,
    ballLightning:false, overcharge:false, _overchargeUsed:false,
    // Necro talents
    lifeDrain:false, arcaneSurge:false, _arcaneSurgeUsed:false, spellLeech:false, undyingHunger:false, chaosTouch:false, _chaosTouchActive:false,
    uncontrolledPower:false, _uncontrolledPowerUsed:false,
    // Protection talents
    counterspell:false, _counterspellUsed:false, ward:false, doubleCharge:false,
    _doubleChargeCount:0, forceOfWill:false,
    // Archmage talents
    esotericKnowledge:false, _esotericKnowledgeUsed:false, arcaneMastery:false, _arcaneMasteryApplied:false,
    spellEcho:false, _spellEchoUsed:false,
    // Divine masters
    overflowingGrace:false, protectiveBlessing:false, lastRites:false, vigil:false,
    divineVessel:false, _divineVesselApplied:false, grace:false, _graceUsed:false, blessedBlade:false, holyFire:false,

    // Exorcist talents
    banish:false, _banishUsed:false, sanctify:false,
    // Brute talents
    fortitude:false, endure:false,
    // Combat state flags
    rageTriggerActive:false,
    _armorLastTarget:false,
    // Armour special flags
    _armorFireImmune:false, _armorFlatDR:false, _armorChaosWard:false, _armorPackScorn:false, _armorSpellbound:false,
    _armorBloodscent:false, _armorRighteous:false, _dwarfForgedStunUsed:false, _spellboundR0Used:false,
    // Weapon special flags
    _wpnBladeguard:false, _wpnBladeguardDef:false,
    _wpnChannelFaith:false, _wpnHolySmoke:false, _wpnHolySmokeProc:false, _wpnBlessedStrike:false, _wpnArcaneFocus:false, _wpnArcaneFocusMissed:false,
    _wpnSpellblade:false, _wpnSpellbladeUsed:false, _wpnSmite:false, _wpnSmiteUsed:false, _wpnSunder:false, _wpnOpeningShot:false,
    _wpnOpeningShotFired:false, _wpnReloading:false, _wpnMarksmanship:false,
    // Weapon combat flags
    _wpnCleave:false, _wpnCleaveReady:false, _wpnCleaveBonus:false,
    _wpnReach:false, _wpnRiposte:false, _wpnRiposteUsedThisRound:false, _wpnSilverEdge:false, _wpnUnstable:false, _wpnRuneStrike:false,
    _wpnRuneStrikeUsed:false, _wpnRuneStrikeActive:false,
    // Legendary item flags
    _legVenomFang:false, _legVenomFangProc:false, _legBeastlordMaul:false, _legBeastlordMaulUsed:false,
    _legVarghulfTalon:false, _legVarghulfLeech:0, _legChainbreaker:false, _legSunstoneBlade:false, _legPrimordialStaff:false, _legExtinctionAegis:false,
    _legAncientScale:false, _legAncientScaleUsed:false, _legShroud:false, _legShroudUsed:false, _legShroudActive:false, _legBloodDrinker:false,
    _legRatking:false, _chainbreakerCritProc:false, _legBerserk:false, _legBerserkUsed:false, _legBerserkBonusActive:false,
    _legWarpstoneGauntlet:false, _warpstoneKillStr:0, _legPrimordialTalisman:false, _primordialTalismanUsed:false,
    traditions:[], scrollSpells:{}, stimulantBoon:0, sharpeningStone:false, luckyPendant:false,
    alive:true,
    spellcaster:c.spellcaster, tradition:c.tradition||null,
    knownSpells:[],
    pendingSpellChoices:0,
    merchantStock:null, lootOptions:null, pendingRevive:false,
  };
}

function talentHeal(char) {
  const attrs = char.attrs || {};
  const highestMod = Math.max(0, ...Object.values(attrs).map(v => Math.floor((v-10)/2)));
  return rd(1,6) + highestMod; // nerfed from *2 (Catch Breath, Nimble Recovery, Rallying Cry)
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
  const atkMod=modVal(char.attrs[wpnStat])+char.weaponAtkBonus+warCryBonus;
  let boons=0, banes=0;
  if (char.weaponTraining) boons++;
  if (char.swiftFeet) boons+=2;
  if (char.vigil && char.health===char.maxHealth) boons++;
  if (char._vengeanceReady){ char._vengeanceReady=false; boons+=2; } // vengeancePassive: 2 boons after ally falls
  if (char.rage&&char.rageBoon) { boons++; } // rage boon — dmg applied on hit, flag cleared there
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
  if(char.shadowStep) boons++; // shadowStep: all attacks have +1 boon
  const forceCritDeadAim=char._deadAimArmed; if(forceCritDeadAim){ char._deadAimArmed=false; }
  if(char._pressAdvantageReady){ char._pressAdvantageReady=false; boons++; } // boon vs undead/chaos
  if (char.warlordAura) boons++; // aura from warlord
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned'))    banes++;
  // skavencunning now applies poison on hit (handled in enemy attack section)
  const baneBuff = getBuffVal(char, 'bane');
  if (baneBuff) banes += baneBuff;
  const forceCrit=char.luckyPendant||forceCritDeadAim; if(char.luckyPendant) char.luckyPendant=false;
  const atkBuff=getBuffVal(char,'atkBoon'); boons+=atkBuff;
  let {base,final,boonDie,baneDie}=rollD20boons(boons,banes);
  const _fs=(char.activeBuffs||[]).find(b=>b.foresightRerolls>0); // Foresight: roll twice, keep the higher
  if(_fs){ const r2=rollD20boons(boons,banes); if(r2.final>final){ ({base,final,boonDie,baneDie}=r2); } _fs.foresightRerolls--; if(_fs.foresightRerolls<=0) char.activeBuffs=char.activeBuffs.filter(b=>b!==_fs); }
  char.activeBuffs=(char.activeBuffs||[]).filter(b=>!b.consumeOnAttack);
  const fumble=base===1&&!forceCrit, crit=forceCrit||base===20;
  const phantomThisHit=char.phantomStrike&&!char._phantomStrikeUsed;
  if(phantomThisHit) char._phantomStrikeUsed=true;
  const _arcaneIgnoreAC=char.arcaneStrike&&(Math.random()<(0.04*(1+Math.max(0,modVal(char.attrs.int)))));
  const _enemyAC=(enemy.ac||0)+((enemy.scurryAway&&enemy._scurryDefBonus)||0); // Scurry Away: +3 AC while a clanrat lives
  const total=final+atkMod, hit=!fumble&&(crit||total>=_enemyAC||phantomThisHit||_arcaneIgnoreAC);
  if(_arcaneIgnoreAC&&!phantomThisHit) { } // logged below if hit
  let dmg=0, dmgParts=[];
  if (hit) {
    const weapRoll=rd(num,sides);
    if(warCryDmgBonus>0){dmg+=warCryDmgBonus;dmgParts.push(`+${warCryDmgBonus} war cry`);}    const statBonus=Math.max(0,modVal(char.attrs[wpnStat]));
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
      if (!char._trickeryFirstHit) { char._trickeryFirstHit=true; char._trickeryPoisonProc=4; }
      else { char._trickeryPoisonProc=2; }
    }
    const dmgBuff=getBuffVal(char,'dmgBonus'); if(dmgBuff){dmg+=dmgBuff;dmgParts.push(`+${dmgBuff} buff`);}
    if(enemy && enemy._mistFormRounds>0){ dmg=Math.ceil(dmg/2); dmgParts.push('½ mist'); }
    if(enemy && enemy._godsWardRounds>0){ dmg=Math.ceil(dmg*0.75); dmgParts.push('−25% ward'); }
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
    if(char.rage&&char.rageBoon){ const rb=rd(1,6);dmg+=rb;dmgParts.push(`+${rb} rage`);char.rageBoon=false; } // consume rage proc
    const corrodedBuff=(char.activeBuffs||[]).find(b=>b.dmgPenalty);
    if(corrodedBuff&&dmg>0){ dmg=Math.max(0,dmg-corrodedBuff.dmgPenalty); }
    if(char._wpnRuneStrikeActive && enemy && enemy.damageReduction){ dmg+=enemy.damageReduction; dmgParts.push(`+${enemy.damageReduction} rune`); char._wpnRuneStrikeActive=false; }
    if(char.toughness){dmg=Math.max(0,Math.floor(dmg*0.9));}
    dmg=Math.max(1,dmg);
  }
  const net=boons-banes; const boonInfo=net>0?` (+${boonDie} boon)`:net<0?` (-${baneDie} bane)`:''; // shows actual die rolled
  const wpnLabel=wpn?`${wpn.name} (${wpnDice}+${wpnDmgBonus}) [${(wpn&&wpn.dmgType)||'slashing'}]`:'Unarmed (1d6)';
  if(!hit && !fumble && char._wpnArcaneFocus) char._wpnArcaneFocusMissed=true;
    if(char.weaponMaster && hit){ const maxRoll=num*sides+wpnDmgBonus; const minAllowed=Math.ceil(maxRoll/2); if(dmg<minAllowed){dmg=minAllowed;dmgParts.push(`(min ${minAllowed})`);} }
  return {hit,crit,fumble,base,final,total,dmg,dmgParts,atkMod,boonInfo,forceCrit,wpnLabel};
}

function rollEnemyAttack(enemy, char, hasBoon=false, room=null) {
  if(enemy._worshipBoon){ enemy._worshipBoon=false; hasBoon=true; }
  if(enemy.skavenDiscipline){ hasBoon=true; }
  if(enemy.plagueFrenzy && char._poisonedStacks && char._poisonedStacks>=5){ hasBoon=true; }
  if(enemy._godsNextBoon){ hasBoon=true; enemy._godsNextBoon=false; } // chosenOfTheGods extra boon // plagueFrenzy: player 5+ poison stacks = +1 boon (SotDL max 1 boon die per roll)
  const hasSkavenDiscipline=enemy&&enemy.skavenDiscipline;
  const baneDebuff=getDebuffVal(enemy,'bane');
  const skipDebuff=(enemy.activeDebuffs||[]).find(d=>d.skipTurn);
  if(skipDebuff){ skipDebuff.duration--; if(skipDebuff.duration<=0) enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>!d.skipTurn); return {hit:false,crit:false,dmg:0,dmgRoll:0,critRoll:0,total:0,base:0,skipped:true}; }
  if((char.activeBuffs||[]).some(b=>b.immuneThisRound)){ return {hit:false,crit:false,dmg:0,dmgRoll:0,critRoll:0,total:0,base:0,skipped:true,immune:true}; }
  const evasionBane=char.evasion?1:0;
  const poisonBane=(enemy&&enemy._poisonStacks&&enemy._poisonStacks>=5)?1:0; // Poison threshold: 5+ stacks
  const packScornBane=char._armorPackScorn&&enemy&&enemy.tags&&enemy.tags.includes('skaven')?1:0;
  const shroudBane=char._legShroudActive?1:0; // Shroud of Undeath: below 25% HP enemies have 1 bane
  const ratkingBane=char._legRatking&&enemy&&enemy.tags&&enemy.tags.includes('skaven')?2:0; // Ratking Crown: 2 banes vs skaven
  const sacredAegisBane=0; // sacredAegis now retaliates damage instead of bane
  const vanishBane=(char.activeBuffs||[]).reduce((a,b)=>a+(b.enemyBane||0),0);
  const totalBanes=baneDebuff+evasionBane+packScornBane+shroudBane+ratkingBane+poisonBane+sacredAegisBane+vanishBane;
  // Revelation: forceReroll — enemy rerolls and takes the worse result
  const _revDebuff=(enemy.activeDebuffs||[]).find(d=>d.forceReroll&&(d.rerollCount||0)>0);
  if(_revDebuff){ _revDebuff.rerollCount--; if(_revDebuff.rerollCount<=0) _revDebuff.duration=0; }
  if(enemy._frenzyNextHit){ enemy._frenzyNextHit=false; return {hit:true,crit:false,dmg:rd(enemy.dmgNum,enemy.dmgSides)+enemy.dmgBonus,dmgRoll:0,critRoll:0,total:99,base:20,boonInfo:' (Frenzy — auto-hit)'}; }
  const cwBoon=(enemy&&enemy._chosenBoon>0)?1:0; if(cwBoon&&enemy) enemy._chosenBoon=Math.max(0,(enemy._chosenBoon||0)-1);
  const targetPoisoned=char&&(char._poisonedStacks||0)>=5;
  const effectiveHasBoon=hasBoon||hasSkavenDiscipline||(enemy&&enemy.plagueFrenzy&&targetPoisoned)||(cwBoon>0);
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
  const total2=finalBase+enemy.atk, crit2=finalBase===20;
  const hit=finalBase!==1&&(crit2||total2>=char.defense);
  let dmg=0, dmgRoll=0, critRoll=0;
  if (hit) {
    dmgRoll=rd(enemy.dmgNum,enemy.dmgSides);
    dmg=dmgRoll+enemy.dmgBonus;
    if (crit2) { critRoll=rd(enemy.dmgNum,enemy.dmgSides); dmg+=critRoll; }
    if((enemy.activeDebuffs||[]).some(d=>d.rerollDmgLower)){ const alt=rd(enemy.dmgNum,enemy.dmgSides)+enemy.dmgBonus; dmg=Math.min(dmg,alt); }
    if (char.toughness) dmg=Math.max(0,Math.floor(dmg*0.9));
    dmg=Math.max(1,dmg);
  }
  if(!hit && enemy && enemy.activeDebuffs){
    enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>!d.consumeOnMiss);
  }
  return {hit,crit:crit2,dmg,dmgRoll,critRoll,total:total2,base:adjBase,boonInfo};
}

// ─── BUFF / DEBUFF SYSTEM ────────────────────────────────────────────────────
let _buffId=0;
function addBuff(char, name, effects, duration=1){
  if(!char.activeBuffs) char.activeBuffs=[];
  char.activeBuffs.push({id:_buffId++, name, duration, ...effects});
}
function addDebuff(enemy, name, effects, duration=1){
  if(!enemy.activeDebuffs) enemy.activeDebuffs=[];
  enemy.activeDebuffs.push({id:_buffId++, name, duration, ...effects});
}
function tickBuffs(char){
  if(!char.activeBuffs) return;
  char.activeBuffs.filter(b=>b.regenHp&&b.duration>0).forEach(b=>{ char.health=Math.min(char.maxHealth,char.health+(b.regenHp||0)); });
  // Tick DoT buffs on players (Bleed applied by enemies — fortitude blocks Bleed)
  char.activeBuffs.filter(b=>b.dotDmg&&b.duration>0&&!(char.fortitude&&b.name==='Bleed')).forEach(b=>{ char.health=Math.max(0,char.health-b.dotDmg); });
  char.activeBuffs=char.activeBuffs.filter(b=>{
    if(b.skipTurn) return b.duration>0; // stuns count down on the player's turn, not at round end
    b.duration--;
    if(b.duration<=0){
      // lingeringMagic: DoT doubling handled in applyBurn/applyPoison/applyBleed
      if(b.defBonus) char.defense=Math.max(char.baseAgiDef||0, char.defense-b.defBonus);
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

// ─── LEVEL UP & PATHS ────────────────────────────────────────────────────────

function checkLevelUp(char) {
  // Advance ONE level at a time so no level's talents, HP or path choice is skipped.
  // Stops at a level that needs a path choice; APPLY_PATH calls this again to continue.
  let gained=0, leveled=false;
  while (char.level < 10 && !char.pendingLevelUp && char.xp >= XP_THRESHOLDS[char.level+1]) {
    const newLevel = char.level + 1;
    char.level=newLevel; leveled=true;
    applyLevelGains(char, newLevel);
    if (newLevel===3&&!char.expertPath) { char.pendingLevelUp=true; char.pendingPathTier='expert'; }
    else if (newLevel===7&&!char.masterPath) { char.pendingLevelUp=true; char.pendingPathTier='master'; }
    if (char.traditions && char.traditions.length) {
      char.traditions.forEach(tId=>{
        const newSpells=getSpellsForPower(tId,char.power);
        newSpells.forEach(sp=>{if(!char.knownSpells.find(k=>k.name===sp.name))char.knownSpells.push({...sp,heal:sp.type==='heal'});});
      });
    }
    const hpGain=getPathHpGain(char, newLevel);
    char.maxHealth+=hpGain; char.health=Math.min(char.health+hpGain,char.maxHealth); gained+=hpGain;
  }
  return leveled ? {leveled:true,newLevel:char.level,hpGain:gained} : {leveled:false};
}

function getPathHpGain(char, level) {
  if (level>=7&&char.masterPath) { const mp=MASTER_PATHS[char.masterPath]; return mp?mp.hpGain:2; }
  if (level>=3&&char.expertPath) { const ep=EXPERT_PATHS[char.expertPath]; return ep?ep.hpGain:2; }
  if (char.novicePath) { const np=NOVICE_PATHS[char.novicePath]; return np?np.hpGain:2; }
  return 2;
}

function applyLevelGains(char, level) {
  if (char.expertPath) {
    const ep=EXPERT_PATHS[char.expertPath];
    if (ep&&ep.levelGains&&ep.levelGains[level]) applyTalentList(char, ep.levelGains[level]);
  }
  if (char.masterPath) {
    const mp=MASTER_PATHS[char.masterPath];
    if (mp&&mp.levelGains&&mp.levelGains[level]) applyTalentList(char, mp.levelGains[level]);
  }
}

function applyTalentList(char, talents) {
  talents.forEach(t => {
    if (t==='+1str') char.attrs.str++;
    else if (t==='+1agi') { char.attrs.agi++; char.baseAgiDef=char.attrs.agi; char.defense++; } // Defence = AGI + armour
    else if (t==='+1int') char.attrs.int++;
    else if (t==='+1wil') char.attrs.wil++;
    else char[t]=true;
    if (t==='weaponAptitude') { char.weaponAtkBonus=(char.weaponAtkBonus||0)+2; }
    if (t==='bulwark')       { char.maxHealth+=5; char.health=Math.min(char.health+5,char.maxHealth); char.defense=(char.defense||0)+2; }
    if (t==='overcast'||t==='burningSoul') { /* no power, just talent */ }
    if (t==='spellsurge'||t==='catastrophe') { char.power+=1; char.maxPower+=1; refreshCastingPools(char); }
    if (t==='holyAura'||t==='miracleHeal')  { char.power+=1; char.maxPower+=1; refreshCastingPools(char); }
    if (t==='arcaneMastery') { char.power+=1; char.maxPower+=1; char.arcaneMastery=true; refreshCastingPools(char); }
    if (t==='divineVessel')  { char.power+=1; char.maxPower+=1; char.divineVessel=true;  refreshCastingPools(char); }
  });
}

function applyNovicePath(char, pathId) {
  char.novicePath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  char.pendingSpellChoices=0;
  const np=NOVICE_PATHS[pathId]; if(!np) return;
  char.maxHealth+=np.hpGain; char.health=Math.min(char.health+np.hpGain,char.maxHealth);
  if (np.power) { char.power+=np.power; char.maxPower+=np.power; refreshCastingPools(char); }
  const NOVICE_FLAGS=[
    'weaponTraining','catchBreath','shieldBash','taunt','trickery','nimbleRecovery','spellRecovery','sharedRecovery',
    'toughness','bleedOnCrit','bleedOnHit','evasion','venomOnFirstHit','burningSoul','burnOnSpell',
    'holyFervor','divineFavour','bleedDeep','deepBleed','poisonBlade','curse','_curseUsed','druidFervor','druidsFury','weaponMaster',
  ];
  NOVICE_FLAGS.forEach(f=>{ if(np[f]) char[f]=true; });
  if (char.spellcaster && char.tradition) {
    grantTradition(char, char.tradition);
  }
}

function grantTradition(char, tradId) {
  const trad = TRADITIONS[tradId];
  if (!trad || char.traditions.includes(tradId)) return;
  char.traditions.push(tradId);
  trad.spells.filter(s => s.rank === 0 || s.rank <= char.power).forEach(sp => {
    if (!char.knownSpells.find(k => k.name === sp.name))
      char.knownSpells.push({...sp, heal: sp.type === 'heal'});
  });
  refreshCastingPools(char);
}

function applyExpertPath(char, pathId) {
  char.expertPath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  const ep=EXPERT_PATHS[pathId]; if(!ep) return;
  char.maxHealth+=ep.hpGain; char.health=Math.min(char.health+ep.hpGain,char.maxHealth);
  if (ep.power) { char.power+=ep.power; char.maxPower+=ep.power; refreshCastingPools(char); }
  if (ep.levelGains&&ep.levelGains[3]) applyTalentList(char, ep.levelGains[3]);
  const pathsWithTradition = ['cleric','druid','oracle','paladin','wizard','warlock','sorcerer','spellbinder','evoker','elementalist','healer','zealot','witch'];
  if (pathsWithTradition.includes(pathId)) {
    char.pendingLevelUp=true; char.pendingPathTier='tradition'; char.pendingSpellChoices=1;
  }
  if (pathId==='elementalist' && char.traditions.includes('fire')) {
    const fw=TRADITIONS.fire?.spells.find(s=>s.name==='Firewall')||{name:'Firewall',rank:1,type:'attack',dmg:'4d6',applyBurn:true,burnDiceOverride:2,desc:'Rank 1. 4d6 + INT to one enemy. Burn 2d6 (loses 1 die each round). Fire: ×2 vs Undead.'};
    if(!char.knownSpells.find(k=>k.name==='Firewall')) char.knownSpells.push({...fw,heal:false});
  }
}

function applyMasterPath(char, pathId) {
  char.masterPath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  const mp=MASTER_PATHS[pathId]; if(!mp) return;
  char.maxHealth+=mp.hpGain; char.health=Math.min(char.health+mp.hpGain,char.maxHealth);
  if (mp.power) { char.power+=mp.power; char.maxPower+=mp.power; refreshCastingPools(char); }
  if (mp.levelGains&&mp.levelGains[7]) applyTalentList(char, mp.levelGains[7]);
  const masterWithTradition = ['archmage','arcanist','abjurer','conjurer','transmuter','stormbringer','thaumaturge','highpriest','chaplain','templar','exorcist','healer_m','necromancer'];
  if (masterWithTradition.includes(pathId)) {
    char.pendingLevelUp=true; char.pendingPathTier='tradition'; char.pendingSpellChoices=1;
  }
}

function getTargetEnemy(gs) {
  const enemies = gs.enemies || [];
  if(enemies.length>0){
    const idx=Math.min(gs.activeEnemyIdx||0,enemies.length-1);
    return enemies[idx]||enemies[0]||null;
  }
  return gs.enemy||null;
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
    if(gs._nextCombatHalfHP){ gs._nextCombatHalfHP=false; gs.enemies.forEach(e=>{e.hp=Math.ceil(e.hp/2); e.maxHp=e.hp;}); addLog(room,`🔴 Ritual disruption — enemies enter at half HP!`,'chaos'); }
    gs.inCombat=true; gs.phase='combat'; gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.roundNumber=1;
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
    else { resolveUnknownEvent(room); }
    return;
  }
}

// ─── UNKNOWN ROOM ENCOUNTERS ─────────────────────────────────────────────────
function resolveUnknownEvent(room){
  const gs=room.gs;
  const alive=room.players.filter(p=>p.char&&p.char.alive);
  const roll=d(10);
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
  if(roll===11){
    // Chaos Ritual Site
    addLog(room,`🔴 <strong>Chaos Ritual Site!</strong> An active ritual pulses. Choose: disrupt (each warrior takes 1d6 damage, next enemy starts at half HP) or leave (one ally gains +1 Power).`,'chaos');
    const disrupt=Math.random()<0.5;
    if(disrupt){
      alive.forEach(p=>{const dmg=rd(1,6);p.char.health=Math.max(0,p.char.health-dmg);addLog(room,`${p.name} takes ${dmg} chaos damage disrupting the ritual.`,'chaos');checkDeath(room,p);});
      gs._nextCombatHalfHP=true;
      addLog(room,`Ritual disrupted — next enemy enters at half HP!`,'sys');
    } else {
      const pw=alive[Math.floor(Math.random()*alive.length)];
      pw.char.power+=1; addLog(room,`${pw.name} absorbs the ritual energy — +1 Power permanently.`,'loot');
    }
    return;
  }
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
      const buyer=alive[0]; buyer.char.gold-=15;
      addToInventory(buyer.char,'Spell Scroll',{id:'sc'+Date.now(),name:`Scroll: ${sc.name}`,spell:sc,type:'scroll',desc:sc.desc});
      addLog(room,`🕵 <strong>Black Market!</strong> ${buyer.name} buys a Scroll of ${sc.name} for 15 silver.`,'loot');
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
  return {consumable,scrollSpell,weapon:genSpecialWpn(bossCount),armor:genSpecialArmor(bossCount)};
}
function genSpecialWpn(bossCount=0){
  const specials=WEAPON_BASES.filter(b=>b.special);
  const pool=bossCount===0?specials.filter(b=>b.dice==='1d6'):specials;
  const base=pool[Math.floor(Math.random()*pool.length)];
  const bonus=bossCount===0?d(3):bossCount===1?d(2)+2:d(2)+4;
  return{id:'w'+uuidv4(),name:base.name,dice:base.dice,stat:base.stat,bonus,dmgType:base.dmgType,special:base.special,cost:0,sellCost:3,bought:false,type:'weapon',desc:`${base.dice}+${bonus} · ${base.stat.toUpperCase()} · ${base.dmgType} — ${base.special.desc}`};
}
function genSpecialArmor(bossCount=0){
  const specials=ARMOR_BASES.filter(ab=>ab.special);
  const base=specials[Math.floor(Math.random()*specials.length)];
  const bonus=bossCount===0?d(3):bossCount===1?d(2)+1:d(3)+2;
  const totalDef=base.def+bonus;
  return{id:'a'+uuidv4(),name:base.name,defBonus:totalDef,special:base.special,cost:0,sellCost:3,bought:false,type:'armor',desc:`+${totalDef} Defense — ${base.special.desc}`};
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
  gs.turnOrder = order;
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
    if (autoSkipStunnedPlayer(room, cur.id)) return;
    broadcastState(room.code);
  }
}

function endRound(room) {
  const gs = room.gs;
  if (!gs.inCombat || gs.phase === 'victory' || gs.phase === 'gameover' || gs.phase === 'dying') return;
  room.players.forEach(p => {
      if (!p.char || !p.char.alive) return;
      tickBuffs(p.char);
      if (p.char.health <= 0 && p.char.alive) { checkDeath(room, p); } // DoT (Bleed/Burn/Chilled) kill check
      if (p.char._poisonedStacks && p.char._poisonedStacks > 0 && !p.char.fortitude) {
        const _ppd = p.char._poisonedStacks;
        p.char.health = Math.max(0, p.char.health - _ppd);
        addLog(room, `☠ <strong>Poison</strong> (${p.char._poisonedStacks} stk) — <strong class="num-dmg">\u2212${_ppd}</strong> to ${p.name} \u2192 ${p.char.health}/${p.char.maxHealth} HP`, 'spell');
        p.char._poisonedStacks = Math.max(0, p.char._poisonedStacks - 2);
        if (p.char.health <= 0) checkDeath(room, p);
      }
    });
  (gs.enemies || []).filter(en=>en&&en.hp>0).forEach(en => {
    tickDebuffs(en);
    if(en._mistFormRounds>0) en._mistFormRounds--;
    if(en._godsWardRounds>0) en._godsWardRounds--;
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
  if (ae.mutate) { ae._mutateBonus=(ae._mutateBonus||0)+1; ae.dmgBonus=(ae.dmgBonus||0)+1; addLog(room,`🧬 <strong>Mutate!</strong> ${ae.name} grows stronger — now +${ae._mutateBonus} bonus damage!`,'chaos'); }
  if (ae._godsRegenRounds > 0) { ae._godsRegenRounds--; const gr=rd(1,6); ae.hp=Math.min(ae.maxHp,ae.hp+gr); addLog(room,`🔴 ${ae.name} regenerates <strong>${gr}</strong> HP (Chosen of the Gods).`,'chaos'); }
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

  const stunned = (ae.activeDebuffs || []).find(d => d.skipTurn);
  if (stunned) {
    stunned.duration--;
    if(stunned.duration<=0) ae.activeDebuffs = ae.activeDebuffs.filter(d => !d.skipTurn); // remove when expired
    addLog(room, `💫 <strong>${ae.name}</strong> is stunned — loses its action this turn! (${stunned.duration>0?stunned.duration+' turn(s) remaining':'last turn'})`, 'sys');
    advanceTurn(room);
    return;
  }

  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) { triggerGameover(room); return; }

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
  if (ae.chaosWorship && !ae._worshipUsed) {
    ae._worshipUsed = true; // reset per-round handled below
    const worship=Math.floor(Math.random()*5);
    if(worship===0){ ae._worshipLifeLeech=true; addLog(room,`🔱 <strong>Chaos Worship!</strong> ${ae.name} — next attack leeches life!`,'chaos'); }
    else if(worship===1){ ae._worshipBleed=true; addLog(room,`🔱 <strong>Chaos Worship!</strong> ${ae.name} — next attack applies Bleed!`,'chaos'); }
    else if(worship===2){ ae._worshipBoon=true; addLog(room,`🔱 <strong>Chaos Worship!</strong> ${ae.name} — next attack +1 boon!`,'chaos'); }
    else if(worship===3){ ae._worshipStun=true; addLog(room,`🔱 <strong>Chaos Worship!</strong> ${ae.name} — next attack stuns!`,'chaos'); }
    else { ae._worshipBane=true; addLog(room,`🔱 <strong>Chaos Worship!</strong> ${ae.name} — all players have 1 bane next round!`,'chaos'); if(alive.length) alive.forEach(p=>addBuff(p.char,'Chaos Bane',{atkBane:1},2)); }
  }
  if(ae.chaosWorship){ ae._worshipUsed=false; }
  if(ae.chosenOfTheGods && !ae._godsUsed) {
    ae._godsUsed = true;
    const gods=Math.floor(Math.random()*4);
    if(gods===0){ ae._godsRegenRounds=2; addLog(room,`🔴 <strong>Chosen of the Gods!</strong> ${ae.name} — Chaos blesses with regeneration!`,'chaos'); }
    else if(gods===1){ ae._godsNextBoon=true; addLog(room,`🔴 <strong>Chosen of the Gods!</strong> ${ae.name} — Chaos grants +2 boons on next attack!`,'chaos'); }
    else if(gods===2){ ae._godsWardRounds=2; addLog(room,`🔴 <strong>Chosen of the Gods!</strong> ${ae.name} — Chaos wards 25% damage for 2 rounds!`,'chaos'); }
    else { alive.forEach(p=>addBuff(p.char,'Chaos Bane',{atkBane:1},2)); addLog(room,`🔴 <strong>Chosen of the Gods!</strong> ${ae.name} — Chaos curses all players with 1 bane!`,'chaos'); }
  }
  if(ae.chosenOfTheGods){ ae._godsUsed=false; } // refresh each round
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
  if (ae.chosenOfGods && !ae._chosenThisRound) {
    ae._chosenThisRound=true;
    const _cg=Math.floor(Math.random()*4);
    if(_cg===0){ addBuff(ae,'Regen',{regenHp:rd(1,6)},2); addLog(room,`✨ <strong>Chosen of the Gods!</strong> ${ae.name} regenerates — 1d6 HP for 2 rounds!`,'chaos'); }
    else if(_cg===1){ ae._chosenBoon=2; addLog(room,`✨ <strong>Chosen of the Gods!</strong> ${ae.name} — +2 boons on next attack!`,'chaos'); }
    else if(_cg===2){ addBuff(ae,'Blessed Armour',{damageReduction:0.25},2); addLog(room,`✨ <strong>Chosen of the Gods!</strong> ${ae.name} — 25% damage reduction for 2 rounds!`,'chaos'); }
    else { alive.forEach(p=>addBuff(p.char,'Cursed',{bane:1},2)); addLog(room,`✨ <strong>Chosen of the Gods!</strong> ${ae.name} — all players have 1 bane for 2 rounds!`,'chaos'); }
  }
  if (ae.chaosWorship) {
    const _cw=Math.floor(Math.random()*5);
    const _cwOpts=['lifeLeechNext','bleedNext','boonNext','stunNext','baneNext'];
    ae['_cw_'+_cwOpts[_cw]]=true;
    const _cwLabels=['💉 next attack leeches life','🩸 next attack applies Bleed','⚔ next attack +1 boon','💫 next attack stuns','⬇ next attack gives player 1 bane'];
    addLog(room,`🌀 <strong>Chaos Worship!</strong> ${ae.name} receives a dark blessing — ${_cwLabels[_cw]}!`,'chaos');
  }
  if (ae.belowRoar && !ae._roarActive && ae.hp < ae.maxHp * 0.5) {
    ae._roarActive = true;
    room.players.filter(p=>p.char&&p.char.alive).forEach(p => { addBuff(p.char,'Roared',{bane:1},1); });
    addLog(room, `🐂 <strong>Bellowing Roar!</strong> All warriors have 1 bane on next attack!`, 'chaos');
  }
  if (ae.frenzyAtk && ae.hp < ae.maxHp * ae.frenzyAtk.threshold && !ae._frenzyActive) {
    ae._frenzyActive = true;
    addLog(room, `😤 <strong>Frenzy!</strong> ${ae.name} enters a frenzied state!`, 'chaos');
  }
  if (ae._crushCooldown > 0) ae._crushCooldown--;

  // ── Determine attack multiplier ───────────────────────────────────────────
  if (ae.frenzyMulti && !ae._frenzyOnceUsed && ae.hp < ae.maxHp * (ae.frenzyMulti.threshold||0.5)) {
    ae._frenzyOnceUsed = true;
    ae.lifeLeechFrac = 0.5; // increase leech to 50%
    ae._frenzyNextHit = true; // next attack auto-hits
    addLog(room, `😤 <strong>Frenzy!</strong> ${ae.name} — next attack ALWAYS lands, life leech increased to <strong>50%</strong>!`, 'chaos');
  }
  const baseAttacks = ae.multi ? 2 : 1;

  // Taunt: while a warrior is Taunting, enemies attack only them
  const _taunter = alive.find(p => (p.char.activeBuffs||[]).some(b => b.taunting));
  if (_taunter) { alive.length = 0; alive.push(_taunter); }
  // ── Attack loop ───────────────────────────────────────────────────────────
  if(alive.length>1) alive.sort((a,b)=>(a.char._armorLastTarget?1:0)-(b.char._armorLastTarget?1:0));
  if(alive.length>1) alive.sort((a,b)=>((b.char.bodyguard)?1:0)-((a.char.bodyguard)?1:0));
  alive.forEach(p => {
    const auraBonus  = room.players.some(q=>q.char&&q.char.alive&&q.char.holyAura)?2:0;
    const shieldBonus = p.char.shieldwall ? 2 : 0;
    const ignoresDef  = ae.ignoresDef || 0;
    if(p.char.flicker && !p.char._flickerUsed){ p.char._flickerUsed=true; addLog(room,`🤸 <strong>Flicker!</strong> ${p.name} simply isn't there — attack negated!`,'spell'); return; }
    const aegisBonus  = room.players.some(q=>q.char&&q.char.alive&&q.char._legExtinctionAegis)?2:0;
    const wardBonus   = room.players.some(q=>q.char&&q.char.alive&&q.char.ward)?1:0; // Ward talent
    if(p.char._legShroud && p.char.health>0 && p.char.health<=Math.floor(p.char.maxHealth*0.25)){
      p.char._legShroudActive=true;
    } else { p.char._legShroudActive=false; }
    const defTotal    = Math.max(10, p.char.defense + auraBonus + shieldBonus + aegisBonus + wardBonus - ignoresDef);

    for (let atk_i = 0; atk_i < baseAttacks; atk_i++) {
      if (!p.char.alive) break;

      const atkBase  = ae._frenzyActive && ae.frenzyAtk ? ae.frenzyAtk.newAtk : ae.atk;
      const atkBonus = ae._packBonus || 0;
      const hasExtraBoon = ae._rageActive || (ae._frenzyActive && ae.frenzyAtk && ae.frenzyAtk.boon);
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
      ['activeDebuffs','_worshipBoon','_frenzyNextHit','_chosenBoon','_godsNextBoon'].forEach(k=>{ ae[k]=aeProxy[k]; }); // state consumed on the proxy must persist
      p.char._foresightActive = _pcView._foresightActive; // Foresight is consumed on the copy — sync it back

      if (r.hit) {
        let dmg = r.dmg;
        if (ae.chaosCrit && r.crit)                                  { dmg += rd(1,6); }
        if (ae.recklessCharge && recklessBoon)                        { dmg += rd(1,6); }
        if (ae._frenzyActive && ae.frenzyAtk && ae.frenzyAtk.extraDmg){ dmg += rd(1,6); }
        if (ae._rageActive)                                           { dmg += rd(1,6); }
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
        if(dmg>0) gs._anyPlayerHitThisTurn=true;
        checkDeath(room, p);
        if(!p.char.alive && !p.char.pendingRevive){ p.char.pendingRevive=true; }
        const critLabel = r.crit ? ' 💥 CRIT!' : '';
        const dmgBreak  = `${ae.dmgNum}d${ae.dmgSides}(${r.dmgRoll})${ae.dmgBonus?'+'+ae.dmgBonus:''}${r.critRoll?'+'+r.critRoll+' crit':''}`;
        if(p.char.fadePassive) p.char._wasAttackedThisRound=true;
        addLog(room, `${ae.name} hits <strong>${p.name}</strong> — <strong class="num-dmg">-${dmg} dmg</strong>${critLabel} [d20:<strong>${r.base}</strong>+atk<strong>${aeProxy.atk>=0?'+':''}${aeProxy.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${defTotal}</strong>] [${dmgBreak}] → ${p.name} <strong>${p.char.health}</strong>/${p.char.maxHealth} HP`, 'dmg-taken');

        // ── On-hit abilities (skip if player already dead) ───────────────
        if (!p.char.alive) { checkDeath(room, p); }
        if (p.char.alive && ae.lifeLeech) {
          const frac = ae.lifeLeechFrac || 0.25;
          if (ae.lifeLeechFrac && ae.lifeLeechFrac <= 0.25) { ae._leechAccum = (ae._leechAccum||0) + dmg; } // accumulate leech for sustain-type (Varghulf)
          else { const l = Math.floor(dmg * frac); ae.hp = Math.min(ae.maxHp, ae.hp+l); addLog(room, `🩸 ${ae.name} leeches <strong>${l}</strong> HP.`, 'chaos'); }
        }
        if (p.char.alive && ae.insanityAtk && d(6) >= 4) { p.char.insanity++; addLog(room, `${p.name} gains 1 Insanity!`, 'chaos'); }
        if (p.char.alive && ae.bloodOnHit && r.hit) { addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room,`🩸 <strong>Bloodgreed!</strong> ${ae.name} — 1 Bleed!`,'chaos'); }
        if (ae.frenziedAssault && r.hit && ae.hp > ae.maxHp * 0.5) { p.char.health=Math.max(0,p.char.health-4); addLog(room,`⚔ <strong>Frenzied Assault!</strong> +4 bonus damage!`,'chaos'); checkDeath(room,p); }
        if (ae._worshipLifeLeech && r.hit) { ae._worshipLifeLeech=false; const _ll2=Math.ceil(dmg*0.5); ae.hp=Math.min(ae.maxHp,ae.hp+_ll2); addLog(room,`🔱 <strong>Chaos Worship!</strong> Leeches ${_ll2} HP!`,'chaos'); }
        if (ae._worshipBleed && r.hit) { ae._worshipBleed=false; addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room,`🔱 <strong>Chaos Worship!</strong> ${p.name} Bleeds!`,'chaos'); }
        if (ae._worshipStun && r.hit) { ae._worshipStun=false; addBuff(p.char,'Stunned',{skipTurn:true},2); addLog(room,`🔱 <strong>Chaos Worship!</strong> ${p.name} STUNNED!`,'chaos'); }
        if (p.char.alive && ae.graveChill) { addBuff(p.char,'Chilled',{bane:1,dotDmg:rd(1,3)},2); addLog(room, `❄ <strong>Grave Chill!</strong> ${p.name} is Chilled — 1d3 dmg/round + 1 bane for 2 rounds!`, 'spell'); }
        if (ae.corrodingBite && !p.char._corroded) { p.char._corroded=true; addBuff(p.char,'Corroded',{dmgPenalty:1},1); addLog(room, `🟢 <strong>Corroding Bite!</strong> ${p.name} weakened — -1 damage for 1 round!`, 'chaos'); }
        if (p.char.alive && ae.gutterFighting && r.hit) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+2; if((p.char._poisonedStacks||0)>2){ addBuff(p.char,'Gutter Poison',{atkBane:1},1); addLog(room,`🗡 <strong>Gutter Fighting!</strong> ${p.name} — 2 poison stacks + 1 bane (already poisoned)!`,'chaos'); } else { addLog(room,`🗡 <strong>Gutter Fighting!</strong> ${p.name} poisoned — 2 stacks!`,'chaos'); } }
        if (p.char.alive && ae.virulentBlade && r.hit) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+3; addLog(room,`☠ <strong>Virulent Blade!</strong> ${ae.name}'s plague blade applies <strong>3 poison stacks</strong> to ${p.name}!`,'chaos'); }
        if (ae.hypnoticGaze) { addBuff(p.char,'Hypnotised',{bane:1},1); addLog(room, `👁 <strong>Hypnotic Gaze!</strong> ${p.name} entranced — 1 bane on next attack!`, 'chaos'); }
        if (p.char.alive && ae.crushingTail && r.hit && Math.random()<0.20) { addBuff(p.char,'Stunned',{skipTurn:true},2); addLog(room,`🦎 <strong>Crushing Tail!</strong> ${p.name} is STUNNED by the Saurian's tail sweep!`,'chaos'); }
        if (p.char.alive && ae.crushingBlow && !ae._crushCooldown) {
          ae._crushCooldown=2;
          if(p.char._legExtinctionAegis||p.char._legAncientScale){
            addLog(room,`🛡 Crushing Blow absorbed by ${p.name}'s legendary armour!`,'sys');
          } else if(p.char.ironResolve&&(p.char.activeBuffs||[]).some(b=>b.skipTurn)){
            addLog(room,`💪 <strong>Iron Resolve!</strong> ${p.name} is already stunned — second stun ignored!`,'sys');
          } else if(p.char._armorFlatDR&&p.char._dwarfForgedStunUsed){
            addLog(room,`🛡 Crushing Blow! ${p.name}'s Gromril Plate absorbs the stun!`,'sys');
          } else {
            if(p.char._armorFlatDR) p.char._dwarfForgedStunUsed=true;
            addBuff(p.char,'Stunned',{skipTurn:true},2);
            addLog(room,`💥 <strong>Crushing Blow!</strong> ${p.name} is STUNNED and loses their next action!`,'chaos');
          }
        }
        if (ae.brutalCleave && r.hit && Math.random()<0.25) { addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room,`⚔ <strong>Brutal Cleave!</strong> ${ae.name} gouges ${p.name} — 2 Bleed stacks!`,'chaos'); }
        if (ae.critMajorBleed && r.hit) { addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room, `🩸 <strong>Frenzied Rending!</strong> ${p.name} is Bleeding (1d3/round for 2 rounds)!`, 'chaos'); }
        if (p.char.alive && ae.skavencunning && r.hit) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+2; addLog(room,`🐀 <strong>Skaven Cunning!</strong> ${ae.name} poisons ${p.name} — 2 poison stacks!`,'chaos'); }
        // chaosWorship buff application
        if (r.hit) {
          if(ae._cw_lifeLeechNext){ ae._cw_lifeLeechNext=false; const lh=Math.ceil(r.dmg/2); ae.hp=Math.min(ae.maxHp,(ae.hp||0)+lh); addLog(room,`💉 <strong>Dark Blessing!</strong> ${ae.name} leeches ${lh} HP!`,'chaos'); }
          if(ae._cw_bleedNext){ ae._cw_bleedNext=false; addBuff(p.char,'Bleed',{dotDmg:rd(1,3)},2); addLog(room,`🩸 <strong>Dark Blessing!</strong> ${p.name} is Bleeding!`,'chaos'); }
          if(ae._cw_boonNext){ ae._cw_boonNext=false; } // consumed — boon was already factored in atk bonus (retroactive note)
          if(ae._cw_stunNext){ ae._cw_stunNext=false; addBuff(p.char,'Stunned',{skipTurn:true},2); addLog(room,`💫 <strong>Dark Blessing!</strong> ${p.name} is STUNNED!`,'chaos'); }
          if(ae._cw_baneNext){ ae._cw_baneNext=false; addBuff(p.char,'Cursed',{bane:1},2); addLog(room,`⬇ <strong>Dark Blessing!</strong> ${p.name} has 1 bane for 2 rounds!`,'chaos'); }
        }
        if (p.char.alive && ae.poisonBlade) { p.char._poisonedStacks=(p.char._poisonedStacks||0)+ae.poisonBlade; addLog(room,`☠ <strong>Poison Blade!</strong> ${ae.name} poisons ${p.name} — <strong>${ae.poisonBlade}</strong> poison stacks!`,'chaos'); }
        // bloodlust handled in pre-attack phase below
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
    if (threshold && gs.enemies && gs.enemies.length < 5) {
      ae[threshold] = true;
      const clanrat = scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:0,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
        room.players.filter(p=>p.connected&&p.char&&p.char.alive).length, false, gs.bossCount);
      clanrat.id='pack_'+Date.now(); gs.enemies.push(clanrat);
      addLog(room, `🐀 <strong>Call the Pack!</strong> ${ae.name} summons a Skaven Clanrat!`, 'chaos');
    }
  }
  if (!ae.packBoss && ae.tags&&ae.tags.includes('skaven')&&ae.hp<ae.maxHp*0.6&&!(gs.packCooldown>0)&&gs.enemies&&gs.enemies.length<4) {
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

  advanceTurn(room);
}

function checkDeath(room, player) {
  if(player.char.health<=0&&player.char.alive){
    if(room.players.some(p=>p.char&&p.char.alive&&p.char.grace&&!p.char._graceUsed&&p.id!==player.id)){
      const graceUser=room.players.find(p=>p.char&&p.char.alive&&p.char.grace&&!p.char._graceUsed&&p.id!==player.id);
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
    if(player.char.unstoppable&&!player.char.unstoppableUsed){
      player.char.unstoppableUsed=true; player.char.alive=true; player.char.health=1;
      addLog(room,`💪 <strong>Unstoppable!</strong> ${player.name} survives the killing blow at 1 HP! (once per run)`,'crit');
    }
    room.players.filter(p=>p.char&&p.char.alive&&p.char.vengeancePassive&&p.id!==player.id).forEach(p=>{ p.char._vengeanceReady=true; });
    if(room.players.some(p=>p.char&&p.char.alive&&p.char.lastRites)){ room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{ p.char.health=Math.min(p.char.maxHealth,p.char.health+1); }); addLog(room,`⛪ <strong>Last Rites!</strong> A warrior falls — survivors steel themselves (+1 HP each).`,'heal'); }
    else if(player.char._legShroud&&!player.char._legShroudUsed){
      player.char._legShroudUsed=true; player.char.alive=true;
      player.char.health=rd(1,6);
      addLog(room,`🌑 <strong>Shroud of Undeath!</strong> ${player.name} rises from death at ${player.char.health} HP!`,'chaos');
    }
  }
}

function resolveEnemyDeath(room, deadEnemy) {
  room.players.forEach(p=>{ if(p.char&&p.char.activeBuffs){ const had=p.char.activeBuffs.some(b=>b.name==='Rattled');
    p.char.activeBuffs=p.char.activeBuffs.filter(b=>b.name!=='Rattled'); if(had) addLog(room,`${p.name} steels their nerve.`,'sys'); } });
  const gs=room.gs;
  const e=deadEnemy||gs.enemy;
  const sanctifyActive=room.players.some(p=>p.char&&p.char.sanctify);
  const isSanctified=sanctifyActive&&e&&(e.chaos||e.undead||(e.tags&&(e.tags.includes('chaos')||e.tags.includes('undead'))));
  if(isSanctified) addLog(room,`✝ <strong>Sanctify!</strong> ${e.name} cannot trigger death abilities!`,'spell');
  // daemonicIchor now triggers on-hit (handled in player attack section)
  if(e&&e.undying&&!e._undyingUsed&&d(6)===6&&!isSanctified){
    e._undyingUsed=true; e.hp=1;
    addLog(room,`💀 <strong>Undying!</strong> ${e.name} refuses to stay dead — rises at 1 HP!`,'chaos');
    return false; // enemy survived — callers must NOT treat this as a death
  }
  // Several effects (Holy Fervor, procs, DoTs) can report the same kill: only process it once,
  // otherwise XP, gold, legendaries and the boss counter are awarded twice.
  if(e){ if(e._deathResolved) return true; e._deathResolved=true; }
  addLog(room,`⚔ <strong>${e.name}</strong> is slain! FOR SIGMAR!`,'crit');
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
  const goldEach=Math.floor(goldTotal/Math.max(1,survivors.length));
  addLog(room,`Each survivor: +<strong>${xpEach} XP</strong>, +<strong>${goldEach} silver</strong>.`,'loot');
  if(e.threat==='Boss'){
    const bossIdx=gs.bossCount; // 0 = boss1 just killed, 1 = boss2, 2 = boss3
    gs.bossCount++;
    survivors.forEach(p=>{
      const leg=genLegendaryItem(bossIdx);
      addToInventory(p.char, leg.name, leg);
      addLog(room,`🏆 <strong>${p.name}</strong> claims <em style="color:#e8c050">${leg.name}</em> — ${leg.desc}`,'loot');
    });
  }
  survivors.forEach(p=>{
    p.char.xp+=xpEach;
    p.char.gold+=goldEach;
    if(!_combatOver){ // other enemies still standing: pay out, but keep once-per-combat state
      const lv=checkLevelUp(p.char);
      if(lv.leveled) addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP)${p.char.pendingLevelUp?' — Choose a path!':''}`, 'spell');
      return;
    }
    resetCombatState(p);
    const lv=checkLevelUp(p.char);
    if(lv.leveled) addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP)${p.char.pendingLevelUp?' — Choose a path!':''}`, 'spell');
  });
  rollEnemyDrop(e, room);
  gs.enemies=(gs.enemies||[]).filter(en=>en!==e&&en.hp>0);
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
  if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The Saurian Ancient falls! The warband conquers the depths! FOR SIGMAR!','crit');broadcastState(room.code);return;}
  else if(gs.bossCount>=3){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');broadcastState(room.code);return;}
}

// Everything that lasts "one combat" is cleared here (called when combat ends by victory or by fleeing)
function resetCombatState(p){
    if(p.char._vigorBonus){ p.char.maxHealth-=p.char._vigorBonus; p.char.health=Math.min(p.char.health,p.char.maxHealth); p.char._vigorBonus=0; } // Vigor lasts one combat
    p.char.sharpeningStone=false;
    p.char.divineSmiteUsed=false;
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
    p.char._shieldBashUsed=false; p.char._curseUsed=false; p.char._arcaneSurgeUsed=false; p.char._volatileFormUsed=false; p.char._tauntReadyRound=0; if(p.char.activeBuffs) p.char.activeBuffs=p.char.activeBuffs.filter(b=>!b.taunting); p.char._entangleUsed=false; p.char._freeCastArmed=false;
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
    p.char._relentlessCount=0;
    p.char._fadedLastRound=false;
    p.char.rageTriggerActive=false;
    p.char._huntersMarkTarget=null;
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
  const light=WEAPON_BASES.filter(b=>b.dice==='1d6'), heavy=WEAPON_BASES.filter(b=>b.dice==='2d6');
  const pool=bossCount>0&&d(5)===1?heavy:light;
  const b=pool[Math.floor(Math.random()*pool.length)], bonus=d(6);
  const specDesc2=b.special?` — ${b.special.desc}`:''; return{id:'w'+uuidv4(),name:b.name,dice:b.dice,stat:b.stat,bonus,dmgType:b.dmgType,special:b.special||null,cost:Math.max(5,(b.dice==='2d6'?20:15)+bonus*8+(b.special?10:0)),sellCost:3,bought:false,type:'weapon',desc:`${b.dice}+${bonus} · ${b.stat.toUpperCase()} · ${b.dmgType}${specDesc2}`};
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
  const specDesc=b.special?` — ${b.special.desc}`:''; return{id:'a'+uuidv4(),name:b.name,defBonus:b.def+bonus,special:b.special||null,cost:Math.max(5,20+bonus*10+(b.special?15:0)),sellCost:3,bought:false,type:'armor',desc:`+${b.def+bonus} Defense${specDesc}`};
}
function genShopScroll(){
  const sp=SCROLL_SPELLS_SHOP[Math.floor(Math.random()*SCROLL_SPELLS_SHOP.length)];
  return{id:'sc'+uuidv4(),name:`Scroll: ${sp.name}`,spell:sp,cost:35,sellCost:3,bought:false,type:'scroll',desc:sp.desc};
}
function buildPlayerShop(bossCount=0){
  const hd1={id:'hd1'+uuidv4(),name:'Healing Draught',cost:10,sellCost:3,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const hd2={id:'hd2'+uuidv4(),name:'Healing Draught',cost:10,sellCost:3,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const otherPool=SHOP_CONSUMABLES.filter(c=>c.name!=='Healing Draught').sort(()=>Math.random()-0.5);
  const other=otherPool[0]?{id:'c'+uuidv4(),name:otherPool[0].name,cost:otherPool[0].cost,sellCost:3,desc:otherPool[0].desc,bought:false,type:'consumable'}:hd1;
  return{
    weaponEnhance:{id:'we'+uuidv4(),name:'Weapon Enhancement',desc:'+1 dmg AND +1 to hit on equipped weapon (cap +6)',cost:30,bought:false,type:'enhance'},
    statBoost:    {id:'sb'+uuidv4(),name:'+1 Primary Stat',desc:'Increase highest attribute by 1',cost:35,bought:false,type:'statboost'},
    weapon1:genWpn(bossCount),weapon2:genWpn(bossCount),armor:genArmor(bossCount),
    consumables:[hd1,hd2,other],scroll:genShopScroll(),
  };
}

function addToInventory(char,name,itemObj=null){
  if(itemObj&&(itemObj.type==='weapon'||itemObj.type==='armor')){
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
  const all=[stock.weaponEnhance,stock.statBoost,stock.weapon1,stock.weapon2,stock.armor,stock.scroll,...stock.consumables];
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
  if(itemName==='Healing Draught'){const h=rd(1,6);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} drinks Healing Draught — +<strong>${h}</strong> HP.`,'heal');}
  else if(itemName==='Greater Healing Draught'){const h=rd(2,6);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} drinks Greater Healing — +<strong>${h}</strong> HP.`,'heal');}
  else if(itemName==='Flask of Oil'||itemName==='Incendiary Flask'){const _te=getTargetEnemy(room.gs);if(inCombat&&_te){let dmg=rd(2,6);if(char._armorFireImmune){dmg+=rd(1,6);}// Dragonscale bonus
_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} throws Flask of Oil — <strong>${dmg}</strong> fire dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}else{consumed=false;}}
  else if(itemName==='Fire Jar'||itemName==='Daemon Fire'){const _te=getTargetEnemy(room.gs);if(inCombat&&_te){if(_te.immuneFire){addLog(room,`🔥 ${_te.name} is immune to fire!`,'spell');}else{const dmg=rd(3,6);_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} smashes Fire Jar — <strong>${dmg}</strong> fire dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}}else{consumed=false;}}
  else if(itemName==='Lucky Pendant'){char.luckyPendant=true;addLog(room,`${player.name} activates Lucky Pendant — next attack is a CRIT!`,'loot');}
  else if(itemName==='Sharpening Stone'){char.sharpeningStone=true;addLog(room,`${player.name} uses Sharpening Stone — +1d6 dmg this combat!`,'loot');}
  else if(itemName==='Antitoxin'){char._poisonedStacks=0; if(char.activeBuffs) char.activeBuffs=char.activeBuffs.filter(b=>!b.bane||b.name!=='Plagued'); if(char.conditions) char.conditions=char.conditions.filter(c=>c!=='Poisoned'); addLog(room,`🧪 <strong>Antitoxin!</strong> ${player.name} clears all poison!`,'heal');}
  else if(itemName==='Smoke Bomb'){if(inCombat){(room.gs.enemies||[]).filter(e=>e&&e.hp>0).forEach(e=>{if(!e.activeDebuffs)e.activeDebuffs=[];e.activeDebuffs.push({name:'Smoked',bane:2,duration:1});}); addLog(room,`💨 <strong>Smoke Bomb!</strong> All enemies have 2 banes next round!`,'spell');}else{consumed=false;}}
  else if(itemName==="Sigmar's Token"){const th=rd(1,6)+3;char.health=Math.min(char.maxHealth,char.health+th);if(char.activeBuffs&&char.activeBuffs.length)char.activeBuffs=char.activeBuffs.filter(b=>b.duration>=500||!b.bane);if(char.conditions&&char.conditions.length)char.conditions.pop();addLog(room,`✝ <strong>Sigmar's Token!</strong> +${th} HP and one debuff removed!`,'heal');}
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

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
function handleMessage(ws,msg){
  const{type,payload}=msg, ctx=clients.get(ws);
  if(type==='CREATE_ROOM'){
    const code=makeCode(),playerId=uuidv4();
    const room={code,hostId:playerId,players:[],gs:initGameState()};
    rooms.set(code,room); clients.set(ws,{roomCode:code,playerId});
    room.players.push({id:playerId,ws,name:payload.name||'Host',career:null,char:null,ready:false,connected:true});
    sendTo(ws,{type:'ROOM_CREATED',payload:{code,playerId}});
    broadcastState(code); return;
  }
  if(type==='JOIN_ROOM'){
    const code=payload.code.toUpperCase(),room=rooms.get(code);
    if(!room){sendTo(ws,{type:'ERROR',payload:{msg:'Room not found.'}});return;}
    if(room.players.filter(p=>p.connected).length>=4){sendTo(ws,{type:'ERROR',payload:{msg:'Room full.'}});return;}
    if(room.gs.phase!=='lobby'){sendTo(ws,{type:'ERROR',payload:{msg:'Game in progress.'}});return;}
    const playerId=uuidv4(); clients.set(ws,{roomCode:code,playerId});
    room.players.push({id:playerId,ws,name:payload.name||'Player',career:null,char:null,ready:false,connected:true});
    sendTo(ws,{type:'ROOM_JOINED',payload:{code,playerId}});
    broadcastState(code); return;
  }
  if(type==='SELECT_CAREER'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId); if(!player)return;
    if(!payload||!CAREERS[payload.career]){sendTo(ws,{type:'ERROR',payload:{msg:'Unknown career.'}});return;}
    if(room.gs.phase!=='lobby') return; // no class swaps mid-run
    player.career=payload.career; player.char=buildChar(payload.career); player.ready=false;
    const _careerToNovice={warrior:'warrior',rogue:'rogue',wizard:'magician',priest:'priest'}; // extend if new careers added
    const _noviceId=_careerToNovice[payload.career]||'warrior';
    applyNovicePath(player.char, _noviceId);
    player.char.pendingLevelUp=false; // novice already applied
    broadcastState(ctx.roomCode); return;
  }
  if(type==='PLAYER_READY'){
    if(!ctx)return; const room=rooms.get(ctx.roomCode); if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId); if(!player||!player.career)return;
    player.ready=true;
    const connected=room.players.filter(p=>p.connected);
    if(connected.length>=1&&connected.every(p=>p.ready)){
      room.gs.phase='path';
      addLog(room,'⚔ The warband descends into Reikland\'s darkness.');
      showPathChoices(room);
    }
    broadcastState(ctx.roomCode); return;
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
    else if(tier==='expert'){applyExpertPath(char,data.pathId);addLog(room,`${player.name} chooses the <strong>${EXPERT_PATHS[data.pathId]?.label}</strong> expert path.`,'spell');}
    else if(tier==='master'){applyMasterPath(char,data.pathId);addLog(room,`${player.name} ascends the <strong>${MASTER_PATHS[data.pathId]?.label}</strong> master path.`,'spell');}
    if(!char.pendingLevelUp){ const _lv=checkLevelUp(char); if(_lv.leveled) addLog(room,`🌟 ${player.name} reaches <strong>Level ${_lv.newLevel}</strong>! (+${_lv.hpGain} max HP)${char.pendingLevelUp?' — Choose a path!':''}`,'spell'); }
    return;
  }
  if(action==='TARGET_ENEMY'){
    if(!gs.inCombat||!gs.enemies||gs.enemies.length<=1) return;
    const idx=parseInt(data.idx)||0;
    if(idx>=0&&idx<gs.enemies.length&&gs.enemies[idx].hp>0){
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
    if(attr==='agi'){ char2.baseAgiDef=char2.attrs.agi; char2.defense++; } // Defence = AGI + armour
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
    else{addLog(room,`${player.name} takes nothing.`,'sys');}
    const alive=room.players.filter(p=>p.char&&p.char.alive&&p.connected);
    if(alive.every(p=>gs.lootPicked.includes(p.id))){gs.phase='event';gs.lootRoom=null;addLog(room,'Loot divided. Press onward.','sys');}
    return;
  }
  if(action==='EQUIP_ITEM'){
    const idx=data.inventoryIndex;
    if(idx===undefined||idx<0||idx>=char.inventory.length)return;
    const result=equipItem(char,idx);
    if(result)addLog(room,`${player.name}: ${result}.`,'loot');
    return;
  }
  if(action==='PRESS_ONWARD'){
    if(gs.phase!=='event') return;
    if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');return;}
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
    const r=actCastSpell(ctx);
    if(r===undefined) return;
    acted=r;
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
    if(data.itemName==='Healing Draught'){const h=rd(1,6);tchar.health=Math.min(tchar.maxHealth,tchar.health+h);addLog(room,`${player.name} gives Healing Draught to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');}
    else if(data.itemName==='Greater Healing Draught'){const h=rd(2,6);tchar.health=Math.min(tchar.maxHealth,tchar.health+h);addLog(room,`${player.name} gives Greater Healing to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');}
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
      addLog(room,'Warband escapes. Press onward.','sys');return;
    } else {addLog(room,`${player.name} fails to flee (${total}<DC10).`,'sys');acted=true;}
  }

  if(acted){
    if(!gs.playersActedThisRound.includes(playerId)) gs.playersActedThisRound.push(playerId);
    if(gs.turnOrder && gs.turnOrder.length) {
      advanceTurn(room);
    }
  }
}

// ─── COMBAT ACTIONS ──────────────────────────────────────────────────────────
// Weapon attack against the current target. Returns true when the action used the turn; undefined aborts with no turn spent.
function actAttack({room,playerId,data,ws,player,gs,char}){
  let acted=false;
  const targetEnemy=getTargetEnemy(gs);
  if(!targetEnemy){addLog(room,'No target.','sys');return;}
  if(char._wpnReloading){ addLog(room,`${player.name} is <strong>reloading</strong> — cannot attack this round!`,'sys'); char._wpnReloading=false; advanceTurn(room); return; }
  let extraBoons=(char.career==='rogue'&&gs.roundNumber===1)?1:0;
  if(char._wpnReach && gs.roundNumber===1) extraBoons++;
  if(char._wpnMarksmanship && gs.roundNumber===1) extraBoons++;
  const openingFires=char._wpnOpeningShot && gs.roundNumber===1 && !char._wpnOpeningShotFired;
  if(openingFires){ extraBoons+=2; char._wpnOpeningShotFired=true; char._wpnReloading=true; }
  if(char._wpnCleaveReady){ char._wpnCleaveReady=false; char._wpnCleaveBonus=true; }
  const r=rollAttack(char,targetEnemy,extraBoons);
  if(r.fumble){
    addLog(room,`${player.name} <em>fumbles!</em> d20 rolled 1 — automatic miss.`,'sys');
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
      // Daemonic Ichor: 25% chance attacker takes 1d6 when hitting Bloodletter
      if(targetEnemy.daemonicIchor && r.hit && Math.random()<0.25){
        const _diDmg=rd(1,6);
        char.health=Math.max(0,char.health-_diDmg);
        addLog(room,`💥 <strong>Daemonic Ichor!</strong> Dark energy lashes back at ${player.name} — <strong class="num-dmg">-${_diDmg}</strong> fire dmg!`,'chaos');
        checkDeath(room,player);
      }
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
      if(char._legPrimordialStaff && spell.rank===0) total*=2;
      // overload is now a USE_TALENT active (see USE_TALENT handler)
      if(char._uncontrolledPowerArmed){ char._uncontrolledPowerArmed=false; total*=2; const bk=rd(1,6); char.health=Math.max(0,char.health-bk); addLog(room,`🌪 <strong>Uncontrolled Power!</strong> ${player.name} takes ${bk} backlash!`,'chaos'); }
      if(char.resonance&&((spellTarget._poisonStacks||0)>0||(spellTarget.activeDebuffs||[]).some(d=>d.name==='Bleed'||d.name==='Burn'))){ total+=rd(1,6); addLog(room,`💥 <strong>Resonance!</strong> +1d6 on afflicted target.`,'spell'); }
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
      if(spellTarget._godsWardRounds>0){ total=Math.ceil(total*0.75); }
      if(spellTarget._mistFormRounds>0){ total=Math.ceil(total/2); addLog(room,`🌫 ${spellTarget.name} is in Mist Form — spell damage halved to ${total}.`,'chaos'); }
      // Primordial Roar: halve player spell damage
      {const _prRB=(char.activeBuffs||[]).find(b2=>b2.dmgReductionPct);if(_prRB){const _old=total;total=Math.max(1,Math.floor(total*(1-_prRB.dmgReductionPct)));addLog(room,`🦎 <strong>Primordial Roar!</strong> ${player.name}\'s spell halved — ${_old}→${total}!`,'chaos');}}
      spellTarget.hp=Math.max(0,spellTarget.hp-total); _primaryApplied=true;
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
    _hitTargets.forEach(_t=>{ if(_t===spellTarget&&_primaryApplied) return; if(_t.hp>0){ _t.hp=Math.max(0,_t.hp-total); if(isAoe&&_hitTargets.length>1) addLog(room,`  ↳ ${_t.name}: <strong class="num-dmg">−${total}</strong> → ${_t.hp}/${_t.maxHp} HP`,'spell'); } });
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
function actUseTalent({room,playerId,data,ws,player,gs,char}){
  let acted=false;
  const t=data.talent;
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
  else if(t==='divineSmite'){if((char._divineSmiteCount||0)>=2){addLog(room,`${player.name}: Divine Smite used 2/2.`,'sys');return;}char._divineSmiteCount=(char._divineSmiteCount||0)+1;const _te=getTargetEnemy(gs);if(!_te)return;
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
    if((char._divineSmiteCount||0)>0)char._divineSmiteCount--;
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
    if((char._doubleChargeCount||0)>=2){addLog(room,`${player.name}: Double Charge both uses spent.`,'sys');return;}
    if(char.overcastUsed){addLog(room,`${player.name}: Overcast already armed this round.`,'sys');return;}
    char._doubleChargeCount=(char._doubleChargeCount||0)+1; char.overcastUsed=false;
    addLog(room,`🌀 <strong>Double Charge!</strong> ${player.name} rearms Overcast (${2-(char._doubleChargeCount)} uses left)!`,'spell');
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

function addLog(room,msg,type=''){if(!room||!room.gs)return;room.gs.log.push({msg,type,ts:Date.now()});if(room.gs.log.length>200)room.gs.log=room.gs.log.slice(-200);}
// ─── ENEMY DROP WEAPONS ─────────────────────────────────────────────────────
function rollEnemyDrop(enemy, room){
  const drops=ENEMY_DROPS[enemy.name];
  if(!drops) return;
  drops.forEach(drop=>{
    if(Math.random()>drop.chance) return;
    let item;
    if(drop.type==='weapon'){
      item={id:'w'+uuidv4(),name:drop.name,dice:drop.dice,stat:drop.stat,bonus:drop.bonus,dmgType:drop.dmgType,special:drop.special,cost:0,sellCost:3,bought:false,type:'weapon',desc:`${drop.dice}+${drop.bonus} · ${drop.stat.toUpperCase()} · ${drop.dmgType} — ${drop.special.desc}`};
    } else {
      const totalDef=(drop.def||2)+d(2);
      item={id:'a'+uuidv4(),name:drop.name,defBonus:totalDef,special:drop.special,cost:0,sellCost:3,bought:false,type:'armor',desc:`+${totalDef} Defense — ${drop.special.desc}`};
    }
    const living=room.players.filter(p=>p.char&&p.char.alive);
    if(!living.length) return;
    const recipient=living[Math.floor(Math.random()*living.length)];
    addToInventory(recipient.char,item.name,item);
    addLog(room,`💀 ${enemy.name} drops <strong>${item.name}</strong>! ${recipient.name} picks it up.`,'loot');
  });
}

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

function broadcastState(roomCode){const room=rooms.get(roomCode);if(!room)return;const data=JSON.stringify({type:'STATE_UPDATE',payload:publicState(room)});room.players.forEach(p=>{if(p.ws.readyState===1)p.ws.send(data);});}

// When someone drops, re-check anything that was waiting on them
function unblockAfterDisconnect(room, player){
  const gs=room.gs;
  const here=room.players.filter(p=>p.char&&p.char.alive&&p.connected);
  if(!here.length) return;
  if(gs.phase==='path'&&gs.pathChoices&&here.every(p=>gs.pathVotes[p.id])) resolvePath(room);
  else if(gs.phase==='loot'&&gs.lootRoom&&here.every(p=>gs.lootPicked.includes(p.id))){ gs.phase='event'; gs.lootRoom=null; addLog(room,'Loot divided. Press onward.','sys'); }
  else if(gs.phase==='merchant'&&!here.some(p=>p.char.merchantStock)){ gs.phase='event'; addLog(room,'The warband leaves the merchant.','sys'); }
  else if(gs.phase==='combat'&&gs.inCombat){ const cur=getCurrentTurn(gs); if(cur&&cur.type==='player'&&cur.id===player.id) advanceTurn(room); }
}

wss.on('connection',ws=>{
  ws.on('message',raw=>{try{handleMessage(ws,JSON.parse(raw));}catch(e){console.error('WS error:',e);}});
  ws.on('close',()=>{
    const ctx=clients.get(ws);if(!ctx)return;
    const room=rooms.get(ctx.roomCode);
    if(room){const player=room.players.find(p=>p.id===ctx.playerId);if(player){player.connected=false;addLog(room,`${player.name} disconnected.`,'sys');try{unblockAfterDisconnect(room,player);}catch(e){console.error('Disconnect unblock error:',e);}broadcastState(ctx.roomCode);}
    setTimeout(()=>{if(room.players.every(p=>!p.connected))rooms.delete(ctx.roomCode);},600000);}
    clients.delete(ws);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>{ console.log(`Shadows Over Reikland on 0.0.0.0:${PORT}`); });
