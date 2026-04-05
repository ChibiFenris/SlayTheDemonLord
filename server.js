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
const modVal = s => s - 10; // simplified: full attr-10, not SotDL's floor((s-10)/2)

function initGameState() {
  return {
    depth:0, inCombat:false, enemy:null, enemies:[], activeEnemyIdx:0, phase:'lobby',
    playersActedThisRound:[], enemyHasActed:false, roundNumber:0, turnOrder:[], activeTurnIdx:0,
    log:[], pathChoices:null, pathVotes:{}, bossNode:false,
    bossCount:0, lootRoom:null, lootPicked:[],
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

// ─── CAREERS ─────────────────────────────────────────────────────────────────
const CAREERS = {
  warrior: { label:'State Soldier',    startAttrs:{str:11,agi:10,int:9,wil:10},  armorDef:3, weaponDmg:'1d6', weaponStr:true,  spellcaster:false },
  rogue:   { label:'Roadwarden',       startAttrs:{str:10,agi:11,int:10,wil:9},  armorDef:1, weaponDmg:'1d6', weaponStr:false, spellcaster:false },
  wizard:  { label:'Bright Wizard',    startAttrs:{str:9,agi:10,int:11,wil:10},  armorDef:0, weaponDmg:'1d6', weaponStr:true,  spellcaster:true,  tradition:'fire' },
  priest:  { label:'Sigmarite Priest', startAttrs:{str:10,agi:9,int:10,wil:11},  armorDef:3, weaponDmg:'1d6', weaponStr:true,  spellcaster:true,  tradition:'life' },
};

// ─── PATHS ───────────────────────────────────────────────────────────────────
// SotDL: Novice path chosen at level 1, Expert at level 3, Master at level 7
const NOVICE_PATHS = {
  warrior: { hpGain:5, power:0, weaponTraining:true,  catchBreath:true,    trickery:false, nimbleRecovery:false, spellRecovery:false, sharedRecovery:false },
  rogue:   { hpGain:3, power:0, weaponTraining:false, catchBreath:false,   trickery:true,  nimbleRecovery:true,  spellRecovery:false, sharedRecovery:false },
  magician:{ hpGain:2, power:1, weaponTraining:false, catchBreath:false,   trickery:false, nimbleRecovery:false, spellRecovery:true,  sharedRecovery:false },
  priest:  { hpGain:4, power:1, weaponTraining:false, catchBreath:false,   trickery:false, nimbleRecovery:false, spellRecovery:false, sharedRecovery:true  },
};

// Full SotDL Expert Paths (level 3–6). All available to all careers.
const EXPERT_PATHS = {
  // Martial
  berserker:   { label:'Berserker',   hpGain:6, power:0,
    levelGains:{ 3:['combatProwess'], 4:['+1str'], 5:['rage'], 6:['+1str'] },
    desc:'Channel battle-rage for +2d6 damage. Cannot be frightened or compelled while berserk.' },
  fighter:     { label:'Fighter',     hpGain:5, power:0,
    levelGains:{ 3:['pacedStrikes'], 4:['+1str'], 5:['combatExpertise'], 6:['+1str'] },
    desc:'Master of arms. Attack with any weapon with 1 boon. Combat Prowess adds damage on every hit.' },
  scout:       { label:'Scout',       hpGain:3, power:0,
    levelGains:{ 3:['quickStep'], 4:['+1agi'], 5:['evasion'], 6:['+1agi'] },
    desc:'Swift skirmisher. Quick Step grants +2 Defense when you miss an attack. Evasion forces 1 bane on all attackers.' },
  thief:       { label:'Thief',       hpGain:3, power:0,
    levelGains:{ 3:['trickery'], 4:['+1agi'], 5:['deathblow'], 6:['+1agi'] },
    desc:'Cunning blade. Trickery adds bonus d6 damage. Deathblow makes crits deal triple weapon dice.' },
  ranger:      { label:'Ranger',      hpGain:4, power:0,
    levelGains:{ 3:['quickstrike'], 4:['+1agi'], 5:['evasion'], 6:['+1str'] },
    desc:'Wilderness hunter. Tracking expertise, extra attack on round 1, and improved evasion.' },
  // Defensive
  defender:    { label:'Defender',    hpGain:5, power:0,
    levelGains:{ 3:['shieldwall'], 4:['+1agi'], 5:['toughness'], 6:['+1str'] },
    desc:'Stalwart protector. Shieldwall grants +2 Defense. Toughness reduces all damage taken by 1.' },
  paladin:     { label:'Paladin',     hpGain:4, power:1,
    levelGains:{ 3:['holyFervor'], 4:['+1str'], 5:['divineSmite'], 6:['+1wil'] },
    desc:'Holy warrior. Holy Fervor grants boon vs undead/chaos. Divine Smite deals +3d6 once per combat.' },
  // Arcane
  evoker:      { label:'Evoker',      hpGain:2, power:1,
    levelGains:{ 3:['darkEvoker'], 4:['+1int'], 5:['metamagic'], 6:['+1int'] },
    desc:'Destructive caster. Dark Evoker boosts dark spells to ×2.5 vs weakness. Metamagic for free casts.' },
  elementalist:{ label:'Elementalist',hpGain:2, power:1,
    levelGains:{ 3:['burningSoul'], 4:['+1int'], 5:['firewall'], 6:['+1wil'] },
    desc:'Fire specialist. Burning Soul adds +1d6 to fire spells. Gains the Firewall area spell.' },
  sorcerer:    { label:'Sorcerer',    hpGain:2, power:1,
    levelGains:{ 3:['lightningIngrained'], 4:['+1int'], 5:['spellRecovery'], 6:['+1int'] },
    desc:'Innate magic. Lightning Ingrained boosts storm spells to ×2.5 vs weakness. Recovers castings on rest.' },
  wizard:      { label:'Wizard',      hpGain:2, power:1,
    levelGains:{ 3:['utilityFocus'], 4:['+1int'], 5:['metamagic'], 6:['+1int'] },
    desc:'Scholarly mage. Utility Focus extends all utility spell durations by 1 round. Metamagic for free casts.' },
  warlock:     { label:'Warlock',     hpGain:2, power:1,
    levelGains:{ 3:['bloodOffering'], 4:['+1int'], 5:['metamagic'], 6:['+1wil'] },
    desc:'Pact-bound caster. Blood Offering sacrifices HP to regain spell castings. Metamagic for free casts.' },
  spellbinder: { label:'Spellbinder', hpGain:3, power:1,
    levelGains:{ 3:['burningSoul'], 4:['+1int'], 5:['combatProwess'], 6:['+1wil'] },
    desc:'Imbues weapons with magic. Burning Soul adds fire damage. Combat Prowess deals +1d6 per hit.' },
  // Divine
  cleric:      { label:'Cleric',      hpGain:4, power:1,
    levelGains:{ 3:['holyFervor'], 4:['+1wil'], 5:['massHeal'], 6:['+1str'] },
    desc:'Champion of the faith. Holy Fervor vs evil, Mass Heal restores all allies each combat.' },
  druid:       { label:'Druid',       hpGain:4, power:1,
    levelGains:{ 3:['sharedRecovery'], 4:['+1wil'], 5:['massHeal'], 6:['+1wil'] },
    desc:'Ancient nature magic. Shared Recovery heals self. Mass Heal heals the whole warband.' },
  oracle:      { label:'Oracle',      hpGain:3, power:1,
    levelGains:{ 3:['holyFervor'], 4:['+1wil'], 5:['divineSmite'], 6:['+1int'] },
    desc:'Divine seer. Prophetic insight. Holy Fervor and Divine Smite channel divine wrath.' },
  witch:       { label:'Witch',       hpGain:2, power:1,
    levelGains:{ 3:['metamagic'], 4:['+1wil'], 5:['massHeal'], 6:['+1int'] },
    desc:'Folk magic practitioner. Curses and hexes. Metamagic and Mass Heal for flexible support.' },
  // Specialist
  assassin:    { label:'Assassin',    hpGain:3, power:0,
    levelGains:{ 3:['deathblow'], 4:['+1agi'], 5:['assassination'], 6:['+1int'] },
    desc:'Lethal precision. Deathblow triples crit dice. Assassination deals +1d6+3 when target is below 50% HP.' },
  zealot:      { label:'Zealot',      hpGain:4, power:1,
    levelGains:{ 3:['holyFervor'], 4:['+1wil'], 5:['divineSmite'], 6:['+1str'] },
    desc:'Righteous fury. Holy Fervor grants boon vs undead/chaos. Divine Smite: +3d6 once per combat.' },
  healer:      { label:'Healer',      hpGain:4, power:1,
    levelGains:{ 3:['massHeal'], 4:['+1wil'], 5:['resurrection'], 6:['+1wil'] },
    desc:'Devoted medic. Mass Heal restores all allies 1d6. Resurrection fully revives a fallen ally.' },
};

// Full SotDL Master Paths (level 7–10). All available to all.
const MASTER_PATHS = {
  // Martial masters
  champion:    { label:'Champion',    hpGain:5, power:0,
    levelGains:{ 7:['warlordAura'], 8:['+1str'], 9:['unstoppable'], 10:['+1str'] },
    desc:'A living legend. Your presence grants allies 1 boon. Survive one killing blow per combat at 1 HP.' },
  warlord:     { label:'Warlord',     hpGain:6, power:0,
    levelGains:{ 7:['rallyingCry'], 8:['+1str'], 9:['sweepingBlow'], 10:['+1agi'] },
    desc:'Battlefield commander. Rallying Cry heals all allies. Sweeping Blow strikes every enemy at once.' },
  avenger:     { label:'Avenger',     hpGain:5, power:0,
    levelGains:{ 7:['combatProwess'], 8:['+1str'], 9:['combatExpertise'], 10:['+1str'] },
    desc:'Vengeance incarnate. Both Combat Prowess and Combat Expertise stack for massive damage per hit.' },
  brute:       { label:'Brute',       hpGain:8, power:0,
    levelGains:{ 7:['unstoppable'], 8:['+1str'], 9:['rallyingCry'], 10:['+1str'] },
    desc:'Unstoppable force. Maximum health and cannot be killed easily. Rallying Cry heals the group.' },
  cavalier:    { label:'Cavalier',    hpGain:5, power:0,
    levelGains:{ 7:['quickstrike'], 8:['+1str'], 9:['sweepingBlow'], 10:['+1agi'] },
    desc:'Mounted warrior. Quick Strike and Sweeping Blow for devastating charges into enemy formations.' },
  myrmidon:    { label:'Myrmidon',    hpGain:5, power:0,
    levelGains:{ 7:['shieldwall'], 8:['+1str'], 9:['toughness'], 10:['+1agi'] },
    desc:'Shield master. Shieldwall and Toughness combine for exceptional resilience in melee.' },
  sentinel:    { label:'Sentinel',    hpGain:5, power:0,
    levelGains:{ 7:['evasion'], 8:['+1agi'], 9:['toughness'], 10:['+1str'] },
    desc:'Guardian of the warband. Evasion and Toughness make you the hardest member to cut down.' },
  // Stealth/ranged masters
  shadowblade: { label:'Shadowblade', hpGain:4, power:0,
    levelGains:{ 7:['phantomStrike'], 8:['+1agi'], 9:['bladestorm'], 10:['+1agi'] },
    desc:'Ghost with a blade. Phantom Strike bypasses armor. Bladestorm makes three attacks per action.' },
  acrobat:     { label:'Acrobat',     hpGain:3, power:0,
    levelGains:{ 7:['evasion'], 8:['+1agi'], 9:['swiftFeet'], 10:['+1agi'] },
    desc:'Nimble and untouchable. Evasion forces 1 bane on attackers. Swift Feet grants 2 boons on all attacks.' },
  executioner: { label:'Executioner', hpGain:3, power:0,
    levelGains:{ 7:['deathblow'], 8:['+1agi'], 9:['phantomStrike'], 10:['+1int'] },
    desc:'Lethal killer. Deathblow (triple crit dice) and Phantom Strike (ignore armor) for maximum lethality.' },
  inquisitor:  { label:'Inquisitor',  hpGain:3, power:0,
    levelGains:{ 7:['holyFervor'], 8:['+1wil'], 9:['deathblow'], 10:['+1str'] },
    desc:'Hunter of heretics. Holy Fervor vs evil, Deathblow for devastating crits against the wicked.' },
  blade:       { label:'Blade',       hpGain:4, power:0,
    levelGains:{ 7:['deathblow'], 8:['+1agi'], 9:['bladestorm'], 10:['+1agi'] },
    desc:'Knife-fighter elite. Precision crits and Bladestorm for multiple devastating rapid strikes.' },
  // Arcane masters
  archmage:    { label:'Archmage',    hpGain:3, power:2,
    levelGains:{ 7:['spellsurge'], 8:['+1int'], 9:['catastrophe'], 10:['+1int'] },
    desc:'Pinnacle of arcane power. Spell Surge for free casting. Catastrophe deals 10d6 to all enemies.' },
  arcanist:    { label:'Arcanist',    hpGain:2, power:1,
    levelGains:{ 7:['utilityFocus'], 8:['+1int'], 9:['metamagic'], 10:['+1int'] },
    desc:'Scholar of the arcane arts. Utility Focus extends all utility spells by 1 round. Metamagic for free casts.' },
  abjurer:     { label:'Abjurer',     hpGain:2, power:1,
    levelGains:{ 7:['shieldwall'], 8:['+1int'], 9:['toughness'], 10:['+1wil'] },
    desc:'Master of Protection magic. Magical shields grant Shieldwall and Toughness defensively.' },
  conjurer:    { label:'Conjurer',    hpGain:2, power:1,
    levelGains:{ 7:['overcast'], 8:['+1int'], 9:['spellsurge'], 10:['+1int'] },
    desc:'Summoner of forces. Overcast for power, Spell Surge to cast without spending a casting.' },
  transmuter:  { label:'Transmuter',  hpGain:2, power:1,
    levelGains:{ 7:['burningSoul'], 8:['+1int'], 9:['overcast'], 10:['+1wil'] },
    desc:'Alters the fabric of reality. Burning Soul and Overcast for amplified arcane destruction.' },
  stormbringer:{ label:'Stormbringer',hpGain:2, power:1,
    levelGains:{ 7:['lightningIngrained'], 8:['+1int'], 9:['catastrophe'], 10:['+1int'] },
    desc:'Commands the Storm tradition. Lightning Ingrained boosts storm spells to ×2.5 vs weakness. Catastrophe for 10d6 to all.' },
  thaumaturge: { label:'Thaumaturge', hpGain:2, power:1,
    levelGains:{ 7:['metamagic'], 8:['+1wil'], 9:['spellsurge'], 10:['+1int'] },
    desc:'Master of Chaos magic. Metamagic and Spell Surge for unpredictable but powerful spellcasting.' },
  // Divine masters
  highpriest:  { label:'High Priest', hpGain:5, power:2,
    levelGains:{ 7:['holyAura'], 8:['+1wil'], 9:['miracleHeal'], 10:['+1wil'] },
    desc:'Bearer of Sigmar\'s grace. Holy Aura grants all allies +2 Defense. Miracle Heal restores full HP.' },
  chaplain:    { label:'Chaplain',    hpGain:4, power:1,
    levelGains:{ 7:['rallyingCry'], 8:['+1wil'], 9:['massHeal'], 10:['+1wil'] },
    desc:'Battlefield spiritual guide. Rallying Cry and Mass Heal keep the warband fighting.' },
  templar:     { label:'Templar',     hpGain:4, power:1,
    levelGains:{ 7:['holyFervor'], 8:['+1str'], 9:['divineSmite'], 10:['+1wil'] },
    desc:'Holy warrior-priest. Holy Fervor vs evil and Divine Smite for righteous melee combat.' },
  exorcist:    { label:'Exorcist',    hpGain:4, power:1,
    levelGains:{ 7:['holyFervor'], 8:['+1wil'], 9:['resurrection'], 10:['+1wil'] },
    desc:'Banisher of daemons. Holy Fervor vs chaos, Resurrection to revive fallen allies.' },
  healer_m:    { label:'Healer (Master)', hpGain:4, power:1,
    levelGains:{ 7:['massHeal'], 8:['+1wil'], 9:['miracleHeal'], 10:['+1wil'] },
    desc:'Supreme healer. Mass Heal for the whole group and Miracle Heal to restore anyone to full HP.' },
  necromancer: { label:'Necromancer', hpGain:2, power:1,
    levelGains:{ 7:['darkEvoker'], 8:['+1int'], 9:['spellsurge'], 10:['+1wil'] },
    desc:'Master of death magic. Dark Evoker boosts dark spells to ×2.5 vs weakness. Spell Surge for free casts.' },
};



// ─── CASTINGS TABLE (PDF p.112) ──────────────────────────────────────────────
// PDF castings by rank. We support ranks 0–3.
// Power: [rank0, rank1, rank2, rank3]
const CASTINGS_TABLE = {
  0:  [1, 0, 0, 0],
  1:  [2, 1, 0, 0],
  2:  [3, 2, 1, 0],
  3:  [4, 2, 1, 1],
  4:  [5, 2, 2, 1],
  5:  [6, 3, 2, 2],
  6:  [7, 3, 2, 2],
  7:  [8, 3, 2, 2],
  8:  [9, 3, 3, 2],
  9:  [10,3, 3, 3],
  10: [11,3, 3, 3],
};

function maxCastings(power, rank) {
  const row = CASTINGS_TABLE[Math.min(power, 10)] || CASTINGS_TABLE[0];
  return row[Math.min(rank, 3)] || 0;
}

// castingPools keyed by spell name: { 'Flame Missile': 3, 'Fireball': 1, ... }
function refreshCastingPools(char) {
  if (!char.castingPools) char.castingPools = {};
  char.knownSpells.forEach(sp => {
    if (char.castingPools[sp.name] === undefined) {
      char.castingPools[sp.name] = maxCastings(char.power, sp.rank);
    }
  });
}

function restoreCastingPools(char) {
  char.castingPools = {};
  char.knownSpells.forEach(sp => {
    char.castingPools[sp.name] = maxCastings(char.power, sp.rank);
  });
}

function castingsLeft(char, spellName, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  const v = char.castingPools[spellName];
  return v !== undefined ? v : maxCastings(char.power, rank);
}

function spendCasting(char, spellName, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  if ((char.castingPools[spellName] || 0) > 0) {
    char.castingPools[spellName]--;
    return true;
  }
  return false;
}

function regainCasting(char, maxRank) {
  // Regain one casting of the lowest-rank spent spell up to maxRank
  if (!char.castingPools) refreshCastingPools(char);
  let bestSpell = null, bestRank = 99;
  char.knownSpells.forEach(sp => {
    if (sp.rank <= maxRank && sp.rank < bestRank) {
      const max = maxCastings(char.power, sp.rank);
      if ((char.castingPools[sp.name] || 0) < max) {
        bestSpell = sp; bestRank = sp.rank;
      }
    }
  });
  if (bestSpell) { char.castingPools[bestSpell.name]++; return bestRank; }
  return -1;
}

// ─── SPELL TRADITIONS ─────────────────────────────────────────────────────────
// Each tradition has spells at ranks 0-3 usable in our combat system.
// Rank 0 = free (no casting spent), Rank 1+ = costs 1 casting.
// Attack spells deal damage (INT mod x2 bonus). Utility spells have special effects.
const TRADITIONS = {
  fire: {
    elemType:'fire',
    label:'Fire',
    spells:[
      {name:'Flame Missile', rank:0, type:'attack', dmg:'1d6',
       desc:'[FIRE ATTACK 0] Fiery missile at one target. 1d6 + INT×2 damage. +1d6 on crit. Free cast.'},
      {name:'Meteor',        rank:1, type:'attack', dmg:'2d6+2',
       desc:'[FIRE ATTACK 1] Fiery stone explodes in 1-yard sphere. 2d6+2 + INT×2 to all in area. Half on Agility save.'},
      {name:'Fiery Volley',  rank:1, type:'attack', dmg:'1d6+1', tripleHit:true,
       desc:'[FIRE ATTACK 2] Three fiery missiles all hit the SAME target. Each: 1d6+1 + INT×2. Three separate rolls.'},
      {name:'Fireball',      rank:2, type:'attack', dmg:'5d6', applyBurn:true,
       desc:'[FIRE ATTACK 3] Globe of fire explodes in 5-yard sphere. 5d6 + INT×2. Half on Agility save. Applies BURN (1d6/round, 2 rounds).'},
      {name:'Immolate',      rank:3, type:'attack', dmg:'4d6', applyBurn:true,
       desc:'[FIRE ATTACK 3] Target smolders and ignites. 4d6 + INT×2. +2d6 on crit. Applies BURN (1d6/round, 2 rounds).'},
    ]
  },
  life: {
    elemType:'holy',
    label:'Life',
    spells:[
      {name:'Minor Healing',    rank:0, type:'heal', dmg:'1d6_wil2',
       desc:'[LIFE UTILITY 0] Touch one creature. Heals 1d6 + WIL×2. Free cast.'},
      {name:'Cure',             rank:1, type:'utility', dmg:'1d6_wil', cure:true,
       desc:'[LIFE UTILITY 1] Remove ALL active debuffs from target. Then heals 1d6 + WIL.'},
      {name:'Light Healing',    rank:1, type:'heal', dmg:'2d6_wil2',
       desc:'[LIFE UTILITY 1] Touch one creature. Heals 2d6 + WIL×2.'},
      {name:'Moderate Healing', rank:2, type:'heal', dmg:'3d6_wil2',
       desc:'[LIFE UTILITY 2] Touch one creature. Heals 3d6 + WIL×2.'},
      {name:'Vitality Burst',   rank:2, type:'heal', dmg:'2d6_wil2_multi', multiTarget:true,
       desc:'[LIFE UTILITY 2] All living allies heal 2d6 + WIL×2 simultaneously.'},
      {name:'Major Healing',    rank:3, type:'heal', dmg:'max',
       desc:'[LIFE UTILITY 3] Touch one creature. Restores it to full HP.'},
    ]
  },
  death: {
    elemType:'dark',
    label:'Death (Necromancy)',
    spells:[
      {name:'Spectral Grasp',   rank:0, type:'attack', dmg:'1d3',
       desc:'[NECROMANCY ATTACK 0] Shadowy hand at one creature. 1d3 + INT×2. Target attacks with 1 bane for 1 round. +1d6 on crit. Free cast.'},
      {name:'Grave Grasp',      rank:1, type:'attack', dmg:'1d6', applyChilled:true,
       desc:'[NECROMANCY ATTACK 1] 1d6 + INT×2 damage. Applies CHILLED (1d3/round, 1 bane on attacks, 2 rounds).'},
      {name:'Bone Splinters',   rank:2, type:'attack', dmg:'3d6', boneSplinters:true,
       desc:'[NECROMANCY ATTACK 2] 3d6 + INT×2. If target is at 25% HP or less after hit: roll d20 — on 10+ target dies instantly.'},
      {name:'Cannibalize Magic',rank:3, type:'attack', dmg:'3d6',
       desc:'[NECROMANCY ATTACK 3] 3d6 + INT×2. Regain one rank 1 casting on hit. On crit: +2d6, regain rank 2 casting.'},
    ]
  },
  shadow: {
    elemType:'dark',
    label:'Shadow',
    spells:[
      {name:'Nightfall Blade',  rank:0, type:'utility', dmg:'0', shadowBlade:true,
       desc:'[SHADOW UTILITY 0] Shadow blade buffs all your weapon attacks with +1d6 damage for 4 rounds. Free cast.'},
      {name:'Shadow Dart',      rank:1, type:'attack', dmg:'2d6',
       desc:'[SHADOW ATTACK 1] Darkness missile. 2d6 + INT×2. +1d6 on crit.'},
      {name:'Shadow Strike',    rank:2, type:'attack', dmg:'2d6', tripleHit:true,
       desc:'[SHADOW ATTACK 2] Strike the SAME target three times. Each: 2d6 + INT×2. Three separate attack rolls.'},
      {name:'Enervation',       rank:3, type:'attack', dmg:'0', healthPenalty:20,
       desc:'[SHADOW ATTACK 3] Reduce target max HP by 20 for the rest of combat. Target also impaired.'},
    ]
  },
  battle: {
    elemType:'arcane',
    label:'Battle',
    spells:[
      {name:'Augmented Attack', rank:0, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[BATTLE ATTACK 0] Your next weapon attack gains +1d6 bonus damage and 1 boon. Free cast.'},
      {name:'Close Wounds',     rank:1, type:'heal', dmg:'1d6_str2',
       desc:'[BATTLE UTILITY 1] Heals 1d6 + STR×2.'},
      {name:'Mighty Attack',    rank:1, type:'utility', dmg:'2d6extra', mightyAtk:true,
       desc:'[BATTLE ATTACK 1] Your next weapon attack gains +2d6 damage AND 2 boons on the attack roll.'},
      {name:'Battle Prowess',   rank:3, type:'utility', dmg:'0', battleProwessSpell:true,
       desc:'[BATTLE UTILITY 3] For 6 rounds: roll attacks twice + take better. +1d6 per attack.'},
    ]
  },
  celestial: {
    elemType:'holy',
    label:'Celestial',
    spells:[
      {name:'Burning Beam',  rank:0, type:'attack', dmg:'1d6',
       desc:'[CELESTIAL ATTACK 0] Fiery beam. 1d6 + INT×2. On crit: target blinded for 1 round. Free cast.'},
      {name:'Flash',         rank:1, type:'attack', dmg:'0', blind:true, applyBlinded:true,
       desc:'[CELESTIAL ATTACK 1] Brilliant flash. Applies BLINDED (3 banes on attacks, 1 round).'},
      {name:'Sunrays',       rank:2, type:'attack', dmg:'1d6', tripleHit:true,
       desc:'[CELESTIAL ATTACK 2] Three blazing beams all hit the SAME target. Each: 1d6 + INT×2.'},
      {name:'Radiation',     rank:3, type:'attack', dmg:'3d6', applyBlinded:true,
       desc:'[CELESTIAL ATTACK 3] 3d6 + WIL×2. Also applies BLINDED (3 banes, 1 round) on hit.'},
    ]
  },
  chaos: {
    elemType:'arcane',
    label:'Chaos',
    spells:[
      {name:'Erratic Bolt',          rank:0, type:'attack', dmg:'1d6', chaosBolt:true,
       desc:'[CHAOS ATTACK 0] 1d6 + INT×2. On hit roll d20 — 12+: deal 2d6 extra chaos damage. Free cast.'},
      {name:'Capricious Devastation',rank:1, type:'attack', dmg:'2d6', chaosBolt:true,
       desc:'[CHAOS ATTACK 1] 2d6 + INT×2. On hit roll d20 — 12+: deal 2d6 extra chaos damage.'},
      {name:'Color of Magic',        rank:2, type:'attack', dmg:'1d6+2', chaosBolt:true,
       desc:'[CHAOS ATTACK 2] 1d6+2 + INT×2. On hit roll d20 — 12+: deal 2d6 extra chaos damage.'},
      {name:'Chaotic Lance',         rank:3, type:'attack', dmg:'4d6', chaosBolt:true,
       desc:'[CHAOS ATTACK 3] 4d6 + INT×2 in a 15-yard line. On hit roll d20 — 12+: deal 2d6 extra chaos damage.'},
    ]
  },
  earth: {
    elemType:'arcane',
    label:'Earth',
    spells:[
      {name:'Earth Spike',   rank:0, type:'attack', dmg:'1d6', prone:true, applyBleed:true,
       desc:'[EARTH ATTACK 0] 1d6+INT×2. Target falls prone. Applies BLEED (1d6/round 2 rounds).'},
      {name:'Stone Blades',  rank:1, type:'attack', dmg:'2d6', bleed:true, applyBleed:true,
       desc:'[EARTH ATTACK 1] 2d6+INT×2 cone. Applies BLEED (1d6/round 2 rounds).'},
      {name:'Avalanche',     rank:2, type:'attack', dmg:'4d6', applyMajorBleed:true,
       desc:'[EARTH ATTACK 2] 4d6+INT×2 area. Applies MAJOR BLEED (2d6/round 2 rounds).'},
      {name:'Eruption',      rank:3, type:'attack', dmg:'5d6', applyMajorBleed:true,
       desc:'[EARTH ATTACK 3] 5d6+INT×2. Targets pushed 1d6 yards. Applies MAJOR BLEED (2d6/round 2 rounds).'},
    ]
  },
  storm: {
    elemType:'lightning',
    label:'Storm',
    spells:[
      {name:'Forked Lightning', rank:0, type:'attack', dmg:'1d6+2', tripleHit:false, doubleHit:true,
       desc:'[STORM ATTACK 0] Hits the SAME target TWICE. Each: 1d6+2+INT×2. Free cast.'},
      {name:'Freezing Fog',    rank:1, type:'attack', dmg:'1d3', slowDebuff:true, applyChilled:true,
       desc:'[STORM ATTACK 1] 1d3+INT×2. Applies CHILLED (1d3/round, 1 bane, 2 rounds).'},
      {name:'Call Lightning',  rank:2, type:'attack', dmg:'3d6+5', stunCheck:true,
       desc:'[STORM ATTACK 2] 3d6+5+INT×2. On hit: d20≥15 = target STUNNED for 1 round (can\'t act).'},
      {name:'Lightning Bolt',  rank:3, type:'attack', dmg:'5d6', lightningDoubleCheck:true,
       desc:'[STORM ATTACK 3] 5d6+INT×2. On hit: d20≥15 = strikes a SECOND time for full damage.'},
    ]
  },
  protection: {
    elemType:'arcane',
    label:'Protection',
    spells:[
      {name:'Force Field',      rank:0, type:'utility', dmg:'0', forceFieldNew:true,
       desc:'[PROTECTION UTILITY 0] Reduce all damage YOU take by 50% for 1 round. Free cast.'},
      {name:'Sanctuary',        rank:1, type:'utility', dmg:'0', sanctuaryNew:true,
       desc:'[PROTECTION UTILITY 1] Reduce all damage ALL PLAYERS take by 50% for 1 round.'},
      {name:'Vigor',            rank:2, type:'utility', dmg:'0', vigorNew:true,
       desc:'[PROTECTION UTILITY 2] Increase YOUR max HP by +10 for the rest of combat.'},
      {name:'Protective Field', rank:3, type:'utility', dmg:'0', protectiveFieldNew:true,
       desc:'[PROTECTION UTILITY 3] ALL players are IMMUNE to damage for 1 round.'},
    ]
  },
  illusion: {
    elemType:'arcane',
    label:'Illusion',
    spells:[
      {name:'Figment',   rank:0, type:'utility', dmg:'0', figmentNew:true,
       desc:'[ILLUSION UTILITY 0] Target enemy makes all attacks with 1 bane for 2 rounds. Free cast.'},
      {name:'Vertigo',   rank:1, type:'utility', dmg:'0', vertigoNew:true,
       desc:'[ILLUSION UTILITY 1] You gain 2 boons against target enemy for 2 rounds.'},
      {name:'Glamer',    rank:2, type:'utility', dmg:'0', glamerNew:true,
       desc:'[ILLUSION UTILITY 2] Target enemy\'s NEXT attack is an automatic miss.'},
      {name:'Phantasm',  rank:3, type:'attack', dmg:'4d6',
       desc:'[ILLUSION ATTACK 3] 4d6+INT×2 psychic damage.'},
    ]
  },
  nature: {
    elemType:'arcane',
    label:'Nature',
    spells:[
      {name:'Oak Hide',        rank:0, type:'utility', dmg:'0', defBonus:2,
       desc:'[NATURE UTILITY 0] +2 Defense for 2 rounds. Free cast.'},
      {name:'Healing Berries', rank:1, type:'heal', dmg:'berries',
       desc:'[NATURE UTILITY 1] Heal 1d3+WIL — triggers THREE times (3 separate heal rolls).'},
      {name:'Shillelagh',      rank:1, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[NATURE UTILITY 1] +1d6 to next weapon attack and +2 Speed.'},
      {name:'Wrath of Nature', rank:3, type:'attack', dmg:'3d6', wrathNature:true,
       desc:'[NATURE ATTACK 3] 3d6+INT×2. Target\'s next TWO attacks have 2 banes each.'},
    ]
  },
  transformation: {
    elemType:'arcane',
    label:'Transformation',
    spells:[
      {name:'Beast Within', rank:0, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[PRIMAL UTILITY 0] +1d6 to next attack + 1 boon on STR. Free cast.'},
      {name:'Dire Beast',   rank:1, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[PRIMAL UTILITY 1] Size+1, attacks deal +1d6 for 1 min.'},
      {name:'Mist Form',    rank:2, type:'utility', dmg:'0', mistFormNew:true,
       desc:'[TRANSFORMATION UTILITY 2] Reduce all damage you take by 50% for 2 rounds.'},
      {name:'Speed Healing',rank:3, type:'heal', dmg:'3d6_wil2',
       desc:'[TRANSFORMATION UTILITY 3] Heal 3d6+WIL×2.'},
    ]
  },
  time: {
    elemType:'arcane',
    label:'Time',
    spells:[
      {name:'Swiftness',       rank:0, type:'utility', dmg:'0', swiftnessNew:true,
       desc:'[TIME UTILITY 0] Your attacks gain +1 boon for 2 rounds. Free cast.'},
      {name:'Rewrite Moment',  rank:1, type:'utility', dmg:'0', rewriteNew:true,
       desc:'[TIME UTILITY 1] For 2 rounds: automatically reroll any missed attacks.'},
      {name:'Minor Paradox',   rank:2, type:'utility', dmg:'0', minorParadoxNew:true,
       desc:'[TIME UTILITY 2] Regain 1 casting of every rank 0–2 spell you know.'},
      {name:'Precognition',    rank:3, type:'utility', dmg:'0', precognitionNew:true,
       desc:'[TIME UTILITY 3] For 2 rounds: all attacks against you have 2 banes, all your attacks have 2 boons.'},
    ]
  },
};

// Helper: get spells up to rank for a power level
function getSpellsForPower(traditionId, power) {
  const t = TRADITIONS[traditionId];
  if (!t) return [];
  // Rank 0 always available; higher ranks require power >= rank
  return t.spells.filter(s => s.rank === 0 || s.rank <= power);
}

// ─── ENEMY POOLS ─────────────────────────────────────────────────────────────
// Enemy roles: Tank=high HP low AC, Striker=high ATK, Hi-AC=low HP high AC, Debuffer=status on hit, Buffer=team buff
const ENEMY_POOLS = {
  low: [
    // SWARM — Pack Instinct: 2+ clanrats alive gives +1 ATK each. Call the Pack coded in fireEnemyTurn.
    {name:'Skaven Clanrat',  type:'Skaven',  threat:'Low', hp:13,ac:11,atk:0,xp:3,gold:[2,8],  tags:['skaven'],
     packInstinct:true},
    // STRIKER — Reckless Charge: round 1 attack has 1 boon +1d6. Bloodgreed: heals 1d6 on kill.
    {name:'Beastman Gor',    type:'Beastmen',threat:'Low', hp:16,ac:12,atk:1,xp:3,gold:[3,10], tags:['beast'],chaos:true,
     recklessCharge:true, bloodgreed:true},
    // TANK — high HP, low AC. Undying: 1-in-6 chance to rise at 1 HP on first death. Weak to blunt (x1.5).
    {name:'Undead Skeleton', type:'Undead',  threat:'Low', hp:18,ac:10,atk:0,xp:3,gold:[0,5],  tags:['undead'],undead:true,
     undying:true, weakToBlunt:true},
    // DEBUFFER — Corroding Bite: on hit target takes -1 to all damage for 1 round.
    {name:'Mutant Thug',     type:'Cultist', threat:'Low', hp:11,ac:13,atk:1,xp:3,gold:[5,15], tags:['chaos'],chaos:true,
     corrodingBite:true},
  ],
  mid: [
    // STRIKER — Frenzied Assault: attacks twice while above 50% HP. Chaos Crit: +1d6 on crits.
    {name:'Chaos Marauder',    type:'Chaos',  threat:'Moderate',hp:32,ac:13,atk:2,xp:5,gold:[10,25],tags:['chaos'],chaos:true,
     frenziedAssault:true, chaosCrit:true},
    // HI-AC STRIKER — AC16 low HP, DR:1. Gutter Fighting: 1 boon on attacks in round 1.
    {name:'Skaven Stormvermin',type:'Skaven', threat:'Moderate',hp:22,ac:16,atk:2,xp:5,gold:[8,20], tags:['skaven'],
     damageReduction:1, gutterFighting:true},
    // TANK — low AC, life leech (1/4), Grave Chill on hit (Chilled debuff 2 rounds).
    {name:'Wight',             type:'Undead', threat:'Moderate',hp:30,ac:11,atk:2,xp:5,gold:[5,15], tags:['undead'],undead:true,lifeLeech:true,
     graveChill:true},
    // DEBUFFER — Virulent Blade: 1 poison stack on hit. Frenzy: ATK->4 below 50% HP.
    {name:'Plague Monk',       type:'Chaos',  threat:'Moderate',hp:22,ac:13,atk:3,xp:5,gold:[5,15], tags:['chaos'],chaos:true,
     virulentBlade:true, frenzyAtk:{threshold:0.5,newAtk:4}},
  ],
  high: [
    // HIGH-AC TANK — DR:2, immune to fire, Brutal Cleave: on crit 50% splash to another player.
    {name:'Chaos Warrior',  type:'Chaos',  threat:'High',hp:45,ac:16,atk:3,xp:8,gold:[15,40],tags:['chaos'],chaos:true,
     damageReduction:2, immuneFire:true, brutalCleave:true},
    // STRIKER — high ATK+4, 50% life leech, Hypnotic Gaze: target has 1 bane next attack. Mist Form: 50% DR at 25% HP once.
    {name:'Vampire Count', type:'Undead', threat:'High',hp:35,ac:14,atk:4,xp:8,gold:[20,60],tags:['undead'],undead:true,lifeLeech:true,
     lifeLeechFrac:0.5, hypnoticGaze:true, mistForm:true},
    // BERSERKER — ignores 2 player Def. Warp-frenzy below 50%: +boon +1d6. Daemonic Ichor: 1d6 fire to all on death.
    {name:'Bloodletter',   type:'Chaos',  threat:'High',hp:38,ac:15,atk:4,xp:8,gold:[25,50],tags:['chaos'],chaos:true,insanityAtk:true,
     ignoresDef:2, frenzyAtk:{threshold:0.5,newAtk:4,boon:true,extraDmg:true}, daemonicIchor:true},
    // BUFFER/SUPPORT — HP 38 (adjusted up). Warlord's Command: +1 ATK all skaven at combat start. Scurry Away: 1 auto-dodge. Poison Blade: 2 stacks on hit.
    {name:'Skaven Warlord',type:'Skaven', threat:'High',hp:38,ac:13,atk:3,xp:8,gold:[10,30],tags:['skaven'],
     warlordCommand:true, scurryAway:true, poisonBlade:4},
  ],
  // Boss 1 — depth 9
  boss1: [
    // MULTI-PHASE: attacks twice, summons clanrats at 60%+30% HP, Skaven Cunning (bane on attackers), Seething Rage at 40%.
    {name:'Skaven Warlord Gnashteeth',type:'Skaven Boss', threat:'Boss',hp:40,ac:15,atk:2,xp:15,gold:[30,80], tags:['skaven'],
     multi:true, skavencunning:true, seethingRage:true, packBoss:true},
    // BRUISER: HP 32 (reduced from 40, DR:2 compensates). Stampede round 1, Bloodlust on kill, DR:2, Bellowing Roar at 50%.
    {name:'Beastlord Kragthor',       type:'Beastmen Boss',threat:'Boss',hp:32,ac:16,atk:2,xp:15,gold:[25,70], tags:['beast'],chaos:true,
     stampede:true, bloodlust:true, damageReduction:2, belowRoar:true},
  ],
  // Boss 2 — depth 19
  boss2: [
    // SUSTAIN: 1/4 leech, crit->Major Bleed, Undeath at 30%, multi attack at 50%.
    {name:'Varghulf',            type:'Undead Boss', threat:'Boss',hp:100,ac:15,atk:4,xp:15,gold:[200,200],tags:['undead'],undead:true,lifeLeech:true,
     lifeLeechFrac:0.25, frenzyMulti:{threshold:0.5}, critMajorBleed:true},
    // TANK BOSS: DR:3, Crushing Blow stun (cooldown 2r), Insanity on hit, Pack Leader.
    {name:'Bonebreaker Ratogre', type:'Skaven Boss', threat:'Boss',hp:95,ac:16,atk:3,xp:15,gold:[200,200],tags:['skaven'],insanityAtk:true,
     damageReduction:3, crushingBlow:true, packLeader:true},
  ],
  // Boss 3 — depth 29
  boss3: [
    // FINAL: regen 1d6/turn, Primordial Roar round 1 (2d6 all), Crushing Tail (bane on hit), DR:2, Extinction Pulse at 30%.
    {name:'Saurian Ancient',type:'Ancient Boss',threat:'Boss',hp:125,ac:15,atk:4,xp:15,gold:[60,150],tags:[],
     regen:true, primordialRoar:true, crushingTail:true, damageReduction:2, extinctionPulse:true},
  ],
};

function enemyDmgDice(threat, isElite, bossCount) {
  if (threat === 'Boss') {
    if (bossCount === 0) return {n:2,s:6,b:0}; // Boss 1: 2d6
    if (bossCount === 1) return {n:3,s:6,b:0}; // Boss 2: 3d6
    return {n:4,s:6,b:0};                       // Boss 3 (Saurian): 4d6
  }
  // Elite: base dice + flat +3 damage bonus added in scaleEnemy
  // Pre-boss-1: normal 1d6, post-boss-1: normal 2d6 (elite same dice, bonus applied separately)
  if (bossCount === 0) return {n:1,s:6,b:0};
  return {n:2,s:6,b:0};
}

function scaleEnemy(tmpl, playerCount, isElite, bossCount) {
  const e = JSON.parse(JSON.stringify(tmpl));
  const bossHpMult = (bossCount > 0 && e.threat !== 'Boss') ? 1.15 : 1.0;
  const bossHpFlat = (bossCount > 0 && e.threat !== 'Boss') ? 10 : 0;
  e.hp = e.maxHp = Math.round(e.hp * (1 + (playerCount-1)*0.65) * bossHpMult) + bossHpFlat;
  e.conditions = []; e.activeDebuffs = []; e.isElite = isElite;
  const dd = enemyDmgDice(e.threat, isElite, bossCount);
  e.dmgNum=dd.n; e.dmgSides=dd.s; e.dmgBonus=dd.b;
  // Elite encounters: +2 ATK, +3 flat damage bonus
  if (isElite && e.threat!=='Boss') {
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
  // Elite: same tier pools as normal — no boss pool for elites
  else if (depth>20) pool=isElite?ENEMY_POOLS.high:ENEMY_POOLS.high;
  else if (depth>10) pool=isElite?ENEMY_POOLS.mid:ENEMY_POOLS.mid;
  else               pool=isElite?ENEMY_POOLS.low:ENEMY_POOLS.low;
  return scaleEnemy(pool[Math.floor(Math.random()*pool.length)], playerCount, isElite, bossCount);
}

// ─── CHARACTER BUILDER ───────────────────────────────────────────────────────
function buildChar(career) {
  const c = CAREERS[career];
  const attrs = {...c.startAttrs};
  const baseDefense = attrs.agi + c.armorDef;
  const startWpn = {id:'w_start_'+uuidv4(),name:'Starting Weapon',dice:'1d6',stat:c.weaponStr?'str':'agi',bonus:0,dmgType:c.weaponStr?'blunt':'slashing',type:'weapon',desc:'1d6 — starting gear'};
  const startArmor = c.armorDef>0 ? {id:'a_start_'+uuidv4(),name:'Starting Armour',defBonus:c.armorDef,type:'armor',desc:`+${c.armorDef} Defense`} : null;
  return {
    career, attrs,
    health:attrs.str, maxHealth:attrs.str,
    defense:baseDefense, baseAgiDef:attrs.agi,
    perception:attrs.int,
    power:0, maxPower:0, castingPools:{}, castingsUsed:0, // castingsUsed kept for compat
    insanity:0, corruption:0, conditions:[], activeBuffs:[],
    inventory:[
      {name:'Healing Draught',qty:2},
      {itemObj:startWpn,name:startWpn.name,qty:1,type:'weapon'},
      ...(startArmor?[{itemObj:startArmor,name:startArmor.name,qty:1,type:'armor'}]:[]),
    ],
    gold:15,
    level:1, xp:0,
    novicePath:null, expertPath:null, masterPath:null,
    pendingLevelUp:false, pendingPathTier:null,  // 'novice'|'expert'|'master'
    // Talents (novice)
    weaponTraining:false, catchBreath:false, catchBreathUsed:false,
    combatProwess:false, combatExpertise:false,
    pacedStrikes:false, pacedStrikesUsed:false,
    rage:false, rageBoon:false,
    quickStep:false,
    bloodOffering:false,
    darkEvoker:false,
    lightningIngrained:false,
    utilityFocus:false,
    assassination:false,
    swiftFeet:false,
    trickery:false, trickeryUsed:false, _trickeryPoisonProc:0, _trickeryFirstHit:false,
    nimbleRecovery:false, nimbleUsed:false,
    spellRecovery:false, spellRecoveryUsed:false,
    sharedRecovery:false, sharedUsed:false,
    // Expert talents
    shieldwall:false, toughness:false,
    quickstrike:false, evasion:false, _quickstrikeUsed:false,
    deathblow:false, shadowstep:false,
    overcast:false, metamagic:false, metamagicUsed:false,
    burningSoul:false, firewall:false,
    holyFervor:false, divineSmite:false, divineSmiteUsed:false,
    massHeal:false, massHealUsed:false, resurrection:false, resurrectionUsed:false,
    // Master talents
    warlordAura:false, unstoppable:false, unstoppableUsed:false,
    rallyingCry:false, rallyingUsed:false, sweepingBlow:false,
    phantomStrike:false, bladestorm:false,
    spellsurge:false, spellsurgeUsed:false, catastrophe:false, metamagicUsed:false,
    holyAura:false, miracleHeal:false, miracleUsed:false,
    // Equipment
    equippedWeapon:startWpn, equippedArmor:startArmor,
    weaponDmgBonus:0, weaponAtkBonus:0,
    traditions:[], scrollSpells:{}, stimulantBoon:0, sharpeningStone:false, luckyPendant:false,
    alive:true,
    spellcaster:c.spellcaster, tradition:c.tradition||null,
    // Spells start empty — granted when traditions are discovered at Level 1 novice pick
    knownSpells:[],
    // Pending spell choices: array of {choices: N} meaning player must make N picks
    pendingSpellChoices:0,
    merchantStock:null, lootOptions:null, pendingRevive:false,
  };
}

const healingRate = char => Math.max(1, Math.floor(char.maxHealth/4));
function talentHeal(char) {
  // 1d6 + highest attribute modifier × 2
  const attrs = char.attrs || {};
  const highestMod = Math.max(0, ...Object.values(attrs).map(v => Math.floor((v-10)/2)));
  return rd(1,6) + highestMod * 2;
}

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
  if (char.swiftFeet) boons+=2;
  if (char.rage&&char.rageBoon) { boons++; } // rage boon — dmg applied on hit, flag cleared there
  if (char.stimulantBoon>0) { boons++; char.stimulantBoon--; }
  if (extraBoons) boons+=extraBoons;
  if (char.holyFervor && enemy && ((enemy.undead||enemy.chaos)||(enemy.tags&&(enemy.tags.includes('undead')||enemy.tags.includes('chaos'))))) boons++; // boon vs undead/chaos
  if (char.warlordAura) boons++; // aura from warlord
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned'))    banes++;
  // Skaven Cunning (Gnashteeth): enemy has skavencunning flag → attacker has 1 bane
  if (enemy && enemy.skavencunning) banes++;
  // Player debuff banes (Hypnotised, Infected, Roared, Prone, Corroded)
  const baneBuff = getBuffVal(char, 'bane');
  if (baneBuff) banes += baneBuff;
  const forceCrit=char.luckyPendant; if(forceCrit) char.luckyPendant=false;
  // Active buff bonuses
  const atkBuff=getBuffVal(char,'atkBoon'); boons+=atkBuff;
  const {base,final}=rollD20boons(boons,banes);
  const fumble=base===1&&!forceCrit, crit=forceCrit||base===20;
  const total=final+atkMod, hit=!fumble&&(crit||total>=enemy.ac||char.phantomStrike);
  let dmg=0, dmgParts=[];
  if (hit) {
    const weapRoll=rd(num,sides);
    const statBonus=Math.max(0,modVal(char.attrs[wpnStat]));
    dmg=weapRoll+statBonus+wpnDmgBonus;
    dmgParts.push(`${num}d${sides}(${weapRoll})`);
    if(statBonus)  dmgParts.push(`+${statBonus} stat`);
    if(wpnDmgBonus)dmgParts.push(`+${wpnDmgBonus} wpn`);
    if (crit)           { const r=rd(num,sides); dmg+=r; dmgParts.push(`+${r} crit`); }
    // Poisoned Blades (formerly Deathblow): +2 poison stacks on hit, +4 on crit — applied after hit resolved
    if (char.combatProwess)   { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} prowess`); }
    if (char.combatExpertise) { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} expertise`); }
    if (char.sharpeningStone) { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} sharpened`); }
    // Trickery: first hit in COMBAT → 5 poison stacks (3+2 bonus). All later hits → 2 stacks.
    // _trickeryFirstHit is combat-scoped (reset on combat start, not per round).
    if (char.trickery) {
      if (!char._trickeryFirstHit) { char._trickeryFirstHit=true; char._trickeryPoisonProc=5; }
      else { char._trickeryPoisonProc=2; }
    }
    const dmgBuff=getBuffVal(char,'dmgBonus'); if(dmgBuff){dmg+=dmgBuff;dmgParts.push(`+${dmgBuff} buff`);}
    const battleProwessBuff=(char.activeBuffs||[]).some(b=>b.battleProwess);
    if(battleProwessBuff){const r=rd(1,6);dmg+=r;dmgParts.push(`+${r} prowess`);}
    // Slashing: ×1.5 vs AC ≤ 14 (light/no armour)
    // Blunt:    ×1.5 vs AC ≥ 16 (heavy armour)
    const wpnType=(wpn&&wpn.dmgType)||'slashing';
    if(enemy){
      if(wpnType==='slashing'&&enemy.ac<=14){ dmg=Math.floor(dmg*1.5); dmgParts.push('×1.5 Slash'); }
      else if(wpnType==='blunt'&&enemy.ac>=16){ dmg=Math.floor(dmg*1.5); dmgParts.push('×1.5 Blunt'); }
      // Brittle Bones (Skeleton): blunt weapons deal x1.5 regardless of AC
      if(wpnType==='blunt'&&enemy.weakToBlunt){ dmg=Math.floor(dmg*1.5); dmgParts.push('×1.5 Blunt (Brittle Bones)'); }
    }
    // Paced Strikes: activated via USE_TALENT — adds +2d6 buff (no auto-trigger)
    const pacedBuff=(char.activeBuffs||[]).find(b=>b.pacedDmg);
    if(pacedBuff){ const pr=rd(2,6);dmg+=pr;dmgParts.push(`+${pr} Paced Strikes`); char.activeBuffs=char.activeBuffs.filter(b=>!b.pacedDmg); char.pacedStrikesUsed=true; }
    // Rage bonus damage on hit
    if(char.rage&&char.rageBoon){ const rb=rd(1,6);dmg+=rb;dmgParts.push(`+${rb} rage`);char.rageBoon=false; } // consume rage proc
    // Assassination: target below 50% HP, +1d6+3 bonus damage
    // Assassination: +1d6+3 dmg if below 50% HP; if above 50%, will add 3 poison stacks (applied after hit)
    // Corroded debuff on player: -1 to damage
    const corrodedBuff=(char.activeBuffs||[]).find(b=>b.dmgPenalty);
    if(corrodedBuff&&dmg>0){ dmg=Math.max(0,dmg-corrodedBuff.dmgPenalty); }
    dmg=Math.max(1,dmg);
  }
  const boonInfo=boons>0?` (${boons} boon)`:banes>0?` (${banes} bane)`:'';
  const wpnLabel=wpn?`${wpn.name} (${wpnDice}+${wpnDmgBonus}) [${(wpn&&wpn.dmgType)||'slashing'}]`:'Unarmed (1d6)';
  return {hit,crit,fumble,base,final,total,dmg,dmgParts,atkMod,boonInfo,forceCrit,wpnLabel};
}

function rollEnemyAttack(enemy, char, hasBoon=false) {
  // Apply active debuffs (bane from Figment/Glamer/Vertigo)
  const baneDebuff=getDebuffVal(enemy,'bane');
  const skipDebuff=(enemy.activeDebuffs||[]).some(d=>d.skipTurn);
  if(skipDebuff){ enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>!d.skipTurn); return {hit:false,crit:false,dmg:0,dmgRoll:0,critRoll:0,total:0,base:0,skipped:true}; }
  // Boon: roll 2d20 take higher. Bane from debuffs reduces roll.
  const evasionBane=char.evasion?1:0;
  const totalBanes=baneDebuff+evasionBane;
  const roll1=d(20);
  const rawBase=hasBoon?Math.max(roll1,d(20)):roll1;
  const boonInfo=hasBoon?' (boon)':baneDebuff>0?` (${baneDebuff} bane)`:totalBanes>0?' (evasion bane)':'';
  const baneRoll=totalBanes>0?Math.max(...Array.from({length:Math.min(totalBanes,4)},()=>d(6))):0;
  const adjBase=totalBanes>0?Math.max(1,rawBase-baneRoll):rawBase;
  const total2=adjBase+enemy.atk, crit2=adjBase===20;
  const hit=adjBase!==1&&(crit2||total2>=char.defense);
  let dmg=0, dmgRoll=0, critRoll=0;
  if (hit) {
    dmgRoll=rd(enemy.dmgNum,enemy.dmgSides);
    dmg=dmgRoll+enemy.dmgBonus;
    if (crit2) { critRoll=rd(enemy.dmgNum,enemy.dmgSides); dmg+=critRoll; }
    if (char.toughness) dmg=Math.max(0,dmg-1);
    dmg=Math.max(1,dmg);
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
  char.activeBuffs=char.activeBuffs.filter(b=>{
    b.duration--;
    if(b.duration<=0){
      if(b.defBonus) char.defense=Math.max(char.baseAgiDef||0, char.defense-b.defBonus);
      if(b.name==='Corroded') char._corroded=false; // allow reapplication next hit
      return false;
    }
    return true;
  });
}
const SELF_TICK_DOTS=new Set(['Bleed','Major Bleed','Burn','Chilled','Grave Grasp']); // Poison uses stack-based system, handled separately
function tickDebuffs(enemy){
  if(!enemy.activeDebuffs) return;
  // Self-ticking DoTs manage their own duration at fire time — skip them here
  enemy.activeDebuffs=enemy.activeDebuffs.filter(d=>{
    if(SELF_TICK_DOTS.has(d.name)) return true; // already ticked at DoT fire
    d.duration--;
    return d.duration>0;
  });
}
function getBuffVal(char, key){ return (char.activeBuffs||[]).filter(b=>b[key]).reduce((s,b)=>s+b[key],0); }
function applyPoison(enemy, stacks, room) {
  enemy._poisonStacks = (enemy._poisonStacks||0) + stacks;
  addLog(room, `☠ ${enemy.name} poisoned — <strong>${enemy._poisonStacks}</strong> stack${enemy._poisonStacks!==1?'s':''} (+${stacks} new)!`, 'spell');
}
function getDebuffVal(enemy, key){ return (enemy.activeDebuffs||[]).filter(d=>d[key]).reduce((s,d)=>s+d[key],0); }

// ─── LEVEL UP & PATHS ────────────────────────────────────────────────────────
// XP thresholds (50% of SotDL base)
const XP_THRESHOLDS = [0,0,10,20,30,34,40,48,58,70,100]; // index 0..10 = levels 0..10
// Lv1=0(start), Lv2=10, Lv3=30(boss1@depth9), Lv10=100(depth27)

function checkLevelUp(char) {
  if (char.level >= 10) return {leveled:false}; // hard cap at level 10
  let newLevel=0;
  for (let i=XP_THRESHOLDS.length-1;i>=0;i--) { if(char.xp>=XP_THRESHOLDS[i]){newLevel=i;break;} }
  newLevel = Math.min(newLevel, 10); // enforce cap
  if (newLevel>char.level) {
    char.level=newLevel;
    // Apply per-level path gains
    applyLevelGains(char, newLevel);
    // Check if we need a path choice
    // Level 1 novice path applied at career select — no pending needed here
    if (newLevel===3&&!char.expertPath) { char.pendingLevelUp=true; char.pendingPathTier='expert'; }
    else if (newLevel===7&&!char.masterPath) { char.pendingLevelUp=true; char.pendingPathTier='master'; }
    else { char.pendingLevelUp=false; }
    // Refresh known spells from all traditions whenever power changes
    if (char.traditions && char.traditions.length) {
      char.traditions.forEach(tId=>{
        const newSpells=getSpellsForPower(tId,char.power);
        newSpells.forEach(sp=>{if(!char.knownSpells.find(k=>k.name===sp.name))char.knownSpells.push({...sp,heal:sp.type==='heal'});});
      });
    }
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
    if (t==='spellsurge'||t==='catastrophe') { char.power+=1; char.maxPower+=1; refreshCastingPools(char); }
    if (t==='holyAura'||t==='miracleHeal')  { char.power+=1; char.maxPower+=1; refreshCastingPools(char); }
  });
}

function applyNovicePath(char, pathId) {
  char.novicePath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  char.pendingSpellChoices=0;
  const np=NOVICE_PATHS[pathId]; if(!np) return;
  char.maxHealth+=np.hpGain; char.health=Math.min(char.health+np.hpGain,char.maxHealth);
  if (np.power) { char.power+=np.power; char.maxPower+=np.power; refreshCastingPools(char); }
  if (np.weaponTraining)  char.weaponTraining=true;
  if (np.catchBreath)     char.catchBreath=true;
  if (np.trickery)        char.trickery=true;
  if (np.nimbleRecovery)  char.nimbleRecovery=true;
  if (np.spellRecovery)   char.spellRecovery=true;
  if (np.sharedRecovery)  char.sharedRecovery=true;
  // Automatically discover the career's starting tradition and grant all eligible spells
  if (char.spellcaster && char.tradition) {
    grantTradition(char, char.tradition);
  }
}

// Discover a tradition and grant all spells up to current Power
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
  // Paths that grant a tradition pick (PDF: Cleric, Druid, Oracle, Paladin, Wizard, Warlock, Sorcerer, Spellbinder, Evoker, Elementalist, Healer, Zealot)
  const pathsWithTradition = ['cleric','druid','oracle','paladin','wizard','warlock','sorcerer','spellbinder','evoker','elementalist','healer','zealot','witch'];
  if (pathsWithTradition.includes(pathId)) {
    // Trigger tradition pick — player picks which tradition to discover
    char.pendingLevelUp=true; char.pendingPathTier='tradition'; char.pendingSpellChoices=1;
  }
  // Elementalist specifically gains Firewall if Fire tradition already known
  if (pathId==='elementalist' && char.traditions.includes('fire')) {
    const fw=TRADITIONS.fire?.spells.find(s=>s.name==='Firewall')||{name:'Firewall',rank:1,type:'attack',dmg:'4d6',desc:'[FIRE ATTACK 1] Wall of fire deals 4d6 + INT×2 damage.'};
    if(!char.knownSpells.find(k=>k.name==='Firewall')) char.knownSpells.push({...fw,heal:false});
  }
}

function applyMasterPath(char, pathId) {
  char.masterPath=pathId; char.pendingLevelUp=false; char.pendingPathTier=null;
  const mp=MASTER_PATHS[pathId]; if(!mp) return;
  char.maxHealth+=mp.hpGain; char.health=Math.min(char.health+mp.hpGain,char.maxHealth);
  if (mp.power) { char.power+=mp.power; char.maxPower+=mp.power; refreshCastingPools(char); }
  if (mp.levelGains&&mp.levelGains[7]) applyTalentList(char, mp.levelGains[7]);
  // Master paths that grant a tradition pick
  const masterWithTradition = ['archmage','arcanist','abjurer','conjurer','transmuter','stormbringer','thaumaturge','highpriest','chaplain','templar','exorcist','healer_m','necromancer'];
  if (masterWithTradition.includes(pathId)) {
    char.pendingLevelUp=true; char.pendingPathTier='tradition'; char.pendingSpellChoices=1;
  }
}


// Get the currently targeted enemy (supports multi-enemy)
function getTargetEnemy(gs) {
  const enemies = gs.enemies || [];
  if(enemies.length>0){
    const idx=Math.min(gs.activeEnemyIdx||0,enemies.length-1);
    return enemies[idx]||enemies[0]||null;
  }
  return gs.enemy||null;
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
    const poolsSpent=p.char.knownSpells&&p.char.knownSpells.some(sp=>(p.char.castingPools||{})[sp.name]<maxCastings(p.char.power,sp.rank));
    if(poolsSpent||p.char.spellRecoveryUsed){ restoreCastingPools(p.char); p.char.spellRecoveryUsed=false; restored=true; }
  });
  if(restored) addLog(room,`✨ ${reason} — all spellcasters regain power.`,'spell');
}

function showPathChoices(room) {
  const gs=room.gs; gs.pathVotes={};
  // Bosses at depth 10, 20, and 30 (final)
  const isBossDepth = (gs.depth===9||gs.depth===19||gs.depth>=29);
  if (isBossDepth) {
    gs.phase='path'; gs.bossNode=true; gs.pathChoices=['boss'];
    const msg = gs.depth>=29
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
  enterNode(room,chosen);
}

function enterNode(room, nodeType) {
  const gs=room.gs; gs.depth++; gs.pathChoices=null; gs.pathVotes={};
  const playerCount=room.players.filter(p=>p.connected&&p.char&&p.char.alive).length;
  if(nodeType==='combat'||nodeType==='elite'||nodeType==='boss') {
    const isBoss=nodeType==='boss', isElite=nodeType==='elite';
    gs.enemies=[];
    gs.activeEnemyIdx=0;
    // Elite encounter: 50% chance = 2 normal enemies instead of 1 elite
    if(isElite && Math.random()<0.5){
      const e1=pickEnemy(gs.depth,false,false,playerCount,gs.bossCount);
      const e2=pickEnemy(gs.depth,false,false,playerCount,gs.bossCount);
      e1.id='e1'; e2.id='e2';
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
    gs.inCombat=true; gs.phase='combat'; gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.roundNumber=1;
    buildTurnOrder(room);
    const _ft=gs.turnOrder[0];
    addLog(room,`--- Round 1 begins --- ${_ft?_ft.name+"'s turn":'Warriors act'} ---`,'sys');
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
      p.char.pacedStrikesUsed=false; p.char.rageBoon=false; p.char.metamagicUsed=false; p.char.overcastUsed=false;
      p.char.trickeryUsed=false; p.char.sharpeningStone=false; p.char.metamagicUsed=false;
      p.char.divineSmiteUsed=false; p.char.massHealUsed=false; p.char.resurrectionUsed=false;
      p.char.unstoppableUsed=false; p.char.rallyingUsed=false; p.char.spellsurgeUsed=false; p.char.miracleUsed=false;
      p.char.conditions=p.char.conditions.filter(c=>c==='Diseased'); p.char.activeBuffs=[];
      addLog(room,`${p.name} recovers ${amt} HP.`,'heal');
    });
    restorePower(room,'Rest site');
    addLog(room,'Rest complete. Press onward.','sys');
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
    const coins=Math.floor((5+Math.floor(Math.random()*46))*0.5);
    gs.lootRoom={coins}; gs.lootPicked=[];
    room.players.forEach(p=>{if(p.char&&p.char.alive) p.char.lootOptions=buildLootOptions(gs.bossCount);});
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
function buildLootOptions(bossCount=0) {
  const useScroll=d(6)>=4;
  const consumable=useScroll?'Spell Scroll':LOOT_CONS_LIST[Math.floor(Math.random()*LOOT_CONS_LIST.length)];
  const scrollSpell=useScroll?SCROLL_SPELLS_LIST[Math.floor(Math.random()*SCROLL_SPELLS_LIST.length)]:null;
  return {consumable,scrollSpell,weapon:genWpn(bossCount),armor:genArmor(bossCount)};
}

// ─── COMBAT FLOW ─────────────────────────────────────────────────────────────
// ─── TURN ORDER SYSTEM ───────────────────────────────────────────────────────

function buildTurnOrder(room) {
  const gs = room.gs;
  const order = [];
  // ALL players first (top to bottom)
  room.players.filter(p => p.char && p.char.alive).forEach(p => {
    order.push({ type: 'player', id: p.id, name: p.name });
  });
  // THEN all enemies (top to bottom)
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

function advanceTurn(room) {
  const gs = room.gs;
  if (!gs.turnOrder) return;
  gs.activeTurnIdx++;
  // Skip dead/disconnected actors
  while (gs.activeTurnIdx < gs.turnOrder.length) {
    const slot = gs.turnOrder[gs.activeTurnIdx];
    if (slot.type === 'player') {
      const p = room.players.find(pl => pl.id === slot.id);
      if (p && p.char && p.char.alive) break;
    } else {
      const e = (gs.enemies || []).find(e => e && (e.id === slot.id || e.name === slot.name) && e.hp > 0);
      if (e) break;
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
        if (!gs.inCombat) return;
        const stillAlive = (gs.enemies || []).find(e => e && (e.id === cur.id || e.name === cur.name) && e.hp > 0);
        if (stillAlive) fireEnemyTurn(room, stillAlive);
        else advanceTurn(room);
        broadcastState(room.code);
      }, 800);
    } else {
      advanceTurn(room); // skip dead enemy
    }
  } else {
    // It's a player's turn — clear them from acted list so they can act again
    gs.playersActedThisRound = gs.playersActedThisRound.filter(id => id !== cur.id);
    addLog(room, `--- ${cur.name}'s turn ---`, 'sys');
    broadcastState(room.code);
  }
}

function endRound(room) {
  const gs = room.gs;
  // Tick player buffs
  room.players.forEach(p => { if (p.char && p.char.alive) tickBuffs(p.char); });
  // Tick enemy debuffs and poison
  (gs.enemies || []).forEach(en => {
    if (!en) return;
    tickDebuffs(en);
    if (en._poisonStacks && en._poisonStacks > 0) {
      en._poisonStacks--;
      if (en._poisonStacks > 0)
        addLog(room, `Poison on ${en.name} fades — ${en._poisonStacks} stack${en._poisonStacks !== 1 ? 's' : ''} remaining.`, 'sys');
      else
        addLog(room, `Poison on ${en.name} cleared.`, 'sys');
    }
  });
  // Call the Pack cooldown
  if (gs.packCooldown > 0) {
    gs.packCooldown--;
    if (gs.packCooldown === 0) addLog(room, 'Call the Pack cooldown lifted.', 'sys');
  }
  gs.playersActedThisRound = [];
  gs.enemyHasActed = false;
  room.players.forEach(p=>{ if(p.char) { p.char._killedThisTurn=false; p.char.trickeryUsed=false; } }); // trickeryUsed still resets for future use; _trickeryFirstHit persists for combat
  gs.roundNumber = (gs.roundNumber || 1) + 1;
  addLog(room, `--- Round ${gs.roundNumber} begins ---`, 'sys');
  // Rebuild turn order for new round
  buildTurnOrder(room);
  if (!gs.turnOrder.length) {
    triggerGameover(room); return;
  }
  const first = gs.turnOrder[0];
  if (first.type === 'enemy') {
    addLog(room, `--- ${first.name}'s turn ---`, 'sys');
    broadcastState(room.code); // show "enemy attacking" before delay
    setTimeout(() => {
      if (!gs.inCombat) return;
      const ae = (gs.enemies || []).find(e => e && (e.id === first.id || e.name === first.name) && e.hp > 0);
      if (ae) fireEnemyTurn(room, ae);
      else advanceTurn(room);
      broadcastState(room.code);
    }, 800);
  } else {
    // First actor is a player — clear them from acted list and announce
    gs.playersActedThisRound = gs.playersActedThisRound.filter(id => id !== first.id);
    addLog(room, `--- ${first.name}'s turn ---`, 'sys');
    broadcastState(room.code);
  }
}

function fireEnemyTurn(room, ae) {
  const gs = room.gs;
  if (!gs.inCombat || !ae || ae.hp <= 0) { advanceTurn(room); return; }

  // Undeath passive
  if (ae.tags && ae.tags.includes('undead') && ae.hp < ae.maxHp * 0.3 && !ae._undeathUsed) {
    ae._undeathUsed = true;
    const h = rd(2, 6);
    ae.hp = Math.min(ae.maxHp, ae.hp + h);
    addLog(room, `Undeath! ${ae.name} surges — heals ${h} HP!`, 'chaos');
  }
  // Regen
  if (ae.regen && ae.hp < ae.maxHp) {
    const r = rd(1, 6); ae.hp = Math.min(ae.maxHp, ae.hp + r);
    addLog(room, `${ae.name} regenerates ${r} HP.`, 'chaos');
  }
  // Poison DoT
  if (ae._poisonStacks && ae._poisonStacks > 0) {
    const pdmg = ae._poisonStacks; // 1 dmg per stack (flat)
    ae.hp = Math.max(0, ae.hp - pdmg);
    addLog(room, `☠ <strong>Poison</strong> (${ae._poisonStacks} stack${ae._poisonStacks!==1?'s':''}) burns ${ae.name} — <strong class="num-dmg">−${pdmg}</strong> dmg → ${ae.name} ${ae.hp}/${ae.maxHp} HP`, 'spell');
    if (ae.hp <= 0) {
      const died = resolveEnemyDeath(room, ae);
      if (died !== false) { advanceTurn(room); return; } // enemy died — turn resolved
      // Undying: enemy rose at 1 HP — continue with their attack turn normally
    }
  }
  // Other DoTs
  const dots = (ae.activeDebuffs || []).filter(d => d.dotDmg);
  for (const dbt of dots) {
    ae.hp = Math.max(0, ae.hp - dbt.dotDmg);
    addLog(room, `${dbt.name} burns ${ae.name} — -${dbt.dotDmg} dmg -> ${ae.hp}/${ae.maxHp} HP`, 'spell');
    if (SELF_TICK_DOTS.has(dbt.name)) dbt.duration--;
    if (ae.hp <= 0) {
      const died = resolveEnemyDeath(room, ae);
      if (died !== false) { advanceTurn(room); return; }
      // Undying: rose at 1 HP — continue
    }
  }
  ae.activeDebuffs = (ae.activeDebuffs || []).filter(d => !(SELF_TICK_DOTS.has(d.name) && d.duration <= 0));
  if (!gs.inCombat) return;

  // Stunned debuff: skip attack
  const stunned = (ae.activeDebuffs || []).find(d => d.skipTurn);
  if (stunned) {
    addLog(room, `${ae.name} is stunned and loses its next action!`, 'sys');
    advanceTurn(room);
    return;
  }

  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) { triggerGameover(room); return; }


  // ── Pre-attack passives ───────────────────────────────────────────────────

  // STAMPEDE (Kragthor): round 1 unavoidable 1d6 to all players
  if (ae.stampede && !ae._stampedeUsed && gs.roundNumber === 1) {
    ae._stampedeUsed = true;
    alive.forEach(p => {
      const dmg = rd(1,6);
      p.char.health = Math.max(0, p.char.health - dmg);
      addLog(room, `🐂 <strong>Stampede!</strong> ${ae.name} charges — <strong class="num-dmg">-${dmg}</strong> unavoidable to ${p.name}!`, 'chaos');
      checkDeath(room, p);
    });
  }
  // PRIMORDIAL ROAR (Saurian): round 1 unavoidable 2d6 to all
  if (ae.primordialRoar && !ae._roarUsed && gs.roundNumber === 1) {
    ae._roarUsed = true;
    alive.forEach(p => {
      const dmg = rd(2,6);
      p.char.health = Math.max(0, p.char.health - dmg);
      addLog(room, `🦎 <strong>Primordial Roar!</strong> ${ae.name} — <strong class="num-dmg">-${dmg}</strong> to ${p.name}!`, 'chaos');
      checkDeath(room, p);
    });
    if (!room.players.filter(p=>p.char&&p.char.alive).length) { triggerGameover(room); return; }
  }
  // WARLORD'S COMMAND (Skaven Warlord): +1 ATK all skaven at first action
  if (ae.warlordCommand && !ae._commandUsed) {
    ae._commandUsed = true;
    (gs.enemies||[]).forEach(e => { if(e&&e!==ae&&e.tags&&e.tags.includes('skaven')&&e.hp>0){e.atk=(e.atk||0)+1;} });
    addLog(room, `⚔ <strong>Warlord's Command!</strong> ${ae.name} rallies the skaven — all skaven +1 ATK!`, 'chaos');
  }
  // PACK INSTINCT (Clanrat): 2+ alive skaven → +1 ATK dynamically
  if (ae.packInstinct) {
    const skavenCount = (gs.enemies||[]).filter(e=>e&&e.hp>0&&e.tags&&e.tags.includes('skaven')).length;
    ae._packBonus = skavenCount >= 2 ? 1 : 0;
  }
  // SEETHING RAGE (Gnashteeth): below 40% HP → boon + extra d6 on attacks
  if (ae.seethingRage && !ae._rageActive && ae.hp < ae.maxHp * 0.4) {
    ae._rageActive = true;
    addLog(room, `😡 <strong>Seething Rage!</strong> ${ae.name} erupts — +1 boon and +1d6 on all attacks!`, 'chaos');
  }
  // EXTINCTION PULSE (Saurian): once below 30% — 2d6 all + Blind all 1 round
  if (ae.extinctionPulse && !ae._pulseUsed && ae.hp < ae.maxHp * 0.3) {
    ae._pulseUsed = true;
    alive.forEach(p => {
      const dmg = rd(2,6);
      p.char.health = Math.max(0, p.char.health - dmg);
      addBuff(p.char, 'Blinded', {bane:3}, 1);
      addLog(room, `💥 <strong>Extinction Pulse!</strong> <strong class="num-dmg">-${dmg}</strong> + Blinded to ${p.name}!`, 'chaos');
      checkDeath(room, p);
    });
    addLog(room, `💥 Extinction Pulse fades... (1-round Blind on all warriors)`, 'sys');
  }
  // MIST FORM (Vampire): 50% DR once below 25% HP
  if (ae.mistForm && !ae._mistUsed && ae.hp < ae.maxHp * 0.25) {
    ae._mistUsed = true;
    if(!ae.activeDebuffs) ae.activeDebuffs=[];
    ae.activeDebuffs.push({name:'Mist Form',damageReduction:0.5,duration:1});
    addLog(room, `🌫 <strong>Mist Form!</strong> ${ae.name} — 50% damage reduction for 1 round!`, 'chaos');
  }
  // BELLOWING ROAR (Kragthor): below 50% HP → all players 1 bane next attack (once)
  if (ae.belowRoar && !ae._roarActive && ae.hp < ae.maxHp * 0.5) {
    ae._roarActive = true;
    room.players.filter(p=>p.char&&p.char.alive).forEach(p => { addBuff(p.char,'Roared',{bane:1},1); });
    addLog(room, `🐂 <strong>Bellowing Roar!</strong> All warriors have 1 bane on next attack!`, 'chaos');
  }
  // FRENZY ATK (Plague Monk, Bloodletter): ATK increases below threshold
  if (ae.frenzyAtk && ae.hp < ae.maxHp * ae.frenzyAtk.threshold && !ae._frenzyActive) {
    ae._frenzyActive = true;
    addLog(room, `😤 <strong>Frenzy!</strong> ${ae.name} enters a frenzied state!`, 'chaos');
  }
  // CRUSHING BLOW cooldown tick
  if (ae._crushCooldown > 0) ae._crushCooldown--;

  // ── Determine attack multiplier ───────────────────────────────────────────
  const frenziedDouble  = ae.frenziedAssault && ae.hp > ae.maxHp * 0.5;
  const frenzyMultiDouble = ae.frenzyMulti && ae.hp < ae.maxHp * (ae.frenzyMulti.threshold||0.5);
  const baseAttacks = (ae.multi || frenziedDouble || frenzyMultiDouble) ? 2 : 1;
  const gutterBoon  = ae.gutterFighting && gs.roundNumber === 1;

  // ── Attack loop ───────────────────────────────────────────────────────────
  alive.forEach(p => {
    const auraBonus  = room.players.some(q=>q.char&&q.char.alive&&q.char.holyAura)?2:0;
    const shieldBonus = p.char.shieldwall ? 2 : 0;
    const ignoresDef  = ae.ignoresDef || 0;
    const defTotal    = Math.max(10, p.char.defense + auraBonus + shieldBonus - ignoresDef);

    for (let atk_i = 0; atk_i < baseAttacks; atk_i++) {
      if (!p.char.alive) break;

      const atkBase  = ae._frenzyActive && ae.frenzyAtk ? ae.frenzyAtk.newAtk : ae.atk;
      const atkBonus = ae._packBonus || 0;
      const hasExtraBoon = gutterBoon || ae._rageActive || (ae._frenzyActive && ae.frenzyAtk && ae.frenzyAtk.boon);
      const aeProxy = {...ae, atk: atkBase + atkBonus};

      // RECKLESS CHARGE (Gor): round 1 first attack gets boon + will add d6 via chaosCrit-like flag
      const recklessBoon = ae.recklessCharge && !ae._recklessUsed && gs.roundNumber === 1;
      if (recklessBoon && atk_i === 0) ae._recklessUsed = true;

      // SCURRY AWAY (Skaven Warlord): once per combat, 40% chance to auto-dodge one attack
      // Roll once for the whole turn (not per-player) then consume
      if (ae.scurryAway && !ae._scurryUsed) {
        if (!ae._scurryRolled) { ae._scurryRolled = true; ae._scurryDodging = Math.random() < 0.4; }
        if (ae._scurryDodging) {
          ae._scurryUsed = true; ae._scurryDodging = false;
          addLog(room, `💨 <strong>Scurry Away!</strong> ${ae.name} vanishes — attack missed!`, 'chaos');
          continue;
        }
      }

      const r = rollEnemyAttack(aeProxy, {...p.char, defense: defTotal}, hasExtraBoon || recklessBoon);

      if (r.hit) {
        let dmg = r.dmg;
        // Bonus damage sources
        if (ae.chaosCrit && r.crit)                                  { dmg += rd(1,6); }
        if (ae.recklessCharge && recklessBoon)                        { dmg += rd(1,6); }
        if (ae._frenzyActive && ae.frenzyAtk && ae.frenzyAtk.extraDmg){ dmg += rd(1,6); }
        if (ae._rageActive)                                           { dmg += rd(1,6); }
        // Mist Form damage reduction on enemy
        const mistDR = (ae.activeDebuffs||[]).find(d=>d.name==='Mist Form');
        if (mistDR) dmg = Math.floor(dmg * (1 - mistDR.damageReduction));
        // Player immunity/DR buffs
        const isImmune = (p.char.activeBuffs||[]).some(b=>b.immune);
        const drBuff   = (p.char.activeBuffs||[]).find(b=>b.damageReduction);
        if (isImmune)  { dmg = 0; addLog(room, `🛡 ${p.name} is IMMUNE — blocked!`, 'spell'); }
        else if (drBuff){ dmg = Math.floor(dmg * (1 - drBuff.damageReduction)); }
        // Beast rage
        if (ae.tags && ae.tags.includes('beast') && ae.hp < ae.maxHp * 0.5) { dmg += 3; }

        p.char.health = Math.max(0, p.char.health - dmg);
        const critLabel = r.crit ? ' 💥 CRIT!' : '';
        const dmgBreak  = `${ae.dmgNum}d${ae.dmgSides}(${r.dmgRoll})${ae.dmgBonus?'+'+ae.dmgBonus:''}${r.critRoll?'+'+r.critRoll+' crit':''}`;
        addLog(room, `${ae.name} hits <strong>${p.name}</strong> — <strong class="num-dmg">-${dmg} dmg</strong>${critLabel} [d20:<strong>${r.base}</strong>+atk<strong>${aeProxy.atk>=0?'+':''}${aeProxy.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${defTotal}</strong>] [${dmgBreak}] → ${p.name} <strong>${p.char.health}</strong>/${p.char.maxHealth} HP`, 'dmg-taken');

        // ── On-hit abilities ──────────────────────────────────────────────
        // Life leech
        if (ae.lifeLeech) {
          const frac = ae.lifeLeechFrac || 0.25;
          if (ae.lifeLeechFrac && ae.lifeLeechFrac <= 0.25) { ae._leechAccum = (ae._leechAccum||0) + dmg; } // accumulate leech for sustain-type (Varghulf)
          else { const l = Math.floor(dmg * frac); ae.hp = Math.min(ae.maxHp, ae.hp+l); addLog(room, `🩸 ${ae.name} leeches <strong>${l}</strong> HP.`, 'chaos'); }
        }
        // Insanity
        if (ae.insanityAtk && d(6) >= 4) { p.char.insanity++; addLog(room, `${p.name} gains 1 Insanity!`, 'chaos'); }
        // Grave Chill (Wight)
        if (ae.graveChill) { addBuff(p.char,'Chilled',{bane:1},2); addLog(room, `❄ <strong>Grave Chill!</strong> ${p.name} is Chilled — 1 bane on attacks for 2 rounds!`, 'spell'); }
        // Corroding Bite (Mutant Thug): -1 dmg debuff on player
        if (ae.corrodingBite && !p.char._corroded) { p.char._corroded=true; addBuff(p.char,'Corroded',{dmgPenalty:1},1); addLog(room, `🟢 <strong>Corroding Bite!</strong> ${p.name} weakened — -1 damage for 1 round!`, 'chaos'); }
        // Virulent Blade (Plague Monk): 1 bane on player's next 2 attacks
        if (ae.virulentBlade) { addBuff(p.char,'Infected',{bane:1},2); addLog(room, `☠ <strong>Virulent Blade!</strong> ${p.name} infected — 1 bane on next 2 attacks!`, 'chaos'); applyPoison(ae, 2, room); addLog(room, `☠ Virulent Blade applies 2 poison stacks on ${ae.name}!`, 'spell'); }
        // Hypnotic Gaze (Vampire): 1 bane on target's next attack
        if (ae.hypnoticGaze) { addBuff(p.char,'Hypnotised',{bane:1},1); addLog(room, `👁 <strong>Hypnotic Gaze!</strong> ${p.name} entranced — 1 bane on next attack!`, 'chaos'); }
        // Crushing Tail (Saurian): 1 bane on target's next attack
        if (ae.crushingTail) { addBuff(p.char,'Prone',{bane:1},1); addLog(room, `🦎 <strong>Crushing Tail!</strong> ${p.name} knocked down — 1 bane on next attack!`, 'chaos'); }
        // Crushing Blow (Ratogre): stun on hit, 2-round cooldown
        if (ae.crushingBlow && !ae._crushCooldown) { ae._crushCooldown=2; addBuff(p.char,'Stunned',{skipTurn:true},1); addLog(room, `💥 <strong>Crushing Blow!</strong> ${p.name} is STUNNED and loses their next action!`, 'chaos'); }
        // Brutal Cleave (Chaos Warrior): crit splashes 50% to another player
        if (ae.brutalCleave && r.crit) {
          const others = alive.filter(o=>o!==p&&o.char&&o.char.alive);
          if (others.length) { const splash=Math.floor(dmg*0.5); others[0].char.health=Math.max(0,others[0].char.health-splash); addLog(room, `⚔ <strong>Brutal Cleave!</strong> ${others[0].name} takes <strong class="num-dmg">-${splash}</strong> splash!`, 'chaos'); checkDeath(room,others[0]); }
        }
        // Crit Major Bleed (Varghulf)
        if (ae.critMajorBleed && r.crit) { addDebuff(ae,'Major Bleed',{dotDmg:rd(2,6)},2); addLog(room, `🩸🩸 <strong>Frenzied Rending!</strong> Major Bleed on ${p.name}!`, 'chaos'); }
        // Poison Blade (Skaven Warlord)
        // Poison Blade: bane on player + poison stacks on the warlord (DoT system proxy for player poison)
        if (ae.poisonBlade) { addBuff(p.char,'Poisoned',{bane:1},2); applyPoison(ae,ae.poisonBlade,room); addLog(room,`☠ <strong>Poison Blade!</strong> ${p.name} is poisoned — 1 bane on next 2 attacks + ${ae.poisonBlade} poison stacks!`,'chaos'); }
        // Bloodlust (Kragthor): on kill, bonus attack on another player
        if (ae.bloodlust && p.char.health <= 0) {
          const next = alive.filter(o=>o!==p&&o.char&&o.char.alive);
          if (next.length) { const r3=rollEnemyAttack(ae,next[0].char); if(r3.hit){next[0].char.health=Math.max(0,next[0].char.health-r3.dmg); addLog(room,`🩸 <strong>Bloodlust!</strong> ${ae.name} charges ${next[0].name} — <strong class="num-dmg">-${r3.dmg}</strong>!`,'chaos'); checkDeath(room,next[0]);} }
        }
        // Player rage
        if (p.char.rage && dmg > 0 && !p.char.rageBoon) { p.char.rageBoon=true; addLog(room,`🔥 ${p.name} RAGES — next attack +1 boon +1d6!`,'crit'); }
        checkDeath(room, p);

      } else {
        if (!r.skipped) addLog(room, `${ae.name} <em>misses</em> <strong>${p.name}</strong> — d20:<strong>${r.base}</strong>+atk<strong>${aeProxy.atk>=0?'+':''}${aeProxy.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${defTotal}</strong>.`, 'sys');
      }
    }
  });

  // ── Post-attack ───────────────────────────────────────────────────────────
  // Varghulf accumulated leech
  if (ae._leechAccum > 0) {
    const l = Math.floor(ae._leechAccum * (ae.lifeLeechFrac||0.25));
    ae.hp = Math.min(ae.maxHp, ae.hp+l);
    addLog(room, `🩸 ${ae.name} leeches <strong>${l}</strong> HP.`, 'chaos');
    ae._leechAccum = 0;
  }
  // Bloodgreed (Gor): heals 1d6 if a player died this turn
  if (ae.bloodgreed && room.players.some(p=>p.char&&p.char._killedThisTurn)) {
    const h=rd(1,6); ae.hp=Math.min(ae.maxHp,ae.hp+h);
    addLog(room, `🩸 <strong>Bloodgreed!</strong> ${ae.name} heals <strong>${h}</strong> HP!`, 'chaos');
  }
  // Pack Boss (Gnashteeth): summon clanrats at 60% and 30%
  if (ae.packBoss) {
    const ratio = ae.hp / ae.maxHp;
    // Check 60% first (higher threshold) then 30% so both can trigger in sequence
    const threshold = ratio < 0.6 && !ae._pack60 ? '_pack60' : ratio < 0.3 && !ae._pack30 ? '_pack30' : null;
    if (threshold && gs.enemies && gs.enemies.length < 5) {
      ae[threshold] = true;
      const clanrat = scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:0,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
        room.players.filter(p=>p.connected&&p.char&&p.char.alive).length, false, gs.bossCount);
      clanrat.id='pack_'+Date.now(); gs.enemies.push(clanrat);
      addLog(room, `🐀 <strong>Call the Pack!</strong> ${ae.name} summons a Skaven Clanrat!`, 'chaos');
    }
  }
  // Regular Call the Pack (non-boss skaven)
  if (!ae.packBoss && ae.tags&&ae.tags.includes('skaven')&&ae.hp<ae.maxHp*0.6&&!(gs.packCooldown>0)&&gs.enemies&&gs.enemies.length<4) {
    gs.packCooldown=3;
    const clanrat=scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:13,ac:11,atk:0,xp:0,gold:[0,0],tags:['skaven'],packInstinct:true},
      room.players.filter(p=>p.connected&&p.char&&p.char.alive).length,false,gs.bossCount);
    clanrat.id='pack_'+Date.now(); gs.enemies.push(clanrat);
    addLog(room, `🐀 <strong>Call the Pack!</strong> ${ae.name} summons a Skaven Clanrat! (3-round cooldown)`, 'chaos');
  }
  // Pack Leader (Ratogre): +2 ATK to all skaven — applied once on Ratogre's first turn
  if (ae.packLeader && !ae._packLeaderApplied) {
    ae._packLeaderApplied = true;
    (gs.enemies||[]).forEach(e=>{ if(e&&e!==ae&&e.tags&&e.tags.includes('skaven')&&e.hp>0){ e.atk=(e.atk||0)+2; } });
    addLog(room, `🐀 <strong>Pack Leader!</strong> ${ae.name} — all skaven allies gain +2 ATK!`, 'chaos');
  }
  const nowAlive = room.players.filter(p => p.char && p.char.alive);
  if (!nowAlive.length) { triggerGameover(room); return; }
  room.players.forEach(p => { if (p.char && !p.char.alive) p.char.pendingRevive = true; });


  advanceTurn(room);
}

