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
    levelGains:{ 3:['combatProwess'], 4:['+1str'], 5:['combatExpertise'], 6:['+1str'] },
    desc:'Channel battle-rage for +2d6 damage. Cannot be frightened or compelled while berserk.' },
  fighter:     { label:'Fighter',     hpGain:5, power:0,
    levelGains:{ 3:['combatProwess'], 4:['+1str'], 5:['combatExpertise'], 6:['+1str'] },
    desc:'Master of arms. Attack with any weapon with 1 boon. Combat Prowess adds damage on every hit.' },
  scout:       { label:'Scout',       hpGain:3, power:0,
    levelGains:{ 3:['quickstrike'], 4:['+1agi'], 5:['evasion'], 6:['+1agi'] },
    desc:'Swift skirmisher. Quick Strike adds an extra attack on round 1. Evasion improves defence.' },
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
    levelGains:{ 3:['overcast'], 4:['+1int'], 5:['metamagic'], 6:['+1int'] },
    desc:'Destructive caster. Overcast spends 2 castings for +2d6. Metamagic recasts a spell for free per rest.' },
  elementalist:{ label:'Elementalist',hpGain:2, power:1,
    levelGains:{ 3:['burningSoul'], 4:['+1int'], 5:['firewall'], 6:['+1wil'] },
    desc:'Fire specialist. Burning Soul adds +1d6 to fire spells. Gains the Firewall area spell.' },
  sorcerer:    { label:'Sorcerer',    hpGain:2, power:1,
    levelGains:{ 3:['overcast'], 4:['+1int'], 5:['spellRecovery'], 6:['+1int'] },
    desc:'Innate magic. Channels raw power — Overcast for +2d6 damage, and recovers castings on rest.' },
  wizard:      { label:'Wizard',      hpGain:2, power:1,
    levelGains:{ 3:['overcast'], 4:['+1int'], 5:['metamagic'], 6:['+1int'] },
    desc:'Scholarly mage. Mastery of a tradition. Overcast and Metamagic for versatile combat magic.' },
  warlock:     { label:'Warlock',     hpGain:2, power:1,
    levelGains:{ 3:['overcast'], 4:['+1int'], 5:['metamagic'], 6:['+1wil'] },
    desc:'Pact-bound caster. Dark patron grants power beyond normal limits. Overcast and Metamagic.' },
  spellbinder: { label:'Spellbinder', hpGain:3, power:1,
    levelGains:{ 3:['burningSoul'], 4:['+1int'], 5:['overcast'], 6:['+1wil'] },
    desc:'Imbues weapons with magic. Burning Soul and Overcast amplify offensive spells.' },
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
    levelGains:{ 3:['deathblow'], 4:['+1agi'], 5:['shadowstep'], 6:['+1int'] },
    desc:'Lethal precision. Deathblow makes crits deal triple weapon dice. Shadowstep — flee for free.' },
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
    levelGains:{ 7:['evasion'], 8:['+1agi'], 9:['shadowstep'], 10:['+1agi'] },
    desc:'Nimble and untouchable. Evasion and Shadowstep for superior mobility and avoidance.' },
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
    levelGains:{ 7:['overcast'], 8:['+1int'], 9:['metamagic'], 10:['+1int'] },
    desc:'Scholar of the arcane arts. Overcast for +2d6 and Metamagic for free recasting per rest.' },
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
    levelGains:{ 7:['overcast'], 8:['+1int'], 9:['catastrophe'], 10:['+1int'] },
    desc:'Commands the Storm tradition. Overcast and Catastrophe for overwhelming elemental force.' },
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
    levelGains:{ 7:['overcast'], 8:['+1int'], 9:['spellsurge'], 10:['+1wil'] },
    desc:'Master of death magic. Overcast and Spell Surge for powerful necromantic spellcasting.' },
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

// Init or refresh casting pools on a char based on current power + known spells
function refreshCastingPools(char) {
  if (!char.castingPools) char.castingPools = {};
  char.knownSpells.forEach(sp => {
    const key = 'r' + sp.rank;
    const max = maxCastings(char.power, sp.rank);
    // Only init if not already set (preserve used castings)
    if (char.castingPools[key] === undefined) char.castingPools[key] = max;
  });
}

function restoreCastingPools(char) {
  char.castingPools = {};
  [0,1,2,3].forEach(rank => {
    const max = maxCastings(char.power, rank);
    if (max > 0) char.castingPools['r'+rank] = max;
  });
}

function castingsLeft(char, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  return char.castingPools['r'+rank] || 0;
}

function spendCasting(char, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  const key = 'r'+rank;
  if ((char.castingPools[key]||0) > 0) { char.castingPools[key]--; return true; }
  return false;
}

function regainCasting(char, maxRank) {
  // Regain the lowest-rank spent casting up to maxRank
  for (let r = 0; r <= maxRank; r++) {
    const key = 'r'+r;
    const max = maxCastings(char.power, r);
    if ((char.castingPools[key]||0) < max) { char.castingPools[key]++; return r; }
  }
  return -1;
}

