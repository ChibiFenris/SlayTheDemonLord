'use strict';
// Armour types. Defence (dodging) now comes from AGI; armour soaks damage instead.
// When an enemy's blow lands, your armour takes its damage reduction (DR) off the hit,
// but it can never stop more than half of a single blow. Heavier armour soaks more
// and makes you a little slower to dodge. What a warrior can wear depends on their
// class: casters wear cloth, ranged fighters up to leather, melee fighters anything.

const TYPES = {
  cloth:   { label: 'Cloth',   rank: 1, dr: 1, dodge: +1 },
  leather: { label: 'Leather', rank: 2, dr: 2, dodge: 0 },
  mail:    { label: 'Mail',    rank: 3, dr: 3, dodge: -1 },
  shield:  { label: 'Shield',  rank: 3, dr: 2, dodge: +1 },
  plate:   { label: 'Plate',   rank: 4, dr: 4, dodge: -2 },
};
// Old armour values ("+N Defence") these types used to carry, for converting old items.
const OLD_BASE = { cloth: 1, leather: 1, mail: 2, shield: 2, plate: 4 };
const MAX_QUALITY = 4;
// Everyone knows how to keep their guard up: Defence is AGI + this, adjusted by armour.
const GUARD = 3;

const affixes = require('./affixes');
// The heaviest armour each class is trained for (1 cloth, 2 leather, 4 plate).
const ROLE = {
  // Empire
  defender: 'melee', witchHunter: 'ranged', empEngineer: 'ranged', elementalist: 'caster',
  // Bretonnia
  knightErrant: 'melee', questingKnight: 'melee', healer: 'caster', herrimault: 'ranged',
  // Dwarfs
  trollSlayer: 'melee', ironbreaker: 'melee', thunderer: 'ranged', runesmith: 'melee',
  // High Elves
  swordmaster: 'melee', sorcerer: 'caster', whiteLion: 'melee', spellbinder: 'melee',
  // Wood Elves
  ranger: 'ranged', wardancer: 'melee', druid: 'caster', assassin: 'ranged',
  // older paths still used by tests and saved games
  inquisitor: 'melee', giantSlayer: 'melee', paladin: 'melee', warlock: 'caster', wizard: 'caster',
  gunner: 'ranged', sapper: 'ranged',
};
const ROLE_RANK = { caster: 1, ranged: 2, melee: 4 };
const ROLE_LABEL = { caster: 'cloth', ranged: 'cloth and leather', melee: 'any armour' };
// Before a warrior picks a class at level 3, their people decide.
const PEOPLE_ROLE = { empire: 'melee', bretonnia: 'melee', dwarf: 'melee', highelf: 'melee', woodelf: 'ranged' };

function roleOf(c) {
  if (!c) return 'melee';
  if (c.expertPath && ROLE[c.expertPath]) return ROLE[c.expertPath];
  return PEOPLE_ROLE[c.career] || 'melee';
}
const maxRank = c => ROLE_RANK[roleOf(c)];

function typeOf(name) {
  const n = String(name || '').toLowerCase();
  if (/shield|buckler|pavise/.test(n)) return 'shield';
  if (/robe|cloak|shroud|tabard|vestment|talisman|amulet|mantle of|raiment|gown|favour/.test(n) && !/ithilmar/.test(n)) return 'cloth';
  if (/leather|jack|hide|pelt|vest|coat|jerkin|leaves|brigandine|padded/.test(n)) return 'leather';
  if (/plate|breastplate|aegis|cuirass|coif|crown|helm/.test(n) && !/mail/.test(n)) return 'plate';
  return 'mail';
}

// Give an armour item its type and damage reduction (safe to call more than once).
function finish(item) {
  if (!item || item.type !== 'armor') return item;
  if (!item.armorType) item.armorType = typeOf(item.name);
  const T = TYPES[item.armorType] || TYPES.mail;
  if (item.dr == null) {
    const q = Math.max(0, Math.round(((item.defBonus || OLD_BASE[item.armorType]) - OLD_BASE[item.armorType]) * 0.75));
    item.dr = T.dr + Math.min(MAX_QUALITY, q) + (item.legendary ? 1 : 0);
  }
  item.dodge = T.dodge + affixes.armourTraitDefence(item);
  const head = summary(item);
  const rest = String(item.desc || '').replace(/^\+\d+ Defen[cs]e/, '').replace(/^(Cloth|Leather|Mail|Shield|Plate) · DR \d+( · [+−]\d+ Defence)?/, '').trim();
  item.desc = head + (rest ? (rest.startsWith('—') || rest.startsWith('·') ? ' ' : ' — ') + rest : '');
  return item;
}
function summary(item) {
  const T = TYPES[item.armorType] || TYPES.mail;
  const dg = item.dodge != null ? item.dodge : T.dodge;
  return `${T.label} · DR ${item.dr}${dg ? ` · ${dg > 0 ? '+' : '−'}${Math.abs(dg)} Defence` : ''}`;
}

// Damage reduction worn right now (Hellblade-style attacks ignore it).
const dr = c => (c && c.equippedArmor ? (finish(c.equippedArmor).dr || 0) : 0) + (c ? affixes.extraDR(c) : 0);
const dodgeOf = item => (item ? finish(item).dodge : 0);
// What armour takes off a landed blow: its DR, but never more than half the blow.
function soak(c, dmg) {
  const r = dr(c); if (!r || dmg <= 0) return { dmg, soaked: 0 };
  const after = Math.max(Math.ceil(dmg / 2), dmg - r);
  return { dmg: after, soaked: dmg - after };
}
const canWear = (c, item) => !item || (TYPES[finish(item).armorType] || TYPES.mail).rank <= maxRank(c);
const wearText = c => ROLE_LABEL[roleOf(c)];

module.exports = { GUARD, TYPES, ROLE, roleOf, maxRank, typeOf, finish, summary, dr, dodgeOf, soak, canWear, wearText };
