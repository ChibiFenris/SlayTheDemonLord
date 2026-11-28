'use strict';
// Front and back lines, for the warband and for the enemy.
//
// Warband: melee enemies can only reach the front line while anyone stands in it;
// archers, gunners and casters reach everyone. Swinging a melee weapon from the back
// line costs 1 bane. A warrior may change line once per turn for free. When the
// last warrior in the front line falls, the back line steps forward.
//
// Enemy: archers, gunners and casters (not bosses) stand in the back line. While
// any enemy holds the front line, melee attacks against the back line have 1 bane
// ("screened"); spells and ranged weapons hit either line normally. When the enemy
// front line is gone, its back line steps forward.
const armour = require('./armour');

// Where a warrior stands when a fight starts: their own choice, else by weapon.
function defaultRow(c, hasRangedWeapon) {
  if (c.rowPref === 'front' || c.rowPref === 'back') return c.rowPref;
  return (hasRangedWeapon(c) || armour.roleOf(c) === 'caster') ? 'back' : 'front';
}
function startOfFight(room, hasRangedWeapon) {
  room.players.forEach(p => { const c = p.char; if (!c || !c.alive) return; c.row = defaultRow(c, hasRangedWeapon); c._rowMovedRound = null; });
}

// The back line steps up once the front line is gone. Returns the names that moved.
function closeRanks(room, addLog) {
  const alive = room.players.filter(p => p.char && p.char.alive);
  if (!alive.length || alive.some(p => p.char.row !== 'back')) return [];
  alive.forEach(p => { p.char.row = 'front'; });
  const names = alive.map(p => p.name);
  if (addLog) addLog(room, `🛡 The front line has fallen — <strong>${names.join(', ')}</strong> ${names.length > 1 ? 'step' : 'steps'} forward to hold it.`, 'sys');
  return names;
}

// Change line. Free, once per turn in combat. Returns an error message or null.
function setRow(room, player, row, currentTurn) {
  const gs = room.gs, c = player.char;
  if (row !== 'front' && row !== 'back') return 'Unknown row.';
  if (c.row === row) { c.rowPref = row; return null; }
  if (gs.phase === 'combat') {
    if (!currentTurn || currentTurn.id !== player.id) return 'You can change line on your own turn.';
    if (c._rowMovedRound === gs.roundNumber) return 'You have already changed line this turn.';
    c._rowMovedRound = gs.roundNumber;
  }
  c.row = row; c.rowPref = row;
  return null;
}

// Enemy lines. Kept up to date by refreshEnemyAuras (fight start, a death, a summon).
const enemyDefaultRow = e => (e.ranged && e.threat !== 'Boss') ? 'back' : 'front';
function refreshEnemyRows(gs) {
  const alive = (gs.enemies || []).filter(e => e && e.hp > 0);
  alive.forEach(e => { if (e.row !== 'front' && e.row !== 'back') e.row = enemyDefaultRow(e); });
  const front = alive.filter(e => e.row === 'front');
  if (!front.length && alive.length) alive.forEach(e => { e.row = 'front'; }); // their back line steps up
  alive.forEach(e => { e._screened = e.row === 'back' && alive.some(o => o !== e && o.row === 'front'); });
}

module.exports = { defaultRow, startOfFight, closeRanks, setRow, enemyDefaultRow, refreshEnemyRows };
