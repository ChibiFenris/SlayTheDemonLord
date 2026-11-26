'use strict';
// Unknown-room events where the warband chooses what to do. Each player votes;
// the majority wins (ties go to the first option voted for). Effects use the
// server helpers handed over with bind().
const { d, rd } = require('./dice');
const { pickRandom } = require('./util');

const S = {};
function bind(api) { Object.assign(S, api); }

const alive = room => room.players.filter(p => p.char && p.char.alive);
const heal = (c, n) => { c.health = Math.min(c.maxHealth, c.health + n); };
const hurt = (room, p, n) => { p.char.health = Math.max(0, p.char.health - n); S.checkDeath(room, p); };
const nextFight = (c, name, fx) => S.addBuff(c, name, fx, 99); // 99-round buffs clear when the next fight ends

const CHOICE_EVENTS = {
  cursedChest: {
    title: 'The Iron-Bound Chest', icon: '⛓',
    text: 'A chest wrapped in chains and black candles sits in the gloom. Something inside hums.',
    options: [
      { id: 'open', label: 'Break it open', desc: 'Each warrior: a cursed relic, or a trap for 1d6.' },
      { id: 'leave', label: 'Leave it be', desc: 'Nothing gained, nothing lost.' },
    ],
    resolve(room, opt) {
      if (opt === 'leave') return S.addLog(room, 'The warband leaves the chest to its whispering.', 'sys');
      alive(room).forEach(p => {
        if (d(2) === 1) {
          const item = S.makeCursedItem(pickRandom(['khornateAxe', 'nurgleMask', 'shroudFlies', 'warpAmulet', 'tzeentchLens']));
          S.addToInventory(p.char, item.name, item);
          S.addLog(room, `⛓ ${p.name} pulls out <strong>${item.name}</strong> — cursed, but strong. (In inventory.)`, 'chaos');
        } else { const n = rd(1, 6); S.addLog(room, `💥 A needle-trap stabs ${p.name} — <strong class="num-dmg">−${n}</strong>.`, 'dmg'); hurt(room, p, n); }
      });
    },
  },
  witchHunter: {
    title: 'The Wounded Witch Hunter', icon: '⚖',
    text: 'A witch hunter lies bleeding against a gibbet, his purse heavy at his belt.',
    options: [
      { id: 'help', label: 'Bind his wounds', desc: 'Each warrior loses 1d4 HP. He rewards one of you with his seal.' },
      { id: 'rob', label: 'Take his purse', desc: '+30 silver each, but guilt: 1 bane in the next fight.' },
      { id: 'leave', label: 'Walk on', desc: 'No risk, no reward.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'help') {
        ps.forEach(p => hurt(room, p, rd(1, 4)));
        const lucky = pickRandom(ps); const seal = S.makeCharm('witchSeal');
        S.addToInventory(lucky.char, seal.name, seal);
        S.addLog(room, `⚖ The witch hunter presses his <strong>${seal.name}</strong> into ${lucky.name}'s hand. "Burn them all."`, 'loot');
      } else if (opt === 'rob') {
        ps.forEach(p => { p.char.gold += 30; nextFight(p.char, 'Guilty', { bane: 1 }); });
        S.addLog(room, '💰 The warband splits his purse — 30 silver each. His eyes follow you. (1 bane next fight.)', 'chaos');
      } else S.addLog(room, 'The warband walks on. His curses fade behind you.', 'sys');
    },
  },
  plagueVillage: {
    title: 'The Plague Village', icon: '☣',
    text: 'Boarded houses, painted with red crosses. Flies drone over the well.',
    options: [
      { id: 'burn', label: 'Burn it to the ground', desc: 'No loot, but the warband fights the next battle with 1 boon.' },
      { id: 'search', label: 'Search the houses', desc: 'Each warrior: a useful item, or catch the sickness (−3 max HP until rest).' },
    ],
    resolve(room, opt) {
      if (opt === 'burn') { alive(room).forEach(p => nextFight(p.char, 'Purifier', { atkBoon: 1 })); return S.addLog(room, '🔥 The village burns. Righteous fire steels the warband — 1 boon next fight.', 'spell'); }
      alive(room).forEach(p => {
        if (d(10) <= 6) { const it = pickRandom(['Healing Draught', 'Antitoxin', 'Holy Water', 'Dwarf Ale']); S.addToInventory(p.char, it); S.addLog(room, `🏚 ${p.name} finds a <strong>${it}</strong>.`, 'loot'); }
        else { p.char.maxHealth = Math.max(1, p.char.maxHealth - 3); p.char.health = Math.min(p.char.health, p.char.maxHealth); p.char._barrowDrain = (p.char._barrowDrain || 0) + 3; S.addLog(room, `🤢 ${p.name} catches the pox — −3 max HP until rest.`, 'chaos'); }
      });
    },
  },
  shrineMorr: {
    title: 'Shrine of Morr', icon: '🕯',
    text: 'A quiet shrine to the god of the dead, its bowl full of old coins.',
    options: [
      { id: 'pray', label: 'Pray for the fallen', desc: 'Each warrior: in the next fight, the first killing blow leaves you at 1 HP.' },
      { id: 'take', label: 'Take the offerings', desc: '+25 silver each, but Morr is watching: 1 bane next fight.' },
    ],
    resolve(room, opt) {
      if (opt === 'pray') { alive(room).forEach(p => { p.char._morrWard = true; }); return S.addLog(room, '🕯 A cold calm settles. Morr will turn away the first killing blow next fight.', 'spell'); }
      alive(room).forEach(p => { p.char.gold += 25; nextFight(p.char, "Morr's Displeasure", { bane: 1 }); });
      S.addLog(room, '🪙 25 silver each from the offering bowl. The candles gutter. (1 bane next fight.)', 'chaos');
    },
  },
  ratTunnel: {
    title: 'The Skaven Tunnel', icon: '🐀',
    text: 'A fresh tunnel bores down into the dark. Chittering echoes from below.',
    options: [
      { id: 'follow', label: 'Follow it down', desc: 'Skip ahead one depth, but the next enemies get the first strike.' },
      { id: 'collapse', label: 'Collapse it', desc: 'Each warrior takes 1d4; the next enemy starts stunned.' },
    ],
    resolve(room, opt) {
      const gs = room.gs;
      if (opt === 'follow') { gs.depth += 1; gs._enemiesFirst = true; return S.addLog(room, `🐀 A shortcut — the warband emerges at depth ${gs.depth}. The ratmen know you're coming…`, 'chaos'); }
      alive(room).forEach(p => hurt(room, p, rd(1, 4)));
      gs._nextCombatFirstEnemyStunned = true;
      S.addLog(room, '🪨 The tunnel caves in. Bruised, but the next foe will be dazed by the rockfall.', 'sys');
    },
  },
  pilgrims: {
    title: 'Sigmarite Pilgrims', icon: '✝',
    text: 'Flagellants and pilgrims chant around a campfire, sharing what little they have.',
    options: [
      { id: 'pray', label: 'Join their prayers', desc: 'Everyone heals 2d6.' },
      { id: 'supplies', label: 'Ask for supplies', desc: 'Each warrior receives a Healing Draught.' },
    ],
    resolve(room, opt) {
      if (opt === 'pray') { const h = rd(2, 6); alive(room).forEach(p => heal(p.char, h)); return S.addLog(room, `✝ The hymn washes over the warband — everyone heals <strong>${h}</strong>.`, 'heal'); }
      alive(room).forEach(p => S.addToInventory(p.char, 'Healing Draught'));
      S.addLog(room, '✝ The pilgrims press a Healing Draught into each warrior\'s hands.', 'loot');
    },
  },
  warpSeam: {
    title: 'The Warpstone Seam', icon: '💎',
    text: 'Green veins of warpstone glow in the rock. It would be easy to chip some free.',
    options: [
      { id: 'mine', label: 'Mine it', desc: 'Each warrior: +1 to a random attribute, −3 max HP and Corruption.' },
      { id: 'leave', label: 'Leave it', desc: 'Wise.' },
    ],
    resolve(room, opt) {
      if (opt === 'leave') return S.addLog(room, 'The warband gives the seam a wide berth.', 'sys');
      alive(room).forEach(p => {
        const a = pickRandom(['str', 'agi', 'int', 'wil']); p.char.attrs[a] += 1;
        p.char.maxHealth = Math.max(1, p.char.maxHealth - 3); p.char.health = Math.min(p.char.health, p.char.maxHealth);
        S.addBuff(p.char, 'Corrupted', { bane: 1 }, 2);
        S.addLog(room, `💎 ${p.name}: +1 ${a.toUpperCase()}, −3 max HP, Corrupted.`, 'chaos');
      });
    },
  },
  gamblingDen: {
    title: 'The Gambling Den', icon: '🎲',
    text: 'Ratcatchers and deserters dice for silver around an upturned barrel.',
    options: [
      { id: 'bet', label: 'Bet 20 silver each', desc: 'Each warrior: double or nothing.' },
      { id: 'pass', label: 'Keep your silver', desc: 'Walk on.' },
    ],
    resolve(room, opt) {
      if (opt === 'pass') return S.addLog(room, 'The warband keeps its purses closed.', 'sys');
      alive(room).forEach(p => {
        const stake = Math.min(20, p.char.gold);
        if (!stake) return S.addLog(room, `${p.name} has nothing to bet.`, 'sys');
        if (d(2) === 1) { p.char.gold += stake; S.addLog(room, `🎲 ${p.name} wins <strong>${stake}</strong> silver!`, 'loot'); }
        else { p.char.gold -= stake; S.addLog(room, `🎲 ${p.name} loses ${stake} silver.`, 'sys'); }
      });
    },
  },
  forge: {
    title: 'The Abandoned Forge', icon: '🔨',
    text: 'A dwarf forge, still warm. Someone left in a hurry.',
    options: [
      { id: 'work', label: 'Work the forge', desc: 'Every warrior: +1 permanent weapon damage, but the next enemies get the first strike.' },
      { id: 'loot', label: 'Strip it for parts', desc: '+15 silver each.' },
    ],
    resolve(room, opt) {
      if (opt === 'loot') { alive(room).forEach(p => { p.char.gold += 15; }); return S.addLog(room, '🔨 The warband strips the forge — 15 silver each.', 'loot'); }
      alive(room).forEach(p => { p.char.weaponDmgBonus = (p.char.weaponDmgBonus || 0) + 1; });
      room.gs._enemiesFirst = true;
      S.addLog(room, '🔨 Hours at the anvil — every weapon gains <strong>+1 damage</strong>. The noise has drawn attention…', 'loot');
    },
  },
  library: {
    title: 'The Forbidden Library', icon: '📜',
    text: 'Shelves of chained books. Some of the titles crawl when you look at them.',
    options: [
      { id: 'study', label: 'Study the tomes', desc: 'Spellcasters gain +1 Power. Everyone else takes 1d6 from warding glyphs.' },
      { id: 'burn', label: 'Burn the heresy', desc: 'Everyone gains 1 boon in the next fight.' },
    ],
    resolve(room, opt) {
      if (opt === 'burn') { alive(room).forEach(p => nextFight(p.char, 'Zeal', { atkBoon: 1 })); return S.addLog(room, '🔥 The library burns. Zeal fills the warband — 1 boon next fight.', 'spell'); }
      alive(room).forEach(p => {
        if (p.char.spellcaster || (p.char.knownSpells || []).length) { p.char.power += 1; p.char.maxPower = (p.char.maxPower || 0) + 1; S.addLog(room, `📜 ${p.name} deciphers a lost incantation — <strong>+1 Power</strong>.`, 'spell'); }
        else { const n = rd(1, 6); S.addLog(room, `⚡ A glyph flares at ${p.name} — <strong class="num-dmg">−${n}</strong>.`, 'dmg'); hurt(room, p, n); }
      });
    },
  },
  halflingCook: {
    title: 'The Lost Halfling Cook', icon: '🍲',
    text: 'A halfling cook, lost from his regiment, offers a stew in return for an escort.',
    options: [
      { id: 'escort', label: 'Escort him', desc: 'Everyone heals to full, but the detour costs 10 silver each.' },
      { id: 'stew', label: 'Just take a bowl', desc: 'Everyone heals 1d6.' },
    ],
    resolve(room, opt) {
      if (opt === 'escort') { alive(room).forEach(p => { p.char.health = p.char.maxHealth; p.char.gold = Math.max(0, p.char.gold - 10); }); return S.addLog(room, '🍲 The finest stew in the Empire. Everyone is fully healed (−10 silver each).', 'heal'); }
      const h = rd(1, 6); alive(room).forEach(p => heal(p.char, h));
      S.addLog(room, `🍲 A warm bowl each — everyone heals <strong>${h}</strong>.`, 'heal');
    },
  },
  chaosRitual: {
    title: 'The Chaos Ritual', icon: '🔴',
    text: 'Cultists have fled an active ritual circle. The air throbs with power.',
    options: [
      { id: 'disrupt', label: 'Disrupt it', desc: 'Each warrior takes 1d6; the next enemies start at half HP.' },
      { id: 'absorb', label: 'Let one of you absorb it', desc: 'One warrior gains +1 Power and Corruption.' },
    ],
    resolve(room, opt) {
      if (opt === 'disrupt') { alive(room).forEach(p => hurt(room, p, rd(1, 6))); room.gs._nextCombatHalfHP = true; return S.addLog(room, '🔴 The circle shatters — the next enemies will enter at half HP.', 'spell'); }
      const p = pickRandom(alive(room)); p.char.power += 1; p.char.maxPower = (p.char.maxPower || 0) + 1; S.addBuff(p.char, 'Corrupted', { bane: 1 }, 2);
      S.addLog(room, `🔴 ${p.name} drinks in the ritual's power — <strong>+1 Power</strong>, and Corruption.`, 'chaos');
    },
  },
};

