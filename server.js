const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ── Rooms: roomCode → { players, gameState, hostId }
const rooms = new Map();
// ── Client → { roomCode, playerId }
const clients = new Map();

// ── Generate a 4-char room code
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

// ── Broadcast to all in a room (optionally exclude one ws)
function broadcast(roomCode, msg, excludeWs = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const data = JSON.stringify(msg);
  room.players.forEach(p => {
    if (p.ws !== excludeWs && p.ws.readyState === 1) {
      p.ws.send(data);
    }
  });
}

// ── Send to one specific player
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ── Build initial shared game state
function initGameState() {
  return {
    depth: 0,
    inCombat: false,
    enemy: null,
    phase: 'lobby',         // lobby | path | combat | event | merchant | gameover | victory
    currentTurnIndex: 0,    // whose turn it is (index into players)
    log: [],
    merchantStock: null,
    gold: 0,                // shared gold pool
    pathChoices: null,
    bossNode: false,
  };
}

// ── Sanitise game state for broadcast (strip ws refs)
function publicState(room) {
  const players = room.players.map(p => ({
    id: p.id,
    name: p.name,
    career: p.career,
    ready: p.ready,
    char: p.char,           // full character object (no ws)
    isHost: p.id === room.hostId,
    connected: p.connected,
  }));
  return { gs: room.gs, players, hostId: room.hostId };
}

// ──────────────────────────────────────────────
// GAME LOGIC (server-authoritative)
// ──────────────────────────────────────────────

function d(n) { return Math.floor(Math.random() * n) + 1; }
function rd(num, sides) { let t = 0; for (let i = 0; i < num; i++) t += d(sides); return t; }
function modVal(score) { return score - 10; }

const CAREERS = {
  warrior: { label:'State Soldier', startAttrs:{str:11,agi:10,int:9,wil:10}, armorDef:3, weaponDmg:'1d8', weaponStr:true, hpBase:0, spellcaster:false },
  rogue:   { label:'Roadwarden',    startAttrs:{str:10,agi:11,int:10,wil:9}, armorDef:1, weaponDmg:'1d6', weaponStr:false, hpBase:0, spellcaster:false },
  wizard:  { label:'Bright Wizard', startAttrs:{str:9,agi:10,int:11,wil:10}, armorDef:0, weaponDmg:'1d6', weaponStr:true, hpBase:0, spellcaster:true, tradition:'fire' },
  priest:  { label:'Sigmarite Priest',startAttrs:{str:10,agi:9,int:10,wil:11},armorDef:3, weaponDmg:'1d8', weaponStr:true, hpBase:0, spellcaster:true, tradition:'life' },
};

const NOVICE_PATHS = {
  warrior: { hpL1:5, hpL2:5, weaponTraining:true, catchBreath:true, combatProwess:false },
  rogue:   { hpL1:3, hpL2:3, trickery:true, nimbleRecovery:true },
  magician:{ hpL1:2, hpL2:2, power:1, cantrip:true, spellRecovery:true },
  priest:  { hpL1:4, hpL2:4, power:1, sharedRecovery:true },
};

const ENEMY_POOLS = {
  low:  [
    {name:'Skaven Clanrat',    type:'Skaven',    threat:'Low',  hp:8,  ac:12,atk:2,dmg:'1d6',dmgB:1,xp:1,gold:[2,8]},
    {name:'Beastman Gor',      type:'Chaos',     threat:'Low',  hp:12, ac:13,atk:3,dmg:'1d8',dmgB:2,xp:1,gold:[3,10]},
    {name:'Undead Skeleton',   type:'Undead',    threat:'Low',  hp:13, ac:13,atk:3,dmg:'1d6',dmgB:2,xp:1,gold:[0,5],undead:true},
    {name:'Mutant Thug',       type:'Cultist',   threat:'Low',  hp:10, ac:11,atk:2,dmg:'1d6',dmgB:1,xp:1,gold:[5,15]},
  ],
  mid:  [
    {name:'Chaos Marauder',    type:'Chaos',     threat:'Moderate',hp:20,ac:14,atk:4,dmg:'1d8',dmgB:3,xp:2,gold:[10,25]},
    {name:'Skaven Stormvermin',type:'Skaven',    threat:'Moderate',hp:18,ac:15,atk:4,dmg:'2d6',dmgB:2,xp:2,gold:[8,20]},
    {name:'Wight',             type:'Undead',    threat:'Moderate',hp:25,ac:14,atk:4,dmg:'1d8',dmgB:2,xp:2,gold:[5,15],undead:true,lifeLeech:true},
    {name:'Nurgle Plaguebearer',type:'Daemon',   threat:'Moderate',hp:22,ac:13,atk:3,dmg:'1d6',dmgB:2,xp:2,gold:[0,0],diseased:true},
  ],
  high: [
    {name:'Chaos Warrior',     type:'Chaos',     threat:'High', hp:35,ac:16,atk:5,dmg:'2d6',dmgB:4,xp:3,gold:[15,40]},
    {name:'Vampire Count',     type:'Undead',    threat:'High', hp:40,ac:15,atk:5,dmg:'1d8',dmgB:3,xp:3,gold:[20,60],undead:true,lifeLeech:true},
    {name:'Greater Daemon',    type:'Daemon',    threat:'High', hp:45,ac:15,atk:6,dmg:'2d8',dmgB:4,xp:3,gold:[25,50],insanityAtk:true},
    {name:'Plague Rat Lord',   type:'Skaven',    threat:'High', hp:32,ac:14,atk:5,dmg:'2d6',dmgB:3,xp:3,gold:[10,30],diseased:true},
  ],
  boss: [
    {name:'Skaven Warlord Gnashteeth',type:'Skaven Boss', threat:'Boss',hp:80,ac:15,atk:6,dmg:'2d8',dmgB:5,xp:5,gold:[30,80],multi:true},
    {name:'Beastlord Kragthor',       type:'Chaos Boss',  threat:'Boss',hp:95,ac:16,atk:7,dmg:'2d8',dmgB:5,xp:5,gold:[25,70],berserk:true},
    {name:'Nagath the Bone-King',     type:'Undead Boss', threat:'Boss',hp:110,ac:16,atk:7,dmg:'2d6',dmgB:4,xp:5,gold:[40,100],undead:true,lifeLeech:true,regen:true},
    {name:'Varghast Bloodgore',       type:'Daemon Boss', threat:'Boss',hp:120,ac:17,atk:8,dmg:'3d6',dmgB:5,xp:5,gold:[50,120],multi:true,insanityAtk:true},
    {name:'Heinrich von Morr',        type:'Undead Boss', threat:'Boss',hp:130,ac:15,atk:7,dmg:'2d6',dmgB:3,xp:5,gold:[60,150],undead:true,lifeLeech:true},
  ],
};

