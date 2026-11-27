'use strict';
// Corruption and Insanity, after Shadow of the Demon Lord.
//
// Corruption comes from Chaos: cursed gear, Cursed Paths, warpstone, dark magic.
// Every 3 points brings a mutation — a gift with a price. It only goes down
// with Sigmarite Incense or a shrine, and mutations never go away.
//
// Insanity comes from horror: terrifying foes, bosses, allies falling. When it
// reaches your limit (4 + WIL bonus) you snap: a short madness hits you right
// away, Insanity resets to 0 and you keep a lasting disorder.
const { rd } = require('./dice');
const { pickRandom } = require('./util');

const S = {};
function bind(api) { Object.assign(S, api); }

const MUTATIONS = {
  warpclaws:   { label: 'Warpclaws',      desc: '+2 weapon damage, −1 Defence.',            apply(c) { c.weaponDmgBonus = (c.weaponDmgBonus || 0) + 2; c.defense -= 1; } },
  thirdEye:    { label: 'Third Eye',      desc: '+1 to hit, −3 max HP.',                     apply(c) { c.weaponAtkBonus = (c.weaponAtkBonus || 0) + 1; c.maxHealth = Math.max(5, c.maxHealth - 3); c.health = Math.min(c.health, c.maxHealth); } },
  scaledHide:  { label: 'Scaled Hide',    desc: '+2 Defence, −1 AGI.',                        apply(c) { c.defense += 2; c.attrs.agi = Math.max(1, c.attrs.agi - 1); } },
  bloatedFlesh:{ label: 'Bloated Flesh',  desc: '+8 max HP, −1 Defence.',                     apply(c) { c.maxHealth += 8; c.health += 8; c.defense -= 1; } },
  tentacle:    { label: 'Writhing Tentacle', desc: 'Your weapon hits have a 1-in-4 chance to lash for +1d6, but you gain Insanity more easily (+1 each time).', apply() {} },
  warpBlood:   { label: 'Warp-Touched Blood', desc: 'Regain 1 HP at the end of every round in combat, −1 WIL.', apply(c) { c.attrs.wil = Math.max(1, c.attrs.wil - 1); } },
  daemonVisage:{ label: 'Daemonic Visage', desc: 'Foes get 1 bane on their first attack each fight, but merchants charge you a quarter more.', apply() {} },
  ironSkull:   { label: 'Horned Skull',   desc: 'You can\'t be stunned, −1 INT.',            apply(c) { c.attrs.int = Math.max(1, c.attrs.int - 1); } },
};
const DISORDERS = {
  nightTerrors:{ label: 'Night Terrors',  desc: 'Campfires heal you a quarter less.' },
  haunted:     { label: 'Haunted',        desc: '1 bane on your first attack every fight.' },
  twitchy:     { label: 'Twitchy',        desc: '−1 Defence.', apply(c) { c.defense -= 1; } },
  paranoid:    { label: 'Paranoid',       desc: '−1 to hit.', apply(c) { c.weaponAtkBonus = (c.weaponAtkBonus || 0) - 1; } },
  bloodthirst: { label: 'Bloodthirst',    desc: '+1 damage, −2 max HP.', apply(c) { c.weaponDmgBonus = (c.weaponDmgBonus || 0) + 1; c.maxHealth = Math.max(5, c.maxHealth - 2); c.health = Math.min(c.health, c.maxHealth); } },
};
// The short madness: one of these hits the moment you snap.
const MADNESS = [
  { label: 'Berserk Fury',  desc: '+2 damage and +1 boon, but −2 Defence for 2 rounds', fx: c => { c.defense -= 2; S.addBuff(c, 'Berserk Fury', { dmgBonus: 2, atkBoon: 1, defBonus: -2 }, 2); } },
  { label: 'Frozen in Terror', desc: 'you lose your next turn', fx: c => S.addBuff(c, 'Frozen in Terror', { skipTurn: true }, 1) },
  { label: 'Gibbering',     desc: '2 banes on your attacks for 2 rounds', fx: c => S.addBuff(c, 'Gibbering', { bane: 2 }, 2) },
  { label: 'Dark Visions',  desc: 'your next attack is a critical hit, but you take 1d6 damage', fx: c => { c._deadAimArmed = true; c.health = Math.max(1, c.health - rd(1, 6)); } },
];

