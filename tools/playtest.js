'use strict';
// Bot playtester: each bot joins a room and plays random legal actions until the
// warband wins or falls. Used by tools/test.js; can also be run on its own:
//   PORT=3000 node tools/playtest.js 8      (server must already be running)
const WebSocket=require('ws');
let PORT=process.env.PORT||3000;
const CAREERS=['warrior','rogue','wizard','priest','witchhunter','slayer','engineer','waywatcher'];
const DATA=require('../game/data');
const EXPERT=['defender','ranger','paladin','assassin','elementalist','sorcerer','warlock','wizard','spellbinder','healer','druid','inquisitor','giantSlayer'];
const MASTER=['myrmidon','brute','warlord','champion','shadowblade','executioner','transmuter','necromancer','abjurer','archmage','healer_m','chaplain','witchfinder','daemonSlayer'];
const TRAD=['fire','life','death','shadow','battle','celestial','chaos','earth','storm','protection','illusion','nature','transformation','time'];
const TALENTS=['turret','grenade','arrowStorm','steamBarrage','taunt','taunt','block','block','revive','condemn','deathWish','warCry','battleOrders','metamagic','spellsurge','miracleHeal','resurrection','entangle','shieldBash','catchBreath','nimbleRecovery','spellRecovery','sharedRecovery','divineFavour','bloodOffering','catastrophe','divineSmite','massHeal','metamagic','overcast','pacedStrikes','rallyingCry','resurrection','battleOrders','vanish','curse','triage','darkPact','druidsFury','revelation','intercept','markHeretic','deadAim','smokeScreen','quickstrike','layOnHands','warCry','entangle','foresight','bladestorm','shadowStep','unstoppable'];
const pick=a=>a[Math.floor(Math.random()*a.length)];
function run(nPlayers, comp, seedLabel){ return new Promise(res=>{
  const bots=[]; let code=null; let done=false; let last=Date.now(); let lastSig=''; let maxDepth=0; let outcome='?'; let states=0;
  const finish=(o)=>{ if(done)return; done=true; outcome=o; bots.forEach(b=>{try{b.ws.close()}catch(e){}}); clearInterval(iv); res({outcome,maxDepth,states,comp,lastPhase,stallDump}); };
  let lastPhase=''; let stallDump=null;
  let lastState=null;
  const iv=setInterval(()=>{ const idle=Date.now()-last; if(idle>600){ bots.forEach(b=>{b.acted='';b.poke&&b.poke();}); } if(idle>8000){ stallDump=lastState; finish('STALL@'+lastPhase); } },300);
  const hard=setTimeout(()=>finish('TIMEOUT@'+lastPhase),240000); // long 4-player runs with relics can go deep
  for(let i=0;i<nPlayers;i++){
    const ws=new WebSocket('ws://localhost:'+PORT); const b={ws,id:null,i,career:comp[i],acted:''}; bots.push(b);
    const send=(type,payload)=>{ if(ws.readyState===1) ws.send(JSON.stringify({type,payload})); };
    const act=(action,data)=>send('PLAYER_ACTION',{action,data:data||{}});
    ws.on('open',()=>{ if(i===0) send('CREATE_ROOM',{name:'Bot0'}); });
    b.poke=()=>{ if(b.lastPayload) handle({type:'STATE_UPDATE',payload:b.lastPayload},true); };
    ws.on('message',raw=>{ if(done) return; handle(JSON.parse(raw)); });
    function handle(m,isPoke){ if(done) return;
      if(m.type==='ROOM_CREATED'){ code=m.payload.code; b.id=m.payload.playerId; send('SELECT_CAREER',{career:b.career});
        bots.slice(1).forEach(o=>{ const j=()=>o.ws.send(JSON.stringify({type:'JOIN_ROOM',payload:{code,name:'Bot'+o.i}})); o.ws.readyState===1?j():o.ws.on('open',j); });
        setTimeout(()=>bots.forEach(o=>o.ws.readyState===1&&o.ws.send(JSON.stringify({type:'PLAYER_READY',payload:{}}))),300);
        return; }
      if(m.type==='ROOM_JOINED'){ b.id=m.payload.playerId; send('SELECT_CAREER',{career:b.career}); return; }
      if(m.type!=='STATE_UPDATE') return;
      states++; lastState=m.payload; b.lastPayload=m.payload;
      const {gs,players}=m.payload; const me=players.find(p=>p.id===b.id); if(!me||!me.char) return;
      const sig=gs.phase+'|'+gs.depth+'|'+gs.activeTurnIdx+'|'+gs.roundNumber+'|'+gs.log.length;
      if(!isPoke&&sig!==lastSig){ lastSig=sig; last=Date.now(); }
      lastPhase=gs.phase+' d'+gs.depth+' r'+gs.roundNumber; maxDepth=Math.max(maxDepth,gs.depth||0);
      if(gs.phase==='victory') return finish('VICTORY');
      if(gs.phase==='gameover') return finish('GAMEOVER');
      if(gs.phase==='lobby'||gs.phase==='dying') return;
      const c=me.char; const key=sig+'|'+b.i;
      if(b.acted===key) return; // one action per distinct state
      b.acted=key;
      setImmediate(()=>{ if(done) return;
        if(c.pendingLevelUp){ const t=c.pendingPathTier||'novice';
          const cp=DATA.CAREER_PATHS[me.career]||{}; const lores=TRAD.filter(x=>DATA.traditionAllowed(c,x)&&!(c.traditions||[]).includes(x));
          const id=t==='expert'?pick(Object.keys(cp.expert||{defender:1})):t==='master'?pick(Object.keys(cp.master||{myrmidon:1})):t==='tradition'?'tradition:'+pick(lores.length?lores:TRAD):'warrior';
          return act('APPLY_PATH',{pathId:id}); }
        if(c.pendingStatBoost) return act('CHOOSE_STAT',{attr:pick(['str','agi','int','wil'])});
        if(!c.alive) return;
        if(gs.phase==='choice'&&gs.choice&&!gs.choice.votes[b.id]) return act('CHOOSE_EVENT',{option:pick(gs.choice.options).id});
        if(gs.phase==='aftermath'&&gs.aftermath&&!gs.aftermath.ready.includes(b.id)) return act('CONTINUE_AFTERMATH');
        if(gs.phase==='campfire'&&gs.campfire&&!gs.campfire.choices[b.id]){ const o=c.campOptions||[]; return (o.length&&Math.random()<0.4)?act('CAMPFIRE',{choice:'upgrade',slot:pick(o).slot}):act('CAMPFIRE',{choice:'rest'}); }
        if(gs.phase==='relic'&&gs.relic){ if(!gs.relic.picked.includes(b.id)&&c.relicOptions&&c.relicOptions.length) return act('PICK_RELIC',{key:pick(c.relicOptions)}); if(gs.relic.prize&&!gs.relic.prize.votes[b.id]) return act('VOTE_PRIZE',{choice:pick(['need','pass'])}); }
        if(gs.phase==='path'&&gs.pathChoices&&!(gs.pathVotes||{})[b.id]) return act('VOTE_PATH',{nodeType:pick(gs.pathChoices)});
        if(gs.phase==='loot') return act('PICK_LOOT',{pick:pick(['coins','consumable','weapon','armor','charm'])});
        if(gs.phase==='merchant'){ if(c.merchantStock&&Math.random()<0.5&&c.merchantStock.length){ const it=pick(c.merchantStock); return act('BUY_ITEM',{itemId:it.id}); }
          if(c.inventory&&c.inventory.length&&Math.random()<0.2) return act('SELL_ITEM',{invIndex:Math.floor(Math.random()*c.inventory.length)});
          return act('LEAVE_SHOP'); }
        if(gs.phase==='event'){
          if(c.inventory&&c.inventory.length&&Math.random()<0.3){ const idx=Math.floor(Math.random()*c.inventory.length); const it=c.inventory[idx];
            if(Math.random()<0.5) return act('EQUIP_ITEM',{inventoryIndex:idx}); return act('USE_ITEM_OOC',{itemName:it.name}); }
          return act('PRESS_ONWARD'); }
        if(gs.phase==='combat'){
          const cur=gs.turnOrder&&gs.turnOrder[gs.activeTurnIdx]; if(!cur||cur.type!=='player'||cur.id!==b.id) return;
          const r=Math.random(); const alive=(gs.enemies||[]).map((e,i)=>[e,i]).filter(([e])=>e&&e.hp>0);
          if(alive.length>1&&r<0.1) act('TARGET_ENEMY',{idx:pick(alive)[1]});
          if(r<0.45) return act('ATTACK');
          if(r<0.7&&c.knownSpells&&c.knownSpells.length){ const sp=pick(c.knownSpells); const ally=pick(players.filter(p=>p.char&&p.char.alive));
            return act('CAST_SPELL',{spellName:sp.name,targetId:ally.id}); }
          if(r<0.85) return act('USE_TALENT',{talent:pick(TALENTS)});
          if(r<0.95&&c.inventory&&c.inventory.length){ const it=pick(c.inventory); if(Math.random()<0.3){ const ally=pick(players.filter(p=>p.char&&p.char.alive)); return act('USE_ITEM_ALLY',{itemName:it.name,targetId:ally.id}); } return act('USE_ITEM',{itemName:it.name}); }
          if(r<0.96) return act('SET_ROW',{row:pick(['front','back'])});
          if(r<0.97) return act('FLEE');
          return act('PASS_TURN');
        }
      });
    }
    ws.on('error',()=>{});
  }
});}

async function runGames(n, port){
  if(port) PORT=port;
  const results=[];
  for(let g=0;g<n;g++){
    const players=1+(g%4);
    const comp=Array.from({length:players},(_,i)=>CAREERS[(g*2+i)%CAREERS.length]);
    const r=await run(players,comp);
    console.log(`game ${g+1}/${n} [${comp.join(', ')}] → ${r.outcome} at depth ${r.maxDepth} (${r.states} states)`);
    results.push(r);
  }
  return results;
}
module.exports={runGames};
if(require.main===module){ runGames(+process.argv[2]||4).then(()=>process.exit(0)); }
