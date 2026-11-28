'use strict';
// Enemy signature mechanics, boss warnings and summons. The combat flow in
// server.js calls the hooks exported here; server functions this module needs
// (logging, buffs, deaths) are handed over once with bind().
const { d, rd } = require('./dice');
const { aliveEnemies, alivePlayers, pickRandom } = require('./util');
const { SUMMONS, ENEMY_POOLS } = require('./data');
const foes = require('./foes');
const rows = require('./rows');
const { charmKey, armorTraits, immuneToPoison, weaponIsHoly, resistsInsanity } = require('./gear');

const S = {};
function bind(api) { Object.assign(S, api); }

// ═════════════════════════════════════════════════════════════════════════════
// ENEMY SIGNATURE MECHANICS
// Each enemy has one mechanic you play around. They plug into the combat flow
// through the hooks below (combat start, enemy turn, targeting, hits, death).
// ═════════════════════════════════════════════════════════════════════════════
let _enemySeq=0;
function newEnemyId(){ return 'en'+(++_enemySeq); }
function isEnemyHidden(e, gs){
  if(!e||!(e._hiding||e._vanished)) return false;
  return aliveEnemies(gs).some(o=>o!==e&&!(o._hiding||o._vanished)); // never hidden when it's the last one
}
function summonEnemy(room, tmpl){
  const gs=room.gs;
  const e=S.scaleEnemy(tmpl, room.players.filter(p=>p.connected&&p.char&&p.char.alive).length, false, gs.bossCount);
  e.id=newEnemyId(); e.summoned=true;
  gs.enemies.push(e);
  refreshEnemyAuras(gs);
  return e;
}
const MUTATIONS=[
  {key:'extraArm',  label:'Extra Arm',  desc:'attacks twice'},
  {key:'thickHide', label:'Thick Hide', desc:'+3 Defence'},
  {key:'acidBlood', label:'Acid Blood', desc:'hitting it with a weapon burns you for 1d4'},
  {key:'tentacles', label:'Tentacles',  desc:'its hits Grab you — 1 bane on your next attack'},
];
// Called from scaleEnemy for every new enemy.
function prepareEnemy(e, bossCount){
  if(e.mutation===true){
    const m=pickRandom(MUTATIONS);
    e.mutation=m.key; e.mutationLabel=m.label; e.mutationDesc=m.desc; e.type=`Mutant · ${m.label}`;
    if(m.key==='extraArm') e.attacks=2;
    if(m.key==='thickHide') e.ac+=3;
  }
  if(e.swarm){ e.attacks=3; e.dmgNum=1; e.dmgSides=3; e.dmgBonus=bossCount||0; }
}
// Auras that depend on who else is alive: Skeleton shield wall, Plague Rat Lord.
// Bonuses that only last while their source is alive. Each one remembers how much it
// added, so it can be taken back off when the source (or the allies it counts) falls.
function setAura(e, key, field, want){ const delta=want-(e[key]||0); if(delta){ e[field]=(e[field]||0)+delta; e[key]=want; return true; } return false; }
function refreshEnemyAuras(gs){
  rows.refreshEnemyRows(gs);
  foes.refreshMobAura(gs);
  const alive=aliveEnemies(gs);
  const lord=alive.some(e=>e.ratLord);
  const clanrats=alive.filter(e=>e.name==='Skaven Clanrat').length;
  const decreeLord=alive.some(e=>e._decree);
  const waaagh=alive.filter(e=>e._waaagh||e._waaaghBoss).length; // each roaring greenskin still standing
  alive.forEach(e=>{
    let dmgChanged=false;
    if(e._decree) setAura(e,'_decreeAc','ac',2*clanrats);                 // Warlord's Decree: +2 Defence per living clanrat
    if(e.scurryAway) e._scurryDefBonus=clanrats>0?3:0;                     // Scurry Away: only with clanrats to hide behind
    dmgChanged=setAura(e,'_decreeDmg','dmgBonus',(e._rallied&&decreeLord)?2:0)||dmgChanged; // rallied clanrats, while their Warlord lives
    dmgChanged=setAura(e,'_waaaghDmg','dmgBonus',(e.tags||[]).includes('greenskin')?waaagh:0)||dmgChanged; // WAAAGH!, while the roarer lives
    if(dmgChanged) e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`;
    e._wallActive=!!(e.shieldWall&&alive.some(o=>o!==e&&o.tags&&o.tags.includes('undead')));
    const want=(lord&&!e.ratLord&&e.tags&&e.tags.includes('skaven'))?1:0;
    const delta=want-(e._ratAura||0);
    if(delta){ e.ac+=delta; e.dmgBonus=(e.dmgBonus||0)+delta; e._ratAura=want; e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`; }
  });
}
// Combat start: pairs, escorts and per-fight charm effects.
function onCombatStart(room){
  const gs=room.gs;
  gs.enemies.forEach(e=>{ if(!e.id||/^e\d$/.test(e.id)) e.id=newEnemyId(); });
  gs.enemies.slice().forEach(e=>{
    if(e.horde&&!e.summoned&&gs.enemies.length<4){
      const tmpl=ENEMY_POOLS.low.find(t=>t.name===e.name);
      const z=summonEnemy(room,{...tmpl,xp:1}); z.isElite=e.isElite;
      S.addLog(room,`🧟 Another <strong>Zombie</strong> shambles out of the dark — they come in pairs!`,'dmg');
    }
    if(e.ratLord&&gs.enemies.length<5){ summonEnemy(room,SUMMONS.poxRats); S.addLog(room,`🐀 The <strong>Plague Rat Lord</strong> arrives with a <strong>Pox Rat Swarm</strong>!`,'dmg'); }
    if(e.mutation&&e.mutationLabel) S.addLog(room,`🧬 ${e.name} — <strong>${e.mutationLabel}</strong>: ${e.mutationDesc}.`,'chaos');
  });
  refreshEnemyAuras(gs);
  room.players.forEach(p=>{
    const c=p.char; if(!c||!c.alive) return;
    const ch=charmKey(c);
    if(ch==='gamblerDie'){
      const keys=['str','agi','int','wil']; const up=pickRandom(keys); const down=pickRandom(keys.filter(k=>k!==up));
      c.attrs[up]+=2; c.attrs[down]-=1; c._gambler={up,down};
      S.addLog(room,`🎲 <strong>Gambler's Die</strong> — ${p.name}: +2 ${up.toUpperCase()}, −1 ${down.toUpperCase()} this fight.`,'loot');
    }
    if(ch==='boneRosary'){ c.health=Math.max(1,c.health-3); }
    if(c.equippedArmor&&c.equippedArmor.special&&c.equippedArmor.special.key==='nurgleMask'&&(c._nurgleDrain||0)<12){
      c._nurgleDrain=(c._nurgleDrain||0)+2; c.maxHealth=Math.max(1,c.maxHealth-2); c.health=Math.min(c.health,c.maxHealth);
      S.addLog(room,`🪰 The <strong>Skull-Mask of Nurgle</strong> feeds — ${p.name} loses 2 max HP until they rest.`,'chaos');
    }
    c._unwieldyUsed=false; c._shieldBlockUsed=false; c._lensUsed=false; c._rosaryUsed=false; c._hitSinceTurn=false;
  });
}
// Turn order: shambling enemies always act last.
function sortTurnOrder(gs, order){
  const rank=s=>{ if(s.type!=='enemy') return 0; const e=(gs.enemies||[]).find(x=>x&&x.id===s.id); return e&&e.shambling?2:1; };
  return order.map((s,i)=>[s,i]).sort((a,b)=>rank(a[0])-rank(b[0])||a[1]-b[1]).map(x=>x[0]);
}