// At 9 Corruption one of the Dark Gods claims you. Each mark is a great gift
// with a matching curse. Which god depends on how you fight (and a little luck).
const PATRONS = {
  khorne:   { label: 'Mark of Khorne',   icon: '🩸', desc: '+2 weapon damage and +6 max HP, but the Blood God despises cowards: you can no longer Block.',
    apply(c) { c.weaponDmgBonus = (c.weaponDmgBonus || 0) + 2; c.maxHealth += 6; c.health += 6; c.block = false; } },
  nurgle:   { label: 'Mark of Nurgle',   icon: '🪰', desc: '+12 max HP and immune to poison, but your rotting flesh slows you: −2 Defence.',
    apply(c) { c.maxHealth += 12; c.health += 12; c.defense -= 2; c._nurgleMark = true; } },
  tzeentch: { label: 'Mark of Tzeentch', icon: '🔮', desc: 'Spellcasters gain +1 Power, others +2 to hit, but the Changer of Ways toys with you: each fight starts with a random boon or bane.',
    apply(c) { if (c.spellcaster) { c.power += 1; c.maxPower = (c.maxPower || 0) + 1; if (S.refreshCastingPools) S.refreshCastingPools(c); } else c.weaponAtkBonus = (c.weaponAtkBonus || 0) + 2; } },
  slaanesh: { label: 'Mark of Slaanesh', icon: '💜', desc: '+1 AGI and Evasion (the first attack against you each round has a bane), but excess frays the mind: your Insanity limit drops by 1.',
    apply(c) { c.attrs.agi += 1; c.baseAgiDef = (c.baseAgiDef || 0) + 1; c.defense += 1; c.evasion = true; } },
};
function patronFor(c) {
  if (Math.random() < 0.25) return pickRandom(Object.keys(PATRONS));
  if (c.spellcaster) return 'tzeentch';
  if (c.career === 'warrior' || c.career === 'slayer') return 'khorne';
  if (c.career === 'rogue' || c.career === 'waywatcher') return 'slaanesh';
  return 'nurgle';
}
function claimByPatron(room, p) {
  const c = p.char; if (c.patron) return;
  const k = patronFor(c); c.patron = k; PATRONS[k].apply(c);
  S.addLog(room, `${PATRONS[k].icon} <strong>${p.name} is claimed!</strong> The Dark Gods have noticed them: <strong>${PATRONS[k].label}</strong> — ${PATRONS[k].desc}`, 'crit');
  room.gs.bossBanner = { name: `${PATRONS[k].icon} ${PATRONS[k].label}`, text: `${p.name} has been claimed by the Dark Gods.`, ts: Date.now() };
}

const limit = c => 4 + (c.patron === 'slaanesh' ? -1 : 0) + Math.max(0, Math.floor((((c.attrs && c.attrs.wil) || 10) - 10) / 2)) + (c.career === 'witchhunter' || c.career === 'slayer' ? 1 : 0);
const resists = c => S.resistsInsanity && S.resistsInsanity(c);

