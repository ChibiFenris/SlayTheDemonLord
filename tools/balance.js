'use strict';
// Balance simulator: plays whole runs in-process with the real server rules and a
// sensible bot (heals when low, focuses the weakest enemy, upgrades gear, picks
// paths that fit its career). Prints win rates, depth reached and gear/charm stats.
//   node tools/balance.js [runsPerSetup=40]
process.env.NO_TURN_TIMER = '1'; // party sims would otherwise hit the 60-second turn limit
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), 'sor-balance');
const realTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...a) => realTimeout(fn, 0, ...a); // no dramatic pauses
require('../game/persist').scheduleSave = () => {}; // simulations don't need saves
{ const rl = require('../game/runlog'); rl.appendRun = () => {}; rl.addDailyScore = () => {}; } // or record simulated runs
const S = require('../server.js');
const D = require('../game/data.js');

const PATHS = Object.fromEntries(Object.entries(D.CAREER_PATHS).map(([k,v])=>[k,{expert:Object.keys(v.expert),master:Object.keys(v.master)}]));
const TRADS = Object.keys(D.TRADITIONS);
const pick = a => a[Math.floor(Math.random() * a.length)];
const avgDice = s => { const m = /(\d+)d(\d+)/.exec(s || '1d6'); return m ? m[1] * (+m[2] + 1) / 2 : 3.5; };
const wpnScore = w => w ? avgDice(w.dice) + (w.bonus || 0) - ((w.traits || []).includes('notched') ? 1 : 0) - (w.cursed ? 1.5 : 0) : 0;
const armScore = a => a ? (a.defBonus || 0) - (a.cursed ? 1 : 0) : 0;

