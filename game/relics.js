'use strict';
// Relics: run-long passives. After every elite or boss fight (and on taking a
// Cursed Path) each warrior picks one of three. Effects hook into combat through
// hasRelic(); the one-off ones (max HP, Power, to-hit, damage) apply on pick.
//
// After a boss in a party there is also a Champion's Prize: one extra legendary
// item the warband rolls for. Everyone chooses Need or Pass; a d20 decides among
// those who need it.
const { d } = require('./dice');

const S = {};
function bind(api) { Object.assign(S, api); }

const RELICS = {
  ironHeart:     { name: 'Iron Heart',          icon: '❤', desc: '+6 max HP.' },
  grimoire:      { name: 'Forbidden Grimoire',  icon: '📕', desc: '+1 Power (more spell castings).' },
  whetstone:     { name: 'Whetstone of Ages',   icon: '🪨', desc: '+1 damage on every weapon hit.' },
  horseshoe:     { name: 'Lucky Horseshoe',     icon: '🧲', desc: '+1 to hit with weapons.' },
  bloodChalice:  { name: "Executioner's Ledger", icon: '📜', desc: 'Whenever an enemy dies, your next weapon hit deals +1d6.' },
  vampireFang:   { name: 'Serrated Fang',       icon: '🦷', desc: 'Your weapon hits also make the target Bleed.' },
  wardingSigil:  { name: 'Warding Sigil',       icon: '🔰', desc: 'Take 1 less damage from every enemy hit.' },
  pilgrimBoots:  { name: 'Iron-shod Boots',     icon: '🥾', desc: 'You can never be stunned or knocked down.' },
  tollingBell:   { name: 'Tolling Bell',        icon: '🔔', desc: 'At the start of every fight, enemies are Shaken: 1 bane on their first attack.' },
  stormstone:    { name: 'Stormstone',          icon: '⚡', desc: 'Your critical hits deal +1d6.' },
  hunterTrophy:  { name: "Hunter's Trophy",     icon: '🦴', desc: '+1d6 damage on hits against elites and bosses.' },
  mirrorShard:   { name: 'Mirror Shard',        icon: '🪞', desc: '15% chance to reflect half the damage of a hit back at the attacker.' },
  phoenixFeather:{ name: 'Phoenix Feather',     icon: '🪶', desc: 'Once per run, survive a killing blow with 1 HP.' },
  quicksilver:   { name: 'Quicksilver Vial',    icon: '⚗', desc: '+1 casting of each rank at the start of every fight.' },
  battleStandard:{ name: 'Tattered Standard',   icon: '🚩', desc: '2 boons on your first attack every fight.' },
  surgeonKit:    { name: "Surgeon's Kit",       icon: '🩹', desc: 'Healing draughts heal you 3 more.' },
  ravenCloak:    { name: 'Ravenfeather Cloak',  icon: '🐦', desc: '+1 Defence.' },
  giantTooth:    { name: "Giant's Tooth",       icon: '🦷', desc: '+4 max HP and +1 damage reduction.' },
  witchfire:     { name: 'Witchfire Lantern',   icon: '🏮', desc: 'Your damage spells deal +2 damage.' },
  bloodRuby:     { name: 'Blood Ruby',          icon: '💎', desc: 'Whenever an enemy dies, heal 2 HP.' },
  goldenTooth:   { name: 'Golden Tooth',        icon: '🪙', desc: '+25% silver from every fight.' },
  thornSeed:     { name: 'Thornseed of Athel Loren', icon: '🌿', desc: 'Enemies that hit you take 2 damage.' },
};

const hasRelic = (c, k) => !!(c && c.relics && c.relics.includes(k));

function applyOnPick(c, k) {
  if (k === 'ironHeart') { c.maxHealth += 6; c.health = Math.min(c.maxHealth, c.health + 6); }
  if (k === 'grimoire') { c.power += 1; c.maxPower = (c.maxPower || 0) + 1; S.refreshCastingPools(c); }
  if (k === 'whetstone') c.weaponDmgBonus = (c.weaponDmgBonus || 0) + 1;
  if (k === 'horseshoe') c.weaponAtkBonus = (c.weaponAtkBonus || 0) + 1;
  if (k === 'ravenCloak') c.defense += 1;
  if (k === 'giantTooth') { c.maxHealth += 4; c.health = Math.min(c.maxHealth, c.health + 4); }
}