// Scale enemy HP for player count
function scaleEnemy(tmpl, playerCount) {
  const e = JSON.parse(JSON.stringify(tmpl));
  const mult = 1 + (playerCount - 1) * 0.5; // +50% HP per extra player
  e.hp = Math.round(e.maxHp = e.hp * mult);
  e.conditions = [];
  return e;
}

function pickEnemy(depth, elite, boss, playerCount) {
  let pool;
  if (boss) pool = ENEMY_POOLS.boss;
  else if (depth > 20) pool = elite ? ENEMY_POOLS.boss : ENEMY_POOLS.high;
  else if (depth > 10) pool = elite ? ENEMY_POOLS.high : ENEMY_POOLS.mid;
  else pool = elite ? ENEMY_POOLS.mid : ENEMY_POOLS.low;
  const tmpl = pool[Math.floor(Math.random() * pool.length)];
  return scaleEnemy(tmpl, playerCount);
}

function buildChar(career) {
  const c = CAREERS[career];
  const attrs = { ...c.startAttrs };
  const health = attrs.str;
  const defense = attrs.agi + c.armorDef;
  return {
    career, attrs,
    health, maxHealth: health,
    damage: 0,
    defense, baseDefense: defense,
    perception: attrs.int,
    power: 0, maxPower: 0,
    castingsUsed: 0,
    insanity: 0, corruption: 0,
    conditions: [],
    inventory: [
      { name: 'Healing Draught', qty: 3 },
    ],
    novicePath: null, expertPath: null, masterPath: null,
    level: 0, xp: 0,
    // talents
    weaponTraining: false, catchBreath: false, catchBreathUsed: false,
    combatProwess: false, combatExpertise: false,
    trickery: false, trickeryUsed: 0, trickeryMax: 1,
    nimbleRecovery: false, nimbleUsed: false,
    spellRecovery: false, spellRecoveryUsed: false,
    sharedRecovery: false, sharedUsed: false,
    prayer: false,
    equippedWeapon: null,
    weaponDmgBonus: 0, weaponAtkBonus: 0,
    equippedArmorDef: 0,
    scrollSpells: {},
    stimulantBoon: 0,
    alive: true,
    spellcaster: c.spellcaster,
    tradition: c.tradition || null,
    knownSpells: c.spellcaster ? (c.tradition === 'fire'
      ? [{ name:'Ignite', rank:0, heal:false, dmg:'1d6' }, { name:'Burning Hands', rank:1, heal:false, dmg:'3d6' }]
      : [{ name:'Minor Healing', rank:0, heal:true, dmg:'1d6' }, { name:'Light Healing', rank:1, heal:true, dmg:'2d6' }]
    ) : [],
  };
}

function healingRate(char) {
  return Math.max(1, Math.floor(char.maxHealth / 4));
}

