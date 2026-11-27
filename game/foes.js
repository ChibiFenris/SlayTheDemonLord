'use strict';
// Boss phases, elite modifiers, the greenskins' tricks and Endless mutators.
// Hooked into the enemy turn (preTurn), enemy creation (elite modifiers) and
// a few spots in the combat flow. Server helpers arrive through bind().
const { rd, d } = require('./dice');
const { pickRandom } = require('./util');
const { SUMMONS, ENEMY_POOLS } = require('./data');

const S = {};
function bind(api) { Object.assign(S, api); }

const aliveFoes = gs => (gs.enemies || []).filter(e => e && e.hp > 0);
const alivePlayers = room => room.players.filter(p => p.char && p.char.alive);
const partyN = room => Math.max(1, alivePlayers(room).length);
const solo = room => partyN(room) === 1;
const refreshDmg = e => { e.dmgDisplay = `${e.dmgNum}d${e.dmgSides}${e.dmgBonus ? '+' + e.dmgBonus : ''}`; };
const tmplByName = n => [...ENEMY_POOLS.low, ...ENEMY_POOLS.mid, ...ENEMY_POOLS.high].find(t => t.name === n);
function summonSome(room, tmpl, n) {
  let made = 0;
  for (let i = 0; i < n && aliveFoes(room.gs).length < 6; i++) { S.summonEnemy(room, { ...tmpl, xp: 0, gold: [0, 0] }); made++; }
  return made;
}
// Everyone takes plain damage (Block halves it).
function hitAll(room, dmgFn, label) {
  alivePlayers(room).forEach(p => {
    let dmg = dmgFn(); if (S.isBlocking(p.char)) dmg = Math.ceil(dmg / 2);
    p.char.health = Math.max(0, p.char.health - dmg);
    S.addLog(room, `&nbsp;↳ ${p.name} <strong class="num-dmg">−${dmg}</strong>${label ? ' ' + label : ''} → ${p.char.health}/${p.char.maxHealth} HP`, 'dmg-taken');
    S.checkDeath(room, p);
  });
}