function allPlayersActed(room) {
  const alive=room.players.filter(p=>p.char&&p.char.alive);
  return alive.length>0&&alive.every(p=>room.gs.playersActedThisRound.includes(p.id));
}

function maybeEnemyAttack(room) {
  if(!allPlayersActed(room)) return;
  const gs=room.gs;
  if(gs.enemyHasActed||!gs.inCombat) return;
  // Ensure gs.enemy is up to date (may have changed if first enemy died to DoT)
  if(!gs.enemy&&gs.enemies&&gs.enemies.length>0){
    gs.enemy=gs.enemies.find(e=>e&&e.hp>0)||null;
  }
  if(!gs.enemy) return;
  gs.enemyHasActed=true;
  const e=gs.enemy;
  const attackingEnemies=(gs.enemies&&gs.enemies.length>0)
    ? gs.enemies.filter(ae=>ae&&ae.hp>0)
    : [e];

  addLog(room,`--- ${attackingEnemies.map(ae=>ae.name).join(' & ')} retaliates! ---`,'sys');

  // Regen on all living enemies + passive checks
  attackingEnemies.forEach(ae=>{
    // UNDEATH passive (undead tag): below 30% HP, heal 2d6 once per combat
    if(ae.tags&&ae.tags.includes('undead')&&ae.hp>0&&ae.hp<ae.maxHp*0.3&&!ae._undeathUsed){
      ae._undeathUsed=true;
      const heal=rd(2,6);
      ae.hp=Math.min(ae.maxHp,ae.hp+heal);
      addLog(room,`☠ <strong>Undeath!</strong> ${ae.name} surges with dark energy — heals <strong>${heal}</strong> HP!`,'chaos');
    }
  });
  attackingEnemies.forEach(ae=>{
    if(ae.regen&&ae.hp<ae.maxHp){const r=rd(1,6);ae.hp=Math.min(ae.maxHp,ae.hp+r);addLog(room,`${ae.name} regenerates ${r} HP.`,'chaos');}
  });

  // Apply Poison stacks at start of enemy turn (1d3 per stack)
  (gs.enemies||[]).filter(ae=>ae&&ae.hp>0).forEach(ae=>{
    if(ae._poisonStacks&&ae._poisonStacks>0){
      const poisonDmg=ae._poisonStacks; // 1 dmg per stack (flat)
      ae.hp=Math.max(0,ae.hp-poisonDmg);
      addLog(room,`☠ <strong>Poison</strong> (${ae._poisonStacks} stack${ae._poisonStacks!==1?'s':''}) burns ${ae.name} — <strong class="num-dmg">−${poisonDmg}</strong> dmg → ${ae.name} ${ae.hp}/${ae.maxHp} HP`,'spell');
      if(ae.hp<=0){resolveEnemyDeath(room,ae);}
    }
  });
  if(!gs.inCombat) return;

  // Apply DoT debuffs on all active enemies at start of enemy turn
  (gs.enemies||[]).filter(ae=>ae&&ae.hp>0).forEach(ae=>{
    (ae.activeDebuffs||[]).filter(d=>d.dotDmg).forEach(d=>{
      ae.hp=Math.max(0,ae.hp-d.dotDmg);
      addLog(room,`${d.name==='Burn'?'🔥':d.name==='Chilled'?'❄':d.name==='Bleed'?'🩸':d.name==='Major Bleed'?'🩸🩸':'☠'} <strong>${d.name}</strong> burns ${ae.name} — <strong class="num-dmg">−${d.dotDmg}</strong> dmg → ${ae.name} ${ae.hp}/${ae.maxHp} HP`,'spell');
      // Bleed/MajorBleed tick their own duration here (start of enemy turn), not at round end
      if(d.name==='Bleed'||d.name==='Major Bleed'||d.name==='Burn'||d.name==='Chilled'||d.name==='Grave Grasp') d.duration--;
      if(ae.hp<=0){resolveEnemyDeath(room,ae);}
    });
    // Remove expired self-ticking debuffs
    ae.activeDebuffs=(ae.activeDebuffs||[]).filter(d=>!(
      (d.name==='Bleed'||d.name==='Major Bleed'||d.name==='Burn'||d.name==='Chilled'||d.name==='Grave Grasp')&&d.duration<=0
    ));
  });
  // If DoT killed all enemies, combat is over — bail
  if(!gs.inCombat) return;

  // Rebuild after DoTs — some enemies may have died
  const stillAliveEnemies=(gs.enemies&&gs.enemies.length>0)
    ? gs.enemies.filter(ae=>ae&&ae.hp>0)
    : (gs.enemy&&gs.enemy.hp>0?[gs.enemy]:[]);
  if(stillAliveEnemies.length===0) return;

  const alive=room.players.filter(p=>p.char&&p.char.alive);
  if(alive.length===0){triggerGameover(room);return;}

  // Each living enemy attacks each player
  stillAliveEnemies.forEach(ae=>{
    if(stillAliveEnemies.length>1) addLog(room,`▸ <strong>${ae.name}</strong> attacks!`,'sys');
    alive.forEach(p=>{
      const auraBonus=room.players.some(q=>q.char&&q.char.alive&&q.char.holyAura)?2:0;
      const shieldBonus=p.char.shieldwall?2:0;
      const r=rollEnemyAttack(ae,{...p.char,defense:p.char.defense+auraBonus+shieldBonus});
      if(r.hit){
        // Apply damage reduction / immunity buffs
        let actualDmg=r.dmg;
        const isImmune=(p.char.activeBuffs||[]).some(b=>b.immune);
        const drBuff=(p.char.activeBuffs||[]).find(b=>b.damageReduction);
        if(isImmune){ actualDmg=0; addLog(room,`🛡 ${p.name} is IMMUNE — damage blocked!`,'spell'); }
        else if(drBuff){ actualDmg=Math.floor(actualDmg*(1-drBuff.damageReduction)); addLog(room,`🛡 ${p.name} takes 50% damage — ${r.dmg}→${actualDmg}!`,'spell'); }
        p.char.health=Math.max(0,p.char.health-actualDmg);
        const critLabel=r.crit?' 💥 CRIT!':'';
        const dmgBreak=`${ae.dmgNum}d${ae.dmgSides}(${r.dmgRoll})${ae.dmgBonus?'+'+ae.dmgBonus:''}${r.critRoll?'+'+r.critRoll+' crit':''}`;
        addLog(room,`${ae.name} hits <strong>${p.name}</strong> — <strong class="num-dmg">−${actualDmg} dmg</strong>${critLabel} [d20:<strong>${r.base}</strong>+atk<strong>${ae.atk>=0?'+':''}${ae.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${p.char.defense+auraBonus+shieldBonus}</strong>] [dmg: ${dmgBreak}] → ${p.name} <strong>${p.char.health}</strong>/${p.char.maxHealth} HP`,'dmg-taken');
        if(ae.lifeLeech){
          const isAccumLeech=ae.lifeLeechFrac&&ae.lifeLeechFrac<=0.25;
          if(isAccumLeech){
            ae._leechAccum=(ae._leechAccum||0)+actualDmg; // accumulate for end-of-turn resolve
          } else {
            const l=Math.floor(r.dmg/4); ae.hp=Math.min(ae.maxHp,ae.hp+l);
            addLog(room,`${ae.name} leeches ${l} HP (¼)!`,'chaos');
          }
        }
        if(ae.insanityAtk&&d(6)>=4){p.char.insanity++;addLog(room,`${p.name} gains 1 Insanity!`,'chaos');}
        // Rage passive: on taking damage, next attack has +1 boon and +1d6 damage
        if(p.char.rage&&actualDmg>0&&!p.char.rageBoon){ p.char.rageBoon=true; addLog(room,`🔥 ${p.name} RAGES — next attack +1 boon +1d6!`,'crit'); }
        checkDeath(room,p);
      } else {
        if(!r.skipped) addLog(room,`${ae.name} <em>misses</em> <strong>${p.name}</strong> — d20:<strong>${r.base}</strong>+atk<strong>${ae.atk>=0?'+':''}${ae.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${p.char.defense+auraBonus+shieldBonus}</strong>.`,'sys');
      }
    });
    // CALL THE PACK (skaven tag): below 60% HP, shared 2-round cooldown across all skaven
    if(ae.tags&&ae.tags.includes('skaven')&&ae.hp<ae.maxHp*0.6&&!(gs.packCooldown>0)&&gs.enemies&&gs.enemies.length<4){
      gs.packCooldown=3; // blocks all skaven from calling for 2 rounds
      const clanrat=scaleEnemy({name:'Skaven Clanrat',type:'Skaven',threat:'Low',hp:15,ac:12,atk:0,xp:0,gold:[0,0],tags:['skaven']},
        room.players.filter(p=>p.connected&&p.char&&p.char.alive).length,false,gs.bossCount);
      clanrat.id='pack_'+Date.now();
      gs.enemies.push(clanrat);
      addLog(room,`🐀 <strong>Call the Pack!</strong> ${ae.name} summons a <strong>Skaven Clanrat</strong>! (3-round cooldown)`,'chaos');
    }
    // Bonus multi-attack hits random player
    if(ae.multi){
      const t=alive[Math.floor(Math.random()*alive.length)];
      if(t){const r2=rollEnemyAttack(ae,t.char);if(r2.hit){t.char.health=Math.max(0,t.char.health-r2.dmg);addLog(room,`${ae.name} bonus attack on ${t.name} for <strong>${r2.dmg}</strong>!`,'dmg');checkDeath(room,t);}}
    }
    // Resolve Varghulf life leech for this enemy
    if(ae.name==='Varghulf'&&ae._leechAccum>0){
      const leech=Math.floor(ae._leechAccum/4);
      ae.hp=Math.min(ae.maxHp,ae.hp+leech);
      addLog(room,`Varghulf leeches <strong>${leech}</strong> HP (¼ of ${ae._leechAccum} total damage dealt)!`,'chaos');
      ae._leechAccum=0;
    }
  });

  const nowAlive=room.players.filter(p=>p.char&&p.char.alive);
  if(nowAlive.length===0){triggerGameover(room);return;}
  room.players.forEach(p=>{if(p.char&&!p.char.alive){p.char.pendingRevive=true;}});
  // Tick buffs/debuffs each round
  room.players.forEach(p=>{if(p.char&&p.char.alive)tickBuffs(p.char);});
  if(gs.enemies) gs.enemies.forEach(en=>{
    if(en){
      tickDebuffs(en);
      // Poison: reduce by 1 stack at end of round
      if(en._poisonStacks&&en._poisonStacks>0){
        en._poisonStacks--;
        if(en._poisonStacks>0) addLog(room,`☠ ${en.name} poison fades — <strong>${en._poisonStacks}</strong> stack${en._poisonStacks!==1?'s':''} remaining.`,'sys');
        else addLog(room,`☠ ${en.name} poison cleared.`,'sys');
      }
    }
  });
  // Tick Call the Pack cooldown
  if(gs.packCooldown>0){
    gs.packCooldown--;
    if(gs.packCooldown===0) addLog(room,`🐀 Call the Pack cooldown lifted.`,'sys');
  }
  gs.playersActedThisRound=[]; gs.enemyHasActed=false;
  // roundNumber increment handled by endRound() in turn-order system
  if(!gs.turnOrder||!gs.turnOrder.length) gs.roundNumber=(gs.roundNumber||1)+1;
}