function rollAttack(char, enemy, boons = 0, banes = 0) {
  const wpn = char.equippedWeapon;
  const wpnStat = wpn ? wpn.stat : (CAREERS[char.career].weaponStr ? 'str' : 'agi');
  const wpnDiceStr = wpn ? wpn.dice : CAREERS[char.career].weaponDmg;
  const wpnBonus = (wpn ? wpn.bonus : 0) + char.weaponDmgBonus;
  const [num, sides] = wpnDiceStr.split('d').map(Number);
  const atkMod = modVal(char.attrs[wpnStat]) + char.weaponAtkBonus;

  if (char.weaponTraining) boons++;
  if (char.stimulantBoon > 0) { boons++; char.stimulantBoon--; }
  if (char.conditions.includes('Frightened')) banes++;
  if (char.conditions.includes('Stunned')) banes++;

  const base = d(20);
  let roll = base;
  if (boons > 0) { const bd = []; for (let i = 0; i < Math.min(boons, 4); i++) bd.push(d(6)); roll = base + Math.max(...bd); }
  else if (banes > 0) { const bd = []; for (let i = 0; i < Math.min(banes, 4); i++) bd.push(d(6)); roll = Math.max(1, base - Math.max(...bd)); }

  const total = roll + atkMod;
  const hit = base === 1 ? false : (base === 20 || total >= enemy.ac);
  const crit = base === 20;
  let dmg = 0;
  if (hit) {
    dmg = rd(num, sides) + Math.max(0, modVal(char.attrs[wpnStat])) + wpnBonus;
    if (crit) dmg += rd(num, sides);
    if (char.combatProwess) dmg += rd(1, 6);
    if (char.combatExpertise) dmg += rd(1, 6);
    if (char.trickery && char.trickeryUsed < char.trickeryMax) { dmg += rd(1, 6); char.trickeryUsed++; }
    dmg = Math.max(1, dmg);
  }
  const wpnLabel = wpn ? `${wpn.name} (${wpnDiceStr}+${wpnBonus})` : CAREERS[char.career].label + ' weapon';
  return { hit, crit, roll: base, total, dmg, atkMod, wpnLabel, fumble: base === 1 };
}

function rollEnemyAttack(enemy, char) {
  const base = d(20);
  const total = base + enemy.atk;
  const hit = total >= char.defense || base === 20;
  const crit = base === 20;
  const [num, sides] = enemy.dmg.split('d').map(Number);
  let dmg = 0;
  if (hit) {
    dmg = rd(num, sides) + enemy.dmgB;
    if (crit) dmg += rd(num, sides);
    dmg = Math.max(1, dmg);
  }
  return { hit, crit, dmg, total };
}

const XP_THRESHOLDS = [0, 2, 3, 5, 8, 11, 14, 18, 23, 28];

function checkLevelUp(char) {
  let newLevel = 0;
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (char.xp >= XP_THRESHOLDS[i]) { newLevel = i; break; }
  }
  if (newLevel > char.level) {
    char.level = newLevel;
    // Apply novice path HP on level up
    const np = NOVICE_PATHS[char.novicePath];
    const hpGain = np ? (char.level <= 2 ? np.hpL1 : np.hpL1) : 2;
    char.maxHealth += hpGain;
    char.health += hpGain;
    return { leveled: true, newLevel, hpGain };
  }
  return { leveled: false };
}

const NODE_TYPES = ['combat','combat','rest','merchant','loot','elite','unknown','unknown'];

function pickPathChoices() {
  const pool = [...NODE_TYPES];
  const chosen = [];
  while (chosen.length < 3) {
    const idx = Math.floor(Math.random() * pool.length);
    const t = pool.splice(idx, 1)[0];
    if (!chosen.includes(t)) chosen.push(t);
  }
  return chosen;
}

// ──────────────────────────────────────────────
// MESSAGE HANDLERS
// ──────────────────────────────────────────────

function handleMessage(ws, msg) {
  const { type, payload } = msg;
  const ctx = clients.get(ws);

  switch (type) {

    case 'CREATE_ROOM': {
      const code = makeCode();
      const playerId = uuidv4();
      const room = {
        code,
        hostId: playerId,
        players: [],
        gs: initGameState(),
      };
      rooms.set(code, room);
      clients.set(ws, { roomCode: code, playerId });
      room.players.push({ id: playerId, ws, name: payload.name || 'Host', career: null, char: null, ready: false, connected: true });
      send(ws, { type: 'ROOM_CREATED', payload: { code, playerId } });
      broadcastState(code);
      break;
    }

    case 'JOIN_ROOM': {
      const code = payload.code.toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'ERROR', payload: { msg: 'Room not found.' } }); return; }
      if (room.players.filter(p => p.connected).length >= 4) { send(ws, { type: 'ERROR', payload: { msg: 'Room is full (4 players max).' } }); return; }
      if (room.gs.phase !== 'lobby') { send(ws, { type: 'ERROR', payload: { msg: 'Game already in progress.' } }); return; }
      const playerId = uuidv4();
      clients.set(ws, { roomCode: code, playerId });
      room.players.push({ id: playerId, ws, name: payload.name || 'Player', career: null, char: null, ready: false, connected: true });
      send(ws, { type: 'ROOM_JOINED', payload: { code, playerId } });
      broadcastState(code);
      break;
    }

    case 'SELECT_CAREER': {
      if (!ctx) return;
      const room = rooms.get(ctx.roomCode);
      if (!room) return;
      const player = room.players.find(p => p.id === ctx.playerId);
      if (!player) return;
      player.career = payload.career;
      player.char = buildChar(payload.career);
      player.ready = false;
      broadcastState(ctx.roomCode);
      break;
    }

    case 'PLAYER_READY': {
      if (!ctx) return;
      const room = rooms.get(ctx.roomCode);
      if (!room) return;
      const player = room.players.find(p => p.id === ctx.playerId);
      if (!player || !player.career) return;
      player.ready = true;
      // If all connected players are ready, start game
      const connected = room.players.filter(p => p.connected);
      if (connected.length >= 1 && connected.every(p => p.ready)) {
        room.gs.phase = 'path';
        room.gs.depth = 0;
        addLog(room, '⚔ The warband descends into the darkness of Reikland. Sigmar guide your blades.');
        showPathChoices(room);
      }
      broadcastState(ctx.roomCode);
      break;
    }

    case 'CHOOSE_PATH': {
      if (!ctx) return;
      const room = rooms.get(ctx.roomCode);
      if (!room || room.gs.phase !== 'path') return;
      if (ctx.playerId !== room.hostId) { send(ws, { type: 'ERROR', payload: { msg: 'Only the host can choose the path.' } }); return; }
      enterNode(room, payload.nodeType);
      broadcastState(ctx.roomCode);
      break;
    }

    case 'PLAYER_ACTION': {
      if (!ctx) return;
      const room = rooms.get(ctx.roomCode);
      if (!room) return;
      handlePlayerAction(room, ctx.playerId, payload);
      broadcastState(ctx.roomCode);
      break;
    }

    case 'APPLY_NOVICE_PATH': {
      if (!ctx) return;
      const room = rooms.get(ctx.roomCode);
      if (!room) return;
      const player = room.players.find(p => p.id === ctx.playerId);
      if (!player || !player.char) return;
      applyNovicePath(player.char, payload.pathId);
      addLog(room, `${player.name} walks the ${payload.pathId} path.`);
      broadcastState(ctx.roomCode);
      break;
    }

    default:
      break;
  }
}

