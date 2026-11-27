'use strict';
// Heirlooms: gear made by and for one people. Anyone can carry and use one as an
// ordinary weapon, armour or charm, but its special power only wakes for its own
// people. They turn up in treasure caches, at merchants and on elites and bosses,
// and each warrior only ever finds the heirlooms of their own people.
const { v4: uuidv4 } = require('uuid');
const { rd, d } = require('./dice');
const { pickRandom } = require('./util');

const HEIRLOOMS = {
  // ── Dwarf ──────────────────────────────────────────────────────────────────
  runeAxe:      { people: 'dwarf', type: 'weapon', name: 'Rune Axe of Grimnir', dice: '1d10', stat: 'str', dmgType: 'slashing', bonus: 1,
                  power: 'Rune of Cleaving: your hits ignore enemy damage reduction and deal +2 damage.' },
  gromrilMail:  { people: 'dwarf', type: 'armor', name: 'Gromril Mail', def: 6,
                  power: 'Rune of Stone: every hit you take deals 1 less damage.' },
  grudgeStone:  { people: 'dwarf', type: 'charm', name: 'Grudgestone',
                  power: 'Remember the grudge: +1d6 damage against any enemy that has hurt you this fight.' },
  // ── Wood Elf ───────────────────────────────────────────────────────────────
  hagbaneBow:   { people: 'woodelf', type: 'weapon', name: 'Hagbane Bow', dice: '1d6', stat: 'agi', dmgType: 'piercing', bonus: 1,
                  power: 'Hagbane tips: every hit adds 2 poison.' },
  moonfireBow:  { people: 'woodelf', type: 'weapon', name: 'Moonfire Bow', dice: '1d8', stat: 'agi', dmgType: 'piercing', bonus: 0,
                  power: 'Moonfire shafts: +1d4 magic damage on every hit, and your crits set the target Burning.' },
  ishaCloak:    { people: 'woodelf', type: 'armor', name: "Cloak of Isha's Leaves", def: 3,
                  power: 'While you stand in the back row, enemies attack you with 1 bane.' },
  // ── High Elf ───────────────────────────────────────────────────────────────
  hoethBlade:   { people: 'highelf', type: 'weapon', name: 'Blade of Hoeth', dice: '1d8', stat: 'int', dmgType: 'slashing', bonus: 1,
                  power: 'Each hit also deals 1d4 + your Power in holy damage.' },
  phoenixPlate: { people: 'highelf', type: 'armor', name: 'Phoenix-Crested Ithilmar', def: 5,
                  power: 'Once per fight, a blow that would fell you leaves you at a quarter of your HP instead.' },
  seerstone:    { people: 'highelf', type: 'charm', name: 'Seerstone of Saphery',
                  power: '+1 Power while you wear it, and your first spell each fight costs no casting.' },
  // ── Bretonnia ──────────────────────────────────────────────────────────────
  questingBlade:{ people: 'bretonnia', type: 'weapon', name: 'Questing Blade', dice: '1d8', stat: 'wil', dmgType: 'slashing', bonus: 2,
                  power: 'The Lance Charge: your first hit each fight deals +2d6.' },
  grailPlate:   { people: 'bretonnia', type: 'armor', name: 'Grail-Blessed Plate', def: 5,
                  power: 'Heal 1 HP at the end of every round, and you cannot gain Insanity.' },
  ladysFavour:  { people: 'bretonnia', type: 'charm', name: "The Lady's Favour",
                  power: 'The first hit against you each fight deals no damage.' },
  // ── Empire ─────────────────────────────────────────────────────────────────
  hochlandRifle:{ people: 'empire', type: 'weapon', name: 'Hochland Long Rifle', dice: '1d10', stat: 'agi', dmgType: 'piercing', bonus: 1,
                  power: 'From the back row: +2 to hit, and crits on 19–20.' },
  runefang:     { people: 'empire', type: 'weapon', name: 'Runefang of the Reik', dice: '1d10', stat: 'str', dmgType: 'slashing', bonus: 2,
                  power: 'Hits ignore damage reduction and deal +1d6 against elites and bosses.' },
  reiksguardPlate:{ people: 'empire', type: 'armor', name: 'Reiksguard Plate', def: 5,
                  power: 'While you are above half HP, your attacks get +1 boon.' },
};
const PEOPLE_NAMES = { empire: 'the Empire', bretonnia: 'Bretonnia', dwarf: 'the Dwarfs', highelf: 'Ulthuan', woodelf: 'Athel Loren' };

// Build an item from a heirloom, a little stronger after each boss.
function make(key, bossCount = 0) {
  const h = HEIRLOOMS[key]; if (!h) return null;
  const from = `Heirloom of ${PEOPLE_NAMES[h.people]}`;
  const base = { heirloom: key, people: h.people, name: h.name, cost: 0, sellCost: 8, bought: false };
  if (h.type === 'weapon') {
    const bonus = h.bonus + Math.min(3, bossCount);
    return { ...base, id: 'hw' + uuidv4(), type: 'weapon', dice: h.dice, stat: h.stat, bonus, dmgType: h.dmgType, special: null,
      desc: `${h.dice}+${bonus} · ${h.stat.toUpperCase()} · ${h.dmgType} — ${from}: ${h.power}` };
  }
  if (h.type === 'armor') {
    const def = h.def + Math.min(2, bossCount);
    return { ...base, id: 'ha' + uuidv4(), type: 'armor', defBonus: def, special: null, desc: `+${def} Defence — ${from}: ${h.power}` };
  }
  return { ...base, id: 'hc' + uuidv4(), type: 'charm', key: 'heirloom_' + key, desc: `${from}: ${h.power}` };
}