// ── Boss phases ──────────────────────────────────────────────────────────────
// At half HP every boss changes how it fights. `tick` runs at the start of each
// of its later turns.
const BOSS_PHASES = {
  'Skaven Warlord Gnashteeth': { name: 'Clanrats, To Me!', line: 'Kill-kill them! Faster, you fools!',
    apply(room, e) { const n = summonSome(room, SUMMONS.clanrat, Math.min(2, partyN(room))); e.dmgBonus += 1; return `${n} Clanrats pour out of the tunnels, and Gnashteeth fights harder (+1 damage).`; } },
  'Beastlord Kragthor': { name: 'Bloodgreed', line: 'BLOOD! MORE BLOOD!',
    apply(room, e) { if (solo(room)) { e.dmgBonus += 2; return '+2 damage from now on.'; } e.attacks = 2; return 'He attacks twice every turn from now on.'; } },
  'Grey Seer Skrittar': { name: 'Warp Shield', line: 'The Horned Rat protects me! Stormvermin, guard-guard!',
    apply(room, e) { const dr = solo(room) ? 1 : 2; e.damageReduction = (e.damageReduction || 0) + dr; const n = solo(room) ? 0 : summonSome(room, SUMMONS.stormvermin, 1); return `A shimmering warp shield (−${dr} damage from every hit)${n ? ' and a Stormvermin bodyguard' : ''}.`; } },
  'Bray-Shaman Ghorros': { name: 'Call of the Herd', line: 'Herdkin! Come and feast!',
    apply(room, e) { const n = summonSome(room, SUMMONS.ungor, Math.min(2, partyN(room))); const h = Math.round(e.maxHp * 0.1); e.hp = Math.min(e.maxHp, e.hp + h); return `${n} Ungor answer the call, and he heals ${h} HP.`; } },
  'Varghulf': { name: 'Blood Frenzy', line: '(It howls, and the howl does not stop.)',
    apply(room, e) { const b = solo(room) ? 2 : 3; e.dmgBonus += b; e.lifeLeech = true; e.lifeLeechFrac = 0.5; return `+${b} damage and it drinks half of all the damage it deals.`; } },
  'Bonebreaker Ratogre': { name: 'Unchained', line: '(The last chain snaps. Its master is nowhere to be seen.)',
    apply(room, e) { e.ac = Math.max(8, e.ac - 2); if (solo(room)) { e.dmgBonus += 2; return '+2 damage, but its wild swings leave it open (−2 Defence).'; } e.attacks = 2; return 'It attacks twice a turn, but its wild swings leave it open (−2 Defence).'; } },
  'Blight King Gutrot': { name: 'Plague Cloud', line: "Grandfather's gift is for sharing!",
    apply(room, e) { return 'A cloud of rot surrounds him: every warrior gains poison at the start of each of his turns.'; },
    tick(room) { alivePlayers(room).forEach(p => { if (!S.immuneToPoison(p.char)) p.char._poisonedStacks = (p.char._poisonedStacks || 0) + 1; }); S.addLog(room, '🤢 The plague cloud seeps into everyone — <strong>+1 poison</strong>.', 'chaos'); } },
  'Gorgrund the Stone Troll': { name: 'Stone Skin', line: 'Gorgrund... ANGRY now.',
    apply(room, e) { const dr = solo(room) ? 1 : 2; e.damageReduction = (e.damageReduction || 0) + dr; e.regen = true; return `Its skin turns to stone (−${dr} damage from every hit) and it regenerates. Fire stops the regeneration.`; } },
  'Saurian Ancient': { name: 'Primal Fury', line: '(The ground shakes as it roars.)',
    apply(room, e) { const b = solo(room) ? 1 : 2; e.dmgBonus += b; e.ac += b; return `+${b} damage and +${b} Defence.`; } },
  "Daemon Prince Vhar'kul": { name: 'Daemonic Ascension', line: 'You see it now, don\'t you? What I truly am.',
    apply(room, e) { const n = summonSome(room, SUMMONS.brimstone, Math.min(2, partyN(room))); e.damageReduction = (e.damageReduction || 0) + (solo(room) ? 1 : 2);
      alivePlayers(room).forEach(p => S.dark.gainInsanity(room, p, 1, 'the sight of the Daemon Prince'));
      return `${n} Horrors spill from the rift, he shrugs off part of every hit, and the sight of him costs everyone 1 Insanity.`; } },
  'Skaldrak the Elder Wyrm': { name: 'Takes Wing', line: 'Burn. All of it, burn.',
    apply(room, e) { e.ranged = true; return 'The wyrm takes to the air: it reaches the back row, and sweeps fire over everyone at the start of each of its turns.'; },
    tick(room) { S.addLog(room, '🐉 Fire rains from above!', 'chaos'); hitAll(room, () => solo(room) ? rd(1, 4) : rd(1, 6)); } },
  'Warboss Grubnak Skullsmasha': { name: 'WAAAGH!', line: 'WAAAGH! Get stuck in, ya gits!',
    apply(room, e) { const n = summonSome(room, SUMMONS.orcBoy, Math.min(2, partyN(room))); aliveFoes(room.gs).filter(x => (x.tags || []).includes('greenskin')).forEach(x => { x.dmgBonus += 1; refreshDmg(x); }); return `${n} Orc Boyz charge in, and every greenskin hits 1 harder.`; } },
};
function checkBossPhase(room, e) {
  if (e.threat !== 'Boss' || e._phase2 || e.hp > e.maxHp / 2) return;
  e._phase2 = true;
  const ph = BOSS_PHASES[e.name] || { name: 'Enraged', line: null, apply(r, x) { x.dmgBonus += 2; return '+2 damage.'; } };
  const what = ph.apply(room, e); refreshDmg(e);
  if (ph.line) S.addLog(room, `🗣 <strong>${e.name}:</strong> <em>“${ph.line}”</em>`, 'boss');
  S.addLog(room, `🔥 <strong>Phase two — ${ph.name}!</strong> ${what}`, 'crit');
  room.gs.bossBanner = { name: `${e.name} — ${ph.name}`, text: ph.line || what, ts: Date.now() };
  e.phaseName = ph.name;
}