function addLog(room, msg, type = '') {
  room.gs.log.push({ msg, type, ts: Date.now() });
  if (room.gs.log.length > 80) room.gs.log = room.gs.log.slice(-80);
}

function broadcastState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const state = publicState(room);
  const data = JSON.stringify({ type: 'STATE_UPDATE', payload: state });
  room.players.forEach(p => {
    if (p.ws.readyState === 1) p.ws.send(data);
  });
}

function showPathChoices(room) {
  if (room.gs.depth > 0 && room.gs.depth % 10 === 0) {
    room.gs.phase = 'path';
    room.gs.bossNode = true;
    room.gs.pathChoices = ['boss'];
    addLog(room, '💀 A monstrous power bars your path. There is no other way forward.', 'chaos');
  } else {
    room.gs.phase = 'path';
    room.gs.bossNode = false;
    room.gs.pathChoices = pickPathChoices();
    addLog(room, 'The warband reaches a crossroads. The host must choose the path forward.');
  }
}

function enterNode(room, nodeType) {
  room.gs.depth++;
  room.gs.pathChoices = null;
  const playerCount = room.players.filter(p => p.connected && p.char && p.char.alive).length;

  switch (nodeType) {
    case 'combat':
    case 'elite':
    case 'boss': {
      const boss = nodeType === 'boss';
      const elite = nodeType === 'elite';
      room.gs.enemy = pickEnemy(room.gs.depth, elite, boss, playerCount);
      room.gs.inCombat = true;
      room.gs.phase = 'combat';
      room.gs.currentTurnIndex = 0;
      addLog(room, `⚔ A <strong>${room.gs.enemy.name}</strong> (${room.gs.enemy.type}) ${boss ? 'BOSS — ' : elite ? 'Elite — ' : ''}emerges from the darkness!`, 'dmg');
      addLog(room, playerTurnMsg(room), 'sys');
      break;
    }
    case 'rest': {
      room.gs.phase = 'event';
      addLog(room, '🔥 The warband finds a campfire. Wounds are tended. Spirits cautiously lift.', 'heal');
      room.players.forEach(p => {
        if (!p.char || !p.char.alive) return;
        const amt = Math.ceil(p.char.maxHealth * 0.6);
        p.char.health = Math.min(p.char.maxHealth, p.char.health + amt);
        p.char.castingsUsed = 0;
        p.char.catchBreathUsed = false;
        p.char.nimbleUsed = false;
        p.char.sharedUsed = false;
        p.char.spellRecoveryUsed = false;
        p.char.trickeryUsed = 0;
        p.char.conditions = p.char.conditions.filter(c => c === 'Diseased'); // keep disease over rest
        addLog(room, `${p.name} recovers ${amt} Health and refreshes abilities.`, 'heal');
      });
      addLog(room, 'Rest complete. Press onward.', 'sys');
      break;
    }
    case 'merchant': {
      room.gs.phase = 'merchant';
      room.gs.merchantStock = buildMerchantStockServer();
      addLog(room, '🛒 A hooded merchant emerges from the shadows. "Fine wares for surviving warriors..."', 'sys');
      break;
    }
    case 'loot': {
      room.gs.phase = 'event';
      const roll = d(6);
      if (roll <= 3) {
        const gold = rd(2, 10) + 5 + room.players.filter(p => p.char && p.char.alive).length * 2;
        room.gs.gold += gold;
        addLog(room, `📦 Loot: the warband finds <strong>${gold} shillings</strong> in a dusty satchel.`, 'loot');
      } else {
        addLog(room, '📦 Loot: a cache of healing draughts. One per survivor.', 'loot');
        room.players.forEach(p => { if (p.char && p.char.alive) addToInventory(p.char, 'Healing Draught'); });
      }
      break;
    }
    case 'unknown': {
      room.gs.phase = 'event';
      const r = d(10);
      if (r <= 3) { enterNode(room, 'combat'); return; }
      else if (r <= 5) { enterNode(room, 'loot'); return; }
      else if (r <= 7) { enterNode(room, 'rest'); return; }
      else {
        const gold = rd(1, 8) + 3;
        room.gs.gold += gold;
        addLog(room, `❓ The unknown yields ${gold} shillings and an uneasy feeling.`, 'loot');
      }
      break;
    }
  }
}