function checkDeath(room, player) {
  if(player.char.health<=0&&player.char.alive){
    player.char.alive=false; player.char.health=0; player.char._killedThisTurn=true;
    addLog(room,`💀 <strong>${player.name}</strong> has fallen!`,'death');
    // Unstoppable: survive at 1 HP once per combat
    if(player.char.unstoppable&&!player.char.unstoppableUsed){
      player.char.unstoppableUsed=true; player.char.alive=true; player.char.health=1;
      addLog(room,`${player.name} is UNSTOPPABLE — survives at 1 HP!`,'crit');
    }
  }
}

function resolveEnemyDeath(room, deadEnemy) {
  const gs=room.gs;
  const e=deadEnemy||gs.enemy;
  // DAEMONIC ICHOR (Bloodletter): on death deal 1d6 fire to all players
  if(e&&e.daemonicIchor){
    room.players.filter(p=>p.char&&p.char.alive).forEach(p=>{
      const dmg=rd(1,6); p.char.health=Math.max(0,p.char.health-dmg);
      addLog(room,`💥 <strong>Daemonic Ichor!</strong> ${e.name} explodes — <strong class="num-dmg">-${dmg}</strong> fire dmg to ${p.name}!`,'chaos');
      checkDeath(room,p);
    });
  }
  // UNDYING (Skeleton): 1-in-6 chance to rise at 1 HP
  if(e&&e.undying&&!e._undyingUsed&&d(6)===6){
    e._undyingUsed=true; e.hp=1;
    addLog(room,`💀 <strong>Undying!</strong> ${e.name} refuses to stay dead — rises at 1 HP!`,'chaos');
    return false; // enemy survived — callers must NOT treat this as a death
  }
  addLog(room,`⚔ <strong>${e.name}</strong> is slain! FOR SIGMAR!`,'crit');
  room.players.forEach(p=>{
    if(p.char&&(!p.char.alive||p.char.pendingRevive)){
      p.char.health=1; p.char.alive=true; p.char.pendingRevive=false;
      addLog(room,`${p.name} dragged back from death — 1 HP!`,'heal');
    }
  });
  const survivors=room.players.filter(p=>p.char&&p.char.alive);
  const xpEach=e.xp||1; // XP awarded directly, no reduction
  // Boss gold: flat per survivor. Other enemies: roll halved.
  let goldTotal;
  if (e.threat==='Boss' && gs.bossCount===0) {
    goldTotal = 150 * survivors.length; // 150 per survivor — boss 1
  } else if (e.threat==='Boss' && gs.bossCount===1) {
    goldTotal = 200 * survivors.length; // 200 per survivor — boss 2
  } else {
    goldTotal=e.gold?Math.floor((e.gold[0]+Math.floor(Math.random()*(e.gold[1]-e.gold[0]+1)))*0.5):0;
  }
  const goldEach=Math.floor(goldTotal/Math.max(1,survivors.length));
  addLog(room,`Each survivor: +<strong>${xpEach} XP</strong>, +<strong>${goldEach} silver</strong>.`,'loot');
  if(e.threat==='Boss') gs.bossCount++;
  survivors.forEach(p=>{
    p.char.xp+=xpEach; p.char.gold+=goldEach; p.char.sharpeningStone=false;
    // Reset per-combat used flags
    p.char.divineSmiteUsed=false; p.char.spellsurgeUsed=false; p.char.pacedStrikesUsed=false; p.char.rageBoon=false; p.char.catastropheUsed=false; p.char.overcastUsed=false; p.char._quickstrikeUsed=false; p.char.trickeryUsed=false; p.char._trickeryFirstHit=false; p.char._trickeryPoisonProc=0;
    const lv=checkLevelUp(p.char);
    if(lv.leveled) addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP)${p.char.pendingLevelUp?' — Choose a path!':''}`, 'spell');
  });
  // Remove dead enemy from pool
  gs.enemies=(gs.enemies||[]).filter(en=>en!==e&&en.hp>0);
  // If more enemies remain, continue combat targeting next alive enemy
  if(gs.enemies&&gs.enemies.length>0){
    gs.enemy=gs.enemies[0]; gs.activeEnemyIdx=0;
    addLog(room,`<strong>${gs.enemies[0].name}</strong> is next! (${gs.enemies[0].hp}/${gs.enemies[0].maxHp} HP)`,'sys');
    // Full round reset — everyone acts again including enemy
    gs.playersActedThisRound=[]; gs.enemyHasActed=false;
    gs.roundNumber=(gs.roundNumber||1)+1;
    addLog(room,'--- New round — warriors act! ---','sys');
    // Revive fallen players between enemies
    room.players.forEach(p=>{if(p.char&&(!p.char.alive||p.char.pendingRevive)){p.char.health=1;p.char.alive=true;p.char.pendingRevive=false;addLog(room,`${p.name} recovers — 1 HP!`,'heal');}});
    return;
  }
  gs.inCombat=false; gs.enemy=null; gs.enemies=[]; gs.phase='event';
  gs.playersActedThisRound=[]; gs.enemyHasActed=false; gs.packCooldown=0;
  // Victory after defeating the Saurian Ancient at depth 30
  if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The Saurian Ancient falls! The warband conquers the depths! FOR SIGMAR!','crit');}
  else if(gs.bossCount>=3){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');}
}

// ─── MERCHANT ────────────────────────────────────────────────────────────────
const WEAPON_BASES=[
  // Slashing: x1.5 vs AC ≤ 14
  {name:'Reiklander Sword', dice:'1d6', stat:'str', dmgType:'slashing'},
  {name:'Duelling Sabre',   dice:'1d6', stat:'agi', dmgType:'slashing'},
  {name:'War Axe',          dice:'2d6', stat:'str', dmgType:'slashing'},
  {name:'Halberd',          dice:'2d6', stat:'str', dmgType:'slashing'},
  {name:'Silvered Rapier',  dice:'1d6', stat:'agi', dmgType:'slashing'},
  // Blunt: x1.5 vs AC ≥ 16
  {name:'Warhammer',        dice:'2d6', stat:'str', dmgType:'blunt'},
  {name:'Pistol',           dice:'1d6', stat:'agi', dmgType:'blunt'},
  {name:'Crossbow',         dice:'1d6', stat:'agi', dmgType:'blunt'},
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

function genWpn(bossCount=0){
  const light=WEAPON_BASES.filter(b=>b.dice==='1d6'), heavy=WEAPON_BASES.filter(b=>b.dice==='2d6');
  // Pre-boss-1: only 1d6 weapons
  const pool=bossCount>0&&d(5)===1?heavy:light;
  const b=pool[Math.floor(Math.random()*pool.length)], bonus=d(6);
  return{id:'w'+uuidv4(),name:b.name,dice:b.dice,stat:b.stat,bonus,dmgType:b.dmgType,cost:Math.max(5,(b.dice==='2d6'?20:15)+bonus*8),sellCost:1,bought:false,type:'weapon',desc:`${b.dice}+${bonus} · ${b.stat.toUpperCase()} · ${b.dmgType}`};
}
function genArmor(bossCount=0){
  const b=ARMOR_BASES[Math.floor(Math.random()*ARMOR_BASES.length)];
  // Pre-boss-1: armor bonus capped so total defBonus <= 6
  let bonus;
  if(bossCount===0){ bonus=d(4); if(b.def+bonus>6) bonus=Math.max(1,6-b.def); }
  else { bonus=d(5)===1?d(2)+4:d(4); }
  return{id:'a'+uuidv4(),name:b.name,defBonus:b.def+bonus,cost:Math.max(5,20+bonus*10),sellCost:1,bought:false,type:'armor',desc:`+${b.def+bonus} Defense`};
}
function genShopScroll(){
  const sp=SCROLL_SPELLS_SHOP[Math.floor(Math.random()*SCROLL_SPELLS_SHOP.length)];
  return{id:'sc'+uuidv4(),name:`Scroll: ${sp.name}`,spell:sp,cost:35,sellCost:1,bought:false,type:'scroll',desc:sp.desc};
}
function buildPlayerShop(bossCount=0){
  const hd1={id:'hd1'+uuidv4(),name:'Healing Draught',cost:10,sellCost:1,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const hd2={id:'hd2'+uuidv4(),name:'Healing Draught',cost:10,sellCost:1,desc:'Heal 1d6 HP',bought:false,type:'consumable'};
  const otherPool=SHOP_CONSUMABLES.filter(c=>c.name!=='Healing Draught').sort(()=>Math.random()-0.5);
  const other=otherPool[0]?{id:'c'+uuidv4(),name:otherPool[0].name,cost:otherPool[0].cost,sellCost:1,desc:otherPool[0].desc,bought:false,type:'consumable'}:hd1;
  return{
    weaponEnhance:{id:'we'+uuidv4(),name:'Weapon Enhancement',desc:'+1 dmg to equipped weapon',cost:25,bought:false,type:'enhance'},
    statBoost:    {id:'sb'+uuidv4(),name:'+1 Primary Stat',desc:'Increase highest attribute by 1',cost:35,bought:false,type:'statboost'},
    weapon1:genWpn(bossCount),weapon2:genWpn(bossCount),armor:genArmor(bossCount),
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
  else if(itemName==='Flask of Oil'){const _te=getTargetEnemy(room.gs);if(inCombat&&_te){if(_te.immuneFire){addLog(room,`🔥 ${_te.name} is immune to fire!`,'spell');}else{const dmg=rd(2,6);_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} throws Flask of Oil — <strong>${dmg}</strong> fire dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}}else{consumed=false;}}
  else if(itemName==='Fire Jar'){const _te=getTargetEnemy(room.gs);if(inCombat&&_te){if(_te.immuneFire){addLog(room,`🔥 ${_te.name} is immune to fire!`,'spell');}else{const dmg=rd(3,6);_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} smashes Fire Jar — <strong>${dmg}</strong> fire dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}}else{consumed=false;}}
  else if(itemName==='Lucky Pendant'){char.luckyPendant=true;addLog(room,`${player.name} activates Lucky Pendant — next attack is a CRIT!`,'loot');}
  else if(itemName==='Sharpening Stone'){char.sharpeningStone=true;addLog(room,`${player.name} uses Sharpening Stone — +1d6 dmg this combat!`,'loot');}
  else if(itemName.startsWith('Scroll:')){
    const spell=char.scrollSpells[itemName];
    if(!spell){addLog(room,`${player.name}: scroll crumbles.`,'sys');return false;}
    if(spell.type==='heal'){const[n,s]=spell.dmgDice.split('d').map(Number);const roll=rd(n,s);const amt=roll+4;char.health=Math.min(char.maxHealth,char.health+amt);addLog(room,`${player.name} reads ${itemName} — ${n}d${s}(${roll})+4 = +<strong>${amt}</strong> HP.`,'heal');}
    else if(inCombat){const _te=getTargetEnemy(room.gs);if(_te){const[n,s]=spell.dmgDice.split('d').map(Number);const dmg=rd(n,s);_te.hp=Math.max(0,_te.hp-dmg);addLog(room,`${player.name} reads ${itemName} — ${n}d${s} = <strong>${dmg}</strong> dmg!`,'spell');if(_te.hp<=0){resolveEnemyDeath(room,_te);return true;}}}
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
    // Start at level 1 with novice path already applied from career
    // Map career to novice path id — must match NOVICE_PATHS keys
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
    const alive=room.players.filter(p=>p.char&&p.char.alive);
    if(alive.every(p=>gs.pathVotes[p.id]))resolvePath(room);
    return;
  }
  if(action==='APPLY_PATH'){
    if(!char.pendingLevelUp){
      console.log('[APPLY_PATH] rejected — pendingLevelUp=false for',player.name,'tier=',char.pendingPathTier,'pathId=',data.pathId);
      return;
    }
    const tier=char.pendingPathTier||'novice';
    console.log('[APPLY_PATH]',player.name,'tier=',tier,'pathId=',data.pathId,'pendingSpellChoices=',char.pendingSpellChoices);

    if(tier==='tradition'){
      // Only accept pathIds that start with 'tradition:' — reject stale path-name messages
      if(!data.pathId.startsWith('tradition:')){
        console.log('[TRADITION] rejected non-tradition pathId:',data.pathId,'(stale message?)');
        return;
      }
      const tradId=data.pathId.replace('tradition:','');
      const trad=TRADITIONS[tradId];
      console.log('[TRADITION] tradId=',tradId,'trad found=',!!trad,'already known=',char.traditions.includes(tradId));
      if(trad && !char.traditions.includes(tradId)){
        grantTradition(char, tradId);
        addLog(room,`${player.name} discovers the <strong>${trad.label}</strong> tradition — all eligible spells granted!`,'spell');
        console.log('[TRADITION] granted. traditions now:',char.traditions,'spells now:',char.knownSpells.map(s=>s.name));
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
  // Player stun check — Crushing Blow can stun a player
  const _stunBuff = (char.activeBuffs||[]).find(b=>b.skipTurn);
  if(_stunBuff){
    char.activeBuffs = char.activeBuffs.filter(b=>!b.skipTurn);
    addLog(room,`💫 ${player.name} is stunned and loses their action!`,'sys');
    // Advance turn as if they acted
    if(!gs.playersActedThisRound.includes(playerId)) gs.playersActedThisRound.push(playerId);
    if(gs.turnOrder&&gs.turnOrder.length) advanceTurn(room);
    broadcastState(room.code); return;
  }
  // Turn-order guard
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

  if(action==='ATTACK'){
    const rogueBoon=(char.career==='rogue'&&gs.roundNumber===1)?1:0;
    // Quick strike: second attack on round 1 if not used
    const targetEnemy=getTargetEnemy(gs);
    if(!targetEnemy){addLog(room,'No target.','sys');return;}
    const r=rollAttack(char,targetEnemy,rogueBoon);
    if(r.fumble){
      addLog(room,`${player.name} <em>fumbles!</em> d20 rolled 1 — automatic miss.`,'sys');
    } else if(r.hit){
      targetEnemy.hp=Math.max(0, targetEnemy.hp-r.dmg);
      const cl=r.forceCrit?' ⚡ Lucky Pendant CRIT!':r.crit?' 💥 CRITICAL HIT!':'';
      const rollBreak=`d20:<strong>${r.base}</strong>${r.boonInfo}+atk<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${targetEnemy.ac}</strong>`;
      const dmgBreak=r.dmgParts.length?` [dmg: ${r.dmgParts.join(' ')} = <strong>${r.dmg}</strong>]`:'';
      addLog(room,`${player.name} ${r.crit?'<strong>CRITS</strong>':'hits'} ${targetEnemy.name} — <strong class="num-dmg">−${r.dmg} dmg</strong>${cl} [${rollBreak}]${dmgBreak} → ${targetEnemy.name} ${targetEnemy.hp}/${targetEnemy.maxHp} HP`,r.crit?'crit':'dmg');
      // ── Post-hit poison applications (only if enemy still alive) ──
      if(targetEnemy.hp>0){
        // Poisoned Blades (deathblow): +2 stacks on hit, +4 on crit
        if(char.deathblow){ const stacks=r.crit?6:4; applyPoison(targetEnemy,stacks,room); }
        // Trickery: +1 poison stack on hit
        if(char._trickeryPoisonProc && targetEnemy.hp>0){ const ts=char._trickeryPoisonProc; char._trickeryPoisonProc=0; applyPoison(targetEnemy,ts,room); } else { char._trickeryPoisonProc=0; }
        // Assassination: +1d6+3 dmg if below 50% HP, else +3 poison stacks
        if(char.assassination){
          if(targetEnemy.hp<targetEnemy.maxHp*0.5){ const ab=rd(1,6)+3;targetEnemy.hp=Math.max(0,targetEnemy.hp-ab);addLog(room,`🗡 Assassination! <strong class="num-dmg">-${ab}</strong> bonus dmg → ${targetEnemy.hp}/${targetEnemy.maxHp} HP!`,'crit'); }
          else { applyPoison(targetEnemy,5,room); }
        }
      } else {
        // Enemy died — clear trickery proc without applying poison
        char._trickeryPoisonProc=0;
      }
      if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
    } else {
      // Miss — check rerollMiss buff (Rewrite Moment)
      const rerollBuff=(char.activeBuffs||[]).find(b=>b.rerollMiss);
      if(rerollBuff){
        addLog(room,`${player.name} misses — <strong>Rewrite Moment</strong> triggers, rerolling!`,'spell');
        const r2=rollAttack(char,targetEnemy,rogueBoon);
        if(r2.hit){
          targetEnemy.hp=Math.max(0, targetEnemy.hp-r2.dmg);
          const dmgBreak2=r2.dmgParts.length?` [dmg: ${r2.dmgParts.join(' ')} = <strong>${r2.dmg}</strong>]`:'';
          addLog(room,`${player.name} reroll ${r2.crit?'<strong>CRITS</strong>':'hits'} ${targetEnemy.name} — <strong class="num-dmg">−${r2.dmg} dmg</strong>${dmgBreak2} → ${targetEnemy.name} ${Math.max(0,targetEnemy.hp)}/${targetEnemy.maxHp} HP`,r2.crit?'crit':'dmg');
          if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
        } else {
          addLog(room,`${player.name} reroll also misses.`,'sys');
        }
      } else {
        addLog(room,`${player.name} <em>misses</em> — d20:<strong>${r.base}</strong>${r.boonInfo}+<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${targetEnemy.ac}</strong>.`,'sys');
        // Quick Step: when YOU miss an attack, gain +2 Defense for 1 round
        if(char.quickStep && !(char.activeBuffs||[]).some(b=>b.name==='Quick Step')){ addBuff(char,'Quick Step',{defBonus:2},1); char.defense+=2; addLog(room,`👟 ${player.name} Quick Steps — +2 Defense this round!`,'sys'); }
      }
    }
    // Bladestorm: 3 attacks total — only fires if first attack hit, inherits weapon training boon
    if(char.bladestorm && r.hit && targetEnemy && targetEnemy.hp>0){
      const bsBoon=char.weaponTraining?1:0;
      for(let bsi=0;bsi<2;bsi++){
        if(targetEnemy.hp<=0) break;
        addLog(room,`🌪 ${player.name} <strong>Bladestorm</strong> strike ${bsi+2}/3!`,'crit');
        const rbs=rollAttack(char,targetEnemy,bsBoon);
        if(rbs.fumble){
          addLog(room,`Bladestorm fumbles!`,'sys');
        } else if(rbs.hit){
          targetEnemy.hp=Math.max(0,targetEnemy.hp-rbs.dmg);
          const bsBreak=rbs.dmgParts.length?` [${rbs.dmgParts.join(' ')} = <strong>${rbs.dmg}</strong>]`:'';
          addLog(room,`Bladestorm ${rbs.crit?'<strong>CRITS</strong>':'hits'} — <strong class="num-dmg">−${rbs.dmg} dmg</strong>${bsBreak} → ${targetEnemy.name} ${Math.max(0,targetEnemy.hp)}/${targetEnemy.maxHp} HP`,rbs.crit?'crit':'dmg');
          // Trickery poison on bonus strikes too
          if(char._trickeryPoisonProc){ const ts=char._trickeryPoisonProc; char._trickeryPoisonProc=0; if(targetEnemy.hp>0){ applyPoison(targetEnemy,ts,room); } }
          if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
        } else {
          addLog(room,`Bladestorm strike misses — d20:${rbs.base}+${rbs.atkMod>=0?'+':''}${rbs.atkMod}=${rbs.total} vs Def${targetEnemy.ac}.`,'sys');
        }
      }
    }
    // Sweeping Blow: after first hit, all other enemies take same damage
    if(char.sweepingBlow && r.hit && gs.enemies && gs.enemies.length>1){
      gs.enemies.filter(e=>e&&e.hp>0&&e!==targetEnemy).forEach(se=>{
        const sweepDmg=Math.max(1,Math.floor(r.dmg*0.75));
        se.hp=Math.min(se.maxHp,se.hp-sweepDmg);
        addLog(room,`💥 Sweeping Blow hits <strong>${se.name}</strong> — <strong class="num-dmg">−${sweepDmg}</strong> dmg → ${Math.max(0,se.hp)}/${se.maxHp} HP`,'crit');
        if(se.hp<=0){resolveEnemyDeath(room,se);}
      });
    }
    // Quick Strike: free second attack on round 1 only (once per combat)
    if(char.quickstrike && gs.roundNumber===1 && !char._quickstrikeUsed && targetEnemy && targetEnemy.hp>0){
      char._quickstrikeUsed=true;
      addLog(room,`⚡ ${player.name} <strong>Quick Strike</strong> — bonus attack!`,'crit');
      const qsBoon=char.weaponTraining?1:0;
      const rqs=rollAttack(char,targetEnemy,qsBoon);
      if(rqs.fumble){
        addLog(room,`Quick Strike fumbles!`,'sys');
      } else if(rqs.hit){
        targetEnemy.hp=Math.max(0,targetEnemy.hp-rqs.dmg);
        const qsBreak=rqs.dmgParts.length?` [${rqs.dmgParts.join(' ')} = <strong>${rqs.dmg}</strong>]`:'';
        addLog(room,`Quick Strike ${rqs.crit?'<strong>CRITS</strong>':'hits'} — <strong class="num-dmg">−${rqs.dmg} dmg</strong>${qsBreak} → ${targetEnemy.name} ${Math.max(0,targetEnemy.hp)}/${targetEnemy.maxHp} HP`,rqs.crit?'crit':'dmg');
        // Trickery poison applies on bonus attacks too
        if(rqs.hit && char._trickeryPoisonProc && targetEnemy.hp>0){ const ts=char._trickeryPoisonProc; char._trickeryPoisonProc=0; applyPoison(targetEnemy,ts,room); }
        if(targetEnemy.hp<=0){resolveEnemyDeath(room,targetEnemy);return;}
      } else {
        addLog(room,`Quick Strike misses — d20:${rqs.base}+${rqs.atkMod>=0?'+':''}${rqs.atkMod}=${rqs.total} vs Def${targetEnemy.ac}.`,'sys');
      }
    }
    acted=true;
  }
  else if(action==='PASS_TURN'){
    addLog(room,`${player.name} passes their turn.`,'sys');
    acted=true;
  }
  else if(action==='CAST_SPELL'){
    const spell=char.knownSpells.find(s=>s.name===data.spellName); if(!spell)return;
    const freeCast=(char.spellsurge&&!char.spellsurgeUsed&&data.useSurge)||(char.metamagic&&!char.metamagicUsed&&data.useMetamagic);
    if(freeCast){if(data.useMetamagic&&char.metamagic&&!char.metamagicUsed){char.metamagicUsed=true;addLog(room,`${player.name} uses Metamagic — free cast!`,'spell');}else{char.spellsurgeUsed=true;addLog(room,`${player.name} uses Spell Surge!`,'spell');}}
    else {
      if(!char.castingPools) refreshCastingPools(char);
      const avail=castingsLeft(char,spell.name,spell.rank);
      if(avail<=0){
        addLog(room,`${player.name}: no castings left for ${spell.name} (0/${maxCastings(char.power,spell.rank)}).`,'sys');return;
      }
      if(!spendCasting(char,spell.name,spell.rank)){addLog(room,`${player.name}: casting failed.`,'sys');return;}
    }

    // ── HEAL spells ──
    if(spell.type==='heal'||spell.heal){
      const targetPlayer=data.targetId?room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive):null;
      const target=targetPlayer?targetPlayer.char:char;
      const targetName=targetPlayer?targetPlayer.name:player.name;
      const wilMod=Math.max(0,modVal(char.attrs.wil));
      const strMod=Math.max(0,modVal(char.attrs.str));
      let amt=0;
      const dStr=spell.dmg||'1d6';
      if(dStr==='max'){
        // Major Healing — full restore
        amt=target.maxHealth-target.health;
        target.health=target.maxHealth;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — fully restored to ${target.maxHealth} HP!`,'heal');
      } else if(dStr==='2d6_wil2_multi'||spell.multiTarget){
        // Vitality Burst — all allies 2d6+WIL×2
        room.players.forEach(p=>{
          if(p.char&&p.char.alive){
            const roll=rd(2,6); const h=roll+wilMod*2;
            p.char.health=Math.min(p.char.maxHealth,p.char.health+h);
            addLog(room,`${p.name} healed <strong>${h}</strong> HP (2d6(${roll})+${wilMod*2}).`,'heal');
          }
        });
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies healed!`,'heal');
      } else if(dStr==='1d6_wil2'){  // Minor Healing
        const roll=rd(1,6); amt=roll+wilMod*2;
        target.health=Math.min(target.maxHealth,target.health+amt);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 1d6(${roll})+${wilMod*2} WIL×2 = +<strong>${amt}</strong> HP.`,'heal');
      } else if(dStr==='2d6_wil2'){  // Light Healing
        const roll=rd(2,6); amt=roll+wilMod*2;
        target.health=Math.min(target.maxHealth,target.health+amt);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 2d6(${roll})+${wilMod*2} WIL×2 = +<strong>${amt}</strong> HP.`,'heal');
      } else if(dStr==='3d6_wil2'){  // Moderate Healing
        const roll=rd(3,6); amt=roll+wilMod*2;
        target.health=Math.min(target.maxHealth,target.health+amt);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 3d6(${roll})+${wilMod*2} WIL×2 = +<strong>${amt}</strong> HP.`,'heal');
      } else if(dStr==='1d6_str2'){  // Close Wounds (Battle)
        const roll=rd(1,6); amt=roll+strMod*2;
        target.health=Math.min(target.maxHealth,target.health+amt);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — 1d6(${roll})+${strMod*2} STR×2 = +<strong>${amt}</strong> HP.`,'heal');
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
        // Fallback: rate-based heals (Speed Healing, etc.) + Healing Berries special
        const hr=Math.max(1,Math.floor(target.maxHealth/4));
        if(dStr==='berries'){
          // Healing Berries: 1d3+WIL, triggers 3 times
          const wilMod=Math.max(0,modVal(char.attrs.wil));
          let totalHeal=0;
          for(let i=1;i<=3;i++){const roll=rd(1,3);const h=roll+wilMod;totalHeal+=h;addLog(room,`Berry ${i}: 1d3(${roll})+${wilMod}=<strong>${h}</strong> HP.`,'heal');}
          target.health=Math.min(target.maxHealth,target.health+totalHeal);
          addLog(room,`${player.name} casts <strong>Healing Berries</strong> — total +<strong>${totalHeal}</strong> HP.`,'heal');
        } else if(dStr==='half_rate')       {const amt=Math.max(1,Math.floor(hr/2));target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');}
        else if(dStr==='rate')       {target.health=Math.min(target.maxHealth,target.health+hr);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${hr}</strong> HP.`,'heal');}
        else if(dStr==='double_rate'){const amt=hr*2;target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');}
        else if(dStr==='triple_rate'){const amt=hr*3;target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');}
        else { const m=dStr.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);if(m){const wilMod=Math.max(0,modVal(char.attrs.wil));const roll=rd(parseInt(m[1]),parseInt(m[2]));const amt=roll+parseInt(m[3]||0)+wilMod;target.health=Math.min(target.maxHealth,target.health+amt);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +<strong>${amt}</strong> HP.`,'heal');} }
      }
    }
    // ── UTILITY spells ──
    else if(spell.type==='utility'){
      const te=getTargetEnemy(gs);
      // Utility Focus: all utility spell buffs last 1 extra round
      const _ufBonus=char.utilityFocus?1:0;
      if(spell.defBonus){
        addBuff(char,spell.name+' (Def)',{defBonus:spell.defBonus},2);
        char.defense+=spell.defBonus;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +${spell.defBonus} Defense for 2 rounds.`,'spell');
      } else if(spell.healthBonus){
        addBuff(char,spell.name+' (HP)',{tempHp:spell.healthBonus},8);
        char.health=Math.min(char.maxHealth+spell.healthBonus,char.health+spell.healthBonus);
        char.maxHealth+=spell.healthBonus;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +${spell.healthBonus} max Health for 8 rounds.`,'spell');
      } else if(spell.dmgBuff){
        addBuff(char,spell.name+' (+1d6 dmg)',{dmgBonus:rd(1,6)},1);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — next attack +1d6 damage.`,'spell');
      } else if(spell.atkBoon){
        addBuff(char,spell.name+' (atk boon)',{atkBoon:1},1);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — 1 boon on next attack.`,'spell');
      } else if(spell.battleProwessSpell){
        addBuff(char,spell.name,{battleProwess:true,atkBoon:1},6+_ufBonus);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — roll attacks twice + bonus dmg for 6 rounds!`,'spell');
      } else if(spell.groupBoon){
        room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,spell.name+' (boon)',{atkBoon:1},1);});
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies gain 1 boon this round.`,'spell');
      } else if(spell.groupDefBonus){
        room.players.forEach(p=>{if(p.char&&p.char.alive){addBuff(p.char,spell.name+' (Def)',{defBonus:spell.groupDefBonus},2);p.char.defense+=spell.groupDefBonus;}});
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies +${spell.groupDefBonus} Defense.`,'spell');
      } else if(spell.enemyBane){
        if(te){addDebuff(te,spell.name+' (bane)',{bane:2},2);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${te.name} attacks with 1 bane for 2 rounds.`,'spell');}
      } else if(spell.enemyMiss||spell.skipEnemy||spell.vanish){
        if(te){addDebuff(te,spell.name+' (skip)',{skipTurn:true},1);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${te.name} loses next action!`,'spell');}
      } else if(spell.untouchable){
        addBuff(char,spell.name+' (untouchable)',{defBonus:15},1);
        char.defense+=15;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — untouchable this round!`,'spell');
      } else if(spell.fullBuff){
        addBuff(char,spell.name,{defBonus:2,atkBoon:1},2+_ufBonus);
        char.defense+=2;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +2 Defense and 1 boon for 2 rounds.`,'spell');
      } else if(spell.reroll){
        addBuff(char,spell.name+' (reroll)',{reroll:true},2);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — may reroll dice for 2 rounds.`,'spell');
      } else if(spell.sanctuary){
        addBuff(char,spell.name+' (hidden)',{sanctuary:true},2);
        char.defense+=5;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — hidden from enemies for 2 rounds (+5 Def).`,'spell');
      } else if(spell.forceField){
        addBuff(char,spell.name+' (shield)',{forceField:10},4);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — Force Field absorbs 10 damage!`,'spell');
      } else if(spell.speedBuff){
        addBuff(char,spell.name+' (speed)',{speedBuff:true},4);
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
        addBuff(char,'Nightfall Blade (+1d6)',{dmgBonus:rd(1,6)},4);
        addLog(room,`${player.name} casts <strong>Nightfall Blade</strong> — all weapon attacks +1d6 for 4 rounds!`,'spell');
      } else if(spell.mightyAtk){
        addBuff(char,'Mighty Attack',{dmgBonus:rd(2,6+_ufBonus),atkBoon:2},1);
        addLog(room,`${player.name} casts <strong>Mighty Attack</strong> — next attack: +2d6 and 2 boons!`,'spell');
      // ── NEW PROTECTION spells ──
      } else if(spell.forceFieldNew){
        addBuff(char,'Force Field (50% DR)',{damageReduction:0.5},1);
        addLog(room,`${player.name} casts <strong>Force Field</strong> — 50% damage reduction for 1 round!`,'spell');
      } else if(spell.sanctuaryNew){
        room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,'Sanctuary (50% DR)',{damageReduction:0.5},1);});
        addLog(room,`${player.name} casts <strong>Sanctuary</strong> — all allies take 50% damage for 1 round!`,'spell');
      } else if(spell.vigorNew){
        char.maxHealth+=10; char.health=Math.min(char.maxHealth,char.health+10);
        addLog(room,`${player.name} casts <strong>Vigor</strong> — max HP +10 for rest of combat!`,'spell');
      } else if(spell.protectiveFieldNew){
        room.players.forEach(p=>{if(p.char&&p.char.alive)addBuff(p.char,'Protective Field (Immune)',{immune:true},1);});
        addLog(room,`${player.name} casts <strong>Protective Field</strong> — all allies IMMUNE to damage for 1 round!`,'spell');
      // ── NEW ILLUSION spells ──
      } else if(spell.figmentNew){
        if(te){addDebuff(te,'Figment',{bane:1},2);addLog(room,`${player.name} casts <strong>Figment</strong> — ${te.name} attacks with 1 bane for 2 rounds!`,'spell');}
      } else if(spell.vertigoNew){
        addBuff(char,'Vertigo (2 boons)',{atkBoon:2},2);
        addLog(room,`${player.name} casts <strong>Vertigo</strong> — 2 boons on attacks for 2 rounds!`,'spell');
      } else if(spell.glamerNew){
        if(te){addDebuff(te,'Glamer (miss)',{skipTurn:true},1);addLog(room,`${player.name} casts <strong>Glamer</strong> — ${te.name} next attack misses!`,'spell');}
      // ── NEW TRANSFORMATION ──
      } else if(spell.mistFormNew){
        addBuff(char,'Mist Form (50% DR)',{damageReduction:0.5},2);
        addLog(room,`${player.name} casts <strong>Mist Form</strong> — 50% damage reduction for 2 rounds!`,'spell');
      // ── NEW TIME spells ──
      } else if(spell.swiftnessNew){
        addBuff(char,'Swiftness (+1 boon)',{atkBoon:1},2);
        addLog(room,`${player.name} casts <strong>Swiftness</strong> — +1 boon on attacks for 2 rounds!`,'spell');
      } else if(spell.rewriteNew){
        addBuff(char,'Rewrite Moment (reroll misses)',{rerollMiss:true},2);
        addLog(room,`${player.name} casts <strong>Rewrite Moment</strong> — reroll missed attacks for 2 rounds!`,'spell');
      } else if(spell.minorParadoxNew){
        char.knownSpells.forEach(sp=>{
          if(sp.rank<=2&&char.castingPools){
            const max=maxCastings(char.power,sp.rank);
            char.castingPools[sp.name]=Math.min(max,(char.castingPools[sp.name]||0)+1);
          }
        });
        addLog(room,`${player.name} casts <strong>Minor Paradox</strong> — regained 1 casting of every rank 0-2 spell!`,'spell');
      } else if(spell.precognitionNew){
        addBuff(char,'Precognition',{atkBoon:2,defBoon:2},2+_ufBonus);
        char.defense+=4;
        addLog(room,`${player.name} casts <strong>Precognition</strong> — 2 boons on your attacks, +4 effective Defense for 2 rounds!`,'spell');
      } else {
        addLog(room,`${player.name} casts <strong>${spell.name}</strong>.`,'spell');
      }
    // ── ATTACK spells ──
    } else { // attack
      const spellTarget=getTargetEnemy(gs);
      if(!spellTarget){addLog(room,`${player.name}: no target.`,'sys');return;}
      const dStr=spell.dmg||spell.dmgDice||'1d6';
      const dMatch=dStr.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
      let total=0;
      if(dMatch){
        const n=parseInt(dMatch[1]),s=parseInt(dMatch[2]),b=parseInt(dMatch[3]||0);
        const roll=rd(n,s);
        const wilSpells=['Radiation','Minor Healing','Vitality Burst'];
        const intMod=wilSpells.includes(spell.name)
          ? Math.max(0,modVal(char.attrs.wil))*2
          : Math.max(0,modVal(char.attrs.int))*2;
        let burnBonus=0;
        const fireNames=['Flame Missile','Meteor','Fiery Volley','Fireball','Immolate','Fire Blast','Burning Hands','Firewall'];
        if(char.burningSoul&&fireNames.includes(spell.name)){burnBonus=rd(1,6);}
        // Overcast: +2d6 damage, spends extra casting
        const overcastBuff=(char.activeBuffs||[]).find(b=>b.overcastDmg);
        if(overcastBuff){
          const oc=rd(2,6); total+=oc;
          char.activeBuffs=char.activeBuffs.filter(b=>!b.overcastDmg);
          char.overcastUsed=false; // reset for next combat
          // Spend an extra casting
          if(char.castingPools&&char.castingPools[spell.name]>0) char.castingPools[spell.name]--;
          addLog(room,`💥 Overcast! +${oc} extra damage!`,'crit');
        }
        total=roll+b+intMod+burnBonus;
        if(spell.lifeLeech){const heal=Math.floor(total/4);char.health=Math.min(char.maxHealth,char.health+heal);addLog(room,`${player.name} leeches ${heal} HP (¼)!`,'heal');}
        // Elemental weakness check — find tradition for this spell
        const spellTradKey=Object.keys(TRADITIONS).find(k=>TRADITIONS[k].spells&&TRADITIONS[k].spells.some(s=>s.name===spell.name));
        const spellElem=(TRADITIONS[spellTradKey]||{}).elemType||'arcane';
        const eTags=(spellTarget.tags)||[];
        // Weaknesses: fire→undead ×2, holy→chaos ×2, holy→skaven ×2,
        //             lightning→skaven ×2, dark→beast ×2, death/shadow→beast ×2,
        //             arcane→all ×1.25
        const WEAKNESSES={
          fire:      {tags:['undead'], mult:2},
          holy:      {tags:['chaos','skaven'], mult:2},
          lightning: {tags:['skaven'], mult:2},
          dark:      {tags:['beast'], mult:2},
          arcane:    {tags:['skaven','chaos','undead','beast'], mult:1.25},
        };
        const weakRule=WEAKNESSES[spellElem];
        const isWeak=weakRule&&eTags.some(t=>weakRule.tags.includes(t));
        if(isWeak){
          let mult=weakRule.mult;
          // darkEvoker: dark spells deal 2.5× instead of 2×
          if(spellElem==='dark'&&char.darkEvoker&&mult===2) mult=2.5;
          // lightningIngrained: lightning spells deal 2.5× instead of 2×
          if(spellElem==='lightning'&&char.lightningIngrained&&mult===2) mult=2.5;
          const label=mult>=2.5?`×${mult} ENHANCED`:mult===2?'×2 WEAKNESS':'×1.25 Arcane';
          total=Math.floor(total*mult);
          addLog(room,`⚡ <strong>Elemental ${label}!</strong> [${spellElem}] vs [${eTags.join('/')}]`,'crit');
        }
        // TRIPLE HIT: 3 separate rolls against same target (Fiery Volley, Shadow Strike, Sunrays)
        if(spell.tripleHit){
          let tripleTotal=total; // first hit already rolled
          for(let i=2;i<=3;i++){
            const hr2=rd(n,s)+b+intMod+burnBonus;
            tripleTotal+=hr2;
          }
          total=tripleTotal;
          addLog(room,`${player.name} casts <strong>${spell.name}</strong> [${spellElem}] — 3 hits = <strong>${total}</strong> total dmg!`,'spell');
        } else {
          addLog(room,`${player.name} casts <strong>${spell.name}</strong> [${spellElem}] — ${n}d${s}(${roll})${b?'+'+b:''}+${intMod} INT${burnBonus?'+'+burnBonus+' burn':''} = <strong>${total}</strong> dmg!`,'spell');
        }
      } else {
        total=parseInt(dStr)||0;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — <strong>${total}</strong> dmg!`,'spell');
      }
      spellTarget.hp=Math.min(spellTarget.maxHp, spellTarget.hp-total);

      // ── On-hit special effects ──
      // BURN: 1d6/round for 2 rounds, resets timer if reapplied
      if(spell.applyBurn){
        const existing=spellTarget.activeDebuffs&&spellTarget.activeDebuffs.find(d=>d.name==='Burn');
        if(existing){ existing.duration=2; addLog(room,`🔥 ${spellTarget.name} BURN refreshed (2 rounds)!`,'spell'); }
        else { addDebuff(spellTarget,'Burn',{dotDmg:rd(1,6)},2); addLog(room,`🔥 ${spellTarget.name} is BURNING — 1d6 damage/round for 2 rounds!`,'spell'); }
      }
      // CHILLED: 1d3/round + 1 bane on attacks, 2 rounds
      if(spell.applyChilled){
        const existing=spellTarget.activeDebuffs&&spellTarget.activeDebuffs.find(d=>d.name==='Chilled');
        if(existing){ existing.duration=2; addLog(room,`❄ ${spellTarget.name} CHILL refreshed!`,'spell'); }
        else { addDebuff(spellTarget,'Chilled',{dotDmg:rd(1,3),bane:1},2); addLog(room,`❄ ${spellTarget.name} is CHILLED — 1d3 dmg/round + 1 bane on attacks for 2 rounds!`,'spell'); }
      }
      // BLINDED: 3 banes on attacks for 1 round
      if(spell.applyBlinded||spell.blind){
        const existing=spellTarget.activeDebuffs&&spellTarget.activeDebuffs.find(d=>d.name==='Blinded');
        if(existing){ existing.duration=1; }
        else { addDebuff(spellTarget,'Blinded',{bane:3},1); }
        addLog(room,`💥 ${spellTarget.name} is BLINDED — 3 banes on all attacks for 1 round!`,'spell');
      }
      // BONE SPLINTERS: instant kill check at ≤25% HP
      if(spell.boneSplinters && spellTarget.hp>0 && spellTarget.hp<=Math.floor(spellTarget.maxHp*0.25)){
        const killRoll=d(20);
        addLog(room,`💀 Bone Splinters kill check: d20 = <strong>${killRoll}</strong> (need 10+)...`,'spell');
        if(killRoll>=10){ spellTarget.hp=0; addLog(room,`💀 <strong>INSTANT KILL!</strong> ${spellTarget.name}'s bones explode!`,'crit'); }
      }
      // BLEED: 1d6/round 2 rounds, separate stack from MajorBleed, refresh on reapply
      if(spell.applyBleed){
        const ex=spellTarget.activeDebuffs&&spellTarget.activeDebuffs.find(d=>d.name==='Bleed');
        if(ex){ex.duration=2;addLog(room,`🩸 ${spellTarget.name} BLEED refreshed!`,'spell');}
        else{addDebuff(spellTarget,'Bleed',{dotDmg:rd(1,6)},2);addLog(room,`🩸 ${spellTarget.name} BLEEDING — 1d6/round for 2 rounds!`,'spell');}
      }
      // MAJOR BLEED: 2d6/round 2 rounds, separate stack from Bleed
      if(spell.applyMajorBleed){
        const ex=spellTarget.activeDebuffs&&spellTarget.activeDebuffs.find(d=>d.name==='Major Bleed');
        if(ex){ex.duration=2;addLog(room,`🩸🩸 ${spellTarget.name} MAJOR BLEED refreshed!`,'spell');}
        else{addDebuff(spellTarget,'Major Bleed',{dotDmg:rd(2,6)},2);addLog(room,`🩸🩸 ${spellTarget.name} MAJOR BLEEDING — 2d6/round for 2 rounds!`,'spell');}
      }
      // STUNNED: enemy cannot act this round
      if(spell.stunCheck){
        const stunRoll=d(20);
        addLog(room,`⚡ Stun check: d20=${stunRoll} (need 15+)...`,'spell');
        if(stunRoll>=15){addDebuff(spellTarget,'Stunned',{skipTurn:true},1);addLog(room,`💥 ${spellTarget.name} is STUNNED — loses next action!`,'crit');}
      }
      // LIGHTNING BOLT double-hit check
      if(spell.lightningDoubleCheck){
        const dblRoll=d(20);
        addLog(room,`⚡ Double-strike check: d20=${dblRoll} (need 15+)...`,'spell');
        if(dblRoll>=15){spellTarget.hp=Math.max(0,spellTarget.hp-total);addLog(room,`⚡ <strong>DOUBLE STRIKE!</strong> Hits again for ${total} more damage!`,'crit');}
      }
      // DOUBLE HIT (Forked Lightning — same target twice)
      if(spell.doubleHit){
        const hit2=rd(parseInt(dMatch[1]),parseInt(dMatch[2]))+parseInt(dMatch[3]||0)+intMod;
        spellTarget.hp=Math.max(0,spellTarget.hp-hit2);
        addLog(room,`⚡ Second strike: <strong>${hit2}</strong> dmg!`,'spell');
        total+=hit2; // for display
      }
      // WRATH OF NATURE — target's next 2 attacks have 2 banes
      if(spell.wrathNature){
        addDebuff(spellTarget,'Vine Snare',{bane:2},2);
        addLog(room,`🌿 ${spellTarget.name} is ensnared — next 2 attacks have 2 banes!`,'spell');
      }
      // CHAOS BOLT: d20 on hit — 12+ deals 2d6 extra chaos damage
      if(spell.chaosBolt&&total>0){
        const chRoll=d(20);
        addLog(room,`🎲 Chaos roll: d20 = <strong>${chRoll}</strong> (need 12+)...`,'spell');
        if(chRoll>=12){ const ex=rd(2,6); spellTarget.hp=Math.max(0,spellTarget.hp-ex); addLog(room,`🌀 <strong>Chaos surge!</strong> +${ex} extra chaos damage!`,'crit'); }
      }
      // ENERVATION: reduce max HP for combat
      if(spell.healthPenalty&&spellTarget){
        spellTarget.maxHp=Math.max(1,spellTarget.maxHp-spell.healthPenalty);
        spellTarget.hp=Math.min(spellTarget.maxHp,spellTarget.hp);
        addDebuff(spellTarget,'Enervated',{},99);
        addLog(room,`${spellTarget.name} max HP reduced by ${spell.healthPenalty} for the rest of combat!`,'spell');
      }

      addLog(room,`${spellTarget.name}: <strong>${Math.max(0,spellTarget.hp)}</strong>/${spellTarget.maxHp} HP remaining.`,'sys');
      // Fire immunity (Chaos Warrior)
      if(spell.tradition==='fire'&&spellTarget.immuneFire){ addLog(room,`🔥 ${spellTarget.name} is <strong>immune to fire</strong>!`,'spell'); return; }
      if(spellTarget.hp<=0){resolveEnemyDeath(room,spellTarget);return;}
    } // end attack spell else
    acted=true;
  } // end CAST_SPELL
  else if(action==='USE_TALENT'){
    const t=data.talent;
    if(t==='catchBreath'){if(char.catchBreathUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.catchBreathUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Catch Your Breath — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}
    else if(t==='nimbleRecovery'){if(char.nimbleUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.nimbleUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Nimble Recovery — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}
    else if(t==='sharedRecovery'){if(char.sharedUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.sharedUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Shared Recovery — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}
    else if(t==='spellRecovery'){if(char.spellRecoveryUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.spellRecoveryUsed=true;const h=talentHeal(char);char.health=Math.min(char.maxHealth,char.health+h);const rr=regainCasting(char,1);addLog(room,`${player.name} uses Spell Recovery — +<strong>${h}</strong> HP (1d6+attr×2) + 1 rank ${Math.max(0,rr)} casting.`,'spell');}
    else if(t==='divineSmite'){if(char.divineSmiteUsed){addLog(room,`${player.name}: Divine Smite already used.`,'sys');return;}char.divineSmiteUsed=true;const _te=getTargetEnemy(gs);if(!_te)return;
      // Weapon attack first
      const smiteRoll=rollAttack(char,_te,0);
      if(smiteRoll.hit){
        const holyDmg=rd(3,6);
        const totalSmite=smiteRoll.dmg+holyDmg;
        _te.hp=Math.max(0,_te.hp-totalSmite);
        addLog(room,`⚡ <strong>${player.name}</strong> calls Divine Smite — ${smiteRoll.dmgParts.join(' ')}=<strong>${smiteRoll.dmg}</strong> weapon + <strong>${holyDmg}</strong> holy = <strong class="num-dmg">−${totalSmite}</strong> total → ${_te.name} ${_te.hp}/${_te.maxHp} HP`,'crit');
      } else {
        addLog(room,`${player.name} calls Divine Smite but misses (d20:${smiteRoll.base}+${smiteRoll.atkMod} vs Def${_te.ac}).`,'sys');
      }
      if(_te.hp<=0){resolveEnemyDeath(room,_te);return;}}
    else if(t==='overcast'){
      if(!char.overcast){addLog(room,`${player.name}: no Overcast.`,'sys');return;}
      if(char.overcastUsed){addLog(room,`${player.name}: Overcast already armed.`,'sys');return;}
      char.overcastUsed=true;
      // Armed: next spell spends 2 castings and deals +2d6 damage (applied in CAST_SPELL handler)
      addBuff(char,'Overcast (+2d6)',{overcastDmg:true},1);
      addLog(room,`${player.name} arms <strong>Overcast</strong> — next spell spends 2 castings, deals +2d6!`,'spell');
    }
    else if(t==='bloodOffering'){
      if(!char.bloodOffering){addLog(room,`${player.name}: no Blood Offering.`,'sys');return;}
      const boCost=rd(1,6); char.health=Math.max(1,char.health-boCost);
      char.knownSpells.forEach(sp=>{
        if(sp.rank<=2&&char.castingPools){
          const max=maxCastings(char.power,sp.rank);
          char.castingPools[sp.name]=Math.min(max,(char.castingPools[sp.name]||0)+1);
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
    else if(t==='pacedStrikes'){
      if(!char.pacedStrikes){addLog(room,`${player.name}: no Paced Strikes.`,'sys');return;}
      if(char.pacedStrikesUsed){addLog(room,`${player.name}: Paced Strikes already used this combat.`,'sys');return;}
      // Arm +2d6 buff for next weapon attack
      addBuff(char,'Paced Strikes',{pacedDmg:true},1);
      addLog(room,`⚡ <strong>${player.name}</strong> readies Paced Strikes — next weapon hit deals +2d6 bonus damage!`,'crit');
      acted=true;
    }
    else if(t==='rallyingCry'){if(char.rallyingUsed){addLog(room,`${player.name}: Rallying Cry already used.`,'sys');return;}char.rallyingUsed=true;room.players.forEach(p=>{if(p.char&&p.char.alive){const h=talentHeal(p.char);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} rallies — +<strong>${h}</strong> HP (1d6+attr×2).`,'heal');}});}
    else if(t==='massHeal'){if(char.massHealUsed){addLog(room,`${player.name}: Mass Heal already used.`,'sys');return;}char.massHealUsed=true;room.players.forEach(p=>{if(p.char&&p.char.alive){const h=rd(1,6);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} healed <strong>${h}</strong> HP.`,'heal');}});addLog(room,`${player.name} uses <strong>Mass Heal</strong>!`,'heal');}
    else if(t==='resurrection'){if(char.resurrectionUsed){addLog(room,`${player.name}: Resurrection already used.`,'sys');return;}char.resurrectionUsed=true;const fallen=room.players.find(p=>p.char&&!p.char.alive);if(!fallen){addLog(room,`${player.name}: No fallen allies to revive.`,'sys');return;}fallen.char.health=fallen.char.maxHealth;fallen.char.alive=true;fallen.char.pendingRevive=false;addLog(room,`✨ ${player.name} uses <strong>Resurrection</strong> — ${fallen.name} returns at full HP!`,'heal');}
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
    if(!gs.playersActedThisRound.includes(playerId)) gs.playersActedThisRound.push(playerId);
    if(gs.turnOrder && gs.turnOrder.length) {
      advanceTurn(room);
      // advanceTurn handles broadcastState internally
    } else {
      // Legacy fallback
      try { maybeEnemyAttack(room); } catch(e) { console.error(e); gs.playersActedThisRound=[]; gs.enemyHasActed=false; }
      broadcastState(room.code);
    }
  }
}

function addLog(room,msg,type=''){room.gs.log.push({msg,type,ts:Date.now()});if(room.gs.log.length>200)room.gs.log=room.gs.log.slice(-200);}
function triggerGameover(room){
  const gs=room.gs;
  gs.phase='dying';
  gs.inCombat=false; // stop any queued enemy turns from firing
  addLog(room,'💀 <strong>The warband has fallen...</strong>','death');
  broadcastState(room.code);
  setTimeout(()=>{
    if(gs.phase!=='dying') return; // already resolved
    gs.phase='gameover';
    broadcastState(room.code);
  },3500);
}

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
