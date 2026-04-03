const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.get('/health', (req, res) => res.send('OK'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.set('trust proxy', 1);
server.on('upgrade', (req) => console.log('WS upgrade:', req.url));
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
const d = n => Math.floor(Math.random() * n) + 1;
function rd(num, sides) { let t = 0; for (let i = 0; i < num; i++) t += d(sides); return t; }
const modVal = s => s - 10;

function initGameState() {
  return {
    depth:0, inCombat:false, enemy:null, phase:'lobby',
    playersActedThisRound:[], enemyHasActed:false, roundNumber:0,
    log:[], pathChoices:null, pathVotes:{}, bossNode:false,
    bossCount:0, lootRoom:null, lootPicked:[],
    lastPowerRestoreDepth:0,
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

// ─── CAREERS ─────────────────────────────────────────────────────────────────
const CAREERS = {
  warrior: { label:'State Soldier',    startAttrs:{str:11,agi:10,int:9,wil:10},  armorDef:3, weaponDmg:'1d6', weaponStr:true,  spellcaster:false },
  rogue:   { label:'Roadwarden',       startAttrs:{str:10,agi:11,int:10,wil:9},  armorDef:1, weaponDmg:'1d6', weaponStr:false, spellcaster:false },
  wizard:  { label:'Bright Wizard',    startAttrs:{str:9,agi:10,int:11,wil:10},  armorDef:0, weaponDmg:'1d6', weaponStr:true,  spellcaster:true,  tradition:'fire' },
  priest:  { label:'Sigmarite Priest', startAttrs:{str:10,agi:9,int:10,wil:11},  armorDef:3, weaponDmg:'1d6', weaponStr:true,  spellcaster:true,  tradition:'life' },
};

// ─── PATHS ───────────────────────────────────────────────────────────────────
// SotDL: Novice path chosen at level 1, grants level 1&2 benefits
// Expert path chosen at level 3, grants level 3-6 benefits
// Master path chosen at level 7, grants level 7-10 benefits
const NOVICE_PATHS = {
  warrior: { hpGain:5, power:0, weaponTraining:true,  catchBreath:true,    trickery:false, nimbleRecovery:false, spellRecovery:false, sharedRecovery:false },
  rogue:   { hpGain:3, power:0, weaponTraining:false, catchBreath:false,   trickery:true,  nimbleRecovery:true,  spellRecovery:false, sharedRecovery:false },
  magician:{ hpGain:2, power:1, weaponTraining:false, catchBreath:false,   trickery:false, nimbleRecovery:false, spellRecovery:true,  sharedRecovery:false },
  priest:  { hpGain:4, power:1, weaponTraining:false, catchBreath:false,   trickery:false, nimbleRecovery:false, spellRecovery:false, sharedRecovery:true  },
};

const EXPERT_PATHS = {
  fighter:     { label:'Fighter',      forCareers:['warrior'], hpGain:5, power:0,
    levelGains:{ 3:['combatProwess'], 4:['+1str'], 5:['combatExpertise'], 6:['+1str'] },
    desc:'Masters of melee. Each attack deals +1d6 bonus damage (Combat Prowess) and +1d6 again at level 5 (Combat Expertise).' },
  defender:    { label:'Defender',     forCareers:['warrior'], hpGain:5, power:0,
    levelGains:{ 3:['shieldwall'], 4:['+1agi'], 5:['toughness'], 6:['+1str'] },
    desc:'Stalwart shields of the warband. Gain +2 Defense (Shieldwall) and reduce all incoming damage by 1 (Toughness).' },
  scout:       { label:'Scout',        forCareers:['rogue'],   hpGain:3, power:0,
    levelGains:{ 3:['quickstrike'], 4:['+1agi'], 5:['evasion'], 6:['+1agi'] },
    desc:'Swift and elusive. Quick Strike grants an extra attack on round 1. Evasion adds +2 Defense against ranged attacks.' },
  assassin:    { label:'Assassin',     forCareers:['rogue'],   hpGain:3, power:0,
    levelGains:{ 3:['deathblow'], 4:['+1agi'], 5:['shadowstep'], 6:['+1int'] },
    desc:'Lethal precision. Deathblow makes your crits deal triple weapon dice. Shadowstep lets you flee without opportunity attacks.' },
  evoker:      { label:'Evoker',       forCareers:['wizard'],  hpGain:2, power:1,
    levelGains:{ 3:['overcast'], 4:['+1int'], 5:['metamagic'], 6:['+1int'] },
    desc:'Raw arcane force. Overcast spends 2 castings for +2d6 spell damage. Metamagic lets you recast one spell per rest for free.' },
  elementalist:{ label:'Elementalist', forCareers:['wizard'],  hpGain:2, power:1,
    levelGains:{ 3:['burningSoul'], 4:['+1int'], 5:['firewall'], 6:['+1wil'] },
    desc:'Pyromantic specialist. Burning Soul adds +1d6 to all fire spells. Firewall adds a 4d6 area-of-effect spell to your arsenal.' },
  zealot:      { label:'Zealot',       forCareers:['priest'],  hpGain:4, power:1,
    levelGains:{ 3:['holyFervor'], 4:['+1wil'], 5:['divineSmite'], 6:['+1str'] },
    desc:'Righteous fury. Holy Fervor grants 1 boon attacking undead or chaos. Divine Smite adds +3d6 once per combat.' },
  healer:      { label:'Healer',       forCareers:['priest'],  hpGain:4, power:1,
    levelGains:{ 3:['massHeal'], 4:['+1wil'], 5:['resurrection'], 6:['+1wil'] },
    desc:'Devoted servant. Mass Heal restores 1d6 HP to all living allies. Resurrection fully revives a fallen ally once per rest.' },
};

const MASTER_PATHS = {
  champion:    { label:'Champion',     forCareers:['warrior','fighter','defender'], hpGain:6, power:0,
    levelGains:{ 7:['warlordAura'], 8:['+1str'], 9:['unstoppable'], 10:['+1str'] },
    desc:'A living legend on the battlefield. Your aura grants allies 1 boon. Once per combat, survive a killing blow at 1 HP.' },
  warlord:     { label:'Warlord',      forCareers:['warrior','fighter','defender'], hpGain:6, power:0,
    levelGains:{ 7:['rallyingCry'], 8:['+1str'], 9:['sweepingBlow'], 10:['+1agi'] },
    desc:'Commander and destroyer. Rallying Cry heals all allies for their healing rate. Sweeping Blow strikes all enemies at once.' },
  shadowblade: { label:'Shadowblade',  forCareers:['rogue','scout','assassin'],     hpGain:4, power:0,
    levelGains:{ 7:['phantomStrike'], 8:['+1agi'], 9:['bladestorm'], 10:['+1agi'] },
    desc:'A ghost with a blade. Phantom Strike ignores enemy armor bonuses. Bladestorm makes three attacks in a single action.' },
  archmage:    { label:'Archmage',     forCareers:['wizard','evoker','elementalist'], hpGain:3, power:2,
    levelGains:{ 7:['spellsurge'], 8:['+1int'], 9:['catastrophe'], 10:['+1int'] },
    desc:'The pinnacle of fire magic. Once per combat Spell Surge casts any spell for free. Catastrophe deals 10d6 to all enemies.' },
  highpriest:  { label:'High Priest',  forCareers:['priest','zealot','healer'],     hpGain:5, power:2,
    levelGains:{ 7:['holyAura'], 8:['+1wil'], 9:['miracleHeal'], 10:['+1wil'] },
    desc:'Bearer of Sigmar\'s grace. Holy Aura grants all allies +2 Defense. Miracle Heal restores a target to full HP.' },
};

// ─── ENEMY POOLS ─────────────────────────────────────────────────────────────
const ENEMY_POOLS = {
  low: [
    {name:'Skaven Clanrat',     type:'Skaven',  threat:'Low',      hp:8,  ac:12,atk:2,xp:1,gold:[2,8]},
    {name:'Beastman Gor',       type:'Chaos',   threat:'Low',      hp:12, ac:13,atk:3,xp:1,gold:[3,10]},
    {name:'Undead Skeleton',    type:'Undead',  threat:'Low',      hp:13, ac:13,atk:3,xp:1,gold:[0,5], undead:true},
    {name:'Mutant Thug',        type:'Cultist', threat:'Low',      hp:10, ac:11,atk:2,xp:1,gold:[5,15]},
  ],
  mid: [
    {name:'Chaos Marauder',     type:'Chaos',   threat:'Moderate', hp:20, ac:14,atk:4,xp:2,gold:[10,25]},
    {name:'Skaven Stormvermin', type:'Skaven',  threat:'Moderate', hp:18, ac:15,atk:4,xp:2,gold:[8,20]},
    {name:'Wight',              type:'Undead',  threat:'Moderate', hp:25, ac:14,atk:4,xp:2,gold:[5,15], undead:true,lifeLeech:true},
    {name:'Plague Monk',        type:'Chaos',   threat:'Moderate', hp:22, ac:13,atk:3,xp:2,gold:[0,0],  diseased:true},
  ],
  high: [
    {name:'Chaos Warrior',      type:'Chaos',   threat:'High',     hp:35, ac:16,atk:5,xp:3,gold:[15,40]},
    {name:'Vampire Count',      type:'Undead',  threat:'High',     hp:40, ac:15,atk:5,xp:3,gold:[20,60], undead:true,lifeLeech:true},
    {name:'Bloodletter',        type:'Daemon',  threat:'High',     hp:45, ac:15,atk:6,xp:3,gold:[25,50], insanityAtk:true},
    {name:'Plague Rat Lord',    type:'Skaven',  threat:'High',     hp:32, ac:14,atk:5,xp:3,gold:[10,30], diseased:true},
  ],
  boss: [
    {name:'Skaven Warlord Gnashteeth', type:'Skaven Boss', threat:'Boss',hp:80, ac:15,atk:6,xp:5,gold:[30,80], multi:true},
    {name:'Beastlord Kragthor',        type:'Chaos Boss',  threat:'Boss',hp:95, ac:16,atk:7,xp:5,gold:[25,70]},
    {name:'Varghulf',                  type:'Undead Boss', threat:'Boss',hp:110,ac:16,atk:7,xp:5,gold:[40,100],undead:true,lifeLeech:true,regen:true},
    {name:'Bonebreaker Ratogre',       type:'Daemon Boss', threat:'Boss',hp:120,ac:17,atk:8,xp:5,gold:[50,120],multi:true,insanityAtk:true},
    {name:'Saurian Ancient',           type:'Ancient Boss',threat:'Boss',hp:130,ac:15,atk:7,xp:5,gold:[60,150],undead:true,lifeLeech:true},
  ],
};

function enemyDmgDice(threat, isElite, bossCount) {
  if (threat === 'Boss') return bossCount === 0 ? {n:2,s:6,b:0} : {n:3,s:6,b:0};
  if (isElite)           return bossCount === 0 ? {n:1,s:6,b:2} : {n:2,s:6,b:0};
  return bossCount === 0 ? {n:1,s:6,b:0} : {n:1,s:6,b:3};
}

function scaleEnemy(tmpl, playerCount, isElite, bossCount) {
  const e = JSON.parse(JSON.stringify(tmpl));
  e.hp = e.maxHp = Math.round(e.hp * (1 + (playerCount-1)*0.5));
  e.conditions = []; e.isElite = isElite;
  const dd = enemyDmgDice(e.threat, isElite, bossCount);
  e.dmgNum=dd.n; e.dmgSides=dd.s; e.dmgBonus=dd.b;
  e.dmgDisplay=`${dd.n}d${dd.s}${dd.b?'+'+dd.b:''}`;
  if (isElite && e.threat!=='Boss') e.threat='Elite';
  if (bossCount===0) {
    e.atk=0;
  } else {
    const isBossE=e.threat==='Boss';
    e.atk=Math.min(e.atk, isBossE?5:isElite?4:3);
  }
  return e;
}

function pickEnemy(depth, isElite, isBoss, playerCount, bossCount) {
  let pool;
  if (isBoss)        pool=ENEMY_POOLS.boss;
  else if (depth>20) pool=isElite?ENEMY_POOLS.boss:ENEMY_POOLS.high;
  else if (depth>10) pool=isElite?ENEMY_POOLS.high:ENEMY_POOLS.mid;
  else               pool=isElite?ENEMY_POOLS.mid:ENEMY_POOLS.low;
  return scaleEnemy(pool[Math.floor(Math.random()*pool.length)], playerCount, isElite, bossCount);
}

// ─── CHARACTER BUILDER ───────────────────────────────────────────────────────
function buildChar(career) {
  const c = CAREERS[career];
  const attrs = {...c.startAttrs};
  const baseDefense = attrs.agi + c.armorDef;
  const startWpn = {id:'w_start_'+uuidv4(),name:'Starting Weapon',dice:'1d6',stat:c.weaponStr?'str':'agi',bonus:0,type:'weapon',desc:'1d6 — starting gear'};
  const startArmor = c.armorDef>0 ? {id:'a_start_'+uuidv4(),name:'Starting Armour',defBonus:c.armorDef,type:'armor',desc:`+${c.armorDef} Defense`} : null;
  return {
    career, attrs,
    health:attrs.str, maxHealth:attrs.str,
    defense:baseDefense, baseAgiDef:attrs.agi,
    perception:attrs.int,
    power:0, maxPower:0, castingsUsed:0,
    insanity:0, corruption:0, conditions:[],
    inventory:[
      {name:'Healing Draught',qty:2},
      {itemObj:startWpn,name:startWpn.name,qty:1,type:'weapon'},
      ...(startArmor?[{itemObj:startArmor,name:startArmor.name,qty:1,type:'armor'}]:[]),
    ],
    gold:15,
    level:0, xp:0,
    novicePath:null, expertPath:null, masterPath:null,
    pendingLevelUp:false, pendingPathTier:null,  // 'novice'|'expert'|'master'
    // Talents (novice)
    weaponTraining:false, catchBreath:false, catchBreathUsed:false,
    combatProwess:false, combatExpertise:false,
    trickery:false, trickeryUsed:0, trickeryMax:1,
    nimbleRecovery:false, nimbleUsed:false,
    spellRecovery:false, spellRecoveryUsed:false,
    sharedRecovery:false, sharedUsed:false,
    // Expert talents
    shieldwall:false, toughness:false,
    quickstrike:false, evasion:false,
    deathblow:false, shadowstep:false,
    overcast:false, metamagic:false, metamagicUsed:false,
    burningSoul:false, firewall:false,
    holyFervor:false, divineSmite:false, divineSmiteUsed:false,
    massHeal:false, massHealUsed:false, resurrection:false, resurrectionUsed:false,
    // Master talents
    warlordAura:false, unstoppable:false, unstoppableUsed:false,
    rallyingCry:false, rallyingUsed:false, sweepingBlow:false,
    phantomStrike:false, bladestorm:false,
    spellsurge:false, spellsurgeUsed:false, catastrophe:false,
    holyAura:false, miracleHeal:false, miracleUsed:false,
    // Equipment
    equippedWeapon:startWpn, equippedArmor:startArmor,
    weaponDmgBonus:0, weaponAtkBonus:0,
    scrollSpells:{}, stimulantBoon:0, sharpeningStone:false, luckyPendant:false,
    alive:true,
    spellcaster:c.spellcaster, tradition:c.tradition||null,
    knownSpells:c.spellcaster
      ? (c.tradition==='fire'
          ? [{name:'Ignite',rank:0,heal:false,dmg:'1d6'},{name:'Burning Hands',rank:1,heal:false,dmg:'3d6'}]
          : [{name:'Minor Healing',rank:0,heal:true,dmg:'1d6'},{name:'Light Healing',rank:1,heal:true,dmg:'2d6'}])
      : [],
    merchantStock:null, lootOptions:null, pendingRevive:false,
  };
}

const healingRate = char => Math.max(1, Math.floor(char.maxHealth/4));

// ─── COMBAT ROLLS ────────────────────────────────────────────────────────────
function rollD20boons(boons, banes) {
  const net=boons-banes, base=d(20);
  if (net>0) { const bd=[]; for(let i=0;i<Math.min(net,4);i++) bd.push(d(6)); return {base,final:base+Math.max(...bd)}; }
  if (net<0) { const bd=[]; for(let i=0;i<Math.min(-net,4);i++) bd.push(d(6)); return {base,final:Math.max(1,base-Math.max(...bd))}; }
  return {base,final:base};
}

function rollAttack(char, enemy, extraBoons=0) {
  const wpn=char.equippedWeapon;
  const wpnStat=wpn?wpn.stat:(CAREERS[char.career].weaponStr?'str':'agi');
  const wpnDice=(wpn&&wpn.dice)?wpn.dice:'1d6';
  const wpnDmgBonus=((wpn&&wpn.bonus)?wpn.bonus:0)+char.weaponDmgBonus;
  const [num,sides]=wpnDice.split('d').map(Number);
  const atkMod=modVal(char.attrs[wpnStat])+char.weaponAtkBonus;
  let boons=0, banes=0;
  if (char.weaponTraining) boons++;
  if (char.stimulantBoon>0) { boons++; char.stimulantBoon--; }
  if (extraBoons) boons+=extraBoons;
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned'))    banes++;
  const forceCrit=char.luckyPendant; if(forceCrit) char.luckyPendant=false;
  const {base,final}=rollD20boons(boons,banes);
  const fumble=base===1&&!forceCrit, crit=forceCrit||base===20;
  const total=final+atkMod, hit=!fumble&&(crit||total>=enemy.ac);
  let dmg=0;
  if (hit) {
    dmg=rd(num,sides)+Math.max(0,modVal(char.attrs[wpnStat]))+wpnDmgBonus;
    if (crit) dmg+=rd(num,sides);
    if (char.combatProwess) dmg+=rd(1,6);
    if (char.combatExpertise) dmg+=rd(1,6);
    if (char.sharpeningStone) dmg+=rd(1,6);
    if (char.trickery&&char.trickeryUsed<char.trickeryMax) { dmg+=rd(1,6); char.trickeryUsed++; }
    // Deathblow: crits triple dice
    if (char.deathblow&&crit) dmg+=rd(num,sides);
    // Phantom strike: ignore armor bonus (defense reduced by equippedArmor bonus)
    if (char.phantomStrike) { /* already hits based on raw defense, bonus is conceptual */ }
    // Toughness applied on enemy side
    if (char.warlordAura) { /* aura handled elsewhere */ }
    dmg=Math.max(1,dmg);
  }
  const boonInfo=boons>0?` (${boons} boon)`:banes>0?` (${banes} bane)`:'';
  const wpnLabel=wpn?`${wpn.name} (${wpnDice}+${wpnDmgBonus})`:'Unarmed (1d6)';
  return {hit,crit,fumble,base,final,total,dmg,atkMod,boonInfo,forceCrit,wpnLabel};
}

function rollEnemyAttack(enemy, char) {
  const base=d(20), total=base+enemy.atk, crit=base===20;
  const hit=base!==1&&(crit||total>=char.defense);
  let dmg=0;
  if (hit) {
    dmg=rd(enemy.dmgNum,enemy.dmgSides)+enemy.dmgBonus;
    if (crit) dmg+=rd(enemy.dmgNum,enemy.dmgSides);
    if (char.toughness) dmg=Math.max(0,dmg-1);
    dmg=Math.max(1,dmg);
  }
  return {hit,crit,dmg,total,base};
}

// ─── LEVEL UP & PATHS ────────────────────────────────────────────────────────
// XP thresholds (50% of SotDL base)
const XP_THRESHOLDS = [0,1,2,3,4,6,7,9,12,14];

function checkLevelUp(char) {
  let newLevel=0;
  for (let i=XP_THRESHOLDS.length-1;i>=0;i--) { if(char.xp>=XP_THRESHOLDS[i]){newLevel=i;break;} }
  if (newLevel>char.level) {
    char.level=newLevel;
    // Apply per-level path gains
    applyLevelGains(char, newLevel);
    // Check if we need a path choice
    if (newLevel===1&&!char.novicePath) { char.pendingLevelUp=true; char.pendingPathTier='novice'; }
    else if (newLevel===3&&!char.expertPath) { char.pendingLevelUp=true; char.pendingPathTier='expert'; }
    else if (newLevel===7&&!char.masterPath) { char.pendingLevelUp=true; char.pendingPathTier='master'; }
    else { char.pendingLevelUp=false; }
    const hpGain=getPathHpGain(char, newLevel);
    char.maxHealth+=hpGain; char.health=Math.min(char.health+hpGain,char.maxHealth);
    return {leveled:true,newLevel,hpGain};
  }
  return {leveled:false};
}

function getPathHpGain(char, level) {
  if (level>=7&&char.masterPath) { const mp=MASTER_PATHS[char.masterPath]; return mp?mp.hpGain:2; }
  if (level>=3&&char.expertPath) { const ep=EXPERT_PATHS[char.expertPath]; return ep?ep.hpGain:2; }
  if (char.novicePath) { const np=NOVICE_PATHS[char.novicePath]; return np?np.hpGain:2; }
  return 2;
}

function applyLevelGains(char, level) {
  // Expert path level gains
  if (char.expertPath) {
    const ep=EXPERT_PATHS[char.expertPath];
    if (ep&&ep.levelGains&&ep.levelGains[level]) applyTalentList(char, ep.levelGains[level]);
  }
  // Master path level gains
  if (char.masterPath) {
    const mp=MASTER_PATHS[char.masterPath];
    if (mp&&mp.levelGains&&mp.levelGains[level]) applyTalentList(char, mp.levelGains[level]);
  }
}

function applyTalentList(char, talents) {
  talents.forEach(t => {
    if (t==='+1str') char.attrs.str++;
    else if (t==='+1agi') char.attrs.agi++;
    else if (t==='+1int') char.attrs.int++;
    else if (t==='+1wil') char.attrs.wil++;
    else char[t]=true;
    // Power gains from expert/master
    if (t==='overcast'||t==='burningSoul') { /* no power, just talent */ }
    if (t==='spellsurge'||t==='catastrophe') { char.power+=1; char.maxPower+=1; }
    if (t==='holyAura'||t==='miracleHeal')  { char.power+=1; char.maxPower+=1; }
  });
}

function applyNovicePath(char, pathId) {
  char.novicePath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  const np=NOVICE_PATHS[pathId]; if(!np) return;
  char.maxHealth+=np.hpGain; char.health=Math.min(char.health+np.hpGain,char.maxHealth);
  if (np.power)           { char.power+=np.power; char.maxPower+=np.power; }
  if (np.weaponTraining)  char.weaponTraining=true;
  if (np.catchBreath)     char.catchBreath=true;
  if (np.trickery)        char.trickery=true;
  if (np.nimbleRecovery)  char.nimbleRecovery=true;
  if (np.spellRecovery)   char.spellRecovery=true;
  if (np.sharedRecovery)  char.sharedRecovery=true;
}

function applyExpertPath(char, pathId) {
  char.expertPath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  const ep=EXPERT_PATHS[pathId]; if(!ep) return;
  char.maxHealth+=ep.hpGain; char.health=Math.min(char.health+ep.hpGain,char.maxHealth);
  if (ep.power) { char.power+=ep.power; char.maxPower+=ep.power; }
  // Apply level 3 gains immediately
  if (ep.levelGains&&ep.levelGains[3]) applyTalentList(char, ep.levelGains[3]);
  // Add new spells if applicable
  if (pathId==='firewall') {
    char.knownSpells.push({name:'Firewall',rank:1,heal:false,dmg:'4d6'});
  }
  if (pathId==='elementalist') {
    char.knownSpells.push({name:'Firewall',rank:1,heal:false,dmg:'4d6'});
  }
}

function applyMasterPath(char, pathId) {
  char.masterPath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  const mp=MASTER_PATHS[pathId]; if(!mp) return;
  char.maxHealth+=mp.hpGain; char.health=Math.min(char.health+mp.hpGain,char.maxHealth);
  if (mp.power) { char.power+=mp.power; char.maxPower+=mp.power; }
  if (mp.levelGains&&mp.levelGains[7]) applyTalentList(char, mp.levelGains[7]);
  // Catastrophe spell
  if (pathId==='archmage') {
    char.knownSpells.push({name:'Catastrophe',rank:2,heal:false,dmg:'10d6'});
  }
}

// ─── PATH/NODE LOGIC ─────────────────────────────────────────────────────────
const NODE_TYPES = ['combat','combat','rest','merchant','loot','elite','unknown','unknown'];
function pickThreeNodes() {
  const pool=[...NODE_TYPES], chosen=[];
  while(chosen.length<3){const i=Math.floor(Math.random()*pool.length);const t=pool.splice(i,1)[0];if(!chosen.includes(t))chosen.push(t);}
  return chosen;
}

function restorePower(room, reason) {
  let restored=false;
  room.players.forEach(p=>{
    if(!p.char||!p.char.alive) return;
    if(p.char.castingsUsed>0||p.char.spellRecoveryUsed){ p.char.castingsUsed=0; p.char.spellRecoveryUsed=false; restored=true; }
  });
  if(restored) addLog(room,`✨ ${reason} — all spellcasters regain power.`,'spell');
}

function showPathChoices(room) {
  const gs=room.gs; gs.pathVotes={};
  if (gs.depth>=29) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    addLog(room,'💀 The Final Darkness bars your path. Face it or fall.','chaos');
  } else if (gs.depth>0&&gs.depth%10===0) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    addLog(room,'💀 A monstrous power bars your path. Face it or fall.','chaos');
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
  enterNode(room,chosen);
}

function enterNode(room, nodeType) {
  const gs=room.gs; gs.depth++; gs.pathChoices=null; gs.pathVotes={};
  const playerCount=room.players.filter(p=>p.connected&&p.char&&p.char.alive).length;
  if(nodeType==='combat'||nodeType==='elite'||nodeType==='boss') {
    const isBoss=nodeType==='boss', isElite=nodeType==='elite';
    gs.enemy=pickEnemy(gs.depth,isElite,isBoss,playerCount,gs.bossCount);
    gs.inCombat=true; gs.phase='combat'; gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.roundNumber=1;
    const tag=isBoss?'⚠ BOSS — ':isElite?'Elite — ':'';
    addLog(room,`⚔ ${tag}<strong>${gs.enemy.name}</strong> appears! DMG: ${gs.enemy.dmgDisplay}`,'dmg');
    addLog(room,'All warriors act first — then the enemy strikes!','sys');
    return;
  }
  if(nodeType==='rest') {
    gs.phase='event';
    addLog(room,'🔥 A campfire. The warband rests.','heal');
    room.players.forEach(p=>{
      if(!p.char||!p.char.alive) return;
      const amt=Math.ceil(p.char.maxHealth*0.6);
      p.char.health=Math.min(p.char.maxHealth,p.char.health+amt);
      p.char.catchBreathUsed=false; p.char.nimbleUsed=false; p.char.sharedUsed=false;
      p.char.trickeryUsed=0; p.char.sharpeningStone=false; p.char.metamagicUsed=false;
      p.char.divineSmiteUsed=false; p.char.massHealUsed=false; p.char.resurrectionUsed=false;
      p.char.unstoppableUsed=false; p.char.rallyingUsed=false; p.char.spellsurgeUsed=false; p.char.miracleUsed=false;
      p.char.conditions=p.char.conditions.filter(c=>c==='Diseased');
      addLog(room,`${p.name} recovers ${amt} HP.`,'heal');
    });
    restorePower(room,'Rest site');
    addLog(room,'Rest complete. Press onward.','sys');
    return;
  }
  if(nodeType==='merchant') {
    gs.phase='merchant';
    room.players.forEach(p=>{if(p.char&&p.char.alive) p.char.merchantStock=buildPlayerShop();});
    addLog(room,'🛒 A merchant appears. Each warrior browses their own wares.','sys');
    return;
  }
  if(nodeType==='loot') {
    gs.phase='loot';
    const coins=Math.floor((5+Math.floor(Math.random()*46))*0.5);
    gs.lootRoom={coins}; gs.lootPicked=[];
    room.players.forEach(p=>{if(p.char&&p.char.alive) p.char.lootOptions=buildLootOptions();});
    addLog(room,`📦 A cache! ${coins} coins — each warrior finds their own haul.`,'loot');
    return;
  }
  if(nodeType==='unknown') {
    gs.phase='event';
    const r=d(10);
    if(r<=3){enterNode(room,'combat');return;}
    else if(r<=5){enterNode(room,'loot');return;}
    else if(r<=7){enterNode(room,'rest');return;}
    else{
      const coins=Math.floor((5+Math.floor(Math.random()*16))*0.5);
      room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{p.char.gold+=coins;});
      addLog(room,`❓ The unknown yields ${coins} silver each.`,'loot');
    }
    return;
  }
}

// ─── LOOT ROOM ───────────────────────────────────────────────────────────────
const SCROLL_SPELLS_LIST = [
  {name:'Fireball',desc:'8d6 fire dmg',type:'attack',dmgDice:'8d6'},
  {name:'Smite',desc:'4d6 holy dmg',type:'attack',dmgDice:'4d6'},
  {name:'Chain Lightning',desc:'6d6 lightning',type:'attack',dmgDice:'6d6'},
  {name:"Sigmar's Wrath",desc:'5d6 holy dmg',type:'attack',dmgDice:'5d6'},
  {name:'Cure Wounds',desc:'Heal 3d6+4 HP',type:'heal',dmgDice:'3d6'},
];
const LOOT_CONS_LIST=['Healing Draught','Greater Healing Draught','Flask of Oil','Fire Jar','Lucky Pendant','Sharpening Stone'];
function buildLootOptions() {
  const useScroll=d(6)>=4;
  const consumable=useScroll?'Spell Scroll':LOOT_CONS_LIST[Math.floor(Math.random()*LOOT_CONS_LIST.length)];
  const scrollSpell=useScroll?SCROLL_SPELLS_LIST[Math.floor(Math.random()*SCROLL_SPELLS_LIST.length)]:null;
  return {consumable,scrollSpell,weapon:genWpn(),armor:genArmor()};
}

// ─── COMBAT FLOW ─────────────────────────────────────────────────────────────
function allPlayersActed(room) {
  const alive=room.players.filter(p=>p.char&&p.char.alive);
  return alive.length>0&&alive.every(p=>room.gs.playersActedThisRound.includes(p.id));
}

function maybeEnemyAttack(room) {
  if(!allPlayersActed(room)) return;
  const gs=room.gs;
  if(gs.enemyHasActed||!gs.enemy||!gs.inCombat) return;
  gs.enemyHasActed=true;
  const e=gs.enemy;
  addLog(room,`--- ${e.name} retaliates! (${e.dmgDisplay}) ---`,'sys');
  if(e.regen&&e.hp<e.maxHp){const r=rd(1,6);e.hp=Math.min(e.maxHp,e.hp+r);addLog(room,`${e.name} regenerates ${r} HP.`,'chaos');}
  const alive=room.players.filter(p=>p.char&&p.char.alive);
  // Holy Aura: +2 defense to all (applied inline)
  alive.forEach(p=>{
    const auraBonus=room.players.some(q=>q.char&&q.char.alive&&q.char.holyAura)?2:0;
    const r=rollEnemyAttack(e,{...p.char,defense:p.char.defense+auraBonus});
    if(r.hit){
      p.char.health=Math.max(0,p.char.health-r.dmg);
      const critLabel=r.crit?' 💥 CRIT!':'';
      addLog(room,`${e.name} hits <strong>${p.name}</strong> — <strong class="num-dmg">−${r.dmg} dmg</strong>${critLabel} [d20:<strong>${r.base}</strong>+atk<strong>${e.atk>=0?'+':''}${e.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${p.char.defense+auraBonus}</strong>] → ${p.name} <strong>${Math.max(0,p.char.health)}</strong>/${p.char.maxHealth} HP`,'dmg-taken');
      if(e.lifeLeech){const l=Math.floor(r.dmg/2);e.hp=Math.min(e.maxHp,e.hp+l);addLog(room,`${e.name} leeches ${l} HP!`,'chaos');}
      if(e.insanityAtk&&d(6)>=4){p.char.insanity++;addLog(room,`${p.name} gains 1 Insanity!`,'chaos');}
      if(e.diseased&&d(6)>=5&&!p.char.conditions.includes('Diseased')){p.char.conditions.push('Diseased');addLog(room,`${p.name} contracts disease!`,'chaos');}
      checkDeath(room,p);
    } else {
      addLog(room,`${e.name} <em>misses</em> ${p.name} — d20:<strong>${r.base}</strong>+<strong>${e.atk>=0?'+':''}${e.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${p.char.defense+auraBonus}</strong>.`,'sys');
    }
  });
  if(e.multi){
    const t=alive[Math.floor(Math.random()*alive.length)];
    if(t){const r2=rollEnemyAttack(e,t.char);if(r2.hit){t.char.health=Math.max(0,t.char.health-r2.dmg);addLog(room,`${e.name} bonus attack on ${t.name} for <strong>${r2.dmg}</strong>!`,'dmg');checkDeath(room,t);}}
  }
  const nowAlive=room.players.filter(p=>p.char&&p.char.alive);
  if(nowAlive.length===0){gs.phase='gameover';addLog(room,'💀 The entire warband has fallen.','death');return;}
  room.players.forEach(p=>{if(p.char&&!p.char.alive){p.char.pendingRevive=true;}});
  gs.playersActedThisRound=[]; gs.enemyHasActed=false;
  gs.roundNumber=(gs.roundNumber||1)+1;
  addLog(room,'--- New round — warriors act! ---','sys');
}

function checkDeath(room, player) {
  if(player.char.health<=0&&player.char.alive){
    player.char.alive=false; player.char.health=0;
    addLog(room,`💀 <strong>${player.name}</strong> has fallen!`,'death');
    // Unstoppable: survive at 1 HP once per combat
    if(player.char.unstoppable&&!player.char.unstoppableUsed){
      player.char.unstoppableUsed=true; player.char.alive=true; player.char.health=1;
      addLog(room,`${player.name} is UNSTOPPABLE — survives at 1 HP!`,'crit');
    }
  }
}

function resolveEnemyDeath(room) {
  const gs=room.gs, e=gs.enemy;
  addLog(room,`⚔ <strong>${e.name}</strong> is slain! FOR SIGMAR!`,'crit');
  room.players.forEach(p=>{
    if(p.char&&(!p.char.alive||p.char.pendingRevive)){
      p.char.health=1; p.char.alive=true; p.char.pendingRevive=false;
      addLog(room,`${p.name} dragged back from death — 1 HP!`,'heal');
    }
  });
  const xpEach=e.xp;
  const goldTotal=e.gold?Math.floor(rd(e.gold[0]||1,e.gold[1]||6)*0.5):0;
  const survivors=room.players.filter(p=>p.char&&p.char.alive);
  const goldEach=Math.floor(goldTotal/Math.max(1,survivors.length));
  addLog(room,`Each survivor: +<strong>${xpEach} XP</strong>, +<strong>${goldEach} silver</strong>.`,'loot');
  if(e.threat==='Boss') gs.bossCount++;
  survivors.forEach(p=>{
    p.char.xp+=xpEach; p.char.gold+=goldEach; p.char.sharpeningStone=false;
    // Reset per-combat used flags
    p.char.divineSmiteUsed=false; p.char.spellsurgeUsed=false;
    const lv=checkLevelUp(p.char);
    if(lv.leveled) addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP)${p.char.pendingLevelUp?' — Choose a path!':''}`, 'spell');
  });
  gs.inCombat=false; gs.enemy=null; gs.phase='event';
  gs.playersActedThisRound=[]; gs.enemyHasActed=false;
  if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');}
}

// ─── MERCHANT ────────────────────────────────────────────────────────────────
const WEAPON_BASES=[
  {name:'Reiklander Sword',dice:'1d6',stat:'str'},{name:'Duelling Sabre',dice:'1d6',stat:'agi'},
  {name:'War Axe',dice:'2d6',stat:'str'},{name:'Halberd',dice:'2d6',stat:'str'},
  {name:'Crossbow',dice:'1d6',stat:'agi'},{name:'Silvered Rapier',dice:'1d6',stat:'agi'},
  {name:'Warhammer',dice:'2d6',stat:'str'},{name:'Pistol',dice:'1d6',stat:'agi'},
];
const ARMOR_BASES=[{name:'Leather Jack',def:1},{name:'Chain Shirt',def:2},{name:'Breastplate',def:3},{name:'Full Plate',def:4}];
const SHOP_CONSUMABLES=[
  {name:'Healing Draught',        desc:'Heal 1d6 HP',cost:10},
  {name:'Greater Healing Draught',desc:'Heal 2d6 HP',cost:20},
  {name:'Flask of Oil',           desc:'2d6 fire dmg',cost:15},
  {name:'Fire Jar',               desc:'3d6 fire dmg',cost:25},
  {name:'Lucky Pendant',          desc:'Next attack = crit',cost:40},
  {name:'Sharpening Stone',       desc:'+1d6 dmg this combat',cost:40},
];
const SCROLL_SPELLS_SHOP=[
  {name:'Fireball',desc:'8d6 fire dmg',type:'attack',dmgDice:'8d6'},
  {name:'Smite',desc:'4d6 holy dmg',type:'attack',dmgDice:'4d6'},
  {name:'Chain Lightning',desc:'6d6 lightning',type:'attack',dmgDice:'6d6'},
  {name:"Sigmar's Wrath",desc:'5d6 holy dmg',type:'attack',dmgDice:'5d6'},
  {name:'Cure Wounds',desc:'Heal 3d6+4 HP',type:'heal',dmgDice:'3d6'},
];

function genWpn(){
  const light=WEAPON_BASES.filter(b=>b.dice==='1d6'), heavy=WEAPON_BASES.filter(b=>b.dice==='2d6');
  const pool=d(5)===1?heavy:light;
  const b=pool[Math.floor(Math.random()*pool.length)], bonus=d(6);
  return{id:'w'+uuidv4(),name:b.name,dice:b.dice,stat:b.stat,bonus,cost:Math.max(5,(b.dice==='2d6'?20:15)+bonus*8),sellCost:1,bought:false,type:'weapon',desc:`${b.dice}+${bonus} · ${b.stat.toUpperCase()}`};
}
function genArmor(){
  const b=ARMOR_BASES[Math.floor(Math.random()*ARMOR_BASES.length)];
  const bonus=d(5)===1?d(2)+4:d(4);
  return{id:'a'+uuidv4(),name:b.name,defBonus:b.def+bonus,cost:Math.max(5,20+bonus*10),sellCost:1,bought:false,type:'armor',desc:`+${b.def+bonus} Defense`};
}
function genShopScroll(){
  const sp=SCROLL_SPELLS_SHOP[Math.floor(Math.random()*SCROLL_SPELLS_SHOP.length)];
  return{id:'sc'+uuidv4(),name:`Scroll: ${sp.name}`,spell:sp,cost:35,sellCost:1,bought:false,type:'scroll',desc:sp.desc};
}
function buildPlayerShop(){
  const hd1={id:'hd1'+uuidv4(),name:'Healing Draught',cost:10,sellCost:1,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const hd2={id:'hd2'+uuidv4(),name:'Healing Draught',cost:10,sellCost:1,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const otherPool=SHOP_CONSUMABLES.filter(c=>c.name!=='Healing Draught').sort(()=>Math.random()-0.5);
  const other=otherPool[0]?{id:'c'+uuidv4(),name:otherPool[0].name,cost:otherPool[0].cost,sellCost:1,desc:otherPool[0].desc,bought:false,type:'consumable'}:hd1;
  return{
    weaponEnhance:{id:'we'+uuidv4(),name:'Weapon Enhancement',desc:'+1 dmg to equipped weapon',cost:25,bought:false,type:'enhance'},
    statBoost:    {id:'sb'+uuidv4(),name:'+1 Primary Stat',desc:'Increase highest attribute by 1',cost:35,bought:false,type:'statboost'},
    weapon1:genWpn(),weapon2:genWpn(),armor:genArmor(),
    consumables:[hd1,hd2,other],scroll:genShopScroll(),
  };
}

function addToInventory(char,name,itemObj=null){
  if(itemObj&&(itemObj.type==='weapon'||itemObj.type==='armor')){
    char.inventory.push({name:itemObj.name,qty:1,type:itemObj.type,itemObj,sellCost:1});
  } else {
    const ex=char.inventory.find(i=>i.name===name&&!i.itemObj);
    if(ex) ex.qty++;
    else char.inventory.push({name,qty:1,sellCost:1});
  }
}

function equipItem(char, inventoryIndex) {
  const entry=char.inventory[inventoryIndex]; if(!entry||!entry.itemObj) return false;
  const item=entry.itemObj;
  if(item.type==='weapon'){
    if(char.equippedWeapon&&char.equippedWeapon.id!==item.id)
      char.inventory.push({name:char.equippedWeapon.name,qty:1,type:'weapon',itemObj:char.equippedWeapon,sellCost:1});
    char.equippedWeapon=item; char.inventory.splice(inventoryIndex,1);
    return `Equipped ${item.name} (${item.dice}+${item.bonus})`;
  }
  if(item.type==='armor'){
    const oldBonus=char.equippedArmor?char.equippedArmor.defBonus:0;
    if(char.equippedArmor&&char.equippedArmor.id!==item.id)
      char.inventory.push({name:char.equippedArmor.name,qty:1,type:'armor',itemObj:char.equippedArmor,sellCost:1});
    char.equippedArmor=item;
    char.defense=char.baseAgiDef+item.defBonus;
    char.inventory.splice(inventoryIndex,1);
    return `Equipped ${item.name} (+${item.defBonus} Def, now ${char.defense})`;
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
        // Cap reached — grant +1 boon instead
        char.weaponAtkBonus++;
        addLog(room,`${player.name}: Weapon Enhancement — ${w.name} is at max bonus (+6). Grants +1 boon to hit instead.`,'loot');
      } else {
        w.bonus=currentBonus+1;
        addLog(room,`${player.name}: Weapon Enhancement — ${w.name} now ${w.dice}+${w.bonus} dmg.`,'loot');
      }
    } else {
      char.weaponDmgBonus++;
      addLog(room,`${player.name}: Weapon Enhancement — +1 damage stored (equip a weapon to apply).`,'loot');
    }
  }
  else if(item.type==='statboost'){const ks=Object.keys(char.attrs);let best=ks[0];ks.forEach(k=>{if(modVal(char.attrs[k])>modVal(char.attrs[best]))best=k;});char.attrs[best]++;addLog(room,`${player.name}: +1 ${best.toUpperCase()} (now ${char.attrs[best]}).`,'loot');}
  else if(item.type==='weapon'){addToInventory(char,item.name,item);addLog(room,`${player.name} buys ${item.name} (${item.dice}+${item.bonus}) — in inventory.`,'loot');}
  else if(item.type==='armor'){addToInventory(char,item.name,item);addLog(room,`${player.name} buys ${item.name} (+${item.defBonus} Def) — in inventory.`,'loot');}
  else if(item.type==='scroll'){addToInventory(char,item.name);char.scrollSpells[item.name]=item.spell;addLog(room,`${player.name} buys ${item.name}.`,'loot');}
  else if(item.type==='consumable'){addToInventory(char,item.name);addLog(room,`${player.name} buys ${item.name}.`,'loot');}
}

function handleSell(room,player,invIndex){
  const char=player.char;
  if(invIndex<0||invIndex>=char.inventory.length) return;
  const item=char.inventory[invIndex];
  // Can't sell equipped items
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
  else if(itemName==='Flask of Oil'){if(inCombat&&room.gs.enemy){const dmg=rd(2,6);room.gs.enemy.hp-=dmg;addLog(room,`${player.name} throws Flask of Oil — <strong>${dmg}</strong> fire dmg!`,'spell');if(room.gs.enemy.hp<=0){resolveEnemyDeath(room);return true;}}else{consumed=false;}}
  else if(itemName==='Fire Jar'){if(inCombat&&room.gs.enemy){const dmg=rd(3,6);room.gs.enemy.hp-=dmg;addLog(room,`${player.name} smashes Fire Jar — <strong>${dmg}</strong> fire dmg!`,'spell');if(room.gs.enemy.hp<=0){resolveEnemyDeath(room);return true;}}else{consumed=false;}}
  else if(itemName==='Lucky Pendant'){char.luckyPendant=true;addLog(room,`${player.name} activates Lucky Pendant — next attack is a CRIT!`,'loot');}
  else if(itemName==='Sharpening Stone'){char.sharpeningStone=true;addLog(room,`${player.name} uses Sharpening Stone — +1d6 dmg this combat!`,'loot');}
  else if(itemName.startsWith('Scroll:')){
    const spell=char.scrollSpells[itemName];
    if(!spell){addLog(room,`${player.name}: scroll crumbles.`,'sys');return false;}
    if(spell.type==='heal'){const[n,s]=spell.dmgDice.split('d').map(Number);const roll=rd(n,s);const amt=roll+4;char.health=Math.min(char.maxHealth,char.health+amt);addLog(room,`${player.name} reads ${itemName} — ${n}d${s}(${roll})+4 = +<strong>${amt}</strong> HP.`,'heal');}
    else if(inCombat&&room.gs.enemy){const[n,s]=spell.dmgDice.split('d').map(Number);const dmg=rd(n,s);room.gs.enemy.hp-=dmg;addLog(room,`${player.name} reads ${itemName} — ${n}d${s} = <strong>${dmg}</strong> dmg!`,'spell');if(room.gs.enemy.hp<=0){resolveEnemyDeath(room);return true;}}
    else{consumed=false;}
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
    player.career=payload.career; player.char=buildChar(payload.career); player.ready=false;
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
    const alive=room.players.filter(p=>p.char&&p.char.alive);
    if(alive.every(p=>gs.pathVotes[p.id]))resolvePath(room);
    return;
  }
  if(action==='APPLY_PATH'){
    if(!char.pendingLevelUp)return;
    const tier=char.pendingPathTier||'novice';
    if(tier==='novice'){applyNovicePath(char,data.pathId);addLog(room,`${player.name} walks the <strong>${data.pathId}</strong> novice path.`,'spell');}
    else if(tier==='expert'){applyExpertPath(char,data.pathId);addLog(room,`${player.name} chooses the <strong>${EXPERT_PATHS[data.pathId]?.label}</strong> expert path.`,'spell');}
    else if(tier==='master'){applyMasterPath(char,data.pathId);addLog(room,`${player.name} ascends the <strong>${MASTER_PATHS[data.pathId]?.label}</strong> master path.`,'spell');}
    return;
  }
  if(action==='BUY_ITEM'){handleBuy(room,player,data.itemId);return;}
  if(action==='SELL_ITEM'){handleSell(room,player,data.invIndex);return;}
  if(action==='LEAVE_SHOP'){
    char.merchantStock=null;
    const stillShopping=room.players.filter(p=>p.char&&p.char.alive&&p.char.merchantStock);
    if(stillShopping.length===0){gs.phase='event';addLog(room,'The warband leaves the merchant.','sys');}
    else addLog(room,`${player.name} is done shopping.`,'sys');
    return;
  }
  if(action==='PICK_LOOT'){
    if(gs.phase!=='loot'||!gs.lootRoom||gs.lootPicked.includes(playerId))return;
    gs.lootPicked.push(playerId);
    const opts=char.lootOptions||{}; char.lootOptions=null;
    if(data.pick==='coins'){char.gold+=gs.lootRoom.coins;addLog(room,`${player.name} takes ${gs.lootRoom.coins} silver.`,'loot');}
    else if(data.pick==='consumable'){
      if(opts.consumable==='Spell Scroll'&&opts.scrollSpell){const sn=`Scroll: ${opts.scrollSpell.name}`;addToInventory(char,sn);char.scrollSpells[sn]=opts.scrollSpell;addLog(room,`${player.name} takes ${sn}.`,'loot');}
      else{addToInventory(char,opts.consumable);addLog(room,`${player.name} takes ${opts.consumable}.`,'loot');}
    }
    else if(data.pick==='weapon'){addToInventory(char,opts.weapon.name,opts.weapon);addLog(room,`${player.name} takes ${opts.weapon.name}.`,'loot');}
    else if(data.pick==='armor'){addToInventory(char,opts.armor.name,opts.armor);addLog(room,`${player.name} takes ${opts.armor.name}.`,'loot');}
    else{addLog(room,`${player.name} takes nothing.`,'sys');}
    const alive=room.players.filter(p=>p.char&&p.char.alive);
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
    if(gs.depth>0&&gs.depth%3===0&&gs.depth!==gs.lastPowerRestoreDepth){
      gs.lastPowerRestoreDepth=gs.depth; restorePower(room,`Depth ${gs.depth} milestone`);
    }
    if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');return;}
    showPathChoices(room); return;
  }
  if(action==='USE_ITEM_OOC'){useItemLogic(room,player,data.itemName,false);return;}

  // ── Combat actions ──
  if(gs.phase!=='combat'||!gs.inCombat)return;
  if(!char.alive)return;
  if(gs.playersActedThisRound.includes(playerId)){sendTo(ws,{type:'ERROR',payload:{msg:'Already acted this round.'}});return;}
  let acted=false;

  if(action==='ATTACK'){
    const rogueBoon=(char.career==='rogue'&&gs.roundNumber===1)?1:0;
    // Quick strike: second attack on round 1 if not used
    const r=rollAttack(char,gs.enemy,rogueBoon);
    if(r.fumble){
      addLog(room,`${player.name} <em>fumbles!</em> d20 rolled 1 — automatic miss.`,'sys');
    } else if(r.hit){
      gs.enemy.hp-=r.dmg;
      const cl=r.forceCrit?' ⚡ Lucky Pendant CRIT!':r.crit?' 💥 CRITICAL HIT!':'';
      const rollBreak=`d20:<strong>${r.base}</strong>${r.boonInfo}+atk<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${gs.enemy.ac}</strong>`;
      addLog(room,`${player.name} ${r.crit?'<strong>CRITS</strong>':'hits'} ${gs.enemy.name} — <strong class="num-dmg">−${r.dmg} dmg</strong>${cl} [${rollBreak}] → ${gs.enemy.name} ${Math.max(0,gs.enemy.hp)}/${gs.enemy.maxHp} HP`,r.crit?'crit':'dmg');
      if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}
    } else {
      addLog(room,`${player.name} <em>misses</em> — d20:<strong>${r.base}</strong>${r.boonInfo}+<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${gs.enemy.ac}</strong>.`,'sys');
    }
    acted=true;
  }
  else if(action==='CAST_SPELL'){
    const spell=char.knownSpells.find(s=>s.name===data.spellName); if(!spell)return;
    // Spell surge: cast for free once per combat
    const freeCast=char.spellsurge&&!char.spellsurgeUsed&&data.useSurge;
    if(freeCast){char.spellsurgeUsed=true;addLog(room,`${player.name} uses Spell Surge!`,'spell');}
    else if(spell.rank>0&&char.power-char.castingsUsed<=0){addLog(room,`${player.name}: no castings left.`,'sys');return;}
    if(!freeCast&&spell.rank>0)char.castingsUsed++;
    if(spell.heal){
      const[n,s]=spell.dmg.split('d').map(Number);
      const roll=rd(n,s); const wilMod=Math.max(0,modVal(char.attrs.wil)); const amt=roll+wilMod;
      const targetPlayer=data.targetId?room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive):null;
      const target=targetPlayer?targetPlayer.char:char;
      const targetName=targetPlayer?targetPlayer.name:player.name;
      // Mass Heal: heal all allies
      if(spell.name==='Mass Heal'){
        if(char.massHealUsed){addLog(room,`${player.name}: Mass Heal already used.`,'sys');return;}
        char.massHealUsed=true;
        room.players.forEach(p=>{ if(p.char&&p.char.alive){const h=rd(1,6);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} healed for ${h} HP.`,'heal');} });
      } else if(spell.name==='Miracle Heal'){
        if(char.miracleUsed){addLog(room,`${player.name}: Miracle Heal already used.`,'sys');return;}
        char.miracleUsed=true;
        target.health=target.maxHealth;
        addLog(room,`${player.name} casts Miracle Heal on ${targetName} — fully restored!`,'heal');
      } else {
        target.health=Math.min(target.maxHealth,target.health+amt);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — ${n}d${s}(${roll})+${wilMod} WIL = +<strong>${amt}</strong> HP.`,'heal');
      }
    } else {
      const[n,s]=spell.dmg.split('d').map(Number); let roll=rd(n,s);
      const intMod=Math.max(0,modVal(char.attrs.int))*2;
      // Burning Soul: fire spells +1d6
      let burnBonus=0;
      if(char.burningSoul&&(spell.name==='Ignite'||spell.name==='Burning Hands'||spell.name==='Firewall')){burnBonus=rd(1,6);}
      const total=roll+intMod+burnBonus;
      gs.enemy.hp-=total;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${n}d${s}(${roll})+${intMod} INT${burnBonus?'+'+burnBonus+' burn':''} = <strong>${total}</strong> dmg!`,'spell');
      if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}
    }
    acted=true;
  }
  else if(action==='USE_TALENT'){
    const t=data.talent;
    if(t==='catchBreath'){if(char.catchBreathUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.catchBreathUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Catch Your Breath — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='nimbleRecovery'){if(char.nimbleUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.nimbleUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Nimble Recovery — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='sharedRecovery'){if(char.sharedUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.sharedUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Shared Recovery — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='spellRecovery'){if(char.spellRecoveryUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.spellRecoveryUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);char.castingsUsed=Math.max(0,char.castingsUsed-1);addLog(room,`${player.name} uses Spell Recovery — +<strong>${h}</strong> HP + 1 casting.`,'spell');}
    else if(t==='divineSmite'){if(char.divineSmiteUsed){addLog(room,`${player.name}: Divine Smite already used.`,'sys');return;}char.divineSmiteUsed=true;const dmg=rd(3,6);gs.enemy.hp-=dmg;addLog(room,`${player.name} calls Divine Smite — <strong>${dmg}</strong> holy dmg!`,'spell');if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}}
    else if(t==='rallyingCry'){if(char.rallyingUsed){addLog(room,`${player.name}: Rallying Cry already used.`,'sys');return;}char.rallyingUsed=true;room.players.forEach(p=>{if(p.char&&p.char.alive){const h=healingRate(p.char);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} rallies — +${h} HP.`,'heal');}});}
    acted=true;
  }
  else if(action==='USE_ITEM'){const consumed=useItemLogic(room,player,data.itemName,true);acted=consumed;}
  else if(action==='USE_ITEM_ALLY'){
    const targetPlayer=room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive);
    if(!targetPlayer){addLog(room,`${player.name}: target not found.`,'sys');return;}
    const tchar=targetPlayer.char;
    const idx=char.inventory.findIndex(i=>i.name===data.itemName); if(idx===-1)return;
    if(data.itemName==='Healing Draught'){const h=rd(1,6);tchar.health=Math.min(tchar.maxHealth,tchar.health+h);addLog(room,`${player.name} gives Healing Draught to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');}
    else if(data.itemName==='Greater Healing Draught'){const h=rd(2,6);tchar.health=Math.min(tchar.maxHealth,tchar.health+h);addLog(room,`${player.name} gives Greater Healing to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');}
    else{addLog(room,`${player.name}: can't use that on an ally.`,'sys');return;}
    char.inventory[idx].qty--; if(char.inventory[idx].qty<=0) char.inventory.splice(idx,1);
    acted=true;
  }
  else if(action==='FLEE'){
    if(gs.enemy&&gs.enemy.threat==='Boss'){addLog(room,`${player.name}: no escape from a boss!`,'dmg');return;}
    const base=d(20),total=base+modVal(char.attrs.agi);
    if(total>=10){
      const hit=char.shadowstep?0:rd(1,4);
      if(hit){char.health=Math.max(0,char.health-hit);addLog(room,`${player.name} flees! Takes <strong>${hit}</strong> opportunity dmg.`,'dmg');checkDeath(room,player);}
      else addLog(room,`${player.name} slips away unharmed (Shadowstep).`,'dmg');
      gs.inCombat=false;gs.enemy=null;gs.phase='event';gs.playersActedThisRound=[];gs.enemyHasActed=false;
      addLog(room,'Warband escapes. Press onward.','sys');return;
    } else {addLog(room,`${player.name} fails to flee (${total}<DC10).`,'sys');acted=true;}
  }

  if(acted){
    if(!gs.playersActedThisRound.includes(playerId))gs.playersActedThisRound.push(playerId);
    maybeEnemyAttack(room);
  }
}

function addLog(room,msg,type=''){room.gs.log.push({msg,type,ts:Date.now()});if(room.gs.log.length>100)room.gs.log=room.gs.log.slice(-100);}
function broadcastState(roomCode){const room=rooms.get(roomCode);if(!room)return;const data=JSON.stringify({type:'STATE_UPDATE',payload:publicState(room)});room.players.forEach(p=>{if(p.ws.readyState===1)p.ws.send(data);});}

wss.on('connection',ws=>{
  ws.on('message',raw=>{try{handleMessage(ws,JSON.parse(raw));}catch(e){console.error('WS error:',e);}});
  ws.on('close',()=>{
    const ctx=clients.get(ws);if(!ctx)return;
    const room=rooms.get(ctx.roomCode);
    if(room){const player=room.players.find(p=>p.id===ctx.playerId);if(player){player.connected=false;addLog(room,`${player.name} disconnected.`,'sys');broadcastState(ctx.roomCode);}
    setTimeout(()=>{if(room.players.every(p=>!p.connected))rooms.delete(ctx.roomCode);},600000);}
    clients.delete(ws);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`Shadows Over Reikland on 0.0.0.0:${PORT}`));