function playerTurnMsg(room) {
  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) return '';
  const idx = room.gs.currentTurnIndex % alive.length;
  return `It is <strong>${alive[idx].name}</strong>'s turn.`;
}

function nextTurn(room) {
  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) return;
  room.gs.currentTurnIndex = (room.gs.currentTurnIndex + 1) % alive.length;
  addLog(room, playerTurnMsg(room), 'sys');
}

function handlePlayerAction(room, playerId, payload) {
  const { action, data } = payload;
  const player = room.players.find(p => p.id === playerId);
  if (!player || !player.char || !player.char.alive) return;

  const gs = room.gs;
  const alive = room.players.filter(p => p.char && p.char.alive);
  const myTurnIndex = alive.findIndex(p => p.id === playerId);
  const isMyTurn = gs.phase === 'combat' && myTurnIndex === gs.currentTurnIndex % alive.length;

  // Non-turn actions (use item out of combat, merchant buy, path choose)
  if (action === 'BUY_ITEM') { handleBuy(room, player, data.itemId); return; }
  if (action === 'LEAVE_SHOP') { gs.phase = 'event'; addLog(room, `${player.name} signals the group to move on.`, 'sys'); return; }
  if (action === 'PRESS_ONWARD') {
    if (playerId !== room.hostId && gs.phase !== 'combat') { send(player.ws, { type:'ERROR', payload:{ msg:'Only the host can advance the group.' } }); return; }
    if (gs.depth >= 30) { gs.phase = 'victory'; addLog(room, '🏆 The warband has conquered the depths! FOR SIGMAR!', 'crit'); return; }
    showPathChoices(room);
    return;
  }
  if (action === 'APPLY_PATH') {
    applyNovicePath(player.char, data.pathId);
    addLog(room, `${player.name} walks the <strong>${data.pathId}</strong> path.`, 'spell');
    return;
  }
  if (action === 'USE_ITEM_OOC') { // out of combat item use
    useItemLogic(room, player, data.itemName);
    return;
  }

  if (!isMyTurn) { send(player.ws, { type: 'ERROR', payload: { msg: 'It is not your turn.' } }); return; }

  switch (action) {
    case 'ATTACK': {
      const result = rollAttack(player.char, gs.enemy);
      if (result.fumble) {
        addLog(room, `${player.name} fumbles! The attack fails.`, 'sys');
      } else if (result.hit) {
        gs.enemy.hp -= result.dmg;
        addLog(room, `${player.name} ${result.crit ? '🗡 <strong>Critical Hit!</strong>' : 'hits'} for <strong>${result.dmg}</strong> damage! ${gs.enemy.name} has ${Math.max(0, gs.enemy.hp)}/${gs.enemy.maxHp} HP.`, result.crit ? 'crit' : 'dmg');
        if (gs.enemy.hp <= 0) { resolveEnemyDeath(room); return; }
      } else {
        addLog(room, `${player.name} attacks (${result.total} vs Defense ${gs.enemy.ac}) — misses.`, 'sys');
      }
      enemyAttackAll(room);
      nextTurn(room);
      break;
    }
    case 'CAST_SPELL': {
      const spell = player.char.knownSpells.find(s => s.name === data.spellName);
      if (!spell) return;
      if (spell.rank > 0 && player.char.power - player.char.castingsUsed <= 0) {
        addLog(room, `${player.name} has no castings remaining.`, 'sys'); return;
      }
      if (spell.rank > 0) player.char.castingsUsed++;
      if (spell.heal) {
        const [n, s] = spell.dmg.split('d').map(Number);
        const amt = rd(n, s) + Math.max(0, modVal(player.char.attrs.wil));
        player.char.health = Math.min(player.char.maxHealth, player.char.health + amt);
        addLog(room, `${player.name} casts <strong>${spell.name}</strong> — recovers <strong>${amt}</strong> Health.`, 'heal');
      } else {
        const [n, s] = spell.dmg.split('d').map(Number);
        const dmg = rd(n, s);
        gs.enemy.hp -= dmg;
        addLog(room, `${player.name} casts <strong>${spell.name}</strong> — <strong>${dmg}</strong> damage to ${gs.enemy.name}!`, 'spell');
        if (gs.enemy.hp <= 0) { resolveEnemyDeath(room); return; }
      }
      enemyAttackAll(room);
      nextTurn(room);
      break;
    }
    case 'USE_TALENT': {
      const { talent } = data;
      if (talent === 'catchBreath') {
        if (player.char.catchBreathUsed) { addLog(room, `${player.name}: Catch Your Breath already used.`, 'sys'); return; }
        player.char.catchBreathUsed = true;
        const h = healingRate(player.char);
        player.char.health = Math.min(player.char.maxHealth, player.char.health + h);
        addLog(room, `${player.name} uses Catch Your Breath — recovers <strong>${h}</strong> Health.`, 'heal');
      } else if (talent === 'nimbleRecovery') {
        if (player.char.nimbleUsed) { addLog(room, `${player.name}: Nimble Recovery already used.`, 'sys'); return; }
        player.char.nimbleUsed = true;
        const h = healingRate(player.char);
        player.char.health = Math.min(player.char.maxHealth, player.char.health + h);
        addLog(room, `${player.name} uses Nimble Recovery — recovers <strong>${h}</strong> Health.`, 'heal');
      } else if (talent === 'sharedRecovery') {
        if (player.char.sharedUsed) { addLog(room, `${player.name}: Shared Recovery already used.`, 'sys'); return; }
        player.char.sharedUsed = true;
        const h = healingRate(player.char);
        player.char.health = Math.min(player.char.maxHealth, player.char.health + h);
        addLog(room, `${player.name} uses Shared Recovery — self recovers <strong>${h}</strong> Health.`, 'heal');
      } else if (talent === 'spellRecovery') {
        if (player.char.spellRecoveryUsed) { addLog(room, `${player.name}: Spell Recovery already used.`, 'sys'); return; }
        player.char.spellRecoveryUsed = true;
        const h = healingRate(player.char);
        player.char.health = Math.min(player.char.maxHealth, player.char.health + h);
        player.char.castingsUsed = Math.max(0, player.char.castingsUsed - 1);
        addLog(room, `${player.name} uses Spell Recovery — heals <strong>${h}</strong> HP and regains a casting.`, 'spell');
      }
      enemyAttackAll(room);
      nextTurn(room);
      break;
    }
    case 'USE_ITEM': {
      useItemLogic(room, player, data.itemName, true);
      enemyAttackAll(room);
      nextTurn(room);
      break;
    }
    case 'FLEE': {
      if (gs.enemy && gs.enemy.threat === 'Boss') {
        addLog(room, `${player.name} tries to flee — there is no escape from this foe!`, 'dmg'); return;
      }
      const base = d(20);
      const total = base + modVal(player.char.attrs.agi);
      if (total >= 10) {
        const fleeHit = rd(1, 4);
        player.char.health = Math.max(0, player.char.health - fleeHit);
        addLog(room, `${player.name} flees! Opportunity attack deals <strong>${fleeHit}</strong> damage.`, 'dmg');
        gs.inCombat = false; gs.enemy = null; gs.phase = 'event';
        addLog(room, 'The warband escapes. Press onward.', 'sys');
        checkDeath(room, player);
      } else {
        addLog(room, `${player.name} fails to flee (${total} < DC 10).`, 'sys');
        enemyAttackAll(room);
        nextTurn(room);
      }
      break;
    }
  }
}