// ── Elite modifiers ─────────────────────────────────────────────────────────
const ELITE_AFFIXES = {
  vampiric:  { label: 'Vampiric',  desc: 'heals for 40% of the damage it deals', apply(e) { e.lifeLeech = true; e.lifeLeechFrac = Math.max(e.lifeLeechFrac || 0, 0.4); } },
  armoured:  { label: 'Armoured',  desc: 'takes 2 less damage from every hit', apply(e) { e.damageReduction = (e.damageReduction || 0) + 2; } },
  frenzied:  { label: 'Frenzied',  desc: 'attacks twice below half HP', apply() {} },
  warded:    { label: 'Warded',    desc: 'shrugs off the first spell cast at it', apply(e) { e._wardUp = true; } },
  regenerating: { label: 'Regenerating', desc: 'regenerates 1d6 HP each turn (fire stops it)', apply(e) { e.regen = true; } },
  venomous:  { label: 'Venomous',  desc: 'its hits poison you (3 stacks)', apply(e) { e.virulentBlade = true; } },
  thorned:   { label: 'Thorned',   desc: 'hitting it with a weapon costs you 1d4 HP', apply(e) { e.thorned = true; } },
  giant:     { label: 'Giant',     desc: '+30% HP and +1 damage', apply(e) { e.hp = e.maxHp = Math.round(e.maxHp * 1.3); e.dmgBonus = (e.dmgBonus || 0) + 1; } },
  swift:     { label: 'Swift',     desc: 'attacks twice, each hit 2 weaker', apply(e) { e.attacks = Math.max(2, e.attacks || 1); e.dmgBonus = (e.dmgBonus || 0) - 2; } },
};
function applyEliteAffix(e, key) {
  if (!e || e.threat === 'Boss' || e.affix) return;
  const k = key || pickRandom(Object.keys(ELITE_AFFIXES));
  const a = ELITE_AFFIXES[k]; e.affix = k; e.affixLabel = a.label; e.affixDesc = a.desc;
  a.apply(e); refreshDmg(e);
}

