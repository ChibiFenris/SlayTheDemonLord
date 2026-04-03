const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const clients = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function sendTo(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function initGameState() {
  return {
    depth: 0,
    inCombat: false,
    enemy: null,
    phase: 'lobby',
    playersActedThisRound: [],
    enemyHasActed: false,
    roundNumber: 0,
    log: [],
    pathChoices: null,
    pathVotes: {},
    bossNode: false,
    bossCount: 0,
    lootRoom: null,
    lootPicked: [],
    lastPowerRestoreDepth: 0,
  };
}

function publicState(room) {
  return {
    gs: room.gs,
    players: room.players.map(p => ({
      id: p.id, name: p.name, career: p.career,
      ready: p.ready, char: p.char,
      isHost: p.id === room.hostId, connected: p.connected,
    })),
    hostId: room.hostId,
  };
}

const d = n => Math.floor(Math.random() * n) + 1;
function rd(num, sides) { let t = 0; for (let i = 0; i < num; i++) t += d(sides); return t; }
const modVal = score => score - 10;

// ─── CAREERS ───────────────────────────────────────────────────────────────
const CAREERS = {
  warrior: { label:'State Soldier',    startAttrs:{str:11,agi:10,int:9,wil:10},  armorDef:3, weaponDmg:'1d6', weaponStr:true,  spellcaster:false },
  rogue:   { label:'Roadwarden',       startAttrs:{str:10,agi:11,int:10,wil:9},  armorDef:1, weaponDmg:'1d6', weaponStr:false, spellcaster:false },
  wizard:  { label:'Bright Wizard',    startAttrs:{str:9,agi:10,int:11,wil:10},  armorDef:0, weaponDmg:'1d6', weaponStr:true,  spellcaster:true, tradition:'fire' },
  priest:  { label:'Sigmarite Priest', startAttrs:{str:10,agi:9,int:10,wil:11},  armorDef:3, weaponDmg:'1d6', weaponStr:true,  spellcaster:true, tradition:'life' },
};

// ─── NOVICE PATHS ───────────────────────────────────────────────────────────
const NOVICE_PATHS = {
  warrior: { hpGain:5, power:0, weaponTraining:true,  catchBreath:true,    trickery:false, nimbleRecovery:false, spellRecovery:false, sharedRecovery:false },
  rogue:   { hpGain:3, power:0, weaponTraining:false, catchBreath:false,   trickery:true,  nimbleRecovery:true,  spellRecovery:false, sharedRecovery:false },
  magician:{ hpGain:2, power:1, weaponTraining:false, catchBreath:false,   trickery:false, nimbleRecovery:false, spellRecovery:true,  sharedRecovery:false },
  priest:  { hpGain:4, power:1, weaponTraining:false, catchBreath:false,   trickery:false, nimbleRecovery:false, spellRecovery:false, sharedRecovery:true  },
};

// ─── ENEMY POOLS ────────────────────────────────────────────────────────────
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
    {name:'Nurgle Plaguebearer',type:'Daemon',  threat:'Moderate', hp:22, ac:13,atk:3,xp:2,gold:[0,0],  diseased:true},
  ],
  high: [
    {name:'Chaos Warrior',      type:'Chaos',   threat:'High',     hp:35, ac:16,atk:5,xp:3,gold:[15,40]},
    {name:'Vampire Count',      type:'Undead',  threat:'High',     hp:40, ac:15,atk:5,xp:3,gold:[20,60], undead:true,lifeLeech:true},
    {name:'Greater Daemon',     type:'Daemon',  threat:'High',     hp:45, ac:15,atk:6,xp:3,gold:[25,50], insanityAtk:true},
    {name:'Plague Rat Lord',    type:'Skaven',  threat:'High',     hp:32, ac:14,atk:5,xp:3,gold:[10,30], diseased:true},
  ],
  boss: [
    {name:'Skaven Warlord Gnashteeth',type:'Skaven Boss',threat:'Boss',hp:80, ac:15,atk:6,xp:5,gold:[30,80], multi:true},
    {name:'Beastlord Kragthor',       type:'Chaos Boss', threat:'Boss',hp:95, ac:16,atk:7,xp:5,gold:[25,70]},
    {name:'Nagath the Bone-King',     type:'Undead Boss',threat:'Boss',hp:110,ac:16,atk:7,xp:5,gold:[40,100],undead:true,lifeLeech:true,regen:true},
    {name:'Varghast Bloodgore',       type:'Daemon Boss',threat:'Boss',hp:120,ac:17,atk:8,xp:5,gold:[50,120],multi:true,insanityAtk:true},
    {name:'Heinrich von Morr',        type:'Undead Boss',threat:'Boss',hp:130,ac:15,atk:7,xp:5,gold:[60,150],undead:true,lifeLeech:true},
  ],
};

// Damage rules:
//  Pre-boss-1: normal=1d6, elite=1d6+2, boss1=2d6
//  Post-boss-1: normal=1d6+3, elite=2d6, boss2=3d6
function enemyDmgDice(threat, isElite, bossCount) {
  if (threat === 'Boss') return bossCount === 0 ? {n:2,s:6,b:0} : {n:3,s:6,b:0};
  if (isElite)           return bossCount === 0 ? {n:1,s:6,b:2} : {n:2,s:6,b:0};
  return bossCount === 0 ? {n:1,s:6,b:0} : {n:1,s:6,b:3};
}

function scaleEnemy(tmpl, playerCount, isElite, bossCount) {
  const e = JSON.parse(JSON.stringify(tmpl));
  e.hp = e.maxHp = Math.round(e.hp * (1 + (playerCount - 1) * 0.5));
  e.conditions = [];
  e.isElite = isElite;
  const dd = enemyDmgDice(e.threat, isElite, bossCount);
  e.dmgNum = dd.n; e.dmgSides = dd.s; e.dmgBonus = dd.b;
  e.dmgDisplay = `${dd.n}d${dd.s}${dd.b?'+'+dd.b:''}`;
  if (isElite && e.threat !== 'Boss') e.threat = 'Elite';
  if (bossCount === 0) {
    // Pre-first-boss: no attack bonus at all
    e.atk = 0;
  } else {
    // Post-first-boss: cap ATK by threat tier
    const isBossEnemy = e.threat === 'Boss';
    const cap = isBossEnemy ? 5 : isElite ? 4 : 3;
    e.atk = Math.min(e.atk, cap);
  }
  return e;
}

