'use strict';
// The Daily Run's shared modifiers, and recording each finished run (with its
// one-line chronicle) for the stats page, the hall of fame and the daily board.
const runlog = require('./runlog');
const rng = require('./rng');
const { CAREERS } = require('./data');

const S = {};
function bind(api) { Object.assign(S, api); }

// ─── DAILY RUN ────────────────────────────────────────────────────────────────
function hasDaily(gs,id){ return !!(gs.dailyMods&&gs.dailyMods.includes(id)); }
function startDailyRun(room){
  const gs=room.gs; gs.dailyKey=runlog.todayKey(); const mods=runlog.dailyMods(gs.dailyKey); gs.dailyMods=mods.map(m=>m.id);
  const seed=rng.seedFromString('daily:'+gs.dailyKey); // same seed for everyone today
  if(!gs.rng) gs.rng=rng.makeRng(seed); gs.rng.seed=seed; gs.rng.s=seed; // reseed in place: it is the generator active right now
  S.addLog(room,`📜 <strong>Daily Run</strong> — ${mods.map(m=>`<strong>${m.name}</strong>: ${m.desc}`).join(' · ')}`,'loot');
  if(hasDaily(gs,'provisioned')) room.players.forEach(p=>{ if(!p.char) return; S.addToInventory(p.char,'Healing Draught'); S.addToInventory(p.char,'Healing Draught'); p.char.gold+=20; });
}
function applyDailyToEnemies(gs, list){
  if(!gs.dailyMods) return;
  list.forEach(e=>{
    if(hasDaily(gs,'ironHide')){ e.maxHp=Math.round(e.maxHp*1.2); e.hp=e.maxHp; }
    if(hasDaily(gs,'bloodMoon')){ e.dmgBonus=(e.dmgBonus||0)+1; e.dmgDisplay=`${e.dmgNum}d${e.dmgSides}${e.dmgBonus?'+'+e.dmgBonus:''}`; }
    if(hasDaily(gs,'brittleFoes')) e.ac=Math.max(5,(e.ac||10)-1);
    if(hasDaily(gs,'hardened')) e.ac=(e.ac||10)+1;
  });
}

// ─── RUN RECORDS ──────────────────────────────────────────────────────────────
// Every finished run is logged once (for /api/stats); daily runs also go on the board.
function stripTags(h){ return String(h||'').replace(/<[^>]+>/g,'').trim(); }
// One line for the end screen, history and share card.
function chronicleLine(room,victory,killer){
  const gs=room.gs, party=room.players.filter(p=>p.char);
  const who=party.length===1?`${party[0].name} the ${CAREERS[party[0].career]?CAREERS[party[0].career].label:party[0].career}`:`A warband of ${party.length}`;
  const relicN=party.reduce((a,p)=>a+((p.char.relics||[]).length),0);
  const bits=[];
  if(gs.bossCount) bits.push(`slew ${gs.bossCount} boss${gs.bossCount>1?'es':''}`);
  if(gs.cursedTaken) bits.push(`walked ${gs.cursedTaken} cursed path${gs.cursedTaken>1?'s':''}`);
  if(relicN) bits.push(`carried ${relicN} relic${relicN>1?'s':''}`);
  const did=bits.length?bits.join(', ').replace(/, ([^,]*)$/,' and $1'):'fought on';
  return victory?`${who} ${did}, and conquered the depths in ${gs.totalRounds||'?'} rounds.`:`${who} ${did}, before falling at depth ${gs.depth}${gs.endless?' in Endless Mode':''}${killer?' to '+killer:''}.`;
}
function recordRunEnd(room){
  const gs=room.gs; if(gs._recorded) return; gs._recorded=true;
  if(gs.practice) return; // practice fights don't count
  const victory=gs.phase==='victory';
  let killer=null;
  if(!victory){ const m=stripTags(gs.deathCause).match(/^(?:[^\w]*\s*)?(.+?) (?:hits|crits|strikes|slams|mauls)/); killer=m?m[1]:((gs.enemies||[]).find(e=>e)||{}).name||null; }
  gs.chronicle=chronicleLine(room,victory,killer);
  const rec={ ts:new Date().toISOString(), victory, depth:gs.depth||0, bosses:gs.bossCount||0, difficulty:gs.difficulty||0,
    daily:gs.dailyKey||null, endless:!!gs.endless, killer, rounds:gs.totalRounds||0, cursed:gs.cursedTaken||0, chronicle:gs.chronicle,
    players:room.players.filter(p=>p.char).map(p=>({ name:p.name, career:p.career, level:p.char.level, expert:p.char.expertPath||null, master:p.char.masterPath||null, title:p.title||null, relics:(p.char.relics||[]).length, relicKeys:(p.char.relics||[]).slice(0,20), patron:p.char.patron||null, mutations:(p.char.mutations||[]).length, corruption:p.char.corruption||0 })), zone:gs.zoneId||null, mutators:(gs.mutators||[]).slice() };
  runlog.appendRun(rec);
  if(gs.dailyKey) runlog.addDailyScore(gs.dailyKey,{ names:rec.players.map(p=>p.name), careers:rec.players.map(p=>p.career), depth:rec.depth, bosses:rec.bosses, victory, rounds:gs.totalRounds||0, ts:rec.ts });
}

module.exports = { bind, hasDaily, startDailyRun, applyDailyToEnemies, stripTags, chronicleLine, recordRunEnd };