// ─── SPELL TRADITIONS ─────────────────────────────────────────────────────────
// Each tradition has spells at ranks 0-3 usable in our combat system.
// Rank 0 = free (no casting spent), Rank 1+ = costs 1 casting.
// Attack spells deal damage (INT mod x2 bonus). Utility spells have special effects.
const TRADITIONS = {
  fire: {
    label:'Fire',
    spells:[
      {name:'Flame Missile', rank:0, type:'attack', dmg:'1d6',
       desc:'[FIRE ATTACK 0] Loose a fiery missile at one creature within long range. Will attack vs Agility. On success: 1d6 damage (+1d6 on roll of 20+). Bonus: +INT×2. Bright Wizard specialty.'},
      {name:'Meteor',        rank:1, type:'attack', dmg:'2d6+2',
       desc:'[FIRE ATTACK 1] Hurl a fiery stone at a point within medium range. It explodes in a 1-yard sphere, dealing 2d6+2 damage to everything in the area. Half damage on Agility challenge success.'},
      {name:'Fiery Volley',  rank:1, type:'attack', dmg:'1d6+1',
       desc:'[FIRE ATTACK 2] Launch three fiery missiles, divided among up to three targets within medium range. Will vs Agility per missile. Each hit: 1d6+1 damage (+1d3 on roll of 20+).'},
      {name:'Fireball',      rank:2, type:'attack', dmg:'5d6',
       desc:'[FIRE ATTACK 3] Fling a globe of fire at a point within long range. Explodes in a 5-yard sphere dealing 5d6 damage. Half damage on Agility challenge success. Bonus: +INT×2.'},
      {name:'Immolate',      rank:3, type:'attack', dmg:'4d6',
       desc:'[FIRE ATTACK 3] Target smolders and catches fire. Will vs Agility. On success: 4d6 damage and target catches fire (+2d6 on roll of 20+). Bonus: +INT×2.'},
    ]
  },
  life: {
    label:'Life',
    spells:[
      {name:'Minor Healing',    rank:0, type:'heal', dmg:'half_rate',
       desc:'[LIFE UTILITY 0] Touch one creature. It heals damage equal to half its Healing Rate (MaxHP÷8). Free to cast (rank 0). Foundation of the healing tradition.'},
      {name:'Cure',             rank:1, type:'utility', dmg:'0',
       desc:'[LIFE UTILITY 1] Touch one creature. Remove one affliction (diseased, fatigued, impaired, poisoned), remove 1 Insanity, remove any Health penalty, OR heal half the target\'s Healing Rate.',
       cure:true},
      {name:'Light Healing',    rank:1, type:'heal', dmg:'rate',
       desc:'[LIFE UTILITY 1] Touch one creature. It heals damage equal to its full Healing Rate (MaxHP÷4). Rank 1 — costs 1 casting.'},
      {name:'Moderate Healing', rank:2, type:'heal', dmg:'double_rate',
       desc:'[LIFE UTILITY 2] Touch one creature. It heals damage equal to twice its Healing Rate (MaxHP÷2). Rank 2 — costs 1 casting.'},
      {name:'Vitality Burst',   rank:2, type:'heal', dmg:'rate_multi',
       desc:'[LIFE UTILITY 2] Up to three living creatures within short range each heal their full Healing Rate simultaneously. Rank 2 — costs 1 casting.', multiTarget:true},
      {name:'Major Healing',    rank:3, type:'heal', dmg:'triple_rate',
       desc:'[LIFE UTILITY 3] Touch one creature. It heals damage equal to three times its Healing Rate (3/4 MaxHP). Rank 3 — costs 1 casting.'},
    ]
  },
  death: {
    label:'Death (Necromancy)',
    spells:[
      {name:'Spectral Grasp',   rank:0, type:'attack', dmg:'1d3',
       desc:'[NECROMANCY ATTACK 0] A shadowy hand streaks at one creature within medium range. Intellect vs Agility. On success: 1d3 damage and target attacks with 1 bane for 1 round. (+1d6 on roll of 20+).'},
      {name:'Grave Grasp',      rank:1, type:'attack', dmg:'1d6', graveDot:true,
       desc:'[NECROMANCY ATTACK 1] Darkness and bony hands erupt in a 5-yard area. Agility challenge each round — failure: 1d6 damage and immobilized for 1 min. Lasts 1 minute.'},
      {name:'Bone Splinters',   rank:2, type:'attack', dmg:'3d6+5',
       desc:'[NECROMANCY ATTACK 2] Bone shards fly from target\'s body. Intellect vs Strength. On success: 3d6+5 damage. If incapacitated: killed instantly, bones explode in cone. Bonus: +INT×2.'},
      {name:'Cannibalize Magic',rank:3, type:'attack', dmg:'3d6',
       desc:'[NECROMANCY ATTACK 3] Drain magical energy. Intellect vs Strength. On success: 3d6 damage and you regain one rank 1 casting. On roll of 20+: 3d6+2d6 extra, regain rank 2 casting.'},
    ]
  },
  shadow: {
    label:'Shadow',
    spells:[
      {name:'Nightfall Blade',  rank:0, type:'utility', dmg:'0',
       desc:'[SHADOW UTILITY 0] Wisps form a shadow blade in your hand for 1 min. Functions as a 1d6 finesse weapon. Deals +1d6 bonus damage in shadowy or dark areas. Cast then attack immediately.', shadowBlade:true},
      {name:'Shadow Dart',      rank:1, type:'attack', dmg:'2d6',
       desc:'[SHADOW ATTACK 1] A missile of inky darkness leaps at one creature within medium range. Intellect vs Agility. On success: 2d6 damage. (+1d6 on roll of 20+). Bonus: +INT×2.'},
      {name:'Shadow Strike',    rank:2, type:'attack', dmg:'2d6', multi3:true,
       desc:'[SHADOW ATTACK 3] Three missiles of darkness strike up to three targets within medium range. Intellect vs Agility each. On success: 2d6 damage and target pushed 1d6 yards. Bonus: +INT×2.'},
      {name:'Enervation',       rank:3, type:'attack', dmg:'0', healthPenalty:20,
       desc:'[SHADOW ATTACK 5] A black beam hits one creature within long range. Intellect vs Agility. On success: target suffers −20 penalty to Health for 1 hour (−30 on roll of 20+) and becomes impaired.'},
    ]
  },
  battle: {
    label:'Battle',
    spells:[
      {name:'Augmented Attack', rank:0, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[BATTLE ATTACK 0] As part of casting, you attack with a weapon with 1 boon, using Intellect instead of normal attribute. Your next weapon attack gains +1d6 bonus damage.'},
      {name:'Close Wounds',     rank:1, type:'heal', dmg:'rate',
       desc:'[BATTLE UTILITY 1] You heal damage equal to your Healing Rate (MaxHP÷4). Can be used as a triggered action to heal half your Healing Rate when taking damage.'},
      {name:'Mighty Attack',    rank:1, type:'utility', dmg:'2d6extra', mightyAtk:true,
       desc:'[BATTLE ATTACK 1] As part of casting, make a weapon attack with 1 boon using Intellect. On success, target takes 2d6 extra damage beyond normal weapon damage.'},
      {name:'Battle Prowess',   rank:3, type:'utility', dmg:'0', battleProwessSpell:true,
       desc:'[BATTLE UTILITY 3] For 1 minute: make all weapon attack rolls twice and use the better result. Your weapon attacks deal +1d6 extra damage for the duration.'},
    ]
  },
  celestial: {
    label:'Celestial',
    spells:[
      {name:'Burning Beam',  rank:0, type:'attack', dmg:'1d6',
       desc:'[CELESTIAL ATTACK 0] A fiery beam leaps from your hand at one creature within medium range. Will vs Agility. On success: 1d6 damage. On roll of 20+: also blinded for 1 round.'},
      {name:'Flash',         rank:1, type:'attack', dmg:'0', blind:true,
       desc:'[CELESTIAL ATTACK 1] Brilliant light flashes before one creature within short range. Will vs Perception. On success: target blinded for 1 round. On 20+: blinded for 1 minute.'},
      {name:'Sunrays',       rank:2, type:'attack', dmg:'1d6', multi3:true,
       desc:'[CELESTIAL ATTACK 2] Three blazing beams fly at up to three targets within medium range. Will vs Agility per beam. Each hit: 1d6 damage and target impaired for 1 round. Bonus: +INT×2.'},
      {name:'Radiation',     rank:3, type:'attack', dmg:'1d6', dotArea:true,
       desc:'[CELESTIAL ATTACK 3] Green radiation fills a 3-yard sphere within long range for 1 min. Everything in area: 1d6 damage each round. Strength challenge or become fatigued. Bonus: +INT×2.'},
    ]
  },
  chaos: {
    label:'Chaos',
    spells:[
      {name:'Erratic Bolt',          rank:0, type:'attack', dmg:'1d6',
       desc:'[CHAOS ATTACK 0] A fizzing blob of color flies at one creature within medium range. Will vs Agility. On success: 1d6 damage. On roll of 6 on d6 follow-up: chains to another target. Bonus: +INT×2.'},
      {name:'Capricious Devastation',rank:1, type:'attack', dmg:'2d6',
       desc:'[CHAOS ATTACK 1] A flickering energy ball hits one creature. Will vs Agility with chaos die modifier (odd = penalty, even = bonus). On success: 2d6 damage (+2d6 extra if you had penalty). Bonus: +INT×2.'},
      {name:'Color of Magic',        rank:2, type:'attack', dmg:'1d6+1', chaosExplosion:true,
       desc:'[CHAOS ATTACK 2] A colorful globe explodes in a 1-yard sphere. 1d6+1 damage to all in area. If odd damage die result: everything takes 3d6 extra damage. Bonus: +INT×2.'},
      {name:'Chaotic Lance',         rank:3, type:'attack', dmg:'4d6',
       desc:'[CHAOS ATTACK 3] Unstable energy in a shapeable 15-yard line. 4d6 damage to everything in area. Strength challenge or become impaired. Bonus: +INT×2.'},
    ]
  },
  earth: {
    label:'Earth',
    spells:[
      {name:'Earth Spike',   rank:0, type:'attack', dmg:'1d6', prone:true,
       desc:'[EARTH ATTACK 0] A sharp spike erupts under one creature on the ground within short range. Will vs Agility. On success: 1d6 damage and target falls prone. (+1d6 on roll of 20+). Bonus: +INT×2.'},
      {name:'Stone Blades',  rank:1, type:'attack', dmg:'2d6', bleed:true,
       desc:'[EARTH ATTACK 1] Fling stone shards in a 3-yard cone. 2d6 damage to all in area. Half on Agility success. On failure: target suffers a bleeding wound (1d6 each round until healed). Bonus: +INT×2.'},
      {name:'Avalanche',     rank:2, type:'attack', dmg:'4d6',
       desc:'[EARTH ATTACK 2] Raise and hurl ground in a 2-yard circle + 5-yard cone. 4d6 damage to everything in cone. Half on Agility challenge success. Ground becomes difficult terrain. Bonus: +INT×2.'},
      {name:'Eruption',      rank:3, type:'attack', dmg:'5d6',
       desc:'[EARTH ATTACK 3] Ground erupts in a 10-yard-tall, 2-yard-radius cylinder. 5d6 damage and targets pushed 1d6 yards. Strength challenge or become impaired. Bonus: +INT×2.'},
    ]
  },
  storm: {
    label:'Storm',
    spells:[
      {name:'Forked Lightning', rank:0, type:'attack', dmg:'1d6+2',
       desc:'[STORM ATTACK 1] Strike two targets within short range of each other. Will vs Agility per target. On success: 1d6+2 damage each (+1 boon vs metal targets). (+1d6 on roll of 20+). Bonus: +INT×2.'},
      {name:'Freezing Fog',    rank:1, type:'attack', dmg:'1d3', slowDebuff:true,
       desc:'[STORM ATTACK 1] Icy fog fills a 5-yard cylinder within medium range for 1 min. Each round: Strength challenge or 1d3 damage and slowed for 1 round. Ground becomes difficult terrain.'},
      {name:'Call Lightning',  rank:2, type:'attack', dmg:'3d6+5',
       desc:'[STORM ATTACK 2] A bolt strikes a point outdoors within long range. 3d6+5 damage to all within 3 yards. Strength challenge or deafened 1 hour. Half damage on success. Bonus: +INT×2.'},
      {name:'Lightning Bolt',  rank:3, type:'attack', dmg:'5d6',
       desc:'[STORM ATTACK 3] Lightning travels a 30-yard line, rebounding off solid objects. 5d6 damage to all in line (+1 bane vs metal). Half on Agility success. Bonus: +INT×2.'},
    ]
  },
  protection: {
    label:'Protection',
    spells:[
      {name:'Force Field',      rank:0, type:'utility', dmg:'0', forceField:true,
       desc:'[PROTECTION UTILITY 1] An invisible field surrounds you with 10 Health for 1 minute. All damage hits the field first. When the field\'s 10 HP is depleted, the effect ends.'},
      {name:'Sanctuary',        rank:1, type:'utility', dmg:'0', sanctuary:true,
       desc:'[PROTECTION UTILITY 1] Touch one creature. It becomes hidden from all creatures for 1 minute. Effect ends immediately if the target makes an attack.'},
      {name:'Vigor',            rank:2, type:'utility', dmg:'0', healthBonus:10,
       desc:'[PROTECTION UTILITY 2] Touch one creature. It gains +10 bonus to Health for 1 hour. Bonus applies on top of current HP and increases max HP for the duration.'},
      {name:'Protective Field', rank:3, type:'utility', dmg:'0', groupDefBonus:3,
       desc:'[PROTECTION UTILITY 3] An immobile invisible barrier in a 3-yard sphere for 1 minute. Designated allies pass freely. No other creature can enter or make melee attacks through the barrier.'},
    ]
  },
  illusion: {
    label:'Illusion',
    spells:[
      {name:'Figment',   rank:0, type:'utility', dmg:'0', enemyBane:true,
       desc:'[ILLUSION UTILITY 1] A silent visual illusion appears in a 2-yard cube within short range for 1 hour. Creates distraction — enemy makes its next attack with 1 bane while it believes the illusion.'},
      {name:'Vertigo',   rank:1, type:'attack', dmg:'0', vertigoDebuff:true,
       desc:'[ILLUSION ATTACK 1] Target perceives its environs as spinning. Intellect vs Perception. On success: target afflicted with vertigo for 1 min — must roll Agility or fall prone when moving.'},
      {name:'Glamer',    rank:2, type:'utility', dmg:'0', enemyBane:true,
       desc:'[ILLUSION UTILITY 2] A visual and auditory illusion in a 2-yard cube for 1 hour. If dangerous (fire/boiling): 2d6 damage on contact. Enemies treat the area with suspicion — attack rolls with 1 bane.'},
      {name:'Phantasm',  rank:3, type:'attack', dmg:'4d6',
       desc:'[ILLUSION UTILITY 3] A massive illusion in a 5-yard area within long range for 1 hour. Illusion attacks deal 4d6 psychic damage to those who believe it. Intellect vs Perception. Bonus: +INT×2.'},
    ]
  },
  nature: {
    label:'Nature',
    spells:[
      {name:'Oak Hide',        rank:0, type:'utility', dmg:'0', defBonus:2,
       desc:'[NATURE UTILITY 0] For 1 hour: gain +2 bonus to Defense and make Agility challenge rolls to hide in forests with 1 boon. Cannot cast while wearing heavy armor.'},
      {name:'Healing Berries', rank:1, type:'heal', dmg:'half_rate',
       desc:'[NATURE UTILITY 1] Imbue up to three berries with magic for 8 hours. Each berry heals damage equal to half the consumer\'s Healing Rate when eaten. Share with allies freely.'},
      {name:'Shillelagh',      rank:1, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[NATURE UTILITY 1] Imbue one club or staff you hold for 1 hour. Gain +2 Speed and weapon deals +1d6 extra damage for the duration. Effect ends if you drop the weapon.'},
      {name:'Wrath of Nature', rank:3, type:'attack', dmg:'3d6',
       desc:'[NATURE ATTACK 4] Whip-like vines strike up to five creatures within medium range. 3d6 damage each. Agility challenge or moved 6 yards and immobilized for 1 min. Bonus: +INT×2.'},
    ]
  },
  transformation: {
    label:'Transformation',
    spells:[
      {name:'Beast Within', rank:0, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[PRIMAL UTILITY 0] Awaken your beast form. For 1 minute: gain 1 boon on Strength rolls. Your next melee attack gains +1d6 bonus damage as bestial power surges through your strike.'},
      {name:'Dire Beast',   rank:1, type:'utility', dmg:'0', dmgBuff:true,
       desc:'[PRIMAL UTILITY 2] You or one target becomes a savage beast for 1 minute. Size increases by 1 and attacks with unarmed strikes and natural weapons deal +1d6 extra damage.'},
      {name:'Mist Form',    rank:2, type:'utility', dmg:'0', untouchable:true,
       desc:'[TRANSFORMATION UTILITY 3] You become mist for up to 1 minute. You cannot be targeted by weapon attacks. You can move through small gaps. Effect ends if you make an attack.'},
      {name:'Speed Healing',rank:3, type:'heal', dmg:'triple_rate',
       desc:'[TRANSFORMATION UTILITY 3] Rapid regeneration for 1 minute. You heal damage equal to three times your Healing Rate at the start of each of your turns. Useful after taking heavy damage.'},
    ]
  },
  time: {
    label:'Time',
    spells:[
      {name:'Swiftness',       rank:0, type:'utility', dmg:'0', speedBuff:true,
       desc:'[TIME UTILITY 0] Touch one creature that is not fatigued. For 1 minute: it gains +10 bonus to Speed. When the effect ends, the target becomes fatigued for 1 minute.'},
      {name:'Rewrite Moment',  rank:1, type:'utility', dmg:'0', reroll:true,
       desc:'[TIME UTILITY 1] For 1 minute: once per round when you roll a die, you can discard the result and roll again. You must use the second number. Invaluable on failed attack rolls.'},
      {name:'Minor Paradox',   rank:2, type:'attack', dmg:'0', vanish:true,
       desc:'[TIME ATTACK 1] Target ceases to exist for 1 round. Intellect vs Intellect. On success: target disappears and reappears in its former space next round. On 20+: you regain this casting.'},
      {name:'Precognition',    rank:3, type:'utility', dmg:'0', fullBuff:true,
       desc:'[DIVINATION UTILITY ...] See the future for 1 minute: movement doesn\'t trigger free attacks, impose 2 banes on attacks against you, make Agility challenge rolls with 2 boons. Combined +2 Defense effect.'},
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
// All ATK values are 0 — hit is purely d20 vs Defense
const ENEMY_POOLS = {
  low: [
    {name:'Skaven Clanrat',     type:'Skaven',  threat:'Low',      hp:8,  ac:12,atk:0,xp:1,gold:[2,8]},
    {name:'Beastman Gor',       type:'Chaos',   threat:'Low',      hp:12, ac:13,atk:0,xp:1,gold:[3,10],chaos:true},
    {name:'Undead Skeleton',    type:'Undead',  threat:'Low',      hp:15, ac:10,atk:0,xp:1,gold:[0,5],  undead:true},
    {name:'Mutant Thug',        type:'Cultist', threat:'Low',      hp:10, ac:11,atk:0,xp:1,gold:[5,15],chaos:true},
  ],
  mid: [
    {name:'Chaos Marauder',     type:'Chaos',   threat:'Moderate', hp:20, ac:14,atk:2,xp:2,gold:[10,25],chaos:true},
    {name:'Skaven Stormvermin', type:'Skaven',  threat:'Moderate', hp:18, ac:15,atk:2,xp:2,gold:[8,20]},
    {name:'Wight',              type:'Undead',  threat:'Moderate', hp:28, ac:12,atk:2,xp:2,gold:[5,15],  undead:true,lifeLeech:true},
    {name:'Plague Monk',        type:'Chaos',   threat:'Moderate', hp:19, ac:13,atk:2,xp:2,gold:[0,0],   diseased:true,chaos:true},
  ],
  high: [
    {name:'Chaos Warrior',      type:'Chaos',   threat:'High',     hp:35, ac:16,atk:3,xp:3,gold:[15,40],chaos:true},
    {name:'Vampire Count',      type:'Undead',  threat:'High',     hp:40, ac:15,atk:3,xp:3,gold:[20,60], undead:true,lifeLeech:true},
    {name:'Bloodletter',        type:'Daemon',  threat:'High',     hp:45, ac:15,atk:3,xp:3,gold:[25,50], insanityAtk:true,chaos:true},
    {name:'Skaven Warlord',     type:'Skaven',  threat:'High',     hp:32, ac:14,atk:3,xp:3,gold:[10,30], diseased:true},
  ],
  // Boss 1 (depth 10) — random, ATK +0
  boss1: [
    {name:'Skaven Warlord Gnashteeth', type:'Skaven Boss', threat:'Boss',hp:80, ac:15,atk:0,xp:5,gold:[30,80]},
    {name:'Beastlord Kragthor',        type:'Chaos Boss',  threat:'Boss',hp:95, ac:16,atk:0,xp:5,gold:[25,70],chaos:true},
  ],
  // Boss 2 (depth 20) — random, ATK +3
  boss2: [
    {name:'Varghulf',            type:'Undead Boss', threat:'Boss',hp:138,ac:15,atk:3,xp:5,gold:[200,200],undead:true,lifeLeech:true,regen:true},
    {name:'Bonebreaker Ratogre', type:'Daemon Boss', threat:'Boss',hp:138,ac:16,atk:3,xp:5,gold:[200,200],insanityAtk:true},
  ],
  // Boss 3 (depth 30) — always Saurian Ancient, ATK +4
  boss3: [
    {name:'Saurian Ancient',     type:'Ancient Boss',threat:'Boss',hp:250,ac:15,atk:4,xp:5,gold:[60,150]},
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
  e.hp = e.maxHp = Math.round(e.hp * (1 + (playerCount-1)*0.5) * bossHpMult);
  e.conditions = []; e.isElite = isElite;
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
  const startWpn = {id:'w_start_'+uuidv4(),name:'Starting Weapon',dice:'1d6',stat:c.weaponStr?'str':'agi',bonus:0,type:'weapon',desc:'1d6 — starting gear'};
  const startArmor = c.armorDef>0 ? {id:'a_start_'+uuidv4(),name:'Starting Armour',defBonus:c.armorDef,type:'armor',desc:`+${c.armorDef} Defense`} : null;
  return {
    career, attrs,
    health:attrs.str, maxHealth:attrs.str,
    defense:baseDefense, baseAgiDef:attrs.agi,
    perception:attrs.int,
    power:0, maxPower:0, castingPools:{}, castingsUsed:0, // castingsUsed kept for compat
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
    traditions:[], scrollSpells:{}, stimulantBoon:0, sharpeningStone:false, luckyPendant:false,
    alive:true,
    spellcaster:c.spellcaster, tradition:c.tradition||null,
    knownSpells:c.spellcaster
      ? (c.tradition==='fire'
          ? getSpellsForPower('fire',1)
          : getSpellsForPower('life',1))
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
  if (char.holyFervor && enemy && (enemy.undead||enemy.chaos)) boons++; // boon vs undead/chaos
  if (char.warlordAura) boons++; // aura from warlord
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned'))    banes++;
  const forceCrit=char.luckyPendant; if(forceCrit) char.luckyPendant=false;
  const {base,final}=rollD20boons(boons,banes);
  const fumble=base===1&&!forceCrit, crit=forceCrit||base===20;
  const total=final+atkMod, hit=!fumble&&(crit||total>=enemy.ac);
  let dmg=0, dmgParts=[];
  if (hit) {
    const weapRoll=rd(num,sides);
    const statBonus=Math.max(0,modVal(char.attrs[wpnStat]));
    dmg=weapRoll+statBonus+wpnDmgBonus;
    dmgParts.push(`${num}d${sides}(${weapRoll})`);
    if(statBonus)  dmgParts.push(`+${statBonus} stat`);
    if(wpnDmgBonus)dmgParts.push(`+${wpnDmgBonus} wpn`);
    if (crit)           { const r=rd(num,sides); dmg+=r; dmgParts.push(`+${r} crit`); }
    if (char.deathblow&&crit) { const r=rd(num,sides); dmg+=r; dmgParts.push(`+${r} deathblow`); }
    if (char.combatProwess)   { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} prowess`); }
    if (char.combatExpertise) { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} expertise`); }
    if (char.sharpeningStone) { const r=rd(1,6); dmg+=r; dmgParts.push(`+${r} sharpened`); }
    if (char.trickery&&char.trickeryUsed<char.trickeryMax) { const r=rd(1,6); dmg+=r; char.trickeryUsed++; dmgParts.push(`+${r} trickery`); }
    dmg=Math.max(1,dmg);
  }
  const boonInfo=boons>0?` (${boons} boon)`:banes>0?` (${banes} bane)`:'';
  const wpnLabel=wpn?`${wpn.name} (${wpnDice}+${wpnDmgBonus})`:'Unarmed (1d6)';
  return {hit,crit,fumble,base,final,total,dmg,dmgParts,atkMod,boonInfo,forceCrit,wpnLabel};
}

function rollEnemyAttack(enemy, char) {
  const base=d(20), total=base+enemy.atk, crit=base===20;
  const hit=base!==1&&(crit||total>=char.defense);
  let dmg=0, dmgRoll=0, critRoll=0;
  if (hit) {
    dmgRoll=rd(enemy.dmgNum,enemy.dmgSides);
    dmg=dmgRoll+enemy.dmgBonus;
    if (crit) { critRoll=rd(enemy.dmgNum,enemy.dmgSides); dmg+=critRoll; }
    if (char.toughness) dmg=Math.max(0,dmg-1);
    dmg=Math.max(1,dmg);
  }
  return {hit,crit,dmg,dmgRoll,critRoll,total,base};
}

// ─── LEVEL UP & PATHS ────────────────────────────────────────────────────────
// XP thresholds (50% of SotDL base)
const XP_THRESHOLDS = [0,1,2,3,4,6,7,9,12,14];

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
    if (newLevel===1&&!char.novicePath) { char.pendingLevelUp=true; char.pendingPathTier='novice'; }
    else if (newLevel===3&&!char.expertPath) { char.pendingLevelUp=true; char.pendingPathTier='expert'; }
    else if (newLevel===7&&!char.masterPath) { char.pendingLevelUp=true; char.pendingPathTier='master'; }
    // Spellcasters gain a new tradition or new spells at levels 2,4,6,8,10
    else if (char.spellcaster && [2,4,6,8,10].includes(newLevel)) {
      char.pendingLevelUp=true; char.pendingPathTier='tradition';
    }
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
  const np=NOVICE_PATHS[pathId]; if(!np) return;
  char.maxHealth+=np.hpGain; char.health=Math.min(char.health+np.hpGain,char.maxHealth);
  if (np.power)           { char.power+=np.power; char.maxPower+=np.power; refreshCastingPools(char); }
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
  if (ep.power) { char.power+=ep.power; char.maxPower+=ep.power; refreshCastingPools(char); }
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
  if (mp.power) { char.power+=mp.power; char.maxPower+=mp.power; refreshCastingPools(char); }
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
    if(Object.values(p.char.castingPools||{}).some((v,i)=>v<maxCastings(p.char.power,i))||p.char.spellRecoveryUsed){ restoreCastingPools(p.char); p.char.spellRecoveryUsed=false; restored=true; }
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
      const dmgBreak=`${e.dmgNum}d${e.dmgSides}(${r.dmgRoll})${e.dmgBonus?'+'+e.dmgBonus:''}${r.critRoll?'+'+r.critRoll+' crit':''}`;
      addLog(room,`${e.name} hits <strong>${p.name}</strong> — <strong class="num-dmg">−${r.dmg} dmg</strong>${critLabel} [d20:<strong>${r.base}</strong>+atk<strong>${e.atk>=0?'+':''}${e.atk}</strong>=<strong>${r.total}</strong> vs Def<strong>${p.char.defense+auraBonus}</strong>] [dmg: ${dmgBreak}] → ${p.name} <strong>${Math.max(0,p.char.health)}</strong>/${p.char.maxHealth} HP`,'dmg-taken');
      if(e.lifeLeech){
        // Varghulf: heals 1/4 of ALL damage dealt this round to all players
        // Standard life leech: heals 1/2 of single hit
        const isVarghulf = e.name==='Varghulf';
        if(isVarghulf){
          // Accumulate - will heal after all players attacked
          e._leechAccum = (e._leechAccum||0) + r.dmg;
        } else {
          const l=Math.floor(r.dmg/2); e.hp=Math.min(e.maxHp,e.hp+l);
          addLog(room,`${e.name} leeches ${l} HP!`,'chaos');
        }
      }
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
  // Resolve Varghulf's accumulated 1/4 life leech
  if(e && e.name==='Varghulf' && e._leechAccum>0){
    const leech=Math.floor(e._leechAccum/4);
    e.hp=Math.min(e.maxHp,e.hp+leech);
    addLog(room,`Varghulf leeches <strong>${leech}</strong> HP (¼ of ${e._leechAccum} total damage dealt)!`,'chaos');
    e._leechAccum=0;
  }
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
  const survivors=room.players.filter(p=>p.char&&p.char.alive);
  const xpEach=Math.max(1, Math.floor(e.xp * 0.75)); // 25% XP reduction
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
    p.char.divineSmiteUsed=false; p.char.spellsurgeUsed=false;
    const lv=checkLevelUp(p.char);
    if(lv.leveled) addLog(room,`🌟 ${p.name} reaches <strong>Level ${lv.newLevel}</strong>! (+${lv.hpGain} max HP)${p.char.pendingLevelUp?' — Choose a path!':''}`, 'spell');
  });
  gs.inCombat=false; gs.enemy=null; gs.phase='event';
  gs.playersActedThisRound=[]; gs.enemyHasActed=false;
  // Victory after defeating the Saurian Ancient at depth 30
  if(gs.depth>=30){gs.phase='victory';addLog(room,'🏆 The Saurian Ancient falls! The warband conquers the depths! FOR SIGMAR!','crit');}
  else if(gs.bossCount>=3){gs.phase='victory';addLog(room,'🏆 The warband conquers the depths! FOR SIGMAR!','crit');}
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
    if(tier==='tradition'){
      const raw=data.pathId;
      if(raw.startsWith('spell:')){
        // spell:traditionId:spellName — grant specific spell
        const parts=raw.split(':'); const tradId=parts[1]; const spellName=parts.slice(2).join(':');
        const trad=TRADITIONS[tradId];
        if(trad){
          const sp=trad.spells.find(s=>s.name===spellName);
          if(sp&&!char.knownSpells.find(k=>k.name===sp.name)){
            char.knownSpells.push({...sp,heal:sp.type==='heal'});
            refreshCastingPools(char); addLog(room,`${player.name} learns <strong>${sp.name}</strong> (${TRADITIONS[tradId].label} rank ${sp.rank}).`,'spell');
          }
        }
        char.pendingLevelUp=false; char.pendingPathTier=null;
      } else {
        // tradition:id — discover a new tradition
        const tradId=raw.replace('tradition:','');
        if(TRADITIONS[tradId]&&!char.traditions.includes(tradId)){
          char.traditions.push(tradId);
          const newSpells=getSpellsForPower(tradId,char.power);
          newSpells.forEach(sp=>{if(!char.knownSpells.find(k=>k.name===sp.name))char.knownSpells.push({...sp,heal:sp.type==='heal'});});
          refreshCastingPools(char); addLog(room,`${player.name} learns the <strong>${TRADITIONS[tradId].label}</strong> tradition!`,'spell');
        }
        char.pendingLevelUp=false; char.pendingPathTier=null;
      }
    }
    else if(tier==='novice'){applyNovicePath(char,data.pathId);addLog(room,`${player.name} walks the <strong>${data.pathId}</strong> novice path.`,'spell');}
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
      gs.enemy.hp=Math.min(gs.enemy.maxHp, gs.enemy.hp-r.dmg);
      const cl=r.forceCrit?' ⚡ Lucky Pendant CRIT!':r.crit?' 💥 CRITICAL HIT!':'';
      const rollBreak=`d20:<strong>${r.base}</strong>${r.boonInfo}+atk<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${gs.enemy.ac}</strong>`;
      const dmgBreak=r.dmgParts.length?` [dmg: ${r.dmgParts.join(' ')} = <strong>${r.dmg}</strong>]`:'';
      addLog(room,`${player.name} ${r.crit?'<strong>CRITS</strong>':'hits'} ${gs.enemy.name} — <strong class="num-dmg">−${r.dmg} dmg</strong>${cl} [${rollBreak}]${dmgBreak} → ${gs.enemy.name} ${Math.max(0,gs.enemy.hp)}/${gs.enemy.maxHp} HP`,r.crit?'crit':'dmg');
      if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}
    } else {
      addLog(room,`${player.name} <em>misses</em> — d20:<strong>${r.base}</strong>${r.boonInfo}+<strong>${r.atkMod>=0?'+':''}${r.atkMod}</strong>=<strong>${r.total}</strong> vs Def<strong>${gs.enemy.ac}</strong>.`,'sys');
    }
    acted=true;
  }
  else if(action==='CAST_SPELL'){
    const spell=char.knownSpells.find(s=>s.name===data.spellName); if(!spell)return;
    const freeCast=char.spellsurge&&!char.spellsurgeUsed&&data.useSurge;
    if(freeCast){char.spellsurgeUsed=true;addLog(room,`${player.name} uses Spell Surge!`,'spell');}
    else {
      if(!char.castingPools) refreshCastingPools(char);
      const avail=castingsLeft(char,spell.rank);
      if(avail<=0){
        addLog(room,`${player.name}: no rank ${spell.rank} castings left (0/${maxCastings(char.power,spell.rank)}).`,'sys');return;
      }
      if(!spendCasting(char,spell.rank)){addLog(room,`${player.name}: casting failed.`,'sys');return;}
    }

    // ── HEAL spells ──
    if(spell.type==='heal'||spell.heal){
      const targetPlayer=data.targetId?room.players.find(p=>p.id===data.targetId&&p.char&&p.char.alive):null;
      const target=targetPlayer?targetPlayer.char:char;
      const targetName=targetPlayer?targetPlayer.name:player.name;
      let amt=0;
      // PDF-accurate healing: Life spells use Healing Rate, others use dice
      const hr=Math.max(1,Math.floor(target.maxHealth/4)); // healing rate = MaxHP÷4
      const dStr=spell.dmg||'1d6';
      if(dStr==='half_rate')     { amt=Math.max(1,Math.floor(hr/2)); }
      else if(dStr==='rate')     { amt=hr; }
      else if(dStr==='double_rate') { amt=hr*2; }
      else if(dStr==='triple_rate') { amt=hr*3; }
      else if(dStr==='rate_multi')  { amt=hr; } // multi-target handled below
      else if(dStr!=='0') {
        const[n,s]=dStr.split('d').map(Number);
        const roll=rd(n,s); const wilMod=Math.max(0,modVal(char.attrs.wil)); amt=roll+wilMod;
      }
      if(spell.name==='Mass Heal'){
        if(char.massHealUsed){addLog(room,`${player.name}: Mass Heal already used.`,'sys');return;}
        char.massHealUsed=true;
        room.players.forEach(p=>{ if(p.char&&p.char.alive){const h=rd(1,6);p.char.health=Math.min(p.char.maxHealth,p.char.health+h);addLog(room,`${p.name} healed for ${h} HP.`,'heal');} });
      } else if(spell.name==='Miracle Heal'){
        if(char.miracleUsed){addLog(room,`${player.name}: Miracle Heal already used.`,'sys');return;}
        char.miracleUsed=true; target.health=target.maxHealth;
        addLog(room,`${player.name} casts Miracle Heal on ${targetName} — fully restored!`,'heal');
      } else if(spell.multiTarget){
        // Vitality Burst: heal all alive players their healing rate
        room.players.forEach(p=>{
          if(p.char&&p.char.alive){
            const phr=Math.max(1,Math.floor(p.char.maxHealth/4));
            p.char.health=Math.min(p.char.maxHealth,p.char.health+phr);
            addLog(room,`${p.name} healed for ${phr} HP.`,'heal');
          }
        });
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies healed!`,'heal');
      } else if(spell.cure){
        // Cure: remove an affliction
        if(target.conditions&&target.conditions.length>0){
          const removed=target.conditions.shift();
          addLog(room,`${player.name} casts <strong>Cure</strong> on ${targetName} — removes ${removed}.`,'heal');
        } else {
          const h=Math.max(1,Math.floor(hr/2)); target.health=Math.min(target.maxHealth,target.health+h);
          addLog(room,`${player.name} casts <strong>Cure</strong> on ${targetName} — heals ${h} HP.`,'heal');
        }
      } else if(amt>0){
        target.health=Math.min(target.maxHealth,target.health+amt);
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> on ${targetName} — +<strong>${amt}</strong> HP.`,'heal');
      } else {
        addLog(room,`${player.name} casts <strong>${spell.name}</strong>.`,'heal');
      }
    }
    // ── UTILITY spells ──
    else if(spell.type==='utility'){
      if(spell.defBonus){char.defense+=spell.defBonus;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +${spell.defBonus} Defense this round.`,'spell');}
      else if(spell.dmgBuff){char.stimulantBoon=1;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — next attack deals +1d6 damage.`,'spell');}
      else if(spell.atkBoon){char.stimulantBoon=(char.stimulantBoon||0)+1;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — 1 boon on next attack.`,'spell');}
      else if(spell.groupBoon){addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies gain 1 boon on attacks this round.`,'spell');}
      else if(spell.groupDefBonus){room.players.forEach(p=>{if(p.char&&p.char.alive)p.char.defense+=spell.groupDefBonus;});addLog(room,`${player.name} casts <strong>${spell.name}</strong> — all allies +${spell.groupDefBonus} Defense this round.`,'spell');}
      else if(spell.enemyBane){if(gs.enemy){gs.enemy.atk=Math.max(-3,gs.enemy.atk-2);addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${gs.enemy.name} attacks with 1 bane.`,'spell');}}
      else if(spell.enemyMiss){if(gs.enemy){gs.enemy._missNext=true;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${gs.enemy.name} misses next attack!`,'spell');}}
      else if(spell.reroll){addLog(room,`${player.name} casts <strong>${spell.name}</strong> — may reroll one die this round.`,'spell');}
      else if(spell.untouchable){char.defense+=10;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — untouchable this round!`,'spell');}
      else if(spell.skipEnemy){if(gs.enemy){gs.enemy._skipTurn=true;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${gs.enemy.name} loses its next action!`,'spell');}}
      else if(spell.fullBuff){char.defense+=2;char.stimulantBoon=(char.stimulantBoon||0)+1;addLog(room,`${player.name} casts <strong>${spell.name}</strong> — +2 Defense and 1 boon on all rolls.`,'spell');}
      else{addLog(room,`${player.name} casts <strong>${spell.name}</strong>.`,'spell');}
    }
    // ── ATTACK spells ──
    else {
      if(!gs.enemy){addLog(room,`${player.name}: no target.`,'sys');return;}
      const dStr=spell.dmg||spell.dmgDice||'1d6';
      // Parse "NdS" or "NdS+B" format safely
      const dMatch=dStr.match(/^(\d+)d(\d+)(?:\+(\d+))?$/);
      let total=0;
      if(dMatch){
        const n=parseInt(dMatch[1]),s=parseInt(dMatch[2]),b=parseInt(dMatch[3]||0);
        const roll=rd(n,s);
        const intMod=Math.max(0,modVal(char.attrs.int))*2;
        let burnBonus=0;
        const fireNames=['Flame Missile','Meteor','Fiery Volley','Fireball','Immolate','Fire Blast','Burning Hands','Firewall'];
        if(char.burningSoul&&fireNames.includes(spell.name)){burnBonus=rd(1,6);}
        total=roll+b+intMod+burnBonus;
        if(spell.lifeLeech){const heal=Math.floor(total/2);char.health=Math.min(char.maxHealth,char.health+heal);addLog(room,`${player.name} leeches ${heal} HP!`,'heal');}
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — ${n}d${s}(${roll})${b?'+'+b:''}+${intMod} INT${burnBonus?'+'+burnBonus+' burn':''} = <strong>${total}</strong> dmg!`,'spell');
      } else {
        // Fallback for unusual dmg strings — treat as flat value
        total=parseInt(dStr)||0;
        addLog(room,`${player.name} casts <strong>${spell.name}</strong> — <strong>${total}</strong> dmg!`,'spell');
      }
      gs.enemy.hp=Math.min(gs.enemy.maxHp, gs.enemy.hp-total);
      addLog(room,`${gs.enemy.name}: <strong>${Math.max(0,gs.enemy.hp)}</strong>/${gs.enemy.maxHp} HP remaining.`,'sys');
      if(gs.enemy.hp<=0){resolveEnemyDeath(room);return;}
    }
    acted=true;
  }
  else if(action==='USE_TALENT'){
    const t=data.talent;
    if(t==='catchBreath'){if(char.catchBreathUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.catchBreathUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Catch Your Breath — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='nimbleRecovery'){if(char.nimbleUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.nimbleUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Nimble Recovery — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='sharedRecovery'){if(char.sharedUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.sharedUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);addLog(room,`${player.name} uses Shared Recovery — +<strong>${h}</strong> HP.`,'heal');}
    else if(t==='spellRecovery'){if(char.spellRecoveryUsed){addLog(room,`${player.name}: already used.`,'sys');return;}char.spellRecoveryUsed=true;const h=healingRate(char);char.health=Math.min(char.maxHealth,char.health+h);const rr=regainCasting(char,1);addLog(room,`${player.name} uses Spell Recovery — +<strong>${h}</strong> HP + 1 rank ${Math.max(0,rr)} casting.`,'spell');}
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