function useItemLogic(room, player, itemName, inCombat = false) {
  const char = player.char;
  const idx = char.inventory.findIndex(i => i.name === itemName);
  if (idx === -1) return;
  if (itemName === 'Healing Draught') {
    const h = rd(2, 6) + 2; char.health = Math.min(char.maxHealth, char.health + h);
    addLog(room, `${player.name} drinks a Healing Draught — recovers <strong>${h}</strong> Health.`, 'heal');
  } else if (itemName === 'Greater Healing') {
    const h = rd(4, 6) + 4; char.health = Math.min(char.maxHealth, char.health + h);
    addLog(room, `${player.name} uses Greater Healing — recovers <strong>${h}</strong> Health.`, 'heal');
  } else if (itemName === 'Blessed Wafer') {
    if (char.insanity > 0) { char.insanity--; addLog(room, `${player.name}'s Blessed Wafer calms the mind. Insanity −1.`, 'heal'); }
  } else if (itemName === 'Warpstone Shard') {
    char.power += 2; char.corruption++;
    addLog(room, `${player.name} uses Warpstone Shard — +2 Power, +1 Corruption.`, 'chaos');
  } else if (itemName.startsWith('Scroll:')) {
    const spell = char.scrollSpells[itemName];
    if (!spell) return;
    if (spell.type === 'heal') {
      const amt = rd(3, 6) + 4; char.health = Math.min(char.maxHealth, char.health + amt);
      addLog(room, `${player.name} reads ${itemName} — recovers <strong>${amt}</strong> Health.`, 'heal');
    } else if (inCombat && room.gs.enemy) {
      const dmg = rd(5, 6);
      room.gs.enemy.hp -= dmg;
      addLog(room, `${player.name} reads ${itemName} — <strong>${dmg}</strong> damage!`, 'spell');
      if (room.gs.enemy.hp <= 0) { resolveEnemyDeath(room); return; }
    }
  } else { addLog(room, `${player.name} uses ${itemName}.`, 'sys'); }
  char.inventory[idx].qty--;
  if (char.inventory[idx].qty <= 0) char.inventory.splice(idx, 1);
}