function runGame(careers, opts = {}) {
  return new Promise(resolve => {
    const socks = careers.map((c, i) => ({ i, readyState: 1, career: c, last: null, send(m) { this.last = m; schedule(); } }));
    let pending = false, done = false, steps = 0;
    const finish = r => { if (done) return; done = true; S.rooms.delete(room.code); resolve(r); };
    const schedule = () => { if (pending || done) return; pending = true; setImmediate(tick); };
    const guard = realTimeout(() => finish({ outcome: 'timeout' }), 90000);
    function tick() {
      pending = false; if (done) return;
      if (++steps > 40000) { clearTimeout(guard); return finish({ outcome: 'stuck' }); }
      for (const sk of socks) {
        if (!sk.last) continue;
        const msg = JSON.parse(sk.last); sk.last = null;
        if (msg.type !== 'STATE_UPDATE') continue;
        const st = msg.payload, gs = st.gs;
        if (gs.phase === 'gameover' || gs.phase === 'victory') {
          clearTimeout(guard);
          const me = st.players[0].char;
          return finish({ outcome: gs.phase, depth: gs.depth, bosses: gs.bossCount, weapon: me.equippedWeapon && me.equippedWeapon.name,
            charm: me.equippedCharm && me.equippedCharm.name, careers, level: me.level });
        }
        act(sk, st);
      }
    }
    const room = (() => { S.handleMessage(socks[0], { type: 'CREATE_ROOM', payload: { name: 'B0' } }); return [...S.rooms.values()].pop(); })();
    for (let i = 1; i < socks.length; i++) S.handleMessage(socks[i], { type: 'JOIN_ROOM', payload: { code: room.code, name: 'B' + i } });
    if (opts.difficulty) S.handleMessage(socks[0], { type: 'SET_DIFFICULTY', payload: { level: opts.difficulty } });
    socks.forEach(sk => S.handleMessage(sk, { type: 'SELECT_CAREER', payload: { career: sk.career, startingCharm: opts.charm } }));
    socks.forEach(sk => S.handleMessage(sk, { type: 'PLAYER_READY', payload: {} }));
    const ctxOf = sk => S.clients.get(sk);
    function send(sk, action, data) { S.handleMessage(sk, { type: 'PLAYER_ACTION', payload: { action, data: data || {} } }); }
    function act(sk, st) {
      const gs = st.gs, myId = ctxOf(sk).playerId, me = st.players.find(p => p.id === myId), c = me && me.char;
      if (!c) return;
      if (c.pendingLevelUp) {
        const tier = c.pendingPathTier;
        if (tier === 'tradition') { const t = pick(TRADS.filter(x => D.traditionAllowed(c, x) && !(c.traditions || []).includes(x))); return send(sk, 'APPLY_PATH', { pathId: 'tradition:' + t }); }
        if (tier === 'expert') return send(sk, 'APPLY_PATH', { pathId: pick(PATHS[sk.career].expert) });
        if (tier === 'master') return send(sk, 'APPLY_PATH', { pathId: pick(PATHS[sk.career].master) });
      }
      if (c.pendingStatBoost) return send(sk, 'CHOOSE_STAT', { attr: { empire: 'str', bretonnia: 'wil', dwarf: 'str', highelf: 'int', woodelf: 'agi' }[sk.career] || 'str' });
      if (gs.phase === 'aftermath' && gs.aftermath && !gs.aftermath.ready.includes(myId)) return send(sk, 'CONTINUE_AFTERMATH');
      if (gs.phase === 'campfire' && gs.campfire && c.alive && !gs.campfire.choices[myId]) { const o = c.campOptions || []; const up = c.health / c.maxHealth > 0.75 && o.length; return send(sk, 'CAMPFIRE', up ? { choice: 'upgrade', slot: (o.find(x => x.slot === 'weapon') || o[0]).slot } : { choice: 'rest' }); }
      if (c.alive && gs.phase === 'relic' && gs.relic) {
        if (!gs.relic.picked.includes(myId) && c.relicOptions && c.relicOptions.length) return send(sk, 'PICK_RELIC', { key: c.relicOptions[0] });
        if (gs.relic.prize && !gs.relic.prize.votes[myId]) return send(sk, 'VOTE_PRIZE', { choice: 'need' });
        return;
      }
      if (gs.phase === 'choice' && gs.choice && !gs.choice.votes[myId]) return send(sk, 'CHOOSE_EVENT', { option: pick(gs.choice.options).id });
      if (!c.alive) return;
      const inv = c.inventory || [];
      // Out of combat: wear the best gear.
      if (gs.phase !== 'combat') {
        const wi = inv.findIndex(i => i.type === 'weapon' && i.itemObj && wpnScore(i.itemObj) > wpnScore(c.equippedWeapon) + 0.5 && i.itemObj.stat === (c.equippedWeapon && c.equippedWeapon.stat || i.itemObj.stat));
        if (wi >= 0 && !(c._curseLock && c._curseLock.weapon)) return send(sk, 'EQUIP_ITEM', { inventoryIndex: wi });
        const ai = inv.findIndex(i => i.type === 'armor' && i.itemObj && armScore(i.itemObj) > armScore(c.equippedArmor));
        if (ai >= 0 && !(c._curseLock && c._curseLock.armor)) return send(sk, 'EQUIP_ITEM', { inventoryIndex: ai });
        const ci = inv.findIndex(i => i.type === 'charm' && i.itemObj && !i.itemObj.cursed);
        if (ci >= 0 && !c.equippedCharm) return send(sk, 'EQUIP_ITEM', { inventoryIndex: ci });
      }
      if (gs.phase === 'path' && gs.pathChoices && !(gs.pathVotes || {})[myId]) {
        const hpPct = c.health / c.maxHealth, ch = gs.pathChoices;
        const pref = hpPct < 0.5 ? ['rest', 'merchant', 'loot', 'unknown', 'combat', 'boss', 'elite']
          : c.gold > 60 ? ['merchant', 'loot', 'combat', 'unknown', 'elite', 'rest', 'boss'] : ['loot', 'combat', 'unknown', 'elite', 'merchant', 'rest', 'boss'];
        if (ch.includes('cursed') && hpPct > 0.7 && Math.random() < 0.3) return send(sk, 'VOTE_PATH', { nodeType: 'cursed' });
        return send(sk, 'VOTE_PATH', { nodeType: pref.find(p => ch.includes(p)) || ch[0] });
      }
      if (gs.phase === 'loot' && gs.lootRoom && !(gs.lootPicked || []).includes(myId)) {
        const o = c.lootOptions || {};
        const p = o.weapon && wpnScore(o.weapon) > wpnScore(c.equippedWeapon) + 1 ? 'weapon' : o.armor && armScore(o.armor) > armScore(c.equippedArmor) ? 'armor' : (o.charm && !c.equippedCharm ? 'charm' : 'consumable');
        return send(sk, 'PICK_LOOT', { pick: p });
      }
      if (gs.phase === 'merchant' && c.merchantStock) {
        const stock = c.merchantStock; const all = [stock.armor, stock.armor2, stock.weapon1, stock.weapon2, stock.weapon3, ...(stock.consumables || [])].filter(Boolean);
        const lockW = c._curseLock && c._curseLock.weapon, lockA = c._curseLock && c._curseLock.armor;
        const buy = all.find(it => !it.bought && it.cost <= c.gold && (
          (it.type === 'weapon' && !lockW && it.stat === (c.equippedWeapon && c.equippedWeapon.stat || it.stat) && wpnScore(it) > wpnScore(c.equippedWeapon) + 1) ||
          (it.type === 'armor' && !lockA && armScore(it) > armScore(c.equippedArmor)) ||
          (/Healing/.test(it.name) && c.gold - it.cost >= 15)));
        if (buy) return send(sk, 'BUY_ITEM', { itemId: buy.id });
        return send(sk, 'LEAVE_SHOP');
      }
      if (gs.phase === 'event') return send(sk, 'PRESS_ONWARD');
      if (gs.phase !== 'combat') return;
      const cur = gs.turnOrder && gs.turnOrder[gs.activeTurnIdx];
      if (!cur || cur.type !== 'player' || cur.id !== myId) return;
      const alive = (gs.enemies || []).map((e, i) => [e, i]).filter(([e]) => e && e.hp > 0 && !e._hiding && !e._vanished);
      const weakest = alive.sort((a, b) => a[0].hp - b[0].hp)[0];
      if (weakest && weakest[1] !== (gs.activeEnemyIdx || 0) && alive.length > 1) send(sk, 'TARGET_ENEMY', { idx: weakest[1] });
      const spells = (c.equippedCharm && c.equippedCharm.key === 'brassSkull') ? [] : (c.knownSpells || []);
      const left = sp => { const v = c.castingPools && c.castingPools['R' + sp.rank]; return v === undefined ? 1 : v; };
      const hpPct = c.health / c.maxHealth;
      const allies = st.players.filter(p => p.char && p.char.alive);
      const hurtAlly = allies.filter(p => p.char.health / p.char.maxHealth < 0.4).sort((a, b) => a.char.health - b.char.health)[0];
      const healSpell = spells.filter(s => s.type === 'heal' && left(s) > 0).sort((a, b) => b.rank - a.rank)[0];
      if (hurtAlly && healSpell) return send(sk, 'CAST_SPELL', { spellName: healSpell.name, targetId: hurtAlly.id });
      if (hpPct < 0.35) {
        for (const t of ['catchBreath', 'nimbleRecovery', 'spellRecovery']) if (c[t] && !c[{ catchBreath: 'catchBreathUsed', nimbleRecovery: 'nimbleUsed', spellRecovery: 'spellRecoveryUsed' }[t]]) return send(sk, 'USE_TALENT', { talent: t });
        const pot = inv.find(i => /Healing Draught|Dwarf Ale|Troll Blood|Sigmar's Token/.test(i.name));
        if (pot) return send(sk, 'USE_ITEM', { itemName: pot.name });
      }
      const boss = (gs.enemies || []).find(e => e && e.hp > 0 && e._windup);
      if (boss && c.block && !c._blockUsed) return send(sk, 'USE_TALENT', { talent: 'block' });
      if (c.revive && !c._reviveUsed && st.players.some(p => p.char && !p.char.alive && p.id !== myId)) return send(sk, 'USE_TALENT', { talent: 'revive' });
      if (boss && c.shieldBash && !c._shieldBashUsed) return send(sk, 'USE_TALENT', { talent: 'shieldBash' });
      if (c.taunt && hurtAlly && hurtAlly.id !== myId && !((c._tauntReadyRound || 0) > gs.roundNumber)) return send(sk, 'USE_TALENT', { talent: 'taunt' });
      if (c.condemn && !c._condemnUsed && !c._condemnTargetId) return send(sk, 'USE_TALENT', { talent: 'condemn' });
      for (const t of ['turret', 'arrowStorm', 'grenade', 'steamBarrage', 'divineSmite', 'warCry', 'deadAim', 'curse', 'massHeal']) if (c[t] && !c[t + 'Used'] && !c['_' + t + 'Used']) return send(sk, 'USE_TALENT', { talent: t });
      const atkSpell = spells.filter(s => s.type === 'attack' && left(s) > 0).sort((a, b) => b.rank - a.rank)[0];
      if (atkSpell && c.spellcaster && (atkSpell.rank > 0 || (c.equippedWeapon && c.equippedWeapon.stat === 'int'))) return send(sk, 'CAST_SPELL', { spellName: atkSpell.name });
      return send(sk, 'ATTACK');
    }
    socks.forEach(sk => { if (sk.last) schedule(); });
  });
}

(async () => {
  const N = +process.argv[2] || 40;
  const setups = [['empire'], ['bretonnia'], ['dwarf'], ['highelf'], ['woodelf'], ['empire', 'dwarf', 'highelf', 'woodelf']];
  const charmStats = {}, weaponStats = {};
  console.log(`Balance run: ${N} games per setup\n`);
  console.log('setup'.padEnd(34) + 'win%  avg depth  past boss1  past boss2  timeouts');
  for (const setup of setups) {
    const res = [];
    const runs = setup.length > 1 ? Math.ceil(N / 3) : N; // full parties are slower to simulate
    for (let i = 0; i < runs; i++) {
      const charm = Math.random() < 0.5 ? pick(D.CHARM_SHOP_KEYS) : undefined;
      const r = await runGame(setup, { charm });
      res.push(r);
      if (r.depth !== undefined) {
        const ck = r.charm || '(none)'; (charmStats[ck] = charmStats[ck] || []).push(r.depth);
        const wk = (r.weapon || '').replace(/^(Starting Weapon).*/, '$1'); (weaponStats[wk] = weaponStats[wk] || []).push(r.depth);
      }
    }
    const ok = res.filter(r => r.depth !== undefined);
    const avg = ok.reduce((a, r) => a + r.depth, 0) / Math.max(1, ok.length);
    const pct = f => Math.round(100 * ok.filter(f).length / Math.max(1, ok.length));
    console.log(setup.join('+').padEnd(34) + String(pct(r => r.outcome === 'victory')).padStart(4) + '%' + avg.toFixed(1).padStart(10) +
      (pct(r => r.bosses >= 1) + '%').padStart(12) + (pct(r => r.bosses >= 2) + '%').padStart(12) + String(res.length - ok.length).padStart(10));
  }
  const table = (title, stats) => {
    console.log(`\n${title} (avg depth reached, games)`);
    Object.entries(stats).filter(([, v]) => v.length >= 4).sort((a, b) => b[1].reduce((x, y) => x + y, 0) / b[1].length - a[1].reduce((x, y) => x + y, 0) / a[1].length)
      .forEach(([k, v]) => console.log('  ' + k.padEnd(28) + (v.reduce((x, y) => x + y, 0) / v.length).toFixed(1).padStart(6) + String(v.length).padStart(6)));
  };
  table('Charms worn at the end', charmStats);
  table('Weapon at the end', weaponStats);
  process.exit(0);
})();