function pickEnemy(depth, isElite, isBoss, playerCount, bossCount) {
  let pool;
  if (isBoss)        pool = ENEMY_POOLS.boss;
  else if (depth>20) pool = isElite ? ENEMY_POOLS.boss : ENEMY_POOLS.high;
  else if (depth>10) pool = isElite ? ENEMY_POOLS.high : ENEMY_POOLS.mid;
  else               pool = isElite ? ENEMY_POOLS.mid  : ENEMY_POOLS.low;
  return scaleEnemy(pool[Math.floor(Math.random()*pool.length)], playerCount, isElite, bossCount);
}

// ─── CHARACTER BUILDER ───────────────────────────────────────────────────────
function buildChar(career) {
  const c = CAREERS[career];
  const attrs = {...c.startAttrs};
  const baseDefense = attrs.agi + c.armorDef;
  // Give starting weapon & armor as inventory items
  const startWpn = {id:'w_start_'+uuidv4(),name:'Starting Weapon',dice:'1d6',stat:c.weaponStr?'str':'agi',bonus:0,type:'weapon',desc:'1d6 · starting gear'};
  const startArmor = c.armorDef>0 ? {id:'a_start_'+uuidv4(),name:'Starting Armour',defBonus:c.armorDef,type:'armor',desc:`+${c.armorDef} Defense`} : null;
  return {
    career, attrs,
    health: attrs.str, maxHealth: attrs.str,
    defense: baseDefense, baseAgiDef: attrs.agi,
    perception: attrs.int,
    power: 0, maxPower: 0, castingsUsed: 0,
    insanity: 0, corruption: 0, conditions: [],
    inventory: [
      {name:'Healing Draught',qty:2},
      {itemObj:startWpn, name:startWpn.name, qty:1, type:'weapon'},
      ...(startArmor ? [{itemObj:startArmor, name:startArmor.name, qty:1, type:'armor'}] : []),
    ],
    gold: 15,
    level: 0, xp: 0,
    novicePath: null, pendingLevelUp: false,
    // Talents
    weaponTraining:false, catchBreath:false, catchBreathUsed:false,
    combatProwess:false,  combatExpertise:false,
    trickery:false,       trickeryUsed:0, trickeryMax:1,
    nimbleRecovery:false, nimbleUsed:false,
    spellRecovery:false,  spellRecoveryUsed:false,
    sharedRecovery:false, sharedUsed:false,
    // Equipment slots — null means unequipped
    equippedWeapon: startWpn,
    equippedArmor: startArmor,
    weaponDmgBonus:0, weaponAtkBonus:0,
    scrollSpells:{}, stimulantBoon:0, sharpeningStone:false, luckyPendant:false,
    alive:true,
    spellcaster: c.spellcaster, tradition: c.tradition||null,
    knownSpells: c.spellcaster
      ? (c.tradition==='fire'
          ? [{name:'Ignite',rank:0,heal:false,dmg:'1d6'},{name:'Burning Hands',rank:1,heal:false,dmg:'3d6'}]
          : [{name:'Minor Healing',rank:0,heal:true,dmg:'1d6'},{name:'Light Healing',rank:1,heal:true,dmg:'2d6'}])
      : [],
    merchantStock: null,
  };
}

const healingRate = char => Math.max(1, Math.floor(char.maxHealth/4));

// ─── COMBAT ROLLS (SotDL rules) ──────────────────────────────────────────────
// Attack roll: d20 + attribute modifier vs target Defense
// Boons: roll extra d6s, ADD highest to d20
// Banes: roll extra d6s, SUBTRACT highest from d20
// Natural 1 = fumble (auto miss), Natural 20 = crit (double weapon dice)
function rollD20boons(boons, banes) {
  const net = boons - banes;
  const base = d(20);
  if (net > 0) { const bd=[]; for(let i=0;i<Math.min(net,4);i++) bd.push(d(6)); return {base, final:base+Math.max(...bd)}; }
  if (net < 0) { const bd=[]; for(let i=0;i<Math.min(-net,4);i++) bd.push(d(6)); return {base, final:Math.max(1,base-Math.max(...bd))}; }
  return {base, final:base};
}

function rollAttack(char, enemy, extraBoons=0) {
  const wpn = char.equippedWeapon;
  const wpnStat = wpn ? wpn.stat : (CAREERS[char.career].weaponStr ? 'str' : 'agi');
  const wpnDice = (wpn && wpn.dice) ? wpn.dice : '1d6';   // all weapons are d6-based
  const wpnDmgBonus = ((wpn && wpn.bonus) ? wpn.bonus : 0) + char.weaponDmgBonus;
  const [num,sides] = wpnDice.split('d').map(Number);
  const atkMod = modVal(char.attrs[wpnStat]) + char.weaponAtkBonus;

  let boons=0, banes=0;
  if (char.weaponTraining) boons++;
  if (char.stimulantBoon>0) { boons++; char.stimulantBoon--; }
  if (extraBoons) boons += extraBoons;
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned'))    banes++;

  const forceCrit = char.luckyPendant;
  if (forceCrit) char.luckyPendant = false;

  const {base, final} = rollD20boons(boons, banes);
  const fumble = base===1 && !forceCrit;
  const crit = forceCrit || base===20;
  const total = final + atkMod;
  const hit = !fumble && (crit || total >= enemy.ac);

  let dmg = 0;
  if (hit) {
    dmg = rd(num,sides) + Math.max(0,modVal(char.attrs[wpnStat])) + wpnDmgBonus;
    if (crit) dmg += rd(num,sides);
    if (char.combatProwess) dmg += rd(1,6);
    if (char.combatExpertise) dmg += rd(1,6);
    if (char.sharpeningStone) dmg += rd(1,6);
    if (char.trickery && char.trickeryUsed<char.trickeryMax) { dmg+=rd(1,6); char.trickeryUsed++; }
    dmg = Math.max(1,dmg);
  }
  const boonInfo = boons>0?` (${boons} boon)`:banes>0?` (${banes} bane)`:'';
  return { hit, crit, fumble, base, final, total, dmg, atkMod, boonInfo, forceCrit,
           wpnLabel: wpn ? `${wpn.name} (${wpnDice}+${wpnDmgBonus})` : `${CAREERS[char.career].label} weapon` };
}