function enemyAttackAll(room) {
  if (!room.gs.enemy || !room.gs.inCombat) return;
  const e = room.gs.enemy;
  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) return;
  // Enemy attacks all players in the group each round
  alive.forEach(p => {
    const result = rollEnemyAttack(e, p.char);
    if (result.hit) {
      p.char.health = Math.max(0, p.char.health - result.dmg);
      addLog(room, `${e.name} attacks ${p.name} — <strong>${result.dmg}</strong> damage!${result.crit ? ' (Critical!)' : ''}`, 'dmg');
      if (e.lifeLeech) { const l = Math.floor(result.dmg / 2); e.hp = Math.min(e.maxHp, e.hp + l); addLog(room, `${e.name} leeches ${l} HP!`, 'chaos'); }
      if (e.insanityAtk && d(6) >= 4) { p.char.insanity++; addLog(room, `${p.name} gains 1 Insanity from the horror!`, 'chaos'); }
      if (e.diseased && d(6) >= 5 && !p.char.conditions.includes('Diseased')) { p.char.conditions.push('Diseased'); addLog(room, `${p.name} contracts disease!`, 'chaos'); }
      checkDeath(room, p);
    } else {
      addLog(room, `${e.name} attacks ${p.name} (${result.total} vs Defense ${p.char.defense}) — misses.`, 'sys');
    }
  });
  // Regen
  if (e.regen && e.hp < e.maxHp) { const r = rd(1, 6); e.hp = Math.min(e.maxHp, e.hp + r); addLog(room, `${e.name} regenerates ${r} HP.`, 'chaos'); }
}

function checkDeath(room, player) {
  if (player.char.health <= 0) {
    player.char.alive = false;
    player.char.health = 0;
    addLog(room, `💀 <strong>${player.name}</strong> has fallen!`, 'death');
    const stillAlive = room.players.filter(p => p.char && p.char.alive);
    if (stillAlive.length === 0) {
      room.gs.phase = 'gameover';
      addLog(room, 'The entire warband has fallen. Reikland weeps.', 'death');
    }
  }
}

function resolveEnemyDeath(room) {
  const e = room.gs.enemy;
  addLog(room, `⚔ <strong>${e.name}</strong> is slain! The warband is victorious!`, 'crit');
  const xpEach = e.xp;
  const gold = rd(e.gold[0] || 1, e.gold[1] || 6);
  room.gs.gold += gold;
  addLog(room, `Each survivor gains <strong>${xpEach}</strong> XP. Found <strong>${gold}</strong> shillings.`, 'loot');
  room.players.forEach(p => {
    if (!p.char || !p.char.alive) return;
    p.char.xp += xpEach;
    const lvResult = checkLevelUp(p.char);
    if (lvResult.leveled) addLog(room, `🌟 ${p.name} reaches <strong>Level ${lvResult.newLevel}</strong>! +${lvResult.hpGain} max Health.`, 'spell');
  });
  room.gs.inCombat = false;
  room.gs.enemy = null;
  room.gs.phase = 'event';
  room.gs.currentTurnIndex = 0;
  if (room.gs.depth >= 30) { room.gs.phase = 'victory'; addLog(room, '🏆 The warband has conquered the depths! FOR SIGMAR!', 'crit'); }
}

function applyNovicePath(char, pathId) {
  char.novicePath = pathId;
  const np = NOVICE_PATHS[pathId];
  if (!np) return;
  char.maxHealth += np.hpL1; char.health += np.hpL1;
  if (np.power) { char.power += np.power; char.maxPower += np.power; }
  if (np.weaponTraining) char.weaponTraining = true;
  if (np.catchBreath) char.catchBreath = true;
  if (np.trickery) char.trickery = true;
  if (np.nimbleRecovery) char.nimbleRecovery = true;
  if (np.spellRecovery) char.spellRecovery = true;
  if (np.sharedRecovery) char.sharedRecovery = true;
}

// ── Merchant stock generation
const WEAPON_BASES = [
  {name:'Reiklander Sword',dice:'1d8',stat:'str'},{name:'Duelling Sabre',dice:'1d6',stat:'agi'},
  {name:'War Axe',dice:'1d8',stat:'str'},{name:'Halberd',dice:'1d10',stat:'str'},
  {name:'Crossbow',dice:'1d8',stat:'agi'},{name:'Silvered Rapier',dice:'1d6',stat:'agi'},
];
const ARMOR_BASES = [
  {name:'Leather Jack',def:1},{name:'Chain Shirt',def:2},{name:'Breastplate',def:3},{name:'Full Plate',def:4},
];
const SCROLL_SPELLS_S = [
  {name:'Fireball',desc:'8d6 fire damage',type:'attack'},{name:'Smite',desc:'4d6 holy damage',type:'attack'},
  {name:'Cure Wounds',desc:'Heal 3d6+4 HP',type:'heal'},{name:'Lightning Bolt',desc:'6d6 lightning',type:'attack'},
  {name:"Sigmar's Wrath",desc:'5d6 holy damage',type:'attack'},
];
const CONSUMABLES_S = ['Healing Draught','Greater Healing','Vial of Antitoxin','Blessed Wafer','Warpstone Shard'];

