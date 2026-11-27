'use strict';
// Spell castings: spells of the same rank share one pool (castingPools.R0..R3),
// sized by Power, refilled at the start of every fight. Also which spells a
// tradition grants at a given Power.
const { CASTINGS_TABLE, TRADITIONS } = require('./data');

function maxCastings(power, rank) {
  const row = CASTINGS_TABLE[Math.min(power, 10)] || CASTINGS_TABLE[0];
  return row[Math.min(rank, 3)] || 0;
}

// Spells of the same rank share one casting pool (castingPools.R0..R3).
function uniqRanks(spells){ const seen=new Set(); return (spells||[]).filter(sp=>!seen.has(sp.rank)&&seen.add(sp.rank)); }

function refreshCastingPools(char) {
  if (!char.castingPools) char.castingPools = {};
  char.knownSpells.forEach(sp => {
    if (char.castingPools['R'+sp.rank] === undefined) {
      char.castingPools['R'+sp.rank] = maxCastings(char.power, sp.rank);
    }
  });
}

function restoreCastingPools(char) {
  char.castingPools = {};
  char.knownSpells.forEach(sp => {
    char.castingPools['R'+sp.rank] = maxCastings(char.power, sp.rank);
  });
}

function castingsLeft(char, spellName, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  const v = char.castingPools['R'+rank];
  return v !== undefined ? v : maxCastings(char.power, rank);
}

function spendCasting(char, spellName, rank) {
  if (!char.castingPools) refreshCastingPools(char);
  if (char.castingPools['R'+rank] === undefined) {
    char.castingPools['R'+rank] = maxCastings(char.power, rank);
  }
  if (char.castingPools['R'+rank] > 0) {
    char.castingPools['R'+rank]--;
    return true;
  }
  return false;
}

function regainCasting(char, maxRank) {
  if (!char.castingPools) refreshCastingPools(char);
  let bestSpell = null, bestRank = 99;
  char.knownSpells.forEach(sp => {
    if (sp.rank <= maxRank && sp.rank < bestRank) {
      const max = maxCastings(char.power, sp.rank);
      if ((char.castingPools['R'+sp.rank] || 0) < max) {
        bestSpell = sp; bestRank = sp.rank;
      }
    }
  });
  if (bestSpell) { char.castingPools['R'+bestSpell.rank]++; return bestRank; }
  return -1;
}

// ─── SPELL TRADITIONS ─────────────────────────────────────────────────────────

function getSpellsForPower(traditionId, power) {
  const t = TRADITIONS[traditionId];
  if (!t) return [];
  return t.spells.filter(s => s.rank === 0 || s.rank <= power);
}

module.exports = { maxCastings, uniqRanks, refreshCastingPools, restoreCastingPools, castingsLeft, spendCasting, regainCasting, getSpellsForPower };