function rollEnemyAttack(enemy, char) {
  const base = d(20);
  const total = base + enemy.atk;
  const crit = base===20;
  const hit = base!==1 && (crit || total>=char.defense);
  let dmg=0;
  if (hit) { dmg=rd(enemy.dmgNum,enemy.dmgSides)+enemy.dmgBonus; if(crit) dmg+=rd(enemy.dmgNum,enemy.dmgSides); dmg=Math.max(1,dmg); }
  return {hit,crit,dmg,total,base};
}

// ─── LEVEL UP ────────────────────────────────────────────────────────────────
const XP_THRESHOLDS = [0,1,2,3,4,6,7,9,12,14]; // 50% of original [0,2,3,5,8,11,14,18,23,28]

function checkLevelUp(char) {
  let newLevel=0;
  for (let i=XP_THRESHOLDS.length-1;i>=0;i--) { if(char.xp>=XP_THRESHOLDS[i]){newLevel=i;break;} }
  if (newLevel>char.level) {
    char.level=newLevel;
    char.pendingLevelUp=true;
    const np=NOVICE_PATHS[char.novicePath];
    const hpGain=np?np.hpGain:2;
    char.maxHealth+=hpGain; char.health=Math.min(char.health+hpGain,char.maxHealth);
    return {leveled:true,newLevel,hpGain};
  }
  return {leveled:false};
}

// ─── NOVICE PATH ────────────────────────────────────────────────────────────
function applyNovicePath(char, pathId) {
  char.novicePath=pathId; char.pendingLevelUp=false;
  const np=NOVICE_PATHS[pathId];
  if (!np) return;
  char.maxHealth+=np.hpGain; char.health=Math.min(char.health+np.hpGain,char.maxHealth);
  if (np.power)           { char.power+=np.power; char.maxPower+=np.power; }
  if (np.weaponTraining)  char.weaponTraining=true;
  if (np.catchBreath)     char.catchBreath=true;
  if (np.trickery)        char.trickery=true;
  if (np.nimbleRecovery)  char.nimbleRecovery=true;
  if (np.spellRecovery)   char.spellRecovery=true;
  if (np.sharedRecovery)  char.sharedRecovery=true;
}

// ─── PATH CHOICES ────────────────────────────────────────────────────────────
const NODE_TYPES = ['combat','combat','rest','merchant','loot','elite','unknown','unknown'];

function pickThreeNodes() {
  const pool=[...NODE_TYPES]; const chosen=[];
  while(chosen.length<3){const i=Math.floor(Math.random()*pool.length);const t=pool.splice(i,1)[0];if(!chosen.includes(t))chosen.push(t);}
  return chosen;
}

function restorePower(room, reason) {
  let restored=false;
  room.players.forEach(p=>{
    if(!p.char||!p.char.alive) return;
    if(p.char.castingsUsed>0||p.char.spellRecoveryUsed){
      p.char.castingsUsed=0;
      p.char.spellRecoveryUsed=false;
      restored=true;
    }
  });
  if(restored) addLog(room,`✨ ${reason} — all spellcasters regain their power.`,'spell');
}

function showPathChoices(room) {
  const gs=room.gs;
  gs.pathVotes={};
  // Depth 30 is always a final boss
  if (gs.depth>=29) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    addLog(room,'💀 The Final Darkness. A monstrous power bars your path. Face it or fall.','chaos');
  } else if (gs.depth>0 && gs.depth%10===0) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    addLog(room,'💀 A monstrous power bars your path. Face it or fall.','chaos');
  } else {
    gs.phase='path'; gs.bossNode=false; gs.pathChoices=pickThreeNodes();
    addLog(room,'The warband reaches a crossroads. Each warrior votes for their path — fate decides the rest.','sys');
  }
}

function resolvePath(room) {
  const gs=room.gs;
  const votes=Object.values(gs.pathVotes);
  if (!votes.length) return;
  const tally={};
  votes.forEach(v=>{tally[v]=(tally[v]||0)+1;});
  const maxV=Math.max(...Object.values(tally));
  const winners=Object.keys(tally).filter(k=>tally[k]===maxV);
  const chosen=winners[Math.floor(Math.random()*winners.length)];
  const voteStr=Object.entries(gs.pathVotes).map(([id,v])=>{const p=room.players.find(p=>p.id===id);return`${p?p.name:'?'}→${v}`;}).join(', ');
  if (winners.length>1) addLog(room,`Votes split (${voteStr}). Fate chooses: <strong>${chosen}</strong>!`,'sys');
  else addLog(room,`Path chosen: <strong>${chosen}</strong>. (${voteStr})`,'sys');
  enterNode(room,chosen);
}