function genWpn() {
  const b = WEAPON_BASES[Math.floor(Math.random()*WEAPON_BASES.length)];
  const bonus = d(6);
  return { id:'w'+Date.now()+Math.random(), name:b.name, dice:b.dice, stat:b.stat, bonus, cost:15+bonus*8, bought:false, type:'weapon', desc:`${b.dice}+${bonus} · ${b.stat.toUpperCase()}` };
}
function genArmor() {
  const b = ARMOR_BASES[Math.floor(Math.random()*ARMOR_BASES.length)];
  const bonus = d(6);
  return { id:'a'+Date.now()+Math.random(), name:b.name, defBonus:b.def+bonus, cost:20+bonus*10, bought:false, type:'armor', desc:`+${b.def+bonus} Defense` };
}
function genScroll() {
  const sp = SCROLL_SPELLS_S[Math.floor(Math.random()*SCROLL_SPELLS_S.length)];
  return { id:'s'+Date.now()+Math.random(), name:`Scroll: ${sp.name}`, spell:sp, cost:18+d(20), bought:false, type:'scroll', desc:sp.desc };
}
function buildMerchantStockServer() {
  const cons = CONSUMABLES_S.sort(()=>Math.random()-0.5).slice(0,3).map((n,i)=>({id:'c'+i,name:n,cost:10+i*3,bought:false,type:'consumable',desc:'Consumable'}));
  return {
    weaponEnhance:{id:'we',name:'Weapon Enhancement',desc:'+1 dmg & +1 boon on attacks',cost:25,bought:false,type:'enhance'},
    statBoost:{id:'sb',name:'+1 Primary Stat',desc:'Increase your highest attribute by 1',cost:35,bought:false,type:'statboost'},
    weapon1:genWpn(), weapon2:genWpn(), armor:genArmor(),
    consumables:cons, scroll:genScroll(),
  };
}

function addToInventory(char, name) {
  const ex = char.inventory.find(i => i.name === name);
  if (ex) ex.qty++;
  else char.inventory.push({ name, qty: 1 });
}

function handleBuy(room, player, itemId) {
  const stock = room.gs.merchantStock;
  if (!stock) return;
  const allItems = [stock.weaponEnhance, stock.statBoost, stock.weapon1, stock.weapon2, stock.armor, stock.scroll, ...stock.consumables];
  const item = allItems.find(i => i.id === itemId);
  if (!item || item.bought) { send(player.ws, { type:'ERROR', payload:{ msg:'Already sold.' } }); return; }
  if (room.gs.gold < item.cost) { send(player.ws, { type:'ERROR', payload:{ msg:'Not enough gold.' } }); return; }
  room.gs.gold -= item.cost;
  item.bought = true;
  const char = player.char;
  if (item.type === 'enhance') {
    char.weaponDmgBonus++; char.weaponAtkBonus++;
    addLog(room, `${player.name} applies Weapon Enhancement — +1 dmg, +1 boon.`, 'loot');
  } else if (item.type === 'statboost') {
    const ks = Object.keys(char.attrs);
    let best = ks[0];
    ks.forEach(k => { if (modVal(char.attrs[k]) > modVal(char.attrs[best])) best = k; });
    char.attrs[best]++;
    addLog(room, `${player.name} gains +1 ${best.toUpperCase()} (now ${char.attrs[best]}).`, 'loot');
  } else if (item.type === 'weapon') {
    char.equippedWeapon = item;
    addLog(room, `${player.name} equips ${item.name} (${item.dice}+${item.bonus}).`, 'loot');
  } else if (item.type === 'armor') {
    const old = char.equippedArmorDef || 0;
    char.equippedArmorDef = item.defBonus;
    char.defense += (item.defBonus - old);
    addLog(room, `${player.name} equips ${item.name} (+${item.defBonus} Defense).`, 'loot');
  } else if (item.type === 'scroll') {
    addToInventory(char, item.name);
    char.scrollSpells[item.name] = item.spell;
    addLog(room, `${player.name} buys ${item.name}.`, 'loot');
  } else if (item.type === 'consumable') {
    addToInventory(char, item.name);
    addLog(room, `${player.name} buys ${item.name}.`, 'loot');
  }
}

// ──────────────────────────────────────────────
// WEBSOCKET LIFECYCLE
// ──────────────────────────────────────────────
wss.on('connection', ws => {
  ws.on('message', raw => {
    try { handleMessage(ws, JSON.parse(raw)); } catch (e) { console.error('Message error:', e); }
  });
  ws.on('close', () => {
    const ctx = clients.get(ws);
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (room) {
      const player = room.players.find(p => p.id === ctx.playerId);
      if (player) {
        player.connected = false;
        addLog(room, `${player.name} disconnected.`, 'sys');
        broadcastState(ctx.roomCode);
      }
      // Clean up empty rooms after 10 min
      setTimeout(() => {
        if (room.players.every(p => !p.connected)) rooms.delete(ctx.roomCode);
      }, 600000);
    }
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shadows Over Reikland running on port ${PORT}`));
