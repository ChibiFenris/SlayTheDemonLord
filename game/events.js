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

const partyHas = (room, career) => alive(room).some(p => [].concat(career).includes(p.career)); // one career or a list
const cursedInPack = c => (c.inventory || []).filter(i => i.itemObj && i.itemObj.cursed);

const CHOICE_EVENTS = {
  // ── Former instant events, now choices ───────────────────────────────────
  shrineSigmar: {
    title: 'Shrine of Sigmar', icon: '⛪',
    text: 'A roadside shrine, its hammer still bright. Candles burn, though no one tends them.',
    options: [
      { id: 'pray', label: 'Kneel and pray', desc: 'Everyone heals 1d6+3 and gets 1 boon on their next attack.' },
      { id: 'tithe', label: 'Leave a tithe', desc: 'Pay 15 silver each (if you can): heal fully.' },
      { id: 'loot', label: 'Take the offering bowl', desc: '+20 silver each, but 1 bane in the next fight.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'pray') { const h = rd(1, 6) + 3; ps.forEach(p => { heal(p.char, h); S.addBuff(p.char, 'Shrine Blessing', { atkBoon: 1, consumeOnAttack: true }, 99); }); return S.addLog(room, `⛪ The warband prays — everyone heals <strong>${h} HP</strong> and gains 1 boon on their next attack.`, 'heal'); }
      if (opt === 'tithe') { ps.forEach(p => { if (p.char.gold < 15) return S.addLog(room, `${p.name} has nothing to give.`, 'sys'); p.char.gold -= 15; p.char.health = p.char.maxHealth; S.addLog(room, `⛪ ${p.name} leaves 15 silver — <strong>fully healed</strong>.`, 'heal'); }); return; }
      ps.forEach(p => { p.char.gold += 20; nextFight(p.char, 'Sacrilege', { bane: 1 }); });
      S.addLog(room, '💰 The warband empties the bowl — +20 silver each. Sigmar is watching. (1 bane next fight.)', 'chaos');
    },
  },
  hangingCage: {
    title: 'The Hanging Cage', icon: '☠',
    text: 'A gibbet cage creaks above the road. Inside, a body — and a purse still on its belt.',
    options: [
      { id: 'climb', label: 'Climb up for the purse', desc: 'One of you gets 30 silver; 1d6 damage from the fall.' },
      { id: 'bury', label: 'Cut him down and bury him', desc: 'Everyone gets 1 boon in the next fight.' },
      { id: 'pass', label: 'Hurry past', desc: 'The sight rattles everyone: 1 bane until you first draw blood.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'climb') { const p = pickRandom(ps); p.char.gold += 30; S.addLog(room, `🪙 ${p.name} climbs up and takes the purse — <strong>+30 silver</strong>.`, 'loot'); return hurt(room, p, rd(1, 6)); }
      if (opt === 'bury') { ps.forEach(p => nextFight(p.char, 'Honoured the Dead', { atkBoon: 1 })); return S.addLog(room, '⚰ The warband buries the stranger. Morr is pleased. (1 boon next fight.)', 'heal'); }
      ps.forEach(p => S.addBuff(p.char, 'Rattled', { bane: 1 }, 500));
      S.addLog(room, '☠ The warband hurries past, unsettled — 1 bane until they draw first blood.', 'chaos');
    },
  },
  alchemistCache: {
    title: "The Alchemist's Cache", icon: '⚗',
    text: 'A collapsed workshop. Shelves of stoppered bottles, some labelled, some smoking.',
    options: [
      { id: 'labelled', label: 'Take only the labelled bottles', desc: 'Everyone gets a Healing Draught.' },
      { id: 'all', label: 'Grab everything', desc: 'Everyone gets two random potions — but one of you gets splashed with acid (2d6).' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'labelled') { ps.forEach(p => S.addToInventory(p.char, 'Healing Draught')); return S.addLog(room, '⚗ Each warrior pockets a <strong>Healing Draught</strong>.', 'loot'); }
      const pool = ['Healing Draught', 'Incendiary Flask', 'Sharpening Stone', 'Antitoxin', 'Smelling Salts', 'Ironhide Tonic'];
      ps.forEach(p => { const a = pickRandom(pool), b = pickRandom(pool); S.addToInventory(p.char, a); S.addToInventory(p.char, b); S.addLog(room, `⚗ ${p.name} finds <strong>${a}</strong> and <strong>${b}</strong>.`, 'loot'); });
      const unlucky = pickRandom(ps); S.addLog(room, `💥 A bottle bursts in ${unlucky.name}'s hands!`, 'dmg'); hurt(room, unlucky, rd(2, 6));
    },
  },
  veteranGhost: {
    title: "The Veteran's Ghost", icon: '👻',
    text: 'A pale soldier stands at attention by an old battlefield. He offers one last lesson — to one of you.',
    options: [
      { id: 'learn', label: 'Accept the lesson', desc: 'One of you gains a permanent +1 to hit, but everyone loses 1d4 HP to the grave-cold.' },
      { id: 'salute', label: 'Salute and move on', desc: 'Everyone heals 1d4.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'salute') { ps.forEach(p => heal(p.char, rd(1, 4))); return S.addLog(room, '🫡 The ghost returns the salute and fades. The warband feels lighter. (+1d4 HP.)', 'heal'); }
      const t = pickRandom(ps); t.char.weaponAtkBonus = (t.char.weaponAtkBonus || 0) + 1;
      S.addLog(room, `👻 The ghost teaches ${t.name} an old soldier's trick — <strong>permanent +1 to hit</strong>.`, 'loot');
      ps.forEach(p => hurt(room, p, rd(1, 4)));
    },
  },
  skavenTraps: {
    title: 'The Abandoned Ambush', icon: '🐀',
    text: 'Fresh tracks, sprung nets, a half-eaten meal. The ratmen fled moments ago — their traps are still set.',
    options: [
      { id: 'loot', label: 'Strip the traps for silver', desc: 'Everyone gets 5–30 silver.' },
      { id: 'reset', label: 'Turn their traps on them', desc: 'The first enemy of the next fight starts stunned.' },
    ],
    resolve(room, opt) {
      if (opt === 'reset') { room.gs._nextCombatFirstEnemyStunned = true; return S.addLog(room, '🪤 The warband re-sets the traps ahead. (The first enemy next fight starts stunned.)', 'crit'); }
      const coins = rd(1, 6) * 5; alive(room).forEach(p => { p.char.gold += coins; });
      S.addLog(room, `🐀 The warband strips the traps — <strong>${coins} silver</strong> each.`, 'loot');
    },
  },
  ruinousAltar: {
    title: 'The Ruinous Altar', icon: '🔮', minDepth: 5,
    text: 'An altar of the Changer of Ways, its runes shifting as you look. It offers knowledge, for a price.',
    options: [
      { id: 'read', label: 'Read the runes', desc: 'One of you gains +1 INT; everyone loses 3 max HP until the next rest.' },
      { id: 'smash', label: 'Smash it', desc: 'Everyone takes 1d4, and the next fight begins with 1 boon.' },
      { id: 'leave', label: 'Leave it', desc: 'Nothing happens.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'leave') return S.addLog(room, 'The runes stop shifting as you walk away.', 'sys');
      if (opt === 'smash') { ps.forEach(p => { hurt(room, p, rd(1, 4)); if (p.char.alive) nextFight(p.char, 'Defiant', { atkBoon: 1 }); }); return S.addLog(room, '🔨 The altar cracks apart. (1 boon next fight.)', 'crit'); }
      ps.forEach(p => { p.char.maxHealth = Math.max(1, p.char.maxHealth - 3); p.char.health = Math.min(p.char.health, p.char.maxHealth); });
      const t = pickRandom(ps); t.char.attrs.int++;
      S.addLog(room, `🔮 ${t.name} understands the runes — <strong>+1 INT</strong>. Everyone loses 3 max HP until they rest.`, 'chaos');
    },
  },
  fieldHospital: {
    title: 'The Field Hospital', icon: '🏥',
    text: "A ruined field hospital. A surgeon's kit lies open; the cots are still made.",
    options: [
      { id: 'rest', label: 'Rest on the cots', desc: 'Everyone heals 2d6.' },
      { id: 'search', label: 'Search the supplies', desc: 'One of you finds a Greater Healing Draught; everyone else a Healing Draught.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'rest') { const h = rd(2, 6); ps.forEach(p => heal(p.char, h)); return S.addLog(room, `🏥 The warband rests — <strong>+${h} HP</strong> each.`, 'heal'); }
      const lucky = pickRandom(ps);
      ps.forEach(p => S.addToInventory(p.char, p === lucky ? 'Greater Healing Draught' : 'Healing Draught'));
      S.addLog(room, `🏥 ${lucky.name} finds a <strong>Greater Healing Draught</strong>; the others a Healing Draught each.`, 'loot');
    },
  },
  whisperingWell: {
    title: 'The Whispering Well', icon: '🌊',
    text: 'Voices rise from a dry well, promising power to whoever listens long enough.',
    options: [
      { id: 'listen', label: 'Listen', desc: 'Spellcasters gain +1 Power; others gain 5 silver. Everyone is Shaken (1 bane next attack).' },
      { id: 'coin', label: 'Drop a coin and make a wish', desc: '5 silver each: a 50% chance everyone heals 2d6.' },
      { id: 'cover', label: 'Cover the well', desc: 'Nothing happens.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'cover') return S.addLog(room, 'The voices fall silent under the stones.', 'sys');
      if (opt === 'coin') {
        ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 5); });
        if (d(2) === 1) { const h = rd(2, 6); ps.forEach(p => heal(p.char, h)); return S.addLog(room, `✨ The wish is granted — everyone heals <strong>${h} HP</strong>.`, 'heal'); }
        return S.addLog(room, '🌊 The coins splash into nothing. The well keeps its secrets.', 'sys');
      }
      ps.forEach(p => { S.addBuff(p.char, 'Shaken', { bane: 1 }, 1); if (p.char.spellcaster) { p.char.power += 1; p.char.maxPower = (p.char.maxPower || 0) + 1; S.refreshCastingPools(p.char); } else p.char.gold += 5; });
      S.addLog(room, '🌊 Spellcasters gain <strong>+1 Power</strong>; the others find 5 silver. Everyone is Shaken.', 'loot');
    },
  },
  mercenaries: {
    title: 'The Mercenary Standoff', icon: '⚔',
    text: 'A band of sellswords blocks the road, hands on their hilts. Their captain grins.',
    options: [
      { id: 'talk', label: 'Negotiate', desc: 'They share supplies: 10–60 silver each and 1 boon for 2 rounds.' },
      { id: 'hire', label: 'Pay them to scout ahead (20 silver each)', desc: 'The next fight begins with 2 boons for everyone.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'hire') { ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 20); nextFight(p.char, 'Scouted', { atkBoon: 2 }); }); return S.addLog(room, '🗺 The mercenaries scout the road ahead. (2 boons next fight.)', 'crit'); }
      const coins = rd(2, 6) * 5; ps.forEach(p => { p.char.gold += coins; S.addBuff(p.char, 'Negotiated Edge', { atkBoon: 1 }, 2); });
      S.addLog(room, `🤝 The captain laughs and shares the spoils — <strong>${coins} silver</strong> each and 1 boon for 2 rounds.`, 'loot');
    },
  },
  injuredSurvivor: {
    title: 'The Injured Survivor', icon: '🧑',
    text: 'A wounded soldier lies by the road, clutching a satchel. He begs for help.',
    options: [
      { id: 'help', label: 'Tend his wounds (15 silver each)', desc: 'Everyone heals 1d6 and gets 1 boon on their next attack.' },
      { id: 'satchel', label: 'Take his satchel', desc: 'One random potion each. 1 bane next fight.' },
      { id: 'leave', label: 'Leave him', desc: 'Nothing gained, nothing lost.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'leave') return S.addLog(room, 'The warband walks on.', 'sys');
      if (opt === 'help') { ps.forEach(p => { if (p.char.gold < 15) return; p.char.gold -= 15; heal(p.char, rd(1, 6)); S.addBuff(p.char, 'Aided', { atkBoon: 1, consumeOnAttack: true }, 99); }); return S.addLog(room, '🩹 He thanks you with a blessing — those who paid heal and gain 1 boon.', 'heal'); }
      ps.forEach(p => { S.addToInventory(p.char, pickRandom(['Healing Draught', 'Antitoxin', 'Smelling Salts'])); nextFight(p.char, 'Shamed', { bane: 1 }); });
      S.addLog(room, '🎒 The warband takes his satchel. His eyes follow you. (1 bane next fight.)', 'chaos');
    },
  },
  blackMarket: {
    title: 'The Black Market', icon: '🕵',
    text: 'A whispering trader in a back alley, wares hidden under a tarp.',
    options: [
      { id: 'scroll', label: 'Buy a scroll (15 silver)', desc: 'The first of you with 15 silver buys a random spell scroll.' },
      { id: 'blood', label: 'Sell a little blood', desc: '+30 silver each, but −5 max HP permanently.' },
      { id: 'leave', label: 'Walk away', desc: 'Nothing happens.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'leave') return S.addLog(room, 'The trader melts back into the alley.', 'sys');
      if (opt === 'blood') { ps.forEach(p => { p.char.gold += 30; p.char.maxHealth = Math.max(1, p.char.maxHealth - 5); p.char.health = Math.min(p.char.health, p.char.maxHealth); }); return S.addLog(room, '🩸 A shadowy deal — +30 silver each, −5 max HP for good.', 'chaos'); }
      const buyer = ps.find(p => p.char.gold >= 15);
      if (!buyer) return S.addLog(room, 'Nobody can afford a scroll.', 'sys');
      const sc = pickRandom(S.SCROLL_SPELLS_LIST); const sn = `Scroll: ${sc.name}`;
      buyer.char.gold -= 15; S.addToInventory(buyer.char, sn); buyer.char.scrollSpells = buyer.char.scrollSpells || {}; buyer.char.scrollSpells[sn] = sc;
      S.addLog(room, `📜 ${buyer.name} buys a <strong>${sn}</strong> for 15 silver.`, 'loot');
    },
  },
  // ── New events ───────────────────────────────────────────────────────────
  abandonedWagon: {
    title: 'The Overturned Wagon', icon: '🛒',
    text: 'A merchant wagon lies on its side, its horses gone. Crates spill into the mud. Something moved under the canvas.',
    options: [
      { id: 'search', label: 'Search the crates', desc: 'Half the time a weapon or armour for one of you; otherwise a giant rat bites (1d6).' },
      { id: 'right', label: 'Right the wagon for its owner', desc: 'The owner catches up and pays 25 silver each.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'right') { ps.forEach(p => { p.char.gold += 25; }); return S.addLog(room, '🛒 The grateful owner catches up and pays <strong>25 silver</strong> each.', 'loot'); }
      const t = pickRandom(ps);
      if (d(2) === 1) { const it = d(2) === 1 ? S.genWpn(room.gs.bossCount || 0) : S.genArmor(room.gs.bossCount || 0); S.addToInventory(t.char, it.name, it); return S.addLog(room, `🛒 ${t.name} finds <strong>${it.name}</strong> in a crate. (In inventory.)`, 'loot'); }
      S.addLog(room, `🐀 A rat the size of a dog bites ${t.name}!`, 'dmg'); hurt(room, t, rd(1, 6));
    },
  },
  flagellants: {
    title: 'The Flagellant Procession', icon: '🔔',
    text: 'Chanting penitents whip their own backs as they march. Their prophet points at you: "Repent! The End Times are come!"',
    options: [
      { id: 'join', label: 'March with them a while', desc: 'Everyone takes 1d4 but gains 1 boon for the next two fights.' },
      { id: 'alms', label: 'Give alms (10 silver each)', desc: 'They bless you: everyone heals 1d6.' },
      { id: 'mock', label: 'Mock them', desc: 'Free entertainment. They curse you: 1 bane next fight.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'join') { ps.forEach(p => { hurt(room, p, rd(1, 4)); if (p.char.alive) S.addBuff(p.char, 'Zealous', { atkBoon: 1 }, 198); }); return S.addLog(room, '🔔 The warband marches and bleeds with the faithful. (1 boon for two fights.)', 'crit'); }
      if (opt === 'alms') { ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 10); heal(p.char, rd(1, 6)); }); return S.addLog(room, '🙏 The prophet blesses each warrior. (+1d6 HP.)', 'heal'); }
      ps.forEach(p => nextFight(p.char, 'Cursed by Zealots', { bane: 1 }));
      S.addLog(room, '😏 The warband laughs. The prophet\'s curse follows you. (1 bane next fight.)', 'chaos');
    },
  },
  trollToll: {
    title: 'The Troll Bridge', icon: '🌉', minDepth: 6,
    text: 'A river troll squats under a rickety bridge. "Toll," it grunts, holding out an enormous hand.',
    options: [
      { id: 'pay', label: 'Pay the toll (20 silver each)', desc: 'Cross safely.' },
      { id: 'wade', label: 'Wade across downstream', desc: 'Everyone takes 1d6 from the freezing current.' },
      { id: 'trick', label: 'Trick it (Roadwarden)', desc: 'Cross for free, and lift 20 silver each from its hoard.', needs: 'rogue' },
      { id: 'challenge', label: 'Challenge it (Slayer)', desc: 'The Slayer trades blows (2d6) — the troll respects it and lets everyone pass with a Troll Blood draught.', needs: 'slayer' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'pay') { ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 20); }); return S.addLog(room, '🪙 The troll counts every coin, then waves you across.', 'sys'); }
      if (opt === 'trick') { ps.forEach(p => { p.char.gold += 20; }); return S.addLog(room, '🎭 The Roadwarden distracts the troll with a riddle while the warband helps itself — <strong>+20 silver</strong> each.', 'loot'); }
      if (opt === 'challenge') { ps.filter(p => p.career === 'slayer').forEach(p => hurt(room, p, rd(2, 6))); ps.forEach(p => S.addToInventory(p.char, 'Troll Blood')); return S.addLog(room, '🪓 The Slayer and the troll trade blows until the troll laughs and offers each of you a flask of <strong>Troll Blood</strong>.', 'loot'); }
      ps.forEach(p => hurt(room, p, rd(1, 6)));
      S.addLog(room, '🌊 The warband fords the icy river downstream.', 'dmg');
    },
  },
  ghostlyDuel: {
    title: 'The Ghostly Duellist', icon: '🤺', minDepth: 10,
    text: 'A spectral noble bows and draws a blade of moonlight. "One bout. Win, and my sword is yours."',
    options: [
      { id: 'duel', label: 'Accept the duel', desc: 'Your best fighter rolls: win a fine weapon, lose and take 2d6.' },
      { id: 'decline', label: 'Bow and decline', desc: 'He respects good manners: everyone heals 1d4.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'decline') { ps.forEach(p => heal(p.char, rd(1, 4))); return S.addLog(room, '🎩 The ghost returns your bow and fades. (+1d4 HP.)', 'heal'); }
      const best = ps.slice().sort((a, b) => Math.max(b.char.attrs.str, b.char.attrs.agi) - Math.max(a.char.attrs.str, a.char.attrs.agi))[0];
      const roll = d(20) + Math.max(best.char.attrs.str, best.char.attrs.agi) - 10;
      if (roll >= 13) { const w = S.genWpn((room.gs.bossCount || 0) + 1); S.addToInventory(best.char, w.name, w); return S.addLog(room, `🤺 ${best.name} wins the bout (${roll} vs 13) and claims <strong>${w.name}</strong>. (In inventory.)`, 'loot'); }
      S.addLog(room, `🤺 ${best.name} loses the bout (${roll} vs 13).`, 'dmg'); hurt(room, best, rd(2, 6));
    },
  },
  moonlitGrove: {
    title: 'The Moonlit Grove', icon: '🌙', minDepth: 4,
    text: 'Silver light falls on a ring of standing stones. The air hums. Something old is listening.',
    options: [
      { id: 'rest', label: 'Rest inside the ring', desc: 'Everyone heals 1d6+2.' },
      { id: 'commune', label: 'Commune with it (Priest or Wizard)', desc: 'Every spellcaster regains all castings and gets 1 boon next fight.', needs: ['priest', 'wizard'] },
      { id: 'dig', label: 'Dig at the centre stone', desc: '40 silver for one of you, but everyone is Cursed (1 bane) next fight.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'rest') { ps.forEach(p => heal(p.char, rd(1, 6) + 2)); return S.addLog(room, '🌙 The warband sleeps under the stones and wakes refreshed.', 'heal'); }
      if (opt === 'commune') { ps.filter(p => p.char.spellcaster).forEach(p => { S.refreshCastingPools(p.char); nextFight(p.char, 'Moonlit', { atkBoon: 1 }); }); return S.addLog(room, '✨ The stones answer. Spellcasters regain every casting. (1 boon next fight.)', 'spell'); }
      pickRandom(ps).char.gold += 40; ps.forEach(p => nextFight(p.char, 'Grove Curse', { bane: 1 }));
      S.addLog(room, '💰 Beneath the stone: 40 silver. The grove will not forget. (1 bane next fight.)', 'chaos');
    },
  },
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

  // ── Recurring characters ────────────────────────────────────────────────
  // The Black Ravens: a rival warband met three times. What you do the first
  // time decides how the later meetings go (gs.flags.ravens).
  ravens1: {
    title: 'The Black Ravens', icon: '🐦‍⬛', minDepth: 2, requires: gs => !flag(gs, 'ravens'),
    text: 'A rival warband blocks the bridge — black feathers in their caps. Their captain, Ulla Kranz, smiles: "Toll\'s twenty silver a head. Or turn back."',
    options: [
      { id: 'pay', label: 'Pay the toll', desc: '−20 silver each. Ulla will remember you as easy marks.' },
      { id: 'fight', label: 'Draw steel', desc: 'Fight her sellswords (an elite fight). Ulla will remember the insult.' },
      { id: 'bluff', label: 'Talk your way past', desc: 'A 50/50 chance: cross for free and earn respect, or pay double.' },
    ],
    resolve(room, opt) {
      const gs = room.gs, ps = alive(room);
      if (opt === 'pay') { ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 20); }); setFlag(gs, 'ravens', 'paid'); return S.addLog(room, '🐦‍⬛ You pay. Ulla tips her hat. "Pleasure doing business."', 'sys'); }
      if (opt === 'fight') { setFlag(gs, 'ravens', 'fought'); S.addLog(room, '🐦‍⬛ "Your funeral." Ulla steps back and whistles up her hired blades.', 'dmg'); return S.startFight(room, 'elite'); }
      if (Math.random() < 0.5) { setFlag(gs, 'ravens', 'respect'); return S.addLog(room, '🐦‍⬛ Ulla laughs until she cries. "Bold. I like bold. Go on through."', 'heal'); }
      ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 40); }); setFlag(gs, 'ravens', 'paid');
      S.addLog(room, '🐦‍⬛ Ulla is not amused. "Forty, then. Each." (−40 silver each.)', 'chaos');
    },
  },
  ravens2: {
    title: 'The Ravens Return', icon: '🐦‍⬛', minDepth: 9, requires: gs => flag(gs, 'ravens') && !flag(gs, 'ravens2'),
    text: 'Black feathers again. Ulla Kranz and her Ravens are camped at a ruined chapel — and they have seen you.',
    options: [
      { id: 'parley', label: 'Parley', desc: 'How it goes depends on your last meeting.' },
      { id: 'ambush', label: 'Strike first', desc: 'Ambush them: an elite fight, but you start with 1 boon on every attack.' },
      { id: 'avoid', label: 'Slip around them', desc: 'Lose an hour in the brambles: everyone takes 1d4 damage.' },
    ],
    resolve(room, opt) {
      const gs = room.gs, ps = alive(room), past = flag(gs, 'ravens');
      setFlag(gs, 'ravens2', opt);
      if (opt === 'ambush') { ps.forEach(p => nextFight(p.char, 'Ambush', { atkBoon: 1 })); S.addLog(room, '🐦‍⬛ You fall on the Ravens\' camp before they can form up!', 'dmg'); return S.startFight(room, 'elite'); }
      if (opt === 'avoid') { ps.forEach(p => hurt(room, p, rd(1, 4))); return S.addLog(room, '🌿 You creep around the chapel through thorn and nettle.', 'sys'); }
      if (past === 'respect') { ps.forEach(p => { p.char.gold += 25; heal(p.char, 8); }); return S.addLog(room, '🐦‍⬛ "The bold ones!" Ulla shares her fire, her wine and a purse — +25 silver and 8 HP each.', 'heal'); }
      if (past === 'paid') { ps.forEach(p => { p.char.gold = Math.max(0, p.char.gold - 15); }); return S.addLog(room, '🐦‍⬛ "My favourite customers." The toll went up: −15 silver each.', 'chaos'); }
      S.addLog(room, '🐦‍⬛ "You!" Ulla remembers the bridge. Her Ravens draw steel.', 'dmg'); return S.startFight(room, 'elite');
    },
  },
  ravens3: {
    title: 'The Last of the Ravens', icon: '🐦‍⬛', minDepth: 17, requires: gs => flag(gs, 'ravens2') && !flag(gs, 'ravens3'),
    text: 'Ulla Kranz sits alone on a broken wall, her warband gone. "The thing down there took them all. You\'re going after it anyway. Take me with you — or take what\'s left of our stash."',
    options: [
      { id: 'recruit', label: 'Let her fight with you', desc: 'Ulla fights at your side: everyone gets +2 damage on their next hit.' },
      { id: 'stash', label: 'Take the stash', desc: 'One of you gets a legendary-quality weapon.' },
      { id: 'mercy', label: 'Send her home', desc: 'She presses her lucky charm on you: everyone heals to full.' },
    ],
    resolve(room, opt) {
      const gs = room.gs, ps = alive(room); setFlag(gs, 'ravens3', opt);
      if (opt === 'recruit') { ps.forEach(p => S.addBuff(p.char, "Ulla's Blade", { dmgBonus: 2, consumeOnHit: true }, 99)); return S.addLog(room, '🐦‍⬛ "One last job, then." Ulla falls in beside you — +2 damage on your next hit.', 'heal'); }
      if (opt === 'stash') { const p = pickRandom(ps); const w = S.genWpn(Math.max(1, gs.bossCount || 1) + 1); S.addToInventory(p.char, w.name, w); return S.addLog(room, `🐦‍⬛ The Ravens' stash: ${p.name} takes <strong>${w.name}</strong>.`, 'loot'); }
      ps.forEach(p => { p.char.health = p.char.maxHealth; });
      S.addLog(room, '🐦‍⬛ Ulla goes, lighter for it. Her charm glows once in your hands — everyone is <strong>fully healed</strong>.', 'heal');
    },
  },
  // Brother Aldric, a witch hunter who keeps finding the warband.
  aldric1: {
    title: 'Brother Aldric', icon: '🔥', minDepth: 4, requires: gs => !flag(gs, 'aldric'),
    text: 'A witch hunter in a wide hat stops you, pistol drawn. "Brother Aldric, of the Order. One of you smells of the warp. Hand over anything cursed."',
    options: [
      { id: 'hand', label: 'Hand over cursed items', desc: 'Give up every cursed item; he pays 15 silver for each.' },
      { id: 'refuse', label: 'Refuse', desc: 'He lets you go — but he will be watching.' },
      { id: 'help', label: 'Offer to help his hunt', desc: 'Everyone takes 1d6 damage in the hunt; everyone gets 1 boon in the next 2 fights.' },
    ],
    resolve(room, opt) {
      const gs = room.gs, ps = alive(room); setFlag(gs, 'aldric', opt);
      if (opt === 'hand') { let n = 0; ps.forEach(p => { const c = cursedInPack(p.char); n += c.length; p.char.inventory = p.char.inventory.filter(i => !c.includes(i)); p.char.gold += 15 * c.length; }); return S.addLog(room, n ? `🔥 Aldric burns ${n} cursed item${n > 1 ? 's' : ''} and pays you for them.` : '🔥 Aldric searches you and finds nothing. "Hm. Clean. For now."', 'sys'); }
      if (opt === 'refuse') return S.addLog(room, '🔥 "Then I will see you again," says Aldric. It is not a promise.', 'chaos');
      ps.forEach(p => { hurt(room, p, rd(1, 6)); S.addBuff(p.char, "Aldric's Blessing", { atkBoon: 1 }, 99); });
      S.addLog(room, '🔥 You help Aldric burn a nest of cultists. He blesses your weapons.', 'heal');
    },
  },
  aldric2: {
    title: 'Aldric Again', icon: '🔥', minDepth: 12, requires: gs => flag(gs, 'aldric') && !flag(gs, 'aldric2'),
    text: 'Brother Aldric is waiting at the crossroads, as if he knew you would come. "We meet again."',
    options: [
      { id: 'talk', label: 'Hear him out', desc: 'What he offers depends on how you treated him.' },
      { id: 'leave', label: 'Walk on', desc: 'Nothing happens. Probably.' },
    ],
    resolve(room, opt) {
      const gs = room.gs, ps = alive(room), past = flag(gs, 'aldric'); setFlag(gs, 'aldric2', opt);
      if (opt === 'leave') return S.addLog(room, '🔥 Aldric watches you go.', 'sys');
      if (past === 'refuse') { ps.forEach(p => S.addBuff(p.char, 'Under Suspicion', { bane: 1, consumeOnAttack: true }, 99)); return S.addLog(room, '🔥 "Still hiding something." He has spread word of you — 1 bane on your next attack.', 'chaos'); }
      ps.forEach(p => { heal(p.char, 10); S.addToInventory(p.char, 'Holy Water'); });
      S.addLog(room, '🔥 "Sigmar walks with honest folk." Aldric gives each of you Holy Water and tends your wounds (+10 HP).', 'heal');
    },
  },
  // ── Party decisions ──────────────────────────────────────────────────────
  forkInTheRoad: {
    title: 'The Fork in the Road', icon: '🔀', minDepth: 3, requires: (gs, room) => alive(room).length >= 2,
    text: 'The road splits around a burned village. Scouting both sides would be quicker — but splitting the warband is a risk.',
    options: [
      { id: 'split', label: 'Split up and scout', desc: 'Each of you rolls: on 11+ you find 30 silver, on 10 or less you are ambushed for 2d6.' },
      { id: 'together', label: 'Stay together', desc: 'Safe and slow: everyone heals 1d6.' },
    ],
    resolve(room, opt) {
      const ps = alive(room);
      if (opt === 'together') { const h = rd(1, 6); ps.forEach(p => heal(p.char, h)); return S.addLog(room, `🔀 The warband sticks together and rests as it walks (+${h} HP each).`, 'heal'); }
      ps.forEach(p => { const r = d(20); if (r >= 11) { p.char.gold += 30; S.addLog(room, `🔀 ${p.name} (d20: ${r}) finds a hidden cache — <strong>+30 silver</strong>.`, 'loot'); } else { const dmg = rd(2, 6); S.addLog(room, `🔀 ${p.name} (d20: ${r}) walks into an ambush — <strong class="num-dmg">−${dmg} HP</strong>.`, 'dmg'); hurt(room, p, dmg); } });
    },
  },
};
function flag(gs, k) { return gs.flags && gs.flags[k]; }
function setFlag(gs, k, v) { gs.flags = gs.flags || {}; gs.flags[k] = v; }

// Start a choice event: the room waits in phase 'choice' until everyone votes.
function startChoiceEvent(room, key) {
  const depth = room.gs.depth || 0;
  const ok = x => (CHOICE_EVENTS[x].minDepth || 0) <= depth && (!CHOICE_EVENTS[x].requires || CHOICE_EVENTS[x].requires(room.gs, room));
  const pool = Object.keys(CHOICE_EVENTS).filter(ok);
  // A recurring character whose next meeting is due shows up more often than a random event.
  const story = pool.filter(x => /^(ravens|aldric)[23]$/.test(x));
  if (!key && story.length && Math.random() < 0.5) key = pickRandom(story);
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
