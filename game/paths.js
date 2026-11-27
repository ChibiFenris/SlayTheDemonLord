'use strict';
// Levelling up and the novice, expert and master paths.
// Moved out of server.js unchanged. The server hands this module the helpers it
// uses through bind() once everything is defined (see the bottom of server.js).
let EXPERT_PATHS, MASTER_PATHS, NOVICE_PATHS, TRADITIONS, XP_THRESHOLDS, getSpellsForPower, isEnemyHidden, refreshCastingPools, traditionAllowed;
function bind(api) {
  ({ EXPERT_PATHS, MASTER_PATHS, NOVICE_PATHS, TRADITIONS, XP_THRESHOLDS, getSpellsForPower, isEnemyHidden, refreshCastingPools, traditionAllowed } = api);
}
const armour = require('./armour');
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
    const hpGain=getPathHpGain(char, newLevel)+(char.loneSurvivor?1:0);
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
    else if (t==='+1agi') { char.attrs.agi++; char.baseAgiDef=char.attrs.agi; char.defense++; } // Defence (dodging) comes from AGI
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
    'condemn','silverShot','firstVolley','slayerOath','deathWish','rage',
    'turret','grenade','tinkerer','hawkEye','arrowStorm','virtue','stubborn','valourOfAges','shieldwall','fortitude','pressTheAdvantage','shadowOpening',
  ];
  NOVICE_FLAGS.forEach(f=>{ if(np[f]) char[f]=true; });
  if(np.tinkerer) char.defense+=1; // riveted plate
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
  // A new class may not be trained for the armour you wear: it goes back in your pack.
  if(char.equippedArmor&&!armour.canWear(char,char.equippedArmor)){ const a=char.equippedArmor; char.defense-=armour.dodgeOf(a); char.equippedArmor=null; char.inventory.push({name:a.name,qty:1,type:'armor',itemObj:a,sellCost:3}); char._armourRemovedNote=`took off the ${a.name} (a ${a.armorType==='plate'||a.armorType==='mail'?'heavy':'leather'} armour your class can't wear)`; }
  char.maxHealth+=ep.hpGain; char.health=Math.min(char.health+ep.hpGain,char.maxHealth);
  if (ep.power) { char.power+=ep.power; char.maxPower+=ep.power; refreshCastingPools(char); }
  if (ep.levelGains&&ep.levelGains[3]) applyTalentList(char, ep.levelGains[3]);
  const pathsWithTradition = ['cleric','druid','oracle','paladin','wizard','warlock','sorcerer','spellbinder','evoker','elementalist','healer','zealot','witch'];
  givePathGift(char, ep);
  if (ep.lores || pathsWithTradition.includes(pathId)) teachLore(char);
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
  givePathGift(char, mp);
  if (mp.lores || masterWithTradition.includes(pathId)) teachLore(char);
}

// A class that teaches magic: the character becomes a spellcaster and picks a
// lore their people may learn. If none is left to learn, they get +1 Power instead.
function teachLore(char) {
  char.spellcaster = true;
  if (!char.power) { char.power = 1; char.maxPower = Math.max(char.maxPower || 0, 1); }
  const left = Object.keys(TRADITIONS).filter(t => traditionAllowed(char, t) && !(char.traditions || []).includes(t));
  if (!left.length) { char.power += 1; char.maxPower = (char.maxPower || 0) + 1; refreshCastingPools(char); return; }
  char.pendingLevelUp=true; char.pendingPathTier='tradition'; char.pendingSpellChoices=1;
}
// Some classes come with their own gear (a Thunderer's handgun...). It is equipped at once.
function givePathGift(char, path) {
  const g = path && path.gift; if (!g || g.type !== 'weapon') return;
  const w = { id: 'wg' + Math.random().toString(36).slice(2, 9), name: g.name, dice: g.dice, stat: g.stat, bonus: g.bonus || 0, dmgType: g.dmgType || 'slashing', type: 'weapon', cost: 40, sellCost: 3,
    desc: `${g.dice}+${g.bonus || 0} · ${String(g.stat).toUpperCase()} · ${g.dmgType || 'slashing'} — a gift of your class` };
  char.inventory.push({ name: w.name, qty: 1, type: 'weapon', itemObj: w, sellCost: 3 });
  if (!(char._curseLock && char._curseLock.weapon)) char.equippedWeapon = w;
}

function getTargetEnemy(gs) {
  const enemies = gs.enemies || [];
  if(enemies.length>0){
    const idx=Math.min(gs.activeEnemyIdx||0,enemies.length-1);
    const t=enemies[idx]||enemies[0]||null;
    if(t&&(t.hp<=0||isEnemyHidden(t,gs))){ // hidden/vanished: swing at someone you can reach
      const alt=enemies.findIndex(e=>e&&e.hp>0&&!isEnemyHidden(e,gs));
      if(alt>=0){ gs.activeEnemyIdx=alt; gs.enemy=enemies[alt]; return enemies[alt]; }
    }
    return t;
  }
  return gs.enemy||null;
}

module.exports = { bind, checkLevelUp, getPathHpGain, applyLevelGains, applyTalentList, applyNovicePath, grantTradition, applyExpertPath, applyMasterPath, teachLore, givePathGift, getTargetEnemy };