// ─── NODE ENTRY ──────────────────────────────────────────────────────────────
function enterNode(room, nodeType) {
  const gs=room.gs;
  gs.depth++; gs.pathChoices=null; gs.pathVotes={};
  const playerCount=room.players.filter(p=>p.connected&&p.char&&p.char.alive).length;

  if (nodeType==='combat'||nodeType==='elite'||nodeType==='boss') {
    const isBoss=nodeType==='boss', isElite=nodeType==='elite';
    gs.enemy=pickEnemy(gs.depth,isElite,isBoss,playerCount,gs.bossCount);
    gs.inCombat=true; gs.phase='combat';
    gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.roundNumber=1;
    const tag=isBoss?'⚠ BOSS — ':isElite?'Elite — ':'';
    addLog(room,`⚔ ${tag}<strong>${gs.enemy.name}</strong> (${gs.enemy.type}) appears! Damage: ${gs.enemy.dmgDisplay}`,'dmg');
    addLog(room,'All warriors act first — then the enemy strikes!','sys');
    return;
  }
  if (nodeType==='rest') {
    gs.phase='event';
    addLog(room,'🔥 A campfire flickers. The warband rests.','heal');
    room.players.forEach(p=>{
      if (!p.char||!p.char.alive) return;
      const amt=Math.ceil(p.char.maxHealth*0.6);
      p.char.health=Math.min(p.char.maxHealth,p.char.health+amt);
      p.char.catchBreathUsed=false; p.char.nimbleUsed=false;
      p.char.sharedUsed=false; p.char.trickeryUsed=0;
      p.char.sharpeningStone=false;
      p.char.conditions=p.char.conditions.filter(c=>c==='Diseased');
      addLog(room,`${p.name} recovers ${amt} HP.`,'heal');
    });
    restorePower(room,'Rest site');
    addLog(room,'Rest complete. Press onward.','sys');
    return;
  }
  if (nodeType==='merchant') {
    gs.phase='merchant';
    room.players.forEach(p=>{if(p.char&&p.char.alive) p.char.merchantStock=buildPlayerShop();});
    addLog(room,'🛒 A merchant appears. Each warrior has their own selection of wares.','sys');
    return;
  }
  if (nodeType==='loot') {
    gs.phase='loot';
    const coins=Math.floor((5+Math.floor(Math.random()*46))*0.5); // 50% of 5-50 = ~3-25
    gs.lootRoom={coins};
    gs.lootPicked=[];
    // Each alive player gets their own random loot options
    room.players.forEach(p=>{
      if(p.char&&p.char.alive) p.char.lootOptions=buildLootOptions();
    });
    addLog(room,`📦 A cache! ${coins} coins — each warrior finds their own haul.`,'loot');
    return;
  }
  if (nodeType==='unknown') {
    gs.phase='event';
    const r=d(10);
    if (r<=3){enterNode(room,'combat');return;}
    else if(r<=5){enterNode(room,'loot');return;}
    else if(r<=7){enterNode(room,'rest');return;}
    else{
      const coins=Math.floor((5+Math.floor(Math.random()*16))*0.5); // ~3-10
      room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{p.char.gold+=coins;});
      addLog(room,`❓ The unknown yields ${coins} silver each.`,'loot');
    }
    return;
  }
}

// ─── LOOT ROOM — 3 distinct picks per player ─────────────────────────────────
const SCROLL_SPELLS_LIST = [
  {name:'Fireball',     desc:'8d6 fire dmg',   type:'attack', dmgDice:'8d6'},
  {name:'Smite',        desc:'4d6 holy dmg',   type:'attack', dmgDice:'4d6'},
  {name:'Chain Lightning',desc:'6d6 lightning',type:'attack', dmgDice:'6d6'},
  {name:"Sigmar's Wrath",desc:'5d6 holy dmg',  type:'attack', dmgDice:'5d6'},
  {name:'Cure Wounds',  desc:'Heal 3d6+4 HP',  type:'heal',   dmgDice:'3d6'},
];
const LOOT_CONS_LIST=['Healing Draught','Greater Healing Draught','Flask of Oil','Fire Jar','Lucky Pendant','Sharpening Stone'];

function buildLootOptions() {
  // Pick A: coins only (nothing else)
  // Pick B: a consumable or scroll
  // Pick C: a weapon + armor (both go to inventory)
  const useScroll = d(6) >= 4;
  const consumable = useScroll ? 'Spell Scroll' : LOOT_CONS_LIST[Math.floor(Math.random()*LOOT_CONS_LIST.length)];
  const scrollSpell = useScroll ? SCROLL_SPELLS_LIST[Math.floor(Math.random()*SCROLL_SPELLS_LIST.length)] : null;
  return {
    consumable,
    scrollSpell,
    weapon: genWpn(),
    armor:  genArmor(),
  };
}

// ─── COMBAT FLOW: ALL PLAYERS FIRST, THEN ENEMY ──────────────────────────────
function allPlayersActed(room) {
  const alive=room.players.filter(p=>p.char&&p.char.alive);
  return alive.length>0 && alive.every(p=>room.gs.playersActedThisRound.includes(p.id));
}

function maybeEnemyAttack(room) {
  if (!allPlayersActed(room)) return;
  const gs=room.gs;
  if (gs.enemyHasActed||!gs.enemy||!gs.inCombat) return;
  gs.enemyHasActed=true;
  const e=gs.enemy;
  addLog(room,`--- ${e.name} retaliates! (${e.dmgDisplay} per hit) ---`,'sys');

  if (e.regen&&e.hp<e.maxHp){const r=rd(1,6);e.hp=Math.min(e.maxHp,e.hp+r);addLog(room,`${e.name} regenerates ${r} HP.`,'chaos');}

  const alive=room.players.filter(p=>p.char&&p.char.alive);
  alive.forEach(p=>{
    const r=rollEnemyAttack(e,p.char);
    if (r.hit){
      p.char.health=Math.max(0,p.char.health-r.dmg);
      addLog(room,`${e.name} hits <strong>${p.name}</strong> for <strong>${r.dmg}</strong> dmg (${r.total} vs Def ${p.char.defense})${r.crit?' — CRIT!':''}`,'dmg');
      if(e.lifeLeech){const l=Math.floor(r.dmg/2);e.hp=Math.min(e.maxHp,e.hp+l);addLog(room,`${e.name} leeches ${l} HP!`,'chaos');}
      if(e.insanityAtk&&d(6)>=4){p.char.insanity++;addLog(room,`${p.name} gains 1 Insanity!`,'chaos');}
      if(e.diseased&&d(6)>=5&&!p.char.conditions.includes('Diseased')){p.char.conditions.push('Diseased');addLog(room,`${p.name} contracts disease!`,'chaos');}
      checkDeath(room,p);
    } else {
      addLog(room,`${e.name} attacks ${p.name} (${r.total} vs Def ${p.char.defense}) — miss.`,'sys');
    }
  });

  if (e.multi){
    const t=alive[Math.floor(Math.random()*alive.length)];
    if(t){const r2=rollEnemyAttack(e,t.char);if(r2.hit){t.char.health=Math.max(0,t.char.health-r2.dmg);addLog(room,`${e.name} bonus attack on ${t.name} for <strong>${r2.dmg}</strong>!`,'dmg');checkDeath(room,t);}}
  }

  // Revive fallen if at least 1 alive
  const nowAlive=room.players.filter(p=>p.char&&p.char.alive);
  if (nowAlive.length===0) { gs.phase='gameover'; addLog(room,'💀 The entire warband has fallen. Reikland weeps.','death'); return; }
  room.players.forEach(p=>{if(p.char&&!p.char.alive){p.char.pendingRevive=true;}});

  // New round
  gs.playersActedThisRound=[];
  gs.enemyHasActed=false;
  gs.roundNumber=(gs.roundNumber||1)+1;
  addLog(room,'--- New round — warriors act! ---','sys');
}

