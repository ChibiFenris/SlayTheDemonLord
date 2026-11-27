'use strict';
// Building a new character for a career, the Lone Survivor bonus for solo
// players, and the heal shared by the "catch your breath" talents.
const { v4: uuidv4 } = require('uuid');
const { CAREERS } = require('./data');
const { rd } = require('./dice');
const { refreshCastingPools } = require('./castings');

const S = {};
function bind(api) { Object.assign(S, api); }

// Lone Survivor: Warriors, Wizards, Priests and Witch Hunters who start a run alone get a little extra staying power.
// Warrior: +6 max HP, the others +5 max HP; all +1 HP per level.
const LONE_SURVIVOR = { warrior:{hp:6, power:0}, wizard:{hp:5, power:0}, priest:{hp:5, power:0}, witchhunter:{hp:6, power:0}, engineer:{hp:5, power:0}, waywatcher:{hp:4, power:0} };
function applyLoneSurvivor(room, player){
  const ls=LONE_SURVIVOR[player.career]; if(!ls||!player.char) return;
  const c=player.char; c.loneSurvivor=true;
  c.maxHealth+=ls.hp; c.health+=ls.hp;
  if(ls.power){ c.power+=ls.power; c.maxPower=(c.maxPower||0)+ls.power; refreshCastingPools(c); }
  S.addLog(room,`🕯 <strong>Lone Survivor</strong> — ${player.name} walks the dark road alone: +${ls.hp} max HP${ls.power?', +1 Power':''}.`,'loot');
}

function buildChar(career) {
  const c = CAREERS[career];
  const attrs = {...c.startAttrs};
  const baseDefense = attrs.agi + c.armorDef;
  const wpnDmgStr=c.weaponDmg||'1d6'; const wpnBonusParts=wpnDmgStr.split('+'); const wpnDicePart=wpnBonusParts[0]; const wpnStartBonus=parseInt(wpnBonusParts[1]||'0')||0;
  const _wpnStat=c.weaponIntBased?'int':c.weaponWilBased?'wil':c.weaponStr?'str':'agi';
  const _wpnType=c.weaponType||(c.weaponStr||c.weaponIntBased?'blunt':'slashing');
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
    block:true, _blockUsed:false, revive:true, _reviveUsed:false, row:(career==='wizard'||career==='witchhunter'||c.startRow==='back')?'back':'front', mutations:[], disorders:[], relics:[],
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
    lifeDrain:false, arcaneSurge:false, _arcaneSurgeUsed:false, spellLeech:false, glamourVeil:false, _glamourUsed:false, misdirection:false, _misdirectArmed:false, undyingHunger:false, chaosTouch:false, _chaosTouchActive:false,
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

module.exports = { bind, LONE_SURVIVOR, applyLoneSurvivor, buildChar, talentHeal };
