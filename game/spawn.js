'use strict';
// Making enemies: which ones a fight draws (by depth, region and boss count)
// and how tough they are (party size, bosses beaten, elites, Endless tiers).
const { ENEMY_POOLS } = require('./data');
const zones = require('./zones');

const S = {};
function bind(api) { Object.assign(S, api); }


function enemyDmgDice(threat, isElite, bossCount) {
  if (threat === 'Boss') {
    if (bossCount === 0) return {n:1,s:6,b:3}; // Boss 1: 1d6+3
    if (bossCount === 1) return {n:2,s:6,b:3}; // Boss 2: 2d6+3 (avg 10, harder)
    return {n:2,s:6,b:4};                       // Boss 3 (Saurian): 2d6+4 (final boss, hardest)
  }
  if (bossCount === 0) return {n:1,s:6,b:0};
  if (bossCount === 1) return {n:2,s:6,b:0};
  return {n:2,s:6,b:2}; // zone 3: extra +2 damage for high-tier enemies
}

// Archers, gunners and spellcasters can reach the back row.
const RANGED_ENEMIES = new Set(['Ungor Skirmisher','Ratling Gun Team','Warlock Engineer','Blue Horror','Brimstone Horror','Banshee','Grey Seer Skrittar','Bray-Shaman Ghorros',"Daemon Prince Vhar'kul",'Skaldrak the Elder Wyrm','Nurgle Cultist']);
// Endless Mode keeps counting bosses past three; each one beyond the third is a tier.
const endlessTier = bossCount => Math.max(0, (bossCount||0) - 2);
const runWon = gs => !gs.endless && (gs.depth >= 30 || gs.bossCount >= 3);
function scaleEnemy(tmpl, playerCount, isElite, bossCount) {
  const e = JSON.parse(JSON.stringify(tmpl));
  if (RANGED_ENEMIES.has(e.name)) e.ranged = true;
  const bossHpMult = bossCount>=2 ? 1.40 : bossCount===1 ? 1.25 : 1.0; // tougher scaling post-boss
  const bossHpFlat = bossCount >= 2 ? 30 : bossCount === 1 ? 15 : 0; // +15 post-boss1, +30 post-boss2
  const tier = endlessTier(bossCount); // 0 in a normal run; +1 for every boss past the third in Endless
  e.hp = e.maxHp = Math.round(e.hp * (1 + (playerCount-1)*0.9) * bossHpMult * (1 + 0.4*tier + 0.05*tier*tier)) + bossHpFlat + 20*tier;
  if (e.threat === 'Boss' && playerCount === 1) e.hp = e.maxHp = Math.round(e.hp * (bossCount >= 1 ? 0.78 : 0.88)); // a lone warrior faces smaller bosses, especially later on
  e.conditions = []; e.activeDebuffs = []; e.isElite = isElite;
  const dd = enemyDmgDice(e.threat, isElite, bossCount);
  e.dmgNum=dd.n; e.dmgSides=dd.s; e.dmgBonus=dd.b;
  if (tier) {
    e.dmgBonus += Math.round(tier*1.5); e.atk = (e.atk||0) + tier; e.ac = (e.ac||10) + Math.floor(tier/2);
    if (Array.isArray(e.gold)) e.gold = e.gold.map(g => Math.round(g * (1 + 0.25*tier)));
    e.endlessTier = tier;
  }
  if (isElite && e.threat!=='Boss') {
    e.hp = e.maxHp = Math.round(e.hp * 1.5); // 1.5× HP for elites
    e.atk = (e.atk||0) + 2;
    e.dmgBonus = (e.dmgBonus||0) + 3;
    e.threat='Elite';
    S.foes.applyEliteAffix(e);
  }
  S.prepareEnemy(e, bossCount);
  e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`;
  return e;
}

function pickEnemy(depth, isElite, isBoss, playerCount, bossCount) {
  let pool;
  if (isBoss) {
    if (bossCount >= 3)      pool=[ENEMY_POOLS.boss1,ENEMY_POOLS.boss2,ENEMY_POOLS.boss3][bossCount%3]; // Endless: the bosses come round again, stronger
    else if (depth >= 30)    pool=ENEMY_POOLS.boss3;
    else if (bossCount===0)  pool=ENEMY_POOLS.boss1;
    else if (bossCount===1)  pool=ENEMY_POOLS.boss2;
    else                     pool=ENEMY_POOLS.boss3;
  }
  else if (depth>20) pool=isElite?ENEMY_POOLS.high:ENEMY_POOLS.high;
  else if (depth>10) pool=isElite?ENEMY_POOLS.mid:ENEMY_POOLS.mid;
  else               pool=isElite?ENEMY_POOLS.low:ENEMY_POOLS.low;
  const clean = pool.filter(e => e && e.threat && e.name && e.hp);
  const validPool = isBoss ? clean : zones.favour(clean, depth); // the region's factions turn up more often (bosses stay a free draw)
  if (!validPool.length) { console.error('pickEnemy: no valid enemies in pool', pool); return scaleEnemy(pool[0], playerCount, isElite, bossCount); }
  return scaleEnemy(validPool[Math.floor(Math.random()*validPool.length)], playerCount, isElite, bossCount);
}


module.exports = { bind, enemyDmgDice, RANGED_ENEMIES, endlessTier, runWon, scaleEnemy, pickEnemy };
