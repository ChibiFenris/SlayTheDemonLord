'use strict';
// The newer weapon and armour traits, charms and relics, in one place. The combat
// code calls these hooks at fixed points (attack roll, a hit landing, a hit taken,
// an enemy's attack roll, the start of a fight, an enemy dying, healing draughts,
// spell damage), the same way it calls the heirloom hooks.
const { rd, d } = require('./dice');
const relics = require('./relics');

const wt = c => (c && c.equippedWeapon && c.equippedWeapon.traits) || [];
const at = c => (c && c.equippedArmor && c.equippedArmor.traits) || [];
const ck = c => (c && c.equippedCharm ? c.equippedCharm.key : null);
const has = (c, k) => relics.hasRelic(c, k);
const tagged = (e, ...t) => !!(e && e.tags && t.some(x => e.tags.includes(x)));
const isBossOrElite = e => e && (e.threat === 'Boss' || e.threat === 'Elite' || e.isElite);

// Defence from a weapon's traits (applied when it is equipped or taken off).
const weaponDefence = w => { const t = (w && w.traits) || []; return (t.includes('guarding') ? 1 : 0) - (t.includes('cumbersome') ? 1 : 0); };
// Defence from an armour's traits (counted with the armour type's dodge).
const armourTraitDefence = a => { const t = (a && a.traits) || []; return (t.includes('lightweight') ? 1 : 0) - (t.includes('illfitting') ? 1 : 0); };
// Extra damage reduction that isn't the armour itself.
const extraDR = c => (has(c, 'giantTooth') ? 1 : 0) + (ck(c) === 'daemonBracer' ? 2 : 0);