// ── Enemy turn: phases, ticks, greenskin tricks, frenzied elites ─────────────
// Returns 'done' when the enemy's turn is used up, or adds to the attack plan.
function preTurn(room, ae, alive, plan) {
  const gs = room.gs;
  checkBossPhase(room, ae);
  if (ae._phase2) { const ph = BOSS_PHASES[ae.name]; if (ph && ph.tick && ae._phaseTicked !== gs.roundNumber) { ae._phaseTicked = gs.roundNumber; ph.tick(room, ae); } }
  if (ae.affix === 'frenzied' && ae.hp <= ae.maxHp / 2) { plan.attacks = Math.max(plan.attacks || 1, 2); if (!ae._frenzyLogged) { ae._frenzyLogged = true; S.addLog(room, `😤 <strong>${ae.name}</strong> is wounded and frenzied — it now attacks twice!`, 'chaos'); } }
  // Squigs bounce about: a third of the time they miss everything.
  if (ae.squigBounce) {
    if (d(3) === 1) { S.addLog(room, `🍄 The <strong>${ae.name}</strong> bounces off a wall and lands nowhere near anyone.`, 'sys'); return 'done'; }
    plan.mult = Math.max(plan.mult || 1, 1.3);
  }
  // Orc Boyz charge in with their choppas on their first turn.
  if (ae.choppaCharge && !ae._charged) { ae._charged = true; plan.extraBoon = true; plan.mult = Math.max(plan.mult || 1, 1.5); S.addLog(room, `🪓 <strong>${ae.name}</strong> charges in, choppa swinging!`, 'chaos'); }
  // Fanatics whirl a ball and chain through the whole warband — and sometimes themselves.
  if (ae.fanatic) {
    S.addLog(room, `⛓ The <strong>${ae.name}</strong> spins its ball and chain through the warband!`, 'chaos');
    hitAll(room, () => rd(1, 6) + 1);
    if (d(4) === 1) { const self = rd(1, 6); ae.hp = Math.max(0, ae.hp - self); S.addLog(room, `⛓ ...and wraps the chain round its own neck (−${self}).`, 'sys'); if (ae.hp <= 0) S.resolveEnemyDeath(room, ae); }
    return 'done';
  }
  // Night Goblin Shamans: Foot of Gork every other turn (and sometimes their heads pop).
  if (ae.gorkFoot && gs.roundNumber % 2 === 0) {
    const t = pickRandom(alive); if (!t) return 'done';
    if (d(8) === 1) { const self = rd(2, 6); ae.hp = Math.max(0, ae.hp - self); S.addLog(room, `💥 Too much Waaagh! energy — the <strong>${ae.name}</strong>'s head swells and pops (−${self})!`, 'crit'); if (ae.hp <= 0) S.resolveEnemyDeath(room, ae); return 'done'; }
    let dmg = rd(2, 6) + (gs.bossCount || 0) * 2; if (S.isBlocking(t.char)) dmg = Math.ceil(dmg / 2);
    t.char.health = Math.max(0, t.char.health - dmg);
    S.addLog(room, `🦶 <strong>Foot of Gork!</strong> A giant green foot stamps on ${t.name} — <strong class="num-dmg">−${dmg}</strong> (ignores armour) → ${t.char.health}/${t.char.maxHealth} HP`, 'crit');
    S.checkDeath(room, t); return 'done';
  }
  // Black Orcs bellow once their mates start dropping.
  if (ae.waaaghCry && !ae._waaagh && ae.hp <= ae.maxHp / 2) {
    ae._waaagh = true; aliveFoes(gs).filter(x => (x.tags || []).includes('greenskin')).forEach(x => { x.dmgBonus += 1; refreshDmg(x); });
    S.addLog(room, `📣 <strong>${ae.name}:</strong> <em>“WAAAGH!”</em> Every greenskin hits 1 harder.`, 'crit');
  }
  return null;
}
// Night Goblins are braver in a crowd: +1 to hit and damage for each other greenskin.
function refreshMobAura(gs) {
  const greens = aliveFoes(gs).filter(x => (x.tags || []).includes('greenskin')).length;
  aliveFoes(gs).forEach(e => {
    if (!e.gobboMob) return;
    const want = Math.min(2, Math.max(0, greens - 1)), delta = want - (e._mobAura || 0);
    if (delta) { e.atk = (e.atk || 0) + delta; e.dmgBonus = (e.dmgBonus || 0) + delta; e._mobAura = want; refreshDmg(e); }
  });
}
// A spell aimed at a Warded elite fizzles (once). Returns true if it was stopped.
function wardStopsSpell(room, e) {
  if (!e || !e._wardUp) return false;
  e._wardUp = false; S.addLog(room, `🔰 <strong>${e.name}</strong>'s ward flares and swallows the spell!`, 'spell'); return true;
}
// Thorned elites hurt whoever hits them with a weapon.
function thornsOnHit(room, player, e) {
  if (!e || !e.thorned || !player.char.alive) return;
  const t = rd(1, 4); player.char.health = Math.max(0, player.char.health - t);
  S.addLog(room, `🌵 Thorns! ${player.name} takes <strong class="num-dmg">−${t}</strong>.`, 'dmg-taken'); S.checkDeath(room, player);
}