function checkDeath(room, player) {
  if (player.char.health<=0&&player.char.alive){
    player.char.alive=false; player.char.health=0;
    addLog(room,`💀 <strong>${player.name}</strong> has fallen!`,'death');
  }
}

function resolveEnemyDeath(room) {
  const gs=room.gs;
  const e=gs.enemy;
  addLog(room,`⚔ <strong>${e.name}</strong> is slain! FOR SIGMAR!`,'crit');

  // Revive fallen at 1 HP if at least 1 was alive
  room.players.forEach(p=>{
    if(p.char&&(!p.char.alive||p.char.pendingRevive)){
      p.char.health=1; p.char.alive=true; p.char.pendingRevive=false;
      addLog(room,`${p.name} is dragged back from death — 1 HP!`,'heal');
    }
  });

  const xpEach=e.xp;
  const goldTotal=e.gold?Math.floor(rd(e.gold[0]||1,e.gold[1]||6)*0.5):0;
  const survivors=room.players.filter(p=>p.char&&p.char.alive);
  const goldEach=Math.floor(goldTotal/Math.max(1,survivors.length));
  addLog(room,`Each survivor: +<strong>${xpEach} XP</strong>, +<strong>${goldEach} silver</strong>.`,'loot');
  if (e.threat==='Boss') gs.bossCount++;

  survivors.forEach(p=>{
    p.char.xp+=xpEach;
    p.char.gold+=goldEach;
    p.char.sharpeningStone=false;
    const lv=checkLevelUp(p.char);
    if(lv.leveled) addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP) Choose a path!`,'spell');
  });

  gs.inCombat=false; gs.enemy=null; gs.phase='event';
  gs.playersActedThisRound=[]; gs.enemyHasActed=false;
  if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');}
}

// ─── MERCHANT (per-player shop) ──────────────────────────────────────────────
// All weapons use d6 dice only — bonus adds on top
const WEAPON_BASES=[
  {name:'Reiklander Sword', dice:'1d6', stat:'str'},
  {name:'Duelling Sabre',   dice:'1d6', stat:'agi'},
  {name:'War Axe',          dice:'2d6', stat:'str'},
  {name:'Halberd',          dice:'2d6', stat:'str'},
  {name:'Crossbow',         dice:'1d6', stat:'agi'},
  {name:'Silvered Rapier',  dice:'1d6', stat:'agi'},
  {name:'Warhammer',        dice:'2d6', stat:'str'},
  {name:'Pistol',           dice:'1d6', stat:'agi'},
];
const ARMOR_BASES=[{name:'Leather Jack',def:1},{name:'Chain Shirt',def:2},{name:'Breastplate',def:3},{name:'Full Plate',def:4}];
const SHOP_CONSUMABLES=[
  {name:'Healing Draught',        desc:'Heal 1d6 HP',                           cost:10},
  {name:'Greater Healing Draught',desc:'Heal 2d6 HP',                           cost:20},
  {name:'Flask of Oil',           desc:'2d6 fire damage',                        cost:15},
  {name:'Fire Jar',               desc:'3d6 fire damage',                        cost:25},
  {name:'Lucky Pendant',          desc:'Next attack is a critical hit (one use)',cost:40},
  {name:'Sharpening Stone',       desc:'+1d6 weapon damage this combat',          cost:40},
];
const SCROLL_SPELLS_SHOP=[
  {name:'Fireball',      desc:'8d6 fire dmg',   type:'attack', dmgDice:'8d6'},
  {name:'Smite',         desc:'4d6 holy dmg',   type:'attack', dmgDice:'4d6'},
  {name:'Chain Lightning',desc:'6d6 lightning', type:'attack', dmgDice:'6d6'},
  {name:"Sigmar's Wrath",desc:'5d6 holy dmg',   type:'attack', dmgDice:'5d6'},
  {name:'Cure Wounds',   desc:'Heal 3d6+4 HP',  type:'heal',   dmgDice:'3d6'},
];

function genWpn(){
  // 2d6 weapons are rarer — only ~20% of drops
  const light=WEAPON_BASES.filter(b=>b.dice==='1d6');
  const heavy=WEAPON_BASES.filter(b=>b.dice==='2d6');
  const pool=d(5)===1 ? heavy : light;  // 1-in-5 chance of 2d6 weapon
  const b=pool[Math.floor(Math.random()*pool.length)];
  const bonus=d(6);
  const costBase=b.dice==='2d6'?20:15;
  return{id:'w'+uuidv4(),name:b.name,dice:b.dice,stat:b.stat,bonus,cost:costBase+bonus*8,bought:false,type:'weapon',desc:`${b.dice}+${bonus} · ${b.stat.toUpperCase()}`};
}
function genArmor(){
  const b=ARMOR_BASES[Math.floor(Math.random()*ARMOR_BASES.length)];
  // Bonus +1 to +4 is common; +5 or +6 is rare (1-in-5 chance)
  const bonus = d(5)===1 ? d(2)+4 : d(4);   // rare: 5-6, common: 1-4
  return{id:'a'+uuidv4(),name:b.name,defBonus:b.def+bonus,cost:20+bonus*10,bought:false,type:'armor',desc:`+${b.def+bonus} Defense`};
}
function genShopScroll(){const sp=SCROLL_SPELLS_SHOP[Math.floor(Math.random()*SCROLL_SPELLS_SHOP.length)];return{id:'sc'+uuidv4(),name:`Scroll: ${sp.name}`,spell:sp,cost:35,bought:false,type:'scroll',desc:sp.desc};}

function buildPlayerShop(){
  // Always stock 2 Healing Draughts + 1 random non-draught consumable
  const hd1={id:'hd1'+uuidv4(),name:'Healing Draught',cost:10,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const hd2={id:'hd2'+uuidv4(),name:'Healing Draught',cost:10,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const otherPool=SHOP_CONSUMABLES.filter(c=>c.name!=='Healing Draught').sort(()=>Math.random()-0.5);
  const other=otherPool[0]?{id:'c'+uuidv4(),name:otherPool[0].name,cost:otherPool[0].cost,desc:otherPool[0].desc,bought:false,type:'consumable'}:hd1;
  const cons=[hd1,hd2,other];
  return{
    weaponEnhance:{id:'we'+uuidv4(),name:'Weapon Enhancement',desc:'+1 dmg & +1 boon to hit',cost:25,bought:false,type:'enhance'},
    statBoost:    {id:'sb'+uuidv4(),name:'+1 Primary Stat',   desc:'Increase highest attribute by 1',cost:35,bought:false,type:'statboost'},
    weapon1:genWpn(),weapon2:genWpn(),armor:genArmor(),
    consumables:cons,scroll:genShopScroll(),
  };
}

function addToInventory(char,name,itemObj=null){
  if(itemObj&&(itemObj.type==='weapon'||itemObj.type==='armor')){
    // Each weapon/armor is a unique item — always add as new entry
    char.inventory.push({name:itemObj.name,qty:1,type:itemObj.type,itemObj});
  } else {
    const ex=char.inventory.find(i=>i.name===name&&!i.itemObj);
    if(ex)ex.qty++;
    else char.inventory.push({name,qty:1});
  }
}

function equipItem(char,inventoryIndex){
  const entry=char.inventory[inventoryIndex];
  if(!entry||!entry.itemObj)return false;
  const item=entry.itemObj;
  if(item.type==='weapon'){
    // Put old equipped weapon back in inventory if different
    if(char.equippedWeapon&&char.equippedWeapon.id!==item.id){
      char.inventory.push({name:char.equippedWeapon.name,qty:1,type:'weapon',itemObj:char.equippedWeapon});
    }
    char.equippedWeapon=item;
    char.inventory.splice(inventoryIndex,1);
    return `Equipped ${item.name} (${item.dice}+${item.bonus})`;
  }
  if(item.type==='armor'){
    // Recalc defense: remove old armor bonus, add new
    const oldBonus=char.equippedArmor?char.equippedArmor.defBonus:0;
    if(char.equippedArmor&&char.equippedArmor.id!==item.id){
      char.inventory.push({name:char.equippedArmor.name,qty:1,type:'armor',itemObj:char.equippedArmor});
    }
    char.equippedArmor=item;
    char.defense=char.baseAgiDef+item.defBonus;
    char.inventory.splice(inventoryIndex,1);
    return `Equipped ${item.name} (+${item.defBonus} Def, now ${char.defense})`;
  }
  return false;
}

function handleBuy(room,player,itemId){
  const char=player.char;
  const stock=char.merchantStock;
  if(!stock){sendTo(player.ws,{type:'ERROR',payload:{msg:'No shop open.'}});return;}
  const all=[stock.weaponEnhance,stock.statBoost,stock.weapon1,stock.weapon2,stock.armor,stock.scroll,...stock.consumables];
  const item=all.find(i=>i.id===itemId);
  if(!item||item.bought){sendTo(player.ws,{type:'ERROR',payload:{msg:'Already purchased.'}});return;}
  if(char.gold<item.cost){sendTo(player.ws,{type:'ERROR',payload:{msg:`Need ${item.cost} ss, have ${char.gold}.`}});return;}
  char.gold-=item.cost; item.bought=true;
  if(item.type==='enhance'){char.weaponDmgBonus++;char.weaponAtkBonus++;addLog(room,`${player.name}: Weapon Enhancement applied.`,'loot');}
  else if(item.type==='statboost'){const ks=Object.keys(char.attrs);let best=ks[0];ks.forEach(k=>{if(modVal(char.attrs[k])>modVal(char.attrs[best]))best=k;});char.attrs[best]++;addLog(room,`${player.name}: +1 ${best.toUpperCase()} (now ${char.attrs[best]}).`,'loot');}
  else if(item.type==='weapon'){
    // Add to inventory — player equips manually
    addToInventory(char,item.name,item);
    addLog(room,`${player.name} buys ${item.name} (${item.dice}+${item.bonus}) — added to inventory.`,'loot');
  }
  else if(item.type==='armor'){
    addToInventory(char,item.name,item);
    addLog(room,`${player.name} buys ${item.name} (+${item.defBonus} Def) — added to inventory.`,'loot');
  }
  else if(item.type==='scroll'){addToInventory(char,item.name);char.scrollSpells[item.name]=item.spell;addLog(room,`${player.name} buys ${item.name}.`,'loot');}
  else if(item.type==='consumable'){addToInventory(char,item.name);addLog(room,`${player.name} buys ${item.name}.`,'loot');}
}

// ─── ITEM USE ────────────────────────────────────────────────────────────────
function useItemLogic(room,player,itemName,inCombat=false){
  const char=player.char;
  const idx=char.inventory.findIndex(i=>i.name===itemName);
  if(idx===-1)return false;
  let consumed=true;

  if(itemName==='Healing Draught'){const h=rd(1,6);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} drinks Healing Draught — +<strong>${h}</strong> HP.`,'heal');}
  else if(itemName==='Greater Healing Draught'){const h=rd(2,6);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} drinks Greater Healing — +<strong>${h}</strong> HP.`,'heal');}
  else if(itemName==='Flask of Oil'){if(inCombat&&room.gs.enemy){const dmg=rd(2,6);room.gs.enemy.hp-=dmg;addLog(room,`${player.name} throws Flask of Oil — <strong>${dmg}</strong> fire dmg!`,'spell');if(room.gs.enemy.hp<=0){resolveEnemyDeath(room);return true;}}else{addLog(room,`${player.name} readies Flask of Oil.`,'sys');consumed=false;}}
  else if(itemName==='Fire Jar'){if(inCombat&&room.gs.enemy){const dmg=rd(3,6);room.gs.enemy.hp-=dmg;addLog(room,`${player.name} smashes Fire Jar — <strong>${dmg}</strong> fire dmg!`,'spell');if(room.gs.enemy.hp<=0){resolveEnemyDeath(room);return true;}}else{addLog(room,`${player.name} readies Fire Jar.`,'sys');consumed=false;}}
  else if(itemName==='Lucky Pendant'){char.luckyPendant=true;addLog(room,`${player.name} activates Lucky Pendant — next attack is a CRIT!`,'loot');}
  else if(itemName==='Sharpening Stone'){char.sharpeningStone=true;addLog(room,`${player.name} uses Sharpening Stone — +1d6 dmg this combat!`,'loot');}
  else if(itemName.startsWith('Scroll:')){
    const spell=char.scrollSpells[itemName];
    if(!spell){addLog(room,`${player.name}: scroll crumbles.`,'sys');return false;}
    if(spell.type==='heal'){const[n,s]=spell.dmgDice.split('d').map(Number);const roll=rd(n,s);const amt=roll+4;char.health=Math.min(char.maxHealth,char.health+amt);addLog(room,`${player.name} reads ${itemName} — rolled ${n}d${s}(${roll})+4 = +<strong>${amt}</strong> HP.`,'heal');}
    else if(inCombat&&room.gs.enemy){const[n,s]=spell.dmgDice.split('d').map(Number);const dmg=rd(n,s);room.gs.enemy.hp-=dmg;addLog(room,`${player.name} reads ${itemName} — rolled ${n}d${s} = <strong>${dmg}</strong> dmg!`,'spell');if(room.gs.enemy.hp<=0){resolveEnemyDeath(room);return true;}}
    else{addLog(room,`No valid target.`,'sys');consumed=false;}
  } else {consumed=false;}

  if(consumed){char.inventory[idx].qty--;if(char.inventory[idx].qty<=0)char.inventory.splice(idx,1);}
  return consumed;
}

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
function handleMessage(ws,msg){
  const{type,payload}=msg;
  const ctx=clients.get(ws);

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
    const playerId=uuidv4();
    clients.set(ws,{roomCode:code,playerId});
    room.players.push({id:playerId,ws,name:payload.name||'Player',career:null,char:null,ready:false,connected:true});
    sendTo(ws,{type:'ROOM_JOINED',payload:{code,playerId}});
    broadcastState(code); return;
  }
  if(type==='SELECT_CAREER'){
    if(!ctx)return;const room=rooms.get(ctx.roomCode);if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId);if(!player)return;
    player.career=payload.career;player.char=buildChar(payload.career);player.ready=false;
    broadcastState(ctx.roomCode);return;
  }
  if(type==='PLAYER_READY'){
    if(!ctx)return;const room=rooms.get(ctx.roomCode);if(!room)return;
    const player=room.players.find(p=>p.id===ctx.playerId);if(!player||!player.career)return;
    player.ready=true;
    const connected=room.players.filter(p=>p.connected);
    if(connected.length>=1&&connected.every(p=>p.ready)){
      room.gs.phase='path';
      addLog(room,'⚔ The warband descends into Reikland\'s darkness.');
      showPathChoices(room);
    }
    broadcastState(ctx.roomCode);return;
  }
  if(type==='PLAYER_ACTION'){
    if(!ctx)return;const room=rooms.get(ctx.roomCode);if(!room)return;
    handlePlayerAction(room,ctx.playerId,payload,ws);
    broadcastState(ctx.roomCode);return;
  }
}

function handlePlayerAction(room,playerId,payload,ws){
  const{action,data}=payload;
  const player=room.players.find(p=>p.id===playerId);
  if(!player||!player.char)return;
  const gs=room.gs,char=player.char;

  // ── Any-phase actions ──
  if(action==='VOTE_PATH'){
    if(gs.phase!=='path'||!gs.pathChoices)return;
    gs.pathVotes[playerId]=data.nodeType;
    addLog(room,`${player.name} votes: <strong>${data.nodeType}</strong>.`,'sys');
    const alive=room.players.filter(p=>p.char&&p.char.alive);
    if(alive.every(p=>gs.pathVotes[p.id]))resolvePath(room);
    return;
  }
  if(action==='APPLY_PATH'){if(!char.pendingLevelUp)return;applyNovicePath(char,data.pathId);addLog(room,`${player.name} walks the <strong>${data.pathId}</strong> path.`,'spell');return;}
  if(action==='BUY_ITEM'){handleBuy(room,player,data.itemId);return;}
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
    const opts=char.lootOptions||{};
    char.lootOptions=null;
    if(data.pick==='coins'){
      char.gold+=gs.lootRoom.coins; // coins already halved at generation
      addLog(room,`${player.name} takes the coins — +${gs.lootRoom.coins} silver.`,'loot');
    } else if(data.pick==='consumable'){
      if(opts.consumable==='Spell Scroll'&&opts.scrollSpell){
        const sn=`Scroll: ${opts.scrollSpell.name}`;
        addToInventory(char,sn);char.scrollSpells[sn]=opts.scrollSpell;
        addLog(room,`${player.name} takes ${sn}.`,'loot');
      } else {
        addToInventory(char,opts.consumable);
        addLog(room,`${player.name} takes ${opts.consumable}.`,'loot');
      }
    } else if(data.pick==='weapon'){
      addToInventory(char,opts.weapon.name,opts.weapon);
      addLog(room,`${player.name} takes ${opts.weapon.name} (${opts.weapon.dice}+${opts.weapon.bonus}) — added to inventory.`,'loot');
    } else if(data.pick==='armor'){
      addToInventory(char,opts.armor.name,opts.armor);
      addLog(room,`${player.name} takes ${opts.armor.name} (+${opts.armor.defBonus} Def) — added to inventory.`,'loot');
    } else {
      addLog(room,`${player.name} takes nothing.`,'sys');
    }
    const alive=room.players.filter(p=>p.char&&p.char.alive);
    if(alive.every(p=>gs.lootPicked.includes(p.id))){gs.phase='event';gs.lootRoom=null;addLog(room,'Loot divided. Press onward.','sys');}
    return;
  }
  if(action==='EQUIP_ITEM'){
    // data.inventoryIndex — index into char.inventory
    const idx=data.inventoryIndex;
    if(idx===undefined||idx<0||idx>=char.inventory.length)return;
    const result=equipItem(char,idx);
    if(result) addLog(room,`${player.name}: ${result}.`,'loot');
    return;
  }
  if(action==='PRESS_ONWARD'){
    // Check power restore every 3 depths
    if(gs.depth>0 && gs.depth%3===0 && gs.depth!==gs.lastPowerRestoreDepth){
      gs.lastPowerRestoreDepth=gs.depth;
      restorePower(room,`Depth ${gs.depth} milestone`);
    }
    if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');return;}
    showPathChoices(room);return;
  }
  if(action==='USE_ITEM_OOC'){useItemLogic(room,player,data.itemName,false);return;}

  // ── Combat actions — any alive player, once per round ──
  if(gs.phase!=='combat'||!gs.inCombat)return;
  if(!char.alive)return;
  if(gs.playersActedThisRound.includes(playerId)){sendTo(ws,{type:'ERROR',payload:{msg:'Already acted this round.'}});return;}

  let acted=false;

  if(action==='ATTACK'){
    const rogueBoon = (char.career==='rogue' && gs.roundNumber===1) ? 1 : 0;
    const r=rollAttack(char,gs.enemy,rogueBoon);
    if(r.fumble){addLog(room,`${player.name} fumbles (natural 1)! Attack fails.`,'sys');}
    else if(r.hit){
      gs.enemy.hp-=r.dmg;
      const cl=r.forceCrit?' — Lucky Pendant CRIT!':r.crit?' — CRITICAL HIT!':'';
      addLog(room,`${player.name} ${r.crit?'<strong>CRITS</strong>':'hits'} for <strong>${r.dmg}</strong> dmg (d20:${r.base}${r.boonInfo}+${r.atkMod}=${r.total} vs Def ${gs.enemy.ac})${cl}`,r.crit?'crit':'dmg');
      if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}
    } else {addLog(room,`${player.name} misses (${r.total} vs Def ${gs.enemy.ac}).`,'sys');}
    acted=true;
  }
  else if(action==='CAST_SPELL'){
    const spell=char.knownSpells.find(s=>s.name===data.spellName);if(!spell)return;
    if(spell.rank>0&&char.power-char.castingsUsed<=0){addLog(room,`${player.name}: no castings left.`,'sys');return;}
    if(spell.rank>0)char.castingsUsed++;
    if(spell.heal){
      const[n,s]=spell.dmg.split('d').map(Number);
      const roll=rd(n,s);
      const wilMod=Math.max(0,modVal(char.attrs.wil));  // +1 heal per WIL modifier
      const amt=roll+wilMod;
      const targetPlayer = data.targetId ? room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive) : null;
      const target = targetPlayer ? targetPlayer.char : char;
      const targetName = targetPlayer ? targetPlayer.name : player.name;
      target.health=Math.min(target.maxHealth,target.health+amt);
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — ${n}d${s}(${roll})+${wilMod} WIL = +<strong>${amt}</strong> HP.`,'heal');
    } else {
      const[n,s]=spell.dmg.split('d').map(Number);
      const roll=rd(n,s);
      const intMod=Math.max(0,modVal(char.attrs.int))*2;  // +2 dmg per INT modifier
      const total=roll+intMod;
      gs.enemy.hp-=total;
      addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${n}d${s}(${roll})+${intMod} INT = <strong>${total}</strong> dmg to ${gs.enemy.name}! (${Math.max(0,gs.enemy.hp)}/${gs.enemy.maxHp} HP)`,'spell');
      if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}
    }
    acted=true;
  }
  else if(action==='USE_ITEM_ALLY'){
    // Healing Draught or Greater Healing Draught used on ally
    const targetPlayer=room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive);
    if(!targetPlayer){addLog(room,`${player.name}: target not found.`,'sys');return;}
    const tchar=targetPlayer.char;
    const idx=char.inventory.findIndex(i=>i.name===data.itemName);
    if(idx===-1)return;
    if(data.itemName==='Healing Draught'){
      const h=rd(1,6); tchar.health=Math.min(tchar.maxHealth,tchar.health+h);
      addLog(room,`${player.name} gives a Healing Draught to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');
    } else if(data.itemName==='Greater Healing Draught'){
      const h=rd(2,6); tchar.health=Math.min(tchar.maxHealth,tchar.health+h);
      addLog(room,`${player.name} gives Greater Healing to ${targetPlayer.name} — +<strong>${h}</strong> HP.`,'heal');
    } else { addLog(room,`${player.name}: can't use that on an ally.`,'sys'); return; }
    char.inventory[idx].qty--;
    if(char.inventory[idx].qty<=0) char.inventory.splice(idx,1);
    acted=true;
  }
  else if(action==='USE_TALENT'){
    const t=data.talent;
    if(t==='catchBreath'){if(char.catchBreathUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.catchBreathUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Catch Your Breath — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='nimbleRecovery'){if(char.nimbleUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.nimbleUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Nimble Recovery — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='sharedRecovery'){if(char.sharedUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.sharedUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Shared Recovery — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='spellRecovery'){if(char.spellRecoveryUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.spellRecoveryUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);char.castingsUsed=Math.max(0,char.castingsUsed-1);addLog(room,`${player.name} uses Spell Recovery — +<strong>${h}</strong> HP + 1 casting.`,'spell');}
    acted=true;
  }
  else if(action==='USE_ITEM'){const consumed=useItemLogic(room,player,data.itemName,true);acted=consumed;}
  else if(action==='FLEE'){
    if(gs.enemy&&gs.enemy.threat==='Boss'){addLog(room,`${player.name}: no escape from a boss!`,'dmg');return;}
    const base=d(20),total=base+modVal(char.attrs.agi);
    if(total>=10){const hit=rd(1,4);char.health=Math.max(0,char.health-hit);addLog(room,`${player.name} flees! Takes <strong>${hit}</strong> opportunity dmg.`,'dmg');checkDeath(room,player);gs.inCombat=false;gs.enemy=null;gs.phase='event';gs.playersActedThisRound=[];gs.enemyHasActed=false;addLog(room,'Warband escapes. Press onward.','sys');return;}
    else{addLog(room,`${player.name} fails to flee (${total}<DC10).`,'sys');acted=true;}
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
server.listen(PORT,()=>console.log(`Shadows Over Reikland on port ${PORT}`));