// Start of every fight.
function fightStart(c, corrupt) {
  c._firstAttackDone = false; c._firstHitDone = false; c._ratTailReady = ck(c) === 'ratTail';
  c._steadfastReady = at(c).includes('steadfast'); c._thornBoon = 0;
  if (wt(c).includes('tainted') && d(6) === 1 && corrupt) corrupt(c.equippedWeapon.name);
}
// Weapon attack roll: to-hit, boons, banes and whether a 2 is a fumble.
function attackMods(c) {
  const out = { atk: 0, boons: 0, banes: 0, fumbleOn2: wt(c).includes('illomened') };
  const ch = ck(c);
  if (!c._firstAttackDone) {
    if (has(c, 'battleStandard')) out.boons += 2;
    if (ch === 'huntersHorn') out.boons += 2;
    c._firstAttackDone = true;
  }
  if (ch === 'verenaScales' && c.health < c.maxHealth / 2) out.boons++;
  if (ch === 'thornCrown' && c._thornBoon) { out.boons++; c._thornBoon = 0; }
  return out;
}
// A weapon hit landed. fx: poison(n), burn(n), bleed(), stun(), heal(n). Returns bonus damage and log notes.
function onHit(c, enemy, r, fx) {
  let bonus = 0; const notes = [];
  const t = wt(c), ch = ck(c);
  if (t.includes('sundering') && (enemy._sunderStacks || 0) < 3) { enemy._sunderStacks = (enemy._sunderStacks || 0) + 1; enemy.ac = Math.max(1, (enemy.ac || 10) - 1); }
  if (t.includes('thirsting') && c.health < c.maxHealth) fx.heal(1);
  if (t.includes('flaming') && r.crit) { fx.burn(1); notes.push('Flaming'); }
  if (t.includes('crushing') && r.crit) { fx.stun(); notes.push('Crushing blow — stunned'); }
  if (t.includes('headsman') && enemy.hp <= enemy.maxHp / 4) { bonus += 3; notes.push("Headsman's +3"); }
  if (t.includes('baneforged') && tagged(enemy, 'skaven', 'greenskin', 'vermin')) bonus += 2;
  if (t.includes('rending') && r.crit) { const x = rd(1, 6); bonus += x; notes.push(`Rending +${x}`); }
  if (t.includes('tainted')) bonus += 1;
  if (ch === 'ulricFang') bonus += c.row === 'back' ? -1 : 1;
  if (ch === 'shallyaDove') bonus -= 1;
  if (ch === 'verenaScales' && c.health >= c.maxHealth / 2) bonus -= 1;
  if (ch === 'orcTooth' && !c._firstHitDone) { const x = rd(1, 6); bonus += x; notes.push(`Orc-Tooth +${x}`); }
  c._firstHitDone = true;
  return { bonus, notes };
}
// An enemy is rolling to hit this warrior: extra to-hit for the enemy and banes.
function vsEnemyAttack(c, enemy, room) {
  let atk = 0, banes = 0;
  const round = room && room.gs ? room.gs.roundNumber : 0, ch = ck(c), t = at(c);
  if (t.includes('hallowed') && (tagged(enemy, 'undead', 'daemon') || enemy.undead)) banes++;
  if (t.includes('camouflaged') && c.row === 'back' && round <= 2) banes++;
  if (ch === 'orcTooth' && round === 1) atk++;
  if (ch === 'huntersHorn' && round === 1) atk += 2;
  if (ch === 'ulricFang') atk += c.row === 'back' ? 1 : -1;
  return { atk, banes };
}
// Should this attack simply miss? (Lucky Rat-Tail)
function autoMiss(c) { if (c._ratTailReady) { c._ratTailReady = false; return true; } return false; }
// An enemy hit this warrior for dmg (before armour). Returns the new damage; reflect(n) hurts the attacker.
function onHitTaken(c, ae, dmg, r, reflect) {
  const t = at(c), notes = [];
  if (t.includes('runewarded') && ae.ranged) dmg = Math.max(1, dmg - 2);
  if (ck(c) === 'thornCrown') { dmg += 1; c._thornBoon = 1; }
  if (t.includes('spiked')) { const x = rd(1, 3); reflect(x); notes.push(`spikes ${x}`); }
  if (has(c, 'thornSeed')) { reflect(2); notes.push('thorns 2'); }
  if (t.includes('shoddy') && r && r.crit && c.equippedArmor && (c.equippedArmor.dr || 0) > 1) { c.equippedArmor.dr--; notes.push(`${c.equippedArmor.name} weakens (DR ${c.equippedArmor.dr})`); }
  return { dmg, notes };
}
// Stuns: a Steadfast armour shrugs off the first one each fight.
function resistStun(c) { if (c && c._steadfastReady) { c._steadfastReady = false; return true; } return false; }
// Healing draughts drunk by this warrior.
function draughtHeal(c, h) {
  if (ck(c) === 'shallyaDove') h *= 2;
  if (has(c, 'surgeonKit')) h += 3;
  if (ck(c) === 'daemonBracer') h = Math.ceil(h / 2);
  return h;
}
// Damage spells cast by this warrior.
const spellDamage = c => (has(c, 'witchfire') ? 2 : 0) - (at(c).includes('stifling') ? 1 : 0);
// An enemy died.
function onEnemyDeath(c) { if (has(c, 'bloodRuby') && c.alive && c.health < c.maxHealth) c.health = Math.min(c.maxHealth, c.health + 2); }
// Silver from a fight.
const silverMult = c => (has(c, 'goldenTooth') ? 1.25 : 1);
// Charms with lasting stat changes.
function applyCharm(c, item, on) {
  if (!item) return; const s = on ? 1 : -1;
  if (item.key === 'hourglass') { c.maxHealth -= 4 * s; c.health = Math.max(1, Math.min(c.maxHealth, c.health - (on ? 4 : 0))); }
}

module.exports = { weaponDefence, armourTraitDefence, extraDR, fightStart, attackMods, onHit, vsEnemyAttack, autoMiss, onHitTaken, resistStun, draughtHeal, spellDamage, onEnemyDeath, silverMult, applyCharm, isBossOrElite };