// ── Endless mutators ─────────────────────────────────────────────────────────
// After every Endless boss the warband votes for one of three. They last the run.
const MUTATORS = {
  explosive:   { label: 'Volatile Foes', desc: 'Foes burst when they die (1d6 to everyone), but all silver is doubled.' },
  leanTimes:   { label: 'Lean Times',    desc: 'Rests heal half as much, but all silver is doubled.' },
  bloodPrice:  { label: 'Blood Price',   desc: 'Foes deal +2 damage, but every warrior gains a relic now.' },
  ironTide:    { label: 'Iron Tide',     desc: 'Every foe has an elite modifier, but silver from fights is up by half.' },
  horde:       { label: 'The Horde',     desc: 'An extra foe joins every fight, but every warrior gains +6 max HP now.' },
  vampiricPact:{ label: 'Vampiric Pact', desc: 'Your weapon hits heal you 2 HP, but campfires no longer heal.' },
  glassCannon: { label: 'Glass Cannon',  desc: 'Everyone, friend and foe, deals +2 damage.' },
  plunder:     { label: 'Plunder',       desc: 'Merchants sell at half price, but no more campfires appear on the road.' },
};
const hasMutator = (gs, k) => !!(gs && gs.mutators && gs.mutators.includes(k));
function mutatorOptions(gs) {
  const pool = Object.keys(MUTATORS).filter(k => !hasMutator(gs, k));
  const out = []; while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
function applyMutator(room, k) {
  const gs = room.gs; if (!MUTATORS[k] || hasMutator(gs, k)) return;
  gs.mutators = (gs.mutators || []).concat(k);
  const ps = alivePlayers(room);
  if (k === 'bloodPrice') ps.forEach(p => { const opts = S.relics.optionsFor(p.char); if (opts[0]) { S.relics.grantRelic(p.char, opts[0]); S.addLog(room, `✨ ${p.name} gains the <strong>${S.relics.RELICS[opts[0]].name}</strong>.`, 'loot'); } });
  if (k === 'horde') ps.forEach(p => { p.char.maxHealth += 6; p.char.health += 6; });
  if (k === 'glassCannon') room.players.forEach(p => { if (p.char) p.char.weaponDmgBonus = (p.char.weaponDmgBonus || 0) + 2; });
  S.addLog(room, `♾ <strong>${MUTATORS[k].label}.</strong> ${MUTATORS[k].desc}`, 'chaos');
}
// Called when a fight is set up.
function onFightStart(room) {
  const gs = room.gs;
  if (hasMutator(gs, 'horde') && (gs.enemies || []).length && !(gs.enemies || []).some(e => e.threat === 'Boss') && gs.enemies.length < 4) {
    const extra = S.pickEnemy(gs.depth, false, false, alivePlayers(room).length, gs.bossCount); extra.id = 'eh' + Math.random().toString(36).slice(2, 7); gs.enemies.push(extra);
    S.addLog(room, `♾ The Horde: <strong>${extra.name}</strong> joins the fight.`, 'dmg');
  }
  (gs.enemies || []).forEach(e => {
    if (hasMutator(gs, 'ironTide') && e.threat !== 'Boss') applyEliteAffix(e);
    if (hasMutator(gs, 'bloodPrice')) { e.dmgBonus += 2; refreshDmg(e); }
    if (hasMutator(gs, 'glassCannon')) { e.dmgBonus += 2; refreshDmg(e); }
  });
  refreshMobAura(gs);
}
function silverMult(gs) { let m = 1; if (hasMutator(gs, 'explosive')) m *= 2; if (hasMutator(gs, 'leanTimes')) m *= 2; if (hasMutator(gs, 'ironTide')) m *= 1.5; return m; }
function onFoeDeath(room, e) {
  const gs = room.gs;
  if (hasMutator(gs, 'explosive') && !e.summoned) { S.addLog(room, `💥 ${e.name} bursts!`, 'chaos'); hitAll(room, () => rd(1, 6)); }
  refreshMobAura(gs);
}

module.exports = { bind, BOSS_PHASES, ELITE_AFFIXES, MUTATORS, applyEliteAffix, checkBossPhase, preTurn, refreshMobAura, wardStopsSpell, thornsOnHit,
  hasMutator, mutatorOptions, applyMutator, onFightStart, silverMult, onFoeDeath, tmplByName };
