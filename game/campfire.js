'use strict';
// The campfire: each warrior chooses to rest (heal half, steady the mind, shake
// off curses, a boon in the next fight) or to spend the night upgrading their
// weapon or armour instead. Everyone gets their abilities and castings back.
const S = {};
function bind(api) { Object.assign(S, api); }

const MAX_UPGRADES = 3;          // weapons
const ARMOR_UPGRADES = 2;        // armour
const ARMOR_UPGRADE_MAX_DEF = 5; // armour above +5 Defence can't be reinforced
const alive = room => room.players.filter(p => p.char && p.char.alive);

function upgradeOptions(c) {
  const out = [];
  const w = c.equippedWeapon, a = c.equippedArmor;
  if (w && (w.upgrades || 0) < MAX_UPGRADES) out.push({ slot: 'weapon', name: w.name, now: w.upgrades || 0, max: MAX_UPGRADES, what: '+1 damage' });
  // Armour: twice at most, and only light-to-medium armour (+5 or less) — heavy armour can't be reinforced further.
  if (a && (a.upgrades || 0) < ARMOR_UPGRADES && (a.defBonus || 0) <= ARMOR_UPGRADE_MAX_DEF) out.push({ slot: 'armor', name: a.name, now: a.upgrades || 0, max: ARMOR_UPGRADES, what: '+1 Defence' });
  return out;
}

function startCampfire(room) {
  const gs = room.gs;
  gs.phase = 'campfire';
  gs.campfire = { choices: {} };
  alive(room).forEach(p => { p.char.campOptions = upgradeOptions(p.char); });
  S.addLog(room, '🔥 <strong>A campfire.</strong> Each warrior may rest, or spend the night working on their weapon or armour.', 'heal');
}

function choose(room, playerId, choice, slot) {
  const gs = room.gs, cf = gs.campfire;
  if (gs.phase !== 'campfire' || !cf) return;
  const p = room.players.find(x => x.id === playerId); if (!p || !p.char || !p.char.alive || cf.choices[playerId]) return;
  if (choice === 'upgrade') { if (!(p.char.campOptions || []).some(o => o.slot === slot)) return; cf.choices[playerId] = { choice, slot }; }
  else if (choice === 'rest') cf.choices[playerId] = { choice };
  else return;
  maybeFinish(room);
}

function rest(room, p) {
  const gs = room.gs, c = p.char;
  const amt = Math.ceil(c.maxHealth * 0.5 * S.dark.restFactor(c) * (S.foes.hasMutator(gs, 'leanTimes') ? 0.5 : 1) * (S.foes.hasMutator(gs, 'vampiricPact') ? 0 : 1));
  c.health = Math.min(c.maxHealth, c.health + amt);
  if (c.insanity) S.dark.loseInsanity(c, 1);
  S.cleanseCurses(c, true);
  S.addBuff(c, 'Well Rested', { atkBoon: 1, consumeOnAttack: true }, 99);
  S.addLog(room, `💤 ${p.name} rests by the fire — <strong class="num-heal">+${amt} HP</strong>, a calmer mind, and 1 boon in the next fight.`, 'heal');
}

function upgrade(room, p, slot) {
  const c = p.char;
  if (slot === 'weapon' && c.equippedWeapon) {
    const w = c.equippedWeapon; w.upgrades = (w.upgrades || 0) + 1; w.bonus = (w.bonus || 0) + 1;
    w.desc = `${w.dice}+${w.bonus} · ${String(w.stat || '').toUpperCase()} · ${w.dmgType || ''}${w.special ? ' — ' + w.special.desc : ''} · honed ×${w.upgrades}`;
    S.addLog(room, `⚒ ${p.name} hones the <strong>${w.name}</strong> through the night — <strong>+1 damage</strong> (upgrade ${w.upgrades}/${MAX_UPGRADES}).`, 'loot');
  } else if (slot === 'armor' && c.equippedArmor) {
    const a = c.equippedArmor; a.upgrades = (a.upgrades || 0) + 1; a.defBonus = (a.defBonus || 0) + 1; c.defense += 1;
    a.desc = `+${a.defBonus} Defence${a.special ? ' — ' + a.special.desc : ''} · reinforced ×${a.upgrades}`;
    S.addLog(room, `⚒ ${p.name} rivets and patches the <strong>${a.name}</strong> — <strong>+1 Defence</strong> (upgrade ${a.upgrades}/${ARMOR_UPGRADES}).`, 'loot');
  }
}

// Things everyone gets from a night at camp, rested or not.
function campReset(c) {
  c.catchBreathUsed = false; c.nimbleUsed = false; c.sharedUsed = false;
  c.pacedStrikesUsed = false; c.rageBoon = false; c.metamagicUsed = false; c.overcastUsed = false;
  c.trickeryUsed = false; c.sharpeningStone = false; c.divineSmiteUsed = false; c._divineSmiteCount = 0;
  c.massHealUsed = false; c.resurrectionUsed = false; c.rallyingUsed = false; c.spellsurgeUsed = false; c.miracleUsed = false;
  // unstoppableUsed intentionally NOT reset (once per run)
  c.conditions = (c.conditions || []).filter(x => x === 'Diseased');
  (c.activeBuffs || []).forEach(b => { if (b.defBonus) c.defense -= b.defBonus; }); // undo buff defence before clearing
  c.activeBuffs = [];
}

function maybeFinish(room) {
  const gs = room.gs, cf = gs.campfire; if (!cf) return;
  const here = alive(room).filter(p => p.connected);
  if (!here.every(p => cf.choices[p.id])) return;
  alive(room).forEach(p => {
    campReset(p.char);
    const ch = cf.choices[p.id] || { choice: 'rest' }; // anyone away just rests
    if (ch.choice === 'upgrade') upgrade(room, p, ch.slot); else rest(room, p);
    p.char.campOptions = null;
  });
  S.restorePower(room, 'Rest site');
  gs.campfire = null; gs.phase = 'event';
  S.addLog(room, 'The fire burns low. The warband is ready to move on.', 'sys');
}

module.exports = { bind, MAX_UPGRADES, ARMOR_UPGRADES, ARMOR_UPGRADE_MAX_DEF, upgradeOptions, startCampfire, choose, maybeFinish };
