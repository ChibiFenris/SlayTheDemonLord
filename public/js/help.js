'use strict';
// ─── HOW TO PLAY & FIRST-TIME TIPS ────────────────────────────────────────────
const HELP_SECTIONS=[
  ['The descent','Your warband travels 30 rooms deep, with a boss at depths 10, 20 and 30. At each crossroads everyone votes on the next room: combat, elite, loot, merchant, rest or the unknown.'],
  ['Turns','Combat runs in turns. On your turn pick one action: attack, cast a spell, use a talent or an item, or flee (never from a boss). Some talents and items, like Quick Hands, don\'t use your turn.'],
  ['Boons and banes','A boon adds a d6 to your d20 roll; a bane subtracts one. Several only count the highest. A natural 20 is a critical hit, a natural 1 always misses.'],
  ['Spells','Spells of the same rank share one pool of castings, shown as "Rank 1 2/3". All castings refill at the start of every fight. Rank 0 spells are cheap and plentiful.'],
  ['Conditions','Poison, Bleed and Burn deal damage every round. Stunned skips a turn. Hover or tap a condition to see exactly what it does.'],
  ['Boss warnings','Bosses wind up their big attacks a turn in advance — the warning appears on the boss. Stun them to cancel it, Taunt to choose who takes it, or heal up.'],
  ['After a battle','Experience and silver are paid out when the fight ends. You see what everyone gained, then choose a new path if you levelled up.'],
  ['Gear traits','Weapons and armour can roll good traits (Keen, Serrated, Reinforced…) and bad ones (Notched, Rusted, Heavy…). Read an item before you swap.'],
  ['Cursed gear','Cursed items are strong but have a real drawback, and once equipped they stay on until you rest at a campfire or use a Sigmar\'s Token.'],
  ['Charms','You can wear one charm. Most trade a strength for a weakness — Lucky Hare\'s Foot gives +1 to hit but −1 Defence.'],
  ['Renown','Each run earns Renown for depth reached and bosses slain. Renown unlocks starting charms and the Grim and Doom difficulties.'],
  ['Daily Run','Each day has one blessing and one hardship that everyone shares, and every Daily starts from the same seed: make the same choices and you meet the same rooms. The host turns the Daily on in the room; how deep you get goes on today\'s board in the lobby.'],
  ['Party turns','With two or more players, each turn has 60 seconds. If time runs out, that turn passes so nobody is left waiting.'],
  ['Joining late','You can join a run already under way with its room code if a player has left: you take over their character where they left it.'],
  ['New careers','The Witch Hunter Condemns one enemy each fight (a free action) and hits the unholy harder. The Dwarf Slayer wears no armour, grows stronger below half HP and hits elites and bosses for more.'],
  ['Practice fight','From the lobby, Practice fight puts you in one easy battle with any career and a coach. Nothing is lost if you fall.'],
  ['Quick chat and accounts','In a party, the quick-chat buttons send short calls like "Heal me!". In the lobby, a name and PIN save your Renown so it follows you to another device.'],
  ['Cooldowns','Active abilities recharge: after you use one it shows "Ready in N rounds" and comes back later in the same fight. Every ability is ready again when a new fight starts.'],
  ['Merchant and selling','The merchant stocks three weapons, two armours, two charms and six consumables. Anything you sell fetches 15% of its value. You can take a charm off at any time (cursed ones stay on until you rest).'],
  ['Playing alone','Bosses are smaller and call fewer minions when you play solo. A Warrior, Wizard, Priest or Witch Hunter who starts a run alone also gains Lone Survivor: extra HP at the start and every level.'],
];
const TIPS={
  combat:  ['Your first fight','Wait for your turn, then choose an action. Enemies show their Defence, attack and damage; tap or hover chips for details.'],
  spells:  ['Castings','Spells of the same rank share castings, and every pool refills when a new fight starts — so spend them freely.'],
  traits:  ['Item traits','This item rolled traits. Good ones help, bad ones hurt — check its description before equipping.'],
  cursed:  ['Cursed gear','You found a cursed item. It is powerful, but once worn it stays on until you rest or use a Sigmar\'s Token.'],
  charm:   ['Charms','You found a charm. Equip it from your items; you can wear one at a time.'],
  windup:  ['Boss warning','A boss is winding up a big attack next turn. Stun it to cancel, Taunt to choose who takes it, or brace with heals.'],
  aftermath:['Battle won','XP and silver are paid out now. Press Continue when you\'re ready — if you levelled up, you\'ll pick your path next.'],
  choice:  ['A choice','Everyone votes on what to do. The majority wins, and you can change your vote until the last warrior decides.'],
};
function tipsSeen(){ try{ return JSON.parse(store.get('sorTips')||'{}'); }catch(e){ return {}; } }
function showTip(key){
  const seen=tipsSeen(); if(seen[key]||el('tip-toast')) return;
  seen[key]=1; store.set('sorTips',JSON.stringify(seen));
  const [title,text]=TIPS[key];
  const t=document.createElement('div'); t.id='tip-toast'; t.className='tip-toast'; t.setAttribute('role','status');
  t.innerHTML=`<div class="tt-title">💡 ${title}</div><div class="tt-text">${text}</div><button class="mini-btn">Got it</button>`;
  t.querySelector('button').onclick=()=>t.remove();
  document.body.appendChild(t);
}
function checkTips(st){
  const gs=st.gs, me=st.players.find(p=>p.id===myId); if(!me||!me.char) return;
  // The practice fight has its own coach; end screens shouldn't keep a tip on top.
  if(gs.practice||gs.phase==='practiceDone'||gs.phase==='gameover'||gs.phase==='victory'){ const t=el('tip-toast'); if(t) t.remove(); return; }
  const c=me.char, inv=c.inventory||[];
  if(gs.phase==='combat') showTip('combat');
  if(gs.phase==='combat'&&(c.knownSpells||[]).length) showTip('spells');
  if(gs.phase==='aftermath') showTip('aftermath');
  if(gs.phase==='choice') showTip('choice');
  if((gs.enemies||[]).some(e=>e&&e._windup)) showTip('windup');
  if(inv.some(i=>i.itemObj&&i.itemObj.cursed)) showTip('cursed');
  else if(inv.some(i=>i.type==='charm')) showTip('charm');
  else if(inv.some(i=>i.itemObj&&(i.itemObj.traits||[]).length)) showTip('traits');
}
function openHelp(){
  closeOverlay();
  const ov=document.createElement('div'); ov.className='overlay'; ov.id='ov';
  ov.onclick=e=>{ if(e.target===ov) closeOverlay(); };
  ov.innerHTML=`<div class="panel overlay-box help-box" role="dialog" aria-label="How to play">
    <div class="ph">How to Play</div>
    ${HELP_SECTIONS.map(([h,t])=>`<h3 class="help-h">${h}</h3><p class="help-p">${t}</p>`).join('')}
    <button class="btn btn-w gold" onclick="closeOverlay()">Close</button></div>`;
  document.body.appendChild(ov);
}