// ── Boss telegraphs ──────────────────────────────────────────────────────────
const TELEGRAPHS={
  warpGas:   {name:'Warp-Gas Globe', warn:n=>`⚠ <strong>${n}</strong> uncorks a glowing warp-gas globe — next turn it bursts over the whole warband! Stun him to stop it.`},
  goreCharge:{name:'Gore Charge',    warn:n=>`⚠ <strong>${n}</strong> lowers his horns and paws the ground — next turn he GORES the weakest warrior for triple damage! Taunt, heal or stun him.`},
  leap:      {name:'Leaping Maul',   warn:n=>`⚠ <strong>${n}</strong> crouches to spring — next turn it leaps on a random warrior for double damage. Taunt cannot stop it; a stun can.`},
  slam:      {name:'Bonebreaker Slam',warn:n=>`⚠ <strong>${n}</strong> raises both fists — next turn it SLAMS one warrior for triple damage and a stun! Taunt to choose who takes it, or stun it first.`},
  warpStorm: {name:'Warp Storm',      warn:n=>`⚠ <strong>${n}</strong> gathers a storm of green warp lightning — next turn it strikes the whole warband! Stun him to stop it.`},
  hornCurse: {name:'Curse of Horns',  warn:n=>`⚠ <strong>${n}</strong> raises a bloody totem and begins to chant — next turn he curses everyone and drinks their strength. Stun him to stop it.`},
  plagueWind:{name:'Plague Wind',     warn:n=>`⚠ <strong>${n}</strong> breathes deep, his belly swelling with rot — next turn a plague wind poisons the whole warband. Stun him to stop it.`},
  trollSmash:{name:'Troll Smash',     warn:n=>`⚠ <strong>${n}</strong> hefts a boulder overhead — next turn it crushes one warrior for triple damage. Taunt to choose who takes it, or stun it.`},
  hellfire:  {name:'Hellfire',        warn:n=>`⚠ <strong>${n}</strong> spreads its wings and the air begins to burn — next turn hellfire engulfs the warband. Stun it to stop it.`},
  dragonBreath:{name:'Dragon Breath', warn:n=>`⚠ <strong>${n}</strong> draws in a vast breath, smoke curling from its jaws — next turn it breathes fire on everyone. Stun it to stop it.`},
  bigChoppa: {name:'Big Choppa',      warn:n=>`⚠ <strong>${n}</strong> hefts a choppa the size of a door — next turn he cleaves one warrior for triple damage and Bleed! Taunt to choose who takes it, or stun him.`},
  stomp:     {name:'Primordial Stomp',warn:n=>`⚠ <strong>${n}</strong> rears up on its hind legs — next turn it stomps the whole warband and knocks everyone Prone! Stun it to stop it.`},
};

