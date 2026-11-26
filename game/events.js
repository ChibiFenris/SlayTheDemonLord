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

const partyHas = (room, career) => alive(room).some(p => p.career === career);
const cursedInPack = c => (c.inventory || []).filter(i => i.itemObj && i.itemObj.cursed);

const CHOICE_EVENTS = {
  // ── Events added with the Witch Hunter and Dwarf Slayer ──────────────────
  // minDepth keeps an event to the deeper road; an option with `needs` only
  // appears when someone of that career is in the warband.
  fence: {
    title: 'The Black-Market Fence', icon: '🕯',
    text: 'A hooded figure squats beside a cart of oddities. "Cursed things? I buy. I sell. No questions."',
    options: [
      { id: 'sell', label: 'Sell your cursed gear', desc: 'Every unequipped cursed item in your packs sells for 40 silver.' },
      { id: 'buy', label: 'Buy a cursed relic', desc: 'Anyone with 40 silver buys a random cursed relic.' },
      { id: 'haggle', label: 'Haggle (Roadwarden)', desc: 'Everyone with 20 silver buys a cursed relic at half price.', needs: 'rogue' },
      { id: 'leave', label: 'Move along', desc: 'Nothing gained, nothing lost.' },
    ],
    resolve(room, opt) {
      if (opt === 'leave') return S.addLog(room, 'The fence shrugs and pulls his hood lower.', 'sys');
      if (opt === 'sell') {
        let total = 0;
        alive(room).forEach(p => {
          const items = cursedInPack(p.char); if (!items.length) return;
          const gain = items.reduce((a, i) => a + 40 * (i.qty || 1), 0);
          p.char.inventory = p.char.inventory.filter(i => !items.includes(i)); p.char.gold += gain; total += gain;
          S.addLog(room, `🕯 ${p.name} sells ${items.map(i => i.name).join(', ')} — <strong>+${gain} silver</strong>.`, 'loot');
        });
        if (!total) S.addLog(room, '🕯 Nobody has anything cursed to sell. The fence looks disappointed.', 'sys');
        return;
      }
      const price = opt === 'haggle' ? 20 : 40;
      let bought = 0;
      alive(room).forEach(p => {
        if (p.char.gold < price) return;
        const item = S.makeCursedItem(pickRandom(['khornateAxe', 'nurgleMask', 'shroudFlies', 'warpAmulet', 'tzeentchLens']));
        p.char.gold -= price; S.addToInventory(p.char, item.name, item); bought++;
        S.addLog(room, `🕯 ${p.name} buys <strong>${item.name}</strong> for ${price} silver — cursed, but strong. (In inventory.)`, 'chaos');
      });
      if (!bought) S.addLog(room, `🕯 Nobody can afford the fence's price.`, 'sys');
    },
  },
  dwarfGate: {
    title: 'The Sealed Dwarf Gate', icon: '⛏', minDepth: 8,
    text: 'A great stone door carved with runes blocks a side-passage. Dwarfish words are cut above it: an oath of passage.',
    options: [
      { id: 'force', label: 'Force the gate', desc: 'Everyone strains (1d4 damage). Half the time, one of you finds dwarf-forged armour.' },
      { id: 'oath', label: 'Speak the oath-words (Slayer)', desc: 'The gate opens: a Greater Healing Draught each, and the Slayer gains +1 STR.', needs: 'slayer' },
      { id: 'leave', label: 'Leave it sealed', desc: 'The dwarfs sealed it for a reason.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'leave') return S.addLog(room, 'The runes stay dark. The warband moves on.', 'sys');
      if (opt === 'oath') {
        ps.forEach(p => S.addToInventory(p.char, 'Greater Healing Draught'));
        ps.filter(p => p.career === 'slayer').forEach(p => { p.char.attrs.str++; S.addLog(room, `🪓 ${p.name} speaks the oath of Grimnir — the ancestors grant <strong>+1 STR</strong>.`, 'loot'); });
        return S.addLog(room, '⛏ The gate grinds open on a forgotten storeroom — a <strong>Greater Healing Draught</strong> each.', 'loot');
      }
      ps.forEach(p => hurt(room, p, rd(1, 4)));
      if (d(2) === 1) {
        const lucky = pickRandom(ps.filter(p => p.char.alive)); if (!lucky) return;
        const arm = S.genArmor(room.gs.bossCount || 0); arm.name = 'Dwarf-Forged ' + arm.name.replace(/^Dwarf-Forged /, '');
        S.addToInventory(lucky.char, arm.name, arm);
        S.addLog(room, `⛏ The gate gives way. ${lucky.name} finds <strong>${arm.name}</strong> inside. (In inventory.)`, 'loot');
      } else S.addLog(room, '⛏ The gate gives way onto an empty, dusty hall. Bruised for nothing.', 'sys');
    },
  },
  desecratedShrine: {
    title: 'The Desecrated Shrine', icon: '🜏', minDepth: 18,
    text: "A chapel of Sigmar, its altar smeared with the eight-pointed star. The cult's offerings are still warm.",
    options: [
      { id: 'smash', label: 'Smash the altar', desc: 'Everyone takes 1d6 from the backlash; the warband fights the next battle with 1 boon.' },
      { id: 'consecrate', label: 'Consecrate it (Priest)', desc: 'Everyone heals 2d6 and fights the next battle with 1 boon.', needs: 'priest' },
      { id: 'purge', label: 'Purge it with fire (Witch Hunter)', desc: "Burn the cult's hoard out of the walls: +40 silver each.", needs: 'witchhunter' },
      { id: 'take', label: 'Take the offerings', desc: '+25 silver each, but the Dark Gods notice: 1 Insanity each.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'smash') { ps.forEach(p => { hurt(room, p, rd(1, 6)); if (p.char.alive) nextFight(p.char, 'Righteous', { atkBoon: 1 }); }); return S.addLog(room, '🔨 The altar cracks. Something screams in the stone. (1 boon next fight.)', 'crit'); }
      if (opt === 'consecrate') { ps.forEach(p => { heal(p.char, rd(2, 6)); nextFight(p.char, 'Blessed', { atkBoon: 1 }); }); return S.addLog(room, '✨ Holy water hisses on the star. Sigmar\'s light returns — everyone heals 2d6. (1 boon next fight.)', 'heal'); }
      if (opt === 'purge') { ps.forEach(p => { p.char.gold += 40; }); return S.addLog(room, '🔥 The shrine burns. In the ashes: the cult\'s silver, <strong>+40 each</strong>.', 'loot'); }
      ps.forEach(p => { p.char.gold += 25; p.char.insanity = (p.char.insanity || 0) + 1; });
      S.addLog(room, '💰 The warband pockets the offerings — +25 silver and <strong>1 Insanity</strong> each.', 'chaos');
    },
  },
  lostPatrol: {
    title: 'The Lost Patrol', icon: '🛡', minDepth: 20,
    text: 'Three starving State troops huddle round a dead fire. Their sergeant is gone, their officer is worse.',
    options: [
      { id: 'supply', label: 'Share your supplies', desc: 'Pay 25 silver each (if you can): you gain +3 max HP for the rest of the run.' },
      { id: 'rally', label: 'Rally them (State Soldier)', desc: 'They follow you: the whole warband fights the next battle with 2 boons.', needs: 'warrior' },
      { id: 'strip', label: 'Take their weapons', desc: 'Each warrior gets a random weapon. They will not forget it.' },
      { id: 'leave', label: 'Leave them', desc: 'Nothing gained, nothing lost.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'leave') return S.addLog(room, 'The warband leaves the patrol to their fire.', 'sys');
      if (opt === 'supply') { ps.forEach(p => { if (p.char.gold < 25) return; p.char.gold -= 25; p.char.maxHealth += 3; heal(p.char, 3); S.addLog(room, `🛡 ${p.name} shares supplies — <strong>+3 max HP</strong>.`, 'heal'); }); return; }
      if (opt === 'rally') { ps.forEach(p => nextFight(p.char, 'Rallied Patrol', { atkBoon: 2 })); return S.addLog(room, '📯 "On me!" The patrol falls in behind the warband. (2 boons next fight.)', 'crit'); }
      ps.forEach(p => { const w = S.genWpn(room.gs.bossCount || 0); S.addToInventory(p.char, w.name, w); S.addLog(room, `⚔ ${p.name} takes a <strong>${w.name}</strong>. (In inventory.)`, 'loot'); nextFight(p.char, 'Ashamed', { bane: 1 }); });
      S.addLog(room, 'The patrol watches you go with hollow eyes. (1 bane next fight.)', 'chaos');
    },
  },

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
  const depth = room.gs.depth || 0;
  const pool = Object.keys(CHOICE_EVENTS).filter(x => (CHOICE_EVENTS[x].minDepth || 0) <= depth);
  const k = key || pickRandom(pool);
  const ev = CHOICE_EVENTS[k];
  // Career options only show when that career is in the warband.
  const options = ev.options.filter(o => !o.needs || partyHas(room, o.needs)).map(({ id, label, desc }) => ({ id, label, desc }));
  room.gs.phase = 'choice';
  room.gs.choice = { key: k, title: ev.title, icon: ev.icon, text: ev.text, options, votes: {} };
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