// Start a choice event: the room waits in phase 'choice' until everyone votes.
function startChoiceEvent(room, key) {
  const ev = CHOICE_EVENTS[key || pickRandom(Object.keys(CHOICE_EVENTS))];
  const k = Object.keys(CHOICE_EVENTS).find(x => CHOICE_EVENTS[x] === ev);
  room.gs.phase = 'choice';
  room.gs.choice = { key: k, title: ev.title, icon: ev.icon, text: ev.text, options: ev.options, votes: {} };
  S.addLog(room, `${ev.icon} <strong>${ev.title}.</strong> ${ev.text}`, 'sys');
}

function voteChoice(room, playerId, optionId) {
  const gs = room.gs, ch = gs.choice;
  if (gs.phase !== 'choice' || !ch || !ch.options.some(o => o.id === optionId)) return;
  ch.votes[playerId] = optionId;
  const voters = room.players.filter(p => p.char && p.char.alive && p.connected);
  if (voters.every(p => ch.votes[p.id])) resolveChoice(room);
}

function resolveChoice(room) {
  const gs = room.gs, ch = gs.choice; if (!ch) return;
  const tally = {}; const order = [];
  Object.values(ch.votes).forEach(v => { if (!(v in tally)) order.push(v); tally[v] = (tally[v] || 0) + 1; });
  const winner = order.sort((a, b) => tally[b] - tally[a])[0] || ch.options[0].id;
  const opt = ch.options.find(o => o.id === winner);
  S.addLog(room, `The warband chooses: <strong>${opt.label}</strong>.`, 'sys');
  gs.choice = null; gs.phase = 'event';
  CHOICE_EVENTS[ch.key].resolve(room, winner);
}

module.exports = { bind, CHOICE_EVENTS, startChoiceEvent, voteChoice, resolveChoice };