const isBlocking = c => (c.activeBuffs||[]).some(b=>b.blocking);

// Returns 'done' when the enemy's special replaced its normal attack.
// Otherwise may return {targets, ignoreTaunt, mult, extraBoon} to shape the attack.
function enemyPreTurn(room, ae, alive){
  const gs=room.gs;
  const plan={};
  if(foes.preTurn(room, ae, alive, plan)==='done') return 'done';
  // Hidden/vanished enemies come back at the start of their own turn.
  if(ae._vanished){ ae._vanished=false; ae._returnBoon=true; S.addLog(room,`🐀 <strong>${ae.name}</strong> darts out of the shadows!`,'chaos'); }
  if(ae.hideBehind){
    const others=aliveEnemies(gs).filter(o=>o!==ae&&!(o._hiding||o._vanished));
    if(ae.hp<ae.maxHp*0.3&&others.length){
      if(!ae._hiding) S.addLog(room,`🐀 <strong>${ae.name}</strong> squeals and cowers behind ${others[0].name} — it can't be targeted while its friends stand!`,'chaos');
      ae._hiding=true; return 'done';
    }
    ae._hiding=false;
  }
  if(ae.trollRegen){
    const burning=(ae.activeDebuffs||[]).some(d=>d.name==='Burn')||ae._burnedThisRound;
    if(burning) S.addLog(room,`🔥 ${ae.name}'s wounds are seared — <strong>no regeneration</strong> this turn!`,'spell');
    else if(ae.hp<ae.maxHp){ const h=rd(1,6)+2; ae.hp=Math.min(ae.maxHp,ae.hp+h); S.addLog(room,`💚 <strong>Troll Regeneration!</strong> ${ae.name} knits back <strong>${h}</strong> HP. (Fire stops this.)`,'chaos'); }
    ae._burnedThisRound=false;
  }
  if(ae.bloodTithe){
    const bleeding=alive.filter(p=>(p.char.activeBuffs||[]).some(b=>b.name==='Bleed'));
    if(bleeding.length&&ae.hp<ae.maxHp){ const h=bleeding.reduce(a=>a+rd(1,4),0); ae.hp=Math.min(ae.maxHp,ae.hp+h); S.addLog(room,`🩸 <strong>Blood Tithe!</strong> ${ae.name} drinks from ${bleeding.length} bleeding warrior${bleeding.length>1?'s':''} — +${h} HP.`,'chaos'); }
  }
  if(ae.sacrifice){
    const hurt=aliveEnemies(gs).filter(o=>o!==ae&&o.hp<o.maxHp*0.5).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
    if(hurt&&ae.hp>8){
      ae.hp-=6; const h=rd(2,6); hurt.hp=Math.min(hurt.maxHp,hurt.hp+h);
      S.addLog(room,`🪰 <strong>Blood Sacrifice!</strong> ${ae.name} opens its own veins (−6 HP) to heal ${hurt.name} for <strong>${h}</strong>!`,'chaos');
      return 'done';
    }
  }
  if(ae.pestilentCall&&!ae._pestilentUsed&&gs.roundNumber>=2&&aliveEnemies(gs).length===1&&gs.enemies.length<5){
    ae._pestilentUsed=true; summonEnemy(room,SUMMONS.poxRats);
    S.addLog(room,`🐀 <strong>Pestilent Call!</strong> Left alone, ${ae.name} calls up a <strong>Pox Rat Swarm</strong>!`,'chaos');
  }
  if(ae.dominate&&!ae._dominateUsed&&gs.roundNumber>=2){
    const pool=alive.filter(p=>!(p.char.activeBuffs||[]).some(b=>b.taunting)); const t=pickRandom(pool.length?pool:alive);
    if(t){ ae._dominateUsed=true; S.addBuff(t.char,'Dominated',{skipTurn:true},1); S.addLog(room,`🧛 <strong>Dominate!</strong> ${ae.name} locks eyes with ${t.name} — they lose their next turn!`,'chaos'); }
  }
  if(ae.wail&&gs.roundNumber%2===0){
    S.addLog(room,`👻 <strong>Banshee's Wail!</strong> ${ae.name} shrieks — the sound cuts through any armour!`,'chaos');
    alive.forEach(p=>{
      const dmg=Math.max(1,rd(1,6)+(gs.bossCount||0)-(charmKey(p.char)==='ironTooth'?1:0));
      p.char.health=Math.max(0,p.char.health-dmg);
      let ins='';
      const mad=Math.random()<0.5&&!resistsInsanity(p.char); if(mad) ins=' and Insanity';
      S.addLog(room,`&nbsp;↳ ${p.name} takes <strong class="num-dmg">−${dmg}</strong>${ins} → ${p.char.health}/${p.char.maxHealth} HP`,'dmg-taken');
      if(mad) S.dark.gainInsanity(room,p,1);
      S.checkDeath(room,p);
    });
    return 'done';
  }
  if(ae.trollVomit&&gs.roundNumber%3===0){
    const taunter=alive.find(p=>(p.char.activeBuffs||[]).some(b=>b.taunting));
    const t=taunter||pickRandom(alive);
    const dmg=rd(2,6)+(gs.bossCount||0)*2;
    t.char.health=Math.max(0,t.char.health-dmg);
    S.addBuff(t.char,'Corroded',{dmgPenalty:1},2);
    S.addLog(room,`🤮 <strong>Troll Vomit!</strong> ${ae.name} spews bile over ${t.name} — <strong class="num-dmg">−${dmg}</strong> (ignores armour) and Corroded (−1 damage, 2 rounds) → ${t.char.health}/${t.char.maxHealth} HP`,'dmg-taken');
    S.checkDeath(room,t);
    return 'done';
  }
  if(ae.warpLightning&&gs.roundNumber%2===0){
    if(d(6)===1){
      const bf=rd(2,6); ae.hp=Math.max(0,ae.hp-bf);
      S.addLog(room,`⚡ <strong>Backfire!</strong> ${ae.name}'s warp lightning explodes in its paws — <strong class="num-dmg">−${bf}</strong> → ${ae.hp}/${ae.maxHp} HP`,'crit');
      if(ae.hp<=0) S.resolveEnemyDeath(room,ae);
      return 'done';
    }
    S.addLog(room,`⚡ <strong>Warp Lightning!</strong> ${ae.name} unleashes crackling green bolts at the whole warband!`,'chaos');
    alive.forEach(p=>{
      const dmg=Math.max(1,rd(2,6)+(gs.bossCount||0)-(charmKey(p.char)==='ironTooth'?1:0));
      p.char.health=Math.max(0,p.char.health-dmg);
      S.addLog(room,`&nbsp;↳ ${p.name} <strong class="num-dmg">−${dmg}</strong> → ${p.char.health}/${p.char.maxHealth} HP`,'dmg-taken');
      S.checkDeath(room,p);
    });
    return 'done';
  }
  if(ae.ratlingGun){
    const shots=1+d(3);
    const taunter=alive.find(p=>(p.char.activeBuffs||[]).some(b=>b.taunting));
    plan.targets=Array.from({length:shots},()=>taunter||pickRandom(alive));
    plan.ignoreTaunt=true; plan.attacks=1;
    S.addLog(room,`🔫 <strong>Ratling Gun!</strong> ${ae.name} sprays <strong>${shots}</strong> shots at the warband!`,'chaos');
    if(d(6)===1){ ae._jamNext=true; }
  }
  if(ae.assassinTarget){
    const lowest=alive.slice().sort((a,b)=>a.char.health-b.char.health)[0];
    if(lowest){ plan.targets=[lowest]; S.addLog(room,`🗡 ${ae.name} goes for the weakest — <strong>${lowest.name}</strong>!`,'chaos'); }
  }
  if(ae._returnBoon){ ae._returnBoon=false; plan.extraBoon=true; }
  // Boss telegraphs: announce one round, strike the next.
  if(ae.telegraph&&ae._windup){
    const kind=ae._windup; ae._windup=null;
    const T=TELEGRAPHS[kind];
    S.addLog(room,`💥 <strong>${T.name}!</strong>`,'crit');
    if(kind==='warpGas'){
      const gasStacks=alive.length>=2?3:2;
      alive.forEach(p=>{ if(!immuneToPoison(p.char)) p.char._poisonedStacks=(p.char._poisonedStacks||0)+gasStacks; S.addBuff(p.char,'Choking',{atkBane:1},1); });
      S.addLog(room,`☠ Warp-gas engulfs the warband — <strong>${gasStacks} poison</strong> and 1 bane for everyone!`,'chaos');
      // Small warbands only face one extra rat at a time.
      if(gs.enemies.length<5&&aliveEnemies(gs).length<=alive.length){ summonEnemy(room,SUMMONS.clanrat); S.addLog(room,`🐀 A Clanrat scurries out of the gas!`,'chaos'); }
      return 'done';
    }
    // Whole-party wind-ups deal fixed damage to everyone; smaller parties take less of it.
    const aoeScale=alive.length>=3?1:alive.length===2?0.8:0.6;
    const aoeHit=(base,extra)=>{
      alive.forEach(p=>{
        let dmg=Math.max(1,Math.round((base()+(gs.bossCount||0)*2)*aoeScale)-(charmKey(p.char)==='ironTooth'?1:0));
        if(isBlocking(p.char)) dmg=Math.ceil(dmg/2);
        p.char.health=Math.max(0,p.char.health-dmg);
        S.addLog(room,`&nbsp;↳ ${p.name} <strong class="num-dmg">−${dmg}</strong> → ${p.char.health}/${p.char.maxHealth} HP`,'dmg-taken');
        if(extra&&p.char.health>0) extra(p);
        S.checkDeath(room,p);
      });
    };
    if(kind==='warpStorm'){
      S.addLog(room,`⚡ Green lightning arcs through the warband!`,'chaos');
      aoeHit(()=>rd(2,6),p=>{ if(Math.random()<0.4) S.dark.gainInsanity(room,p,1,'the warp storm'); });
      return 'done';
    }
    if(kind==='hornCurse'){
      alive.forEach(p=>S.addBuff(p.char,'Cursed by Horns',{atkBane:1},2));
      const h=Math.round(ae.maxHp*0.12); ae.hp=Math.min(ae.maxHp,ae.hp+h);
      S.addLog(room,`🐐 Everyone is cursed — <strong>1 bane</strong> on attacks for 2 rounds — and ${ae.name} drinks their strength, healing <strong>${h}</strong> HP.`,'chaos');
      return 'done';
    }
    if(kind==='plagueWind'){
      const st=alive.length>=2?3:2;
      alive.forEach(p=>{ if(!immuneToPoison(p.char)) p.char._poisonedStacks=(p.char._poisonedStacks||0)+st; S.addBuff(p.char,'Retching',{atkBane:1},1); });
      S.addLog(room,`🤢 A choking green wind rolls over the warband — <strong>${st} poison</strong> and 1 bane for everyone!`,'chaos');
      return 'done';
    }
    if(kind==='hellfire'){
      S.addLog(room,`🔥 The air itself ignites!`,'chaos');
      aoeHit(()=>rd(2,6)+2,p=>S.addBuff(p.char,'Burning',{dotDmg:rd(1,3)},2));
      return 'done';
    }
    if(kind==='dragonBreath'){
      S.addLog(room,`🐉 A torrent of dragonfire sweeps the warband!`,'chaos');
      aoeHit(()=>rd(3,6),p=>S.addBuff(p.char,'Burning',{dotDmg:rd(1,4)},2));
      return 'done';
    }
    const taunter=alive.find(p=>(p.char.activeBuffs||[]).some(b=>b.taunting));
    // Single-target wind-ups hit hardest in big parties, where the damage is shared out over the run;
    // a lone warrior takes every one of them, so the multiplier scales with party size.
    const big=alive.length>=3?3:alive.length===2?2.5:2;
    if(kind==='goreCharge'){ plan.targets=[taunter||alive.slice().sort((a,b)=>a.char.health-b.char.health)[0]]; plan.mult=big; plan.extraBoon=true; plan.ignoreTaunt=true; }
    if(kind==='leap'){ plan.targets=[pickRandom(alive)]; plan.mult=big-1; plan.ignoreTaunt=true; plan.onHit='leapBleed'; }
    if(kind==='slam'){ plan.targets=[taunter||pickRandom(alive)]; plan.mult=big; plan.ignoreTaunt=true; plan.onHit='slamStun'; }
    if(kind==='bigChoppa'){ plan.targets=[taunter||alive.slice().sort((a,b)=>a.char.health-b.char.health)[0]]; plan.mult=big; plan.onHit='leapBleed'; }
    if(kind==='trollSmash'){ plan.targets=[taunter||alive.slice().sort((a,b)=>b.char.health-a.char.health)[0]]; plan.mult=big; plan.onHit='prone'; }
    if(kind==='stomp'){ plan.targets=alive.slice(); plan.mult=1.5; plan.ignoreTaunt=true; plan.onHit='prone'; }
    plan.attacks=1;
  }
  return plan;
}
// After the enemy's turn: bosses announce their next big attack every third round.
function enemyPostTurn(room, ae){
  const gs=room.gs;
  if(ae.hp<=0) return;
  if(ae.telegraph&&!ae._windup&&gs.roundNumber%3===2){
    ae._windup=ae.telegraph;
    S.addLog(room,TELEGRAPHS[ae.telegraph].warn(ae.name),'crit');
  }
  if(ae._jamNext){ ae._jamNext=false; S.addDebuff(ae,'Jammed',{skipTurn:true},1); S.addLog(room,`🔧 <strong>Jammed!</strong> ${ae.name}'s gun seizes — it loses its next turn clearing it.`,'sys'); }
}
// Extra damage from the enemy's side, and the player's mitigation from gear.
function enemyDamageMods(room, ae, p, dmg, r, plan){
  const gs=room.gs, c=p.char;
  if(plan&&plan.mult) dmg=Math.round(dmg*plan.mult);
  if(isBlocking(c)) dmg=Math.ceil(dmg/2);
  if(S.hasRelic(c,'wardingSigil')) dmg=Math.max(1,dmg-1);
  if(S.hasRelic(c,'mirrorShard')&&dmg>1&&Math.random()<0.15){ const back=Math.floor(dmg/2); ae.hp=Math.max(1,ae.hp-back); S.addLog(room,`🪞 <strong>Mirror Shard!</strong> Half the blow rebounds — ${ae.name} takes <strong class="num-dmg">−${back}</strong>.`,'crit'); }
  if(ae.gore&&(c.activeBuffs||[]).some(b=>b.name==='Bleed')) dmg+=3;
  if(ae.carrionFeast&&c.health<c.maxHealth*0.5) dmg+=2;
  if(ae.bullCharge&&gs.roundNumber===1){ const bc=rd(2,6); dmg+=bc; S.addLog(room,`🐂 <strong>Bull Charge!</strong> ${ae.name} thunders into ${p.name} — +${bc} damage and knocked Prone.`,'chaos'); }
  if(r.crit&&r.critRoll&&armorTraits(c).includes('padded')) dmg=Math.max(1,dmg-r.critRoll);
  if(charmKey(c)==='ironTooth') dmg=Math.max(1,dmg-1);
  if(c._armorShieldBlock&&!c._shieldBlockUsed&&dmg>0){ c._shieldBlockUsed=true; S.addLog(room,`🛡 <strong>Shield Block!</strong> ${p.name}'s kite shield takes the blow.`,'spell'); dmg=0; }
  return dmg;
}
function enemyAfterHit(room, ae, p, dmg, r, plan){
  const gs=room.gs, c=p.char;
  c._hitSinceTurn=true;
  if(c.alive&&ae.paralysingClaws){ S.addBuff(c,'Paralysed',{bane:1,consumeOnAttack:true},2); S.addLog(room,`🧟 <strong>Paralysing Claws!</strong> ${p.name} goes numb — 1 bane on their next attack.`,'chaos'); }
  if(c.alive&&ae.mutation==='tentacles'){ S.addBuff(c,'Grabbed',{bane:1,consumeOnAttack:true},2); S.addLog(room,`🐙 <strong>Tentacles!</strong> ${p.name} is grabbed — 1 bane on their next attack.`,'chaos'); }
  if(c.alive&&ae.barrowChill&&dmg>0&&(c._barrowDrain||0)<10){
    c._barrowDrain=(c._barrowDrain||0)+2; c.maxHealth=Math.max(1,c.maxHealth-2); c.health=Math.min(c.health,c.maxHealth);
    S.addLog(room,`❄ <strong>Barrow Chill!</strong> ${p.name}'s max HP drops by 2 until they rest (−${c._barrowDrain} so far).`,'chaos');
  }
  if(ae.cleaveSpill&&dmg>1){
    const other=pickRandom(alivePlayers(room).filter(q=>q!==p));
    if(other){ const sp=Math.floor(dmg/2); other.char.health=Math.max(0,other.char.health-sp); S.addLog(room,`⚔ <strong>Cleave!</strong> The blow carries on into ${other.name} — <strong class="num-dmg">−${sp}</strong> → ${other.char.health}/${other.char.maxHealth} HP`,'dmg-taken'); S.checkDeath(room,other); }
  }
  if(ae.bullCharge&&gs.roundNumber===1&&c.alive){ S.addBuff(c,'Prone',{bane:1,consumeOnAttack:true},2); }
  if(ae.vanish&&ae.hp>0&&aliveEnemies(gs).length>1){ ae._vanished=true; S.addLog(room,`💨 ${ae.name} melts into the shadows — it can't be targeted until its next turn.`,'chaos'); }
  if(ae.bloodgreedKill&&!c.alive&&ae.hp>0){ ae.hp=ae.maxHp; S.addLog(room,`🐂 <strong>Bloodgreed!</strong> ${ae.name} roars over the fallen ${p.name} — fully healed!`,'chaos'); }
  if(plan&&plan.onHit==='leapBleed'&&c.alive){ S.addBuff(c,'Bleed',{dotDmg:rd(1,3)},2); S.addBuff(c,'Bleed',{dotDmg:rd(1,3)},2); }
  if(plan&&plan.onHit==='slamStun'&&c.alive){ S.addBuff(c,'Stunned',{skipTurn:true},alivePlayers(room).length===1?1:2); /* a lone warrior loses one turn, not two */ S.addLog(room,`💫 ${p.name} is <strong>STUNNED</strong> by the slam!`,'chaos'); }
  if(plan&&plan.onHit==='prone'&&c.alive){ S.addBuff(c,'Prone',{bane:1,consumeOnAttack:true},2); }
}
// A player's weapon hit lands on an enemy. Returns the damage that actually applies.
function enemyOnWeaponHit(room, player, e, dmg){
  const gs=room.gs;
  if(e.skirmisher&&!e._dodgeUsed){ e._dodgeUsed=true; S.addLog(room,`💨 <strong>Skirmisher!</strong> ${e.name} slips aside — the first blow each fight misses!`,'chaos'); return 0; }
  if(e.coward&&dmg>=10){
    const rat=aliveEnemies(gs).find(o=>o!==e&&o.name==='Skaven Clanrat');
    if(rat){
      rat.hp=Math.max(0,rat.hp-dmg);
      S.addLog(room,`🐀 <strong>Coward!</strong> ${e.name} shoves a Clanrat into the blow — it takes <strong class="num-dmg">−${dmg}</strong> → ${rat.hp}/${rat.maxHp} HP`,'chaos');
      if(rat.hp<=0) S.resolveEnemyDeath(room,rat);
      return 0;
    }
  }
  if(e.damageReduction&&dmg>0) dmg=Math.max(1,dmg-e.damageReduction);
  if(dmg>0) foes.thornsOnHit(room,player,e);
  if(e.mutation==='acidBlood'&&dmg>0&&player.char.alive){
    const a=rd(1,4); player.char.health=Math.max(0,player.char.health-a);
    S.addLog(room,`🧪 <strong>Acid Blood!</strong> ${e.name}'s blood sprays ${player.name} — <strong class="num-dmg">−${a}</strong>`,'chaos'); S.checkDeath(room,player);
  }
  if(e.battleFury&&e.hp-dmg>0&&(e._fury||0)<4){
    e._fury=(e._fury||0)+1; e.dmgBonus=(e.dmgBonus||0)+1; e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`;
    S.addLog(room,`😡 <strong>Battle Fury!</strong> ${e.name} grows angrier — +1 damage (+${e._fury}).`,'chaos');
  }
  return dmg;
}
// Defensive tricks against weapon attack rolls.
function enemyDefence(char, e){
  let banes=0, ac=0;
  if(e._wallActive) ac+=2;
  if(e.halberdGuard&&!e._guardUsed){ e._guardUsed=true; banes++; }
  if(e.ethereal&&!weaponIsHoly(char)) banes++;
  return {banes, ac};
}
function onEnemyDeath(room, e){
  const gs=room.gs;
  if(e.splitOnDeath){
    for(let i=0;i<2&&gs.enemies.length<6;i++) summonEnemy(room,SUMMONS.brimstone);
    S.addLog(room,`🔥 <strong>${e.name}</strong> bursts apart into <strong>two Brimstone Horrors</strong>!`,'chaos');
  }
  if(e.deathCloud){
    alivePlayers(room).forEach(p=>{ if(!immuneToPoison(p.char)) p.char._poisonedStacks=(p.char._poisonedStacks||0)+2; });
    S.addLog(room,`☠ <strong>Plague Censer!</strong> ${e.name}'s censer shatters — every warrior gains 2 poison.`,'chaos');
  }
  if(e.rotFeast){
    aliveEnemies(gs).filter(o=>o!==e&&o.rotFeast).forEach(o=>{ o.dmgBonus=(o.dmgBonus||0)+2; o.hp=Math.min(o.maxHp,o.hp+4); o.dmgDisplay=`${o.dmgNum}d${o.dmgSides}${o.dmgBonus?'+'+o.dmgBonus:''}`; S.addLog(room,`🧟 <strong>Rot Feast!</strong> ${o.name} gorges on the fallen — +2 damage, +4 HP.`,'chaos'); });
  }
}

module.exports = { isBlocking, bind, MUTATIONS, TELEGRAPHS, enemyAfterHit, enemyDamageMods, enemyDefence, enemyOnWeaponHit, enemyPostTurn, enemyPreTurn, isEnemyHidden, newEnemyId, onCombatStart, onEnemyDeath, prepareEnemy, refreshEnemyAuras, sortTurnOrder, summonEnemy };
