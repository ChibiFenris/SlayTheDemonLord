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
  ['New careers','The Witch Hunter Condemns one enemy each fight and hits the unholy harder. The Dwarf Slayer wears no armour, grows stronger below half HP and hits elites and bosses for more.'],
  ['Practice fight','From the lobby, Practice fight puts you in one easy battle with any career and a coach. Nothing is lost if you fall.'],
  ['Quick chat and accounts','In a party, the quick-chat buttons send short calls like "Heal me!". In the lobby, a name and PIN save your Renown so it follows you to another device.'],
  ['Revive','When an ally falls, anyone can use Revive on their turn to bring them back at a quarter of their HP. It has a long cooldown. Fallen allies also get up with 1 HP once a fight is won.'],
  ['Old faces','Some people turn up more than once: the merchant Old Grete, Ulla Kranz and her Black Ravens, and Brother Aldric the witch hunter. How you treat them the first time changes what happens later.'],
  ['Endless mutators','In Endless, after every boss past the third, the warband votes for one of three lasting changes to the run, each with a price and a reward.'],
  ['Endless mode','The host can turn on Endless in the lobby. There is no final victory: a boss waits every 10 depths, the bosses come round again, and each boss past the third makes every foe tougher (more HP, damage, accuracy and silver) and every weapon, armour and legendary you find better. Fight until you fall.'],
  ['Campfire','At a campfire each warrior chooses: rest (heal half, −1 Insanity, curses loosen, a boon next fight) or spend the night upgrading their equipped weapon (+1 damage) or armour (+1 Defence). Weapons can be honed 3 times; armour can be reinforced twice, and only if it gives +5 Defence or less. Everyone gets abilities and castings back.'],
  ['Zones','The road runs through the Drakwald, the Altdorf Undercity and the Chaos Wastes, ten depths each, each with its own foes and music. Endless walks them again.'],
  ['Dark Gods','At 9 Corruption one of the Dark Gods claims you — Khorne, Nurgle, Tzeentch or Slaanesh — with a powerful mark and a matching curse. Witch hunters take notice.'],
  ['Corruption','Chaos leaves its mark. Cursed Paths, cursed gear, warpstone and the dark lores (Chaos, Death) give Corruption. Every 3 points brings a mutation — a gift with a price — up to three. Sigmarite Incense removes Corruption, but mutations stay.'],
  ['Insanity','Horror wears on the mind: terrifying foes, bosses, and allies falling. When Insanity reaches your limit (4, more with high WIL; Witch Hunters and Slayers are steadier) you snap — a short madness strikes at once, then Insanity resets and you keep a lasting disorder. Campfires remove 1, Laudanum removes 2.'],
  ['Boss phases','At half HP every boss changes how it fights: reinforcements, a warp shield, a second attack, a plague cloud, taking wing...'],
  ['Elite modifiers','Every elite has one modifier, shown with a ★: Vampiric, Armoured, Frenzied, Warded, Regenerating, Venomous, Thorned, Giant or Swift.'],
  ['Greenskins','Night Goblins grow brave in a crowd, Squigs bounce about wildly, Fanatics flail at everyone (and sometimes themselves), Orc Boyz charge, Shamans stamp with the Foot of Gork, and Black Orcs shrug off stuns.'],
  ['Races and classes','You start as one of five peoples: Human (Empire) +1 to every attribute, Human (Bretonnia) +4 WIL, Dwarf +4 STR, High Elf +4 INT, Wood Elf +4 AGI. Each people fights with its best attribute. At level 3 you choose one of four expert classes for your people, at level 7 one of four master classes. Masters bring the core of their craft with them, so any expert can become any master.'],
  ['Relics','After every elite or boss fight, and on a Cursed Path, each warrior picks one of three relics: passives that last the whole run.'],
  ['Cursed Path','A ☠ crossroads gives a relic at once, but enemies get +15% HP and +1 damage per curse (up to two) until the next boss dies. Each one taken adds Renown.'],
  ['Champion\'s Prize','After a boss in a party, one extra legendary item drops. Everyone picks Need or Pass; a d20 decides among those who need it. If nobody does, it is sold for silver.'],
  ['Road ahead','The crossroads screen shows what the next two crossroads offer, so you can plan around rests, merchants and bosses.'],
  ['Rows','Stand in the front or back row (switch on your turn). Melee enemies can only reach the front row while anyone stands there; archers, gunners and casters reach everyone. Melee weapons swung from the back row get 1 bane.'],
  ['Events of the peoples','Each people has its own encounter on the road, once per run: a Dwarf grudge to settle, a Bretonnian Grail chapel, a Wood Elf waystone, an envoy from Ulthuan for the High Elves and a State Troop muster for the Empire. They only appear when that people marches with you, and the best option needs one of them in the warband.'],
  ['Abilities and your turn','Every active ability uses your turn, just like attacking or casting. Passives work on their own and never appear as buttons. Abilities that help the warband (War Cry, Battle Orders, Intercept, Counterspell, Grace, Last Rites) always cover you as well, so they are worth taking when you play alone.'],
  ['Block','Every career can Block. It uses your turn: damage you take is halved until your next turn. It recharges in 5 rounds.'],
  ['Enemy intents','Each enemy shows what it will do next: who it will attack and for how much, a big attack it is winding up, or that it is stunned.'],
  ['Combos','Hit a stunned enemy for +1d6 (Exploit). Hit a Condemned enemy that is burning for +1d6 holy (Purge). Hit an enemy that is both poisoned and bleeding for +2 (Festering).'],
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