function grantRelic(c, k) {
  c.relics = c.relics || [];
  if (c.relics.includes(k) || !RELICS[k]) return false;
  c.relics.push(k); applyOnPick(c, k); return true;
}

function optionsFor(c) {
  const pool = Object.keys(RELICS).filter(k => !hasRelic(c, k) && !(k === 'grimoire' && !c.spellcaster) && !(k === 'quicksilver' && !c.spellcaster) && !(k === 'witchfire' && !c.spellcaster));
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

// Start a relic choice. `next` says what follows: 'path' (crossroads) or 'event' (press onward).
function offerRelics(room, next, withPrize) {
  const gs = room.gs, alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length) return false;
  alive.forEach(p => { p.char.relicOptions = optionsFor(p.char); });
  // Someone who already carries every relic has nothing to choose (long Endless runs).
  gs.relic = { next, picked: alive.filter(p => !p.char.relicOptions.length).map(p => p.id), prize: null };
  if (withPrize && alive.length > 1) {
    const item = S.genLegendaryItem(Math.max(0, (gs.bossCount || 1) - 1));
    gs.relic.prize = { item, votes: {} };
  }
  if (gs.relic.picked.length === alive.length && !gs.relic.prize) { gs.relic = null; alive.forEach(p => { p.char.relicOptions = null; }); return false; }
  gs.phase = 'relic';
  S.addLog(room, `✨ <strong>Relics.</strong> Each warrior chooses one to carry for the rest of the run.${gs.relic.prize ? ` And a <strong>Champion's Prize</strong> lies among the spoils: ${gs.relic.prize.item.name}.` : ''}`, 'loot');
  return true;
}

function pickRelic(room, playerId, key) {
  const gs = room.gs, rel = gs.relic; if (gs.phase !== 'relic' || !rel) return;
  const p = room.players.find(x => x.id === playerId); if (!p || !p.char || rel.picked.includes(playerId)) return;
  if (!(p.char.relicOptions || []).includes(key)) return;
  grantRelic(p.char, key); p.char.relicOptions = null; rel.picked.push(playerId);
  S.addLog(room, `${RELICS[key].icon} ${p.name} takes the <strong>${RELICS[key].name}</strong> — ${RELICS[key].desc}`, 'loot');
  maybeFinish(room);
}

function votePrize(room, playerId, choice) {
  const gs = room.gs, rel = gs.relic; if (gs.phase !== 'relic' || !rel || !rel.prize) return;
  if (choice !== 'need' && choice !== 'pass') return;
  rel.prize.votes[playerId] = choice;
  maybeFinish(room);
}

function maybeFinish(room) {
  const gs = room.gs, rel = gs.relic;
  const here = room.players.filter(p => p.char && p.char.alive && p.connected);
  if (!here.every(p => rel.picked.includes(p.id))) return;
  if (rel.prize && !here.every(p => rel.prize.votes[p.id])) return;
  if (rel.prize) {
    const needers = here.filter(p => rel.prize.votes[p.id] === 'need');
    if (needers.length) {
      const rolls = needers.map(p => ({ p, r: d(20) }));
      rolls.sort((a, b) => b.r - a.r);
      const win = rolls[0].p; S.addToInventory(win.char, rel.prize.item.name, rel.prize.item);
      S.addLog(room, `🎲 Champion's Prize — ${rolls.map(x => `${x.p.name} ${x.r}`).join(', ')}. <strong>${win.name}</strong> takes the ${rel.prize.item.name}!`, 'loot');
    } else {
      const gold = 60; here.forEach(p => { p.char.gold += Math.floor(gold / here.length); });
      S.addLog(room, `💰 Nobody claims the ${rel.prize.item.name}; the warband sells it and splits ${gold} silver.`, 'loot');
    }
  }
  room.players.forEach(p => { if (p.char) p.char.relicOptions = null; });
  const next = rel.next; gs.relic = null;
  if (next === 'path') S.showPathChoices(room); else gs.phase = 'event';
}

// Renown unlock: start the run with one relic.
function grantStartRelic(c) {
  if ((c.relics || []).length) return null;
  const k = optionsFor(c)[0]; if (k) grantRelic(c, k); return k;
}

module.exports = { grantStartRelic, optionsFor, bind, RELICS, hasRelic, grantRelic, offerRelics, pickRelic, votePrize, maybeFinish };