function gainCorruption(room, p, n, source) {
  const c = p && p.char; if (!c || !n) return;
  const before = c.corruption || 0; c.corruption = before + n;
  S.addLog(room, `☢ ${p.name} gains <strong>${n} Corruption</strong>${source ? ' from ' + source : ''} (${c.corruption}).`, 'chaos');
  c.mutations = c.mutations || [];
  for (let t = 3; t <= 9; t += 3) {
    if (before < t && c.corruption >= t && c.mutations.length < 3) {
      const k = pickRandom(Object.keys(MUTATIONS).filter(m => !c.mutations.includes(m)));
      if (!k) break;
      c.mutations.push(k); MUTATIONS[k].apply(c);
      S.addLog(room, `🧬 <strong>Mutation!</strong> Chaos changes ${p.name}: <strong>${MUTATIONS[k].label}</strong> — ${MUTATIONS[k].desc}`, 'crit');
    }
  }
  if (before < 9 && c.corruption >= 9) claimByPatron(room, p);
}
function loseCorruption(c, n) { c.corruption = Math.max(0, (c.corruption || 0) - n); }

function gainInsanity(room, p, n, source) {
  const c = p && p.char; if (!c || !c.alive || !n) return;
  if (resists(c)) return;
  if ((c.mutations || []).includes('tentacle')) n += 1;
  c.insanity = (c.insanity || 0) + n;
  if (c.insanity < limit(c)) { if (source) S.addLog(room, `🌀 ${p.name} gains <strong>${n} Insanity</strong> from ${source} (${c.insanity}/${limit(c)}).`, 'chaos'); return; }
  // Snap.
  c.insanity = 0;
  const m = pickRandom(MADNESS); m.fx(c, room, p);
  c.disorders = c.disorders || [];
  let gained = '';
  if (c.disorders.length < 3) {
    const k = pickRandom(Object.keys(DISORDERS).filter(x => !c.disorders.includes(x)));
    if (k) { c.disorders.push(k); if (DISORDERS[k].apply) DISORDERS[k].apply(c); gained = ` They keep a lasting disorder: <strong>${DISORDERS[k].label}</strong> — ${DISORDERS[k].desc}`; }
  }
  S.addLog(room, `🌀 <strong>${p.name} snaps!</strong> ${m.label}: ${m.desc}.${gained}`, 'crit');
}
function loseInsanity(c, n) { c.insanity = Math.max(0, (c.insanity || 0) - n); }

// Fight start: Haunted, Daemonic Visage.
function onFightStart(room) {
  room.players.forEach(p => {
    const c = p.char; if (!c || !c.alive) return;
    if (c.patron === 'tzeentch') { if (Math.random() < 0.5) { S.addBuff(c, "Tzeentch's Favour", { atkBoon: 1 }, 2); S.addLog(room, `🔮 Tzeentch smiles on ${p.name} — 1 boon for 2 rounds.`, 'spell'); } else { S.addBuff(c, "Tzeentch's Jest", { bane: 1 }, 2); S.addLog(room, `🔮 Tzeentch laughs at ${p.name} — 1 bane for 2 rounds.`, 'chaos'); } }
    if ((c.disorders || []).includes('haunted')) S.addBuff(c, 'Haunted', { bane: 1, consumeOnAttack: true }, 99);
  });
  if (room.players.some(p => p.char && p.char.alive && (p.char.mutations || []).includes('daemonVisage')))
    (room.gs.enemies || []).forEach(e => S.addDebuff(e, 'Unnerved', { bane: 1, consumeOnAttack: true }, 2));
}
// End of every combat round.
function onRoundEnd(room) {
  room.players.forEach(p => { const c = p.char; if (c && c.alive && (c.mutations || []).includes('warpBlood') && c.health < c.maxHealth) c.health++; });
}
const restFactor = c => (c.disorders || []).includes('nightTerrors') ? 0.75 : 1;
const shopFactor = c => (c.mutations || []).includes('daemonVisage') ? 1.25 : 1;
const has = (c, k) => !!(c && ((c.mutations || []).includes(k) || (c.disorders || []).includes(k)));

module.exports = { bind, PATRONS, claimByPatron, MUTATIONS, DISORDERS, MADNESS, limit, gainCorruption, loseCorruption, gainInsanity, loseInsanity, onFightStart, onRoundEnd, restFactor, shopFactor, has };