// The heirlooms of a people this warrior hasn't found yet (any, once all are found).
function roll(c, bossCount = 0) {
  const all = Object.keys(HEIRLOOMS).filter(k => HEIRLOOMS[k].people === c.career);
  if (!all.length) return null;
  const fresh = all.filter(k => !(c.heirloomsFound || []).includes(k));
  const key = pickRandom(fresh.length ? fresh : all);
  c.heirloomsFound = [...new Set([...(c.heirloomsFound || []), key])];
  return make(key, bossCount);
}

// Is this heirloom equipped, and is its owner one of its people?
function awake(c, key) {
  if (!c || !HEIRLOOMS[key] || c.career !== HEIRLOOMS[key].people) return false;
  return [c.equippedWeapon, c.equippedArmor, c.equippedCharm].some(i => i && i.heirloom === key);
}

// ── Hooks used by the combat code ──────────────────────────────────────────
// Weapon attack roll: extra boons, to-hit and crit range.
function attackMods(c) {
  const out = { boons: 0, atk: 0, keen: false };
  if (awake(c, 'reiksguardPlate') && c.health > c.maxHealth / 2) out.boons++;
  if (awake(c, 'hochlandRifle') && c.row === 'back') { out.atk += 2; out.keen = true; }
  return out;
}
// Damage reduction the hit ignores (added back after the enemy's own reductions).
const ignoresDR = c => awake(c, 'runeAxe') || awake(c, 'runefang');
// A weapon hit landed: extra damage and side effects. Returns the bonus damage.
function onHit(c, enemy, r, fx, pid) {
  let bonus = 0; const notes = [];
  if (ignoresDR(c) && enemy.damageReduction) bonus += enemy.damageReduction;
  if (awake(c, 'runeAxe')) bonus += 2;
  if (awake(c, 'runefang') && (enemy.threat === 'Boss' || enemy.threat === 'Elite' || enemy.isElite)) { const x = rd(1, 6); bonus += x; notes.push(`Runefang +${x}`); }
  if (awake(c, 'grudgeStone') && (enemy._grudgeAgainst || []).includes(pid)) { const x = rd(1, 6); bonus += x; notes.push(`Grudge +${x}`); }
  if (awake(c, 'hagbaneBow')) fx.poison(2);
  if (awake(c, 'moonfireBow')) { bonus += rd(1, 4); if (r.crit) fx.burn(1); }
  if (awake(c, 'hoethBlade')) bonus += rd(1, 4) + (c.power || 0);
  if (awake(c, 'questingBlade') && !c._lanceChargeUsed) { c._lanceChargeUsed = true; const x = rd(2, 6); bonus += x; notes.push(`Lance Charge +${x}`); }
  return { bonus, notes };
}
// An enemy hit you: adjust the damage (before it is applied).
function onHitTaken(c, enemy, dmg, pid) {
  if (enemy) { enemy._grudgeAgainst = enemy._grudgeAgainst || []; if (!enemy._grudgeAgainst.includes(pid)) enemy._grudgeAgainst.push(pid); }
  let note = '';
  if (dmg > 0 && awake(c, 'ladysFavour') && !c._ladysFavourUsed) { c._ladysFavourUsed = true; note = "The Lady's Favour turns the blow aside"; return { dmg: 0, note }; }
  if (dmg > 0 && awake(c, 'gromrilMail')) dmg = Math.max(0, dmg - 1);
  return { dmg, note };
}
// The enemy's attack roll against you: extra banes.
const banesAgainst = c => (awake(c, 'ishaCloak') && c.row === 'back') ? 1 : 0;
// About to fall: Phoenix-Crested Ithilmar.
function cheatDeath(c) {
  if (!awake(c, 'phoenixPlate') || c._phoenixUsed) return false;
  c._phoenixUsed = true; c.health = Math.max(1, Math.ceil(c.maxHealth / 4)); return true;
}
// End of each round.
function roundTick(c) { if (awake(c, 'grailPlate') && c.alive && c.health < c.maxHealth) c.health++; }
const resistsInsanity = c => awake(c, 'grailPlate');
// Start of every fight.
function fightStart(c) {
  c._lanceChargeUsed = false; c._ladysFavourUsed = false; c._phoenixUsed = false;
  if (awake(c, 'seerstone')) c._freeCastArmed = true;
}
// Charm equip: the Seerstone's Power.
function applyCharm(c, item, on) {
  if (!item || item.key !== 'heirloom_seerstone' || c.career !== 'highelf') return;
  c.power = Math.max(0, (c.power || 0) + (on ? 1 : -1)); c.maxPower = Math.max(0, (c.maxPower || 0) + (on ? 1 : -1));
}

module.exports = { HEIRLOOMS, PEOPLE_NAMES, make, roll, awake, attackMods, ignoresDR, onHit, onHitTaken, banesAgainst, cheatDeath, roundTick, resistsInsanity, fightStart, applyCharm, d };
