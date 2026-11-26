'use strict';
// ═════════════════════════════════════════════════════════════════════════════
// MOBILE LAYOUT — one scrolling column built for thumbs.
// Order: status → turn → enemies → you → chronicle → actions → allies → kit.
// Taps on enemies, talents, spells and items open a bottom sheet with details.
// ═════════════════════════════════════════════════════════════════════════════

// ── Bottom sheet ─────────────────────────────────────────────────────────────
let _sheetTimer=null;
function mOpenSheet(html){
  clearTimeout(_sheetTimer);
  el('m-sheet-body').innerHTML=html;
  el('m-overlay').hidden=false;
  const sh=el('m-sheet');
  sh.hidden=false;
  requestAnimationFrame(()=>sh.classList.add('open'));
}
function mCloseSheet(){
  const sh=el('m-sheet');
  sh.classList.remove('open');
  _sheetTimer=setTimeout(()=>{ sh.hidden=true; el('m-overlay').hidden=true; },250);
}
function sheetButtons(primary){
  return `<div class="m-act-btns">${primary}<button class="m-btn sec" onclick="mCloseSheet()">Close</button></div>`;
}
function mSheet(name,type,desc,rows,status,statusLabel,btns=''){
  const rowsH=(rows||[]).map(r=>`<div class="m-sheet-row">${r[0]}<span>${r[1]}</span></div>`).join('');
  mOpenSheet(`<div class="m-sheet-name">${name}</div><div class="m-sheet-type">${type}</div>${desc?`<div class="m-sheet-desc">${desc}</div>`:''}${rowsH}${statusLabel?`<div class="m-sheet-status ${status}">${statusLabel}</div>`:''}${btns}`);
}

// ── Talents ──────────────────────────────────────────────────────────────────
function talentUsed(key,char){
  const t=ACTIVE_TALENTS.find(a=>a[0]===key);
  if(t) return t[2]?!!char[t[2]]:false;
  const ex=EXTRA_ACTIVES.find(e=>e[0]===key);
  if(ex) return !!ex[3](char,(lastState&&lastState.gs)||{});
  return null; // passive
}
function mTapTalent(key,char){
  const label=labelFromKey(key);
  const used=talentUsed(key,char);
  const isActive=used!==null;
  const inCombat=lastState&&lastState.gs&&lastState.gs.phase==='combat';
  const btn=isActive&&!used&&inCombat?sheetButtons(`<button class="m-btn use" onclick="mUseTalent('${key}')">Use ${label}</button>`):sheetButtons('');
  mSheet(label,isActive?'Active talent':'Passive talent',TALENT_DESCS[key]||label,[],
    isActive?(used?'off':'ok'):'ok',isActive?(used?(key==='taunt'?'Recharging':cooldownText(char,key)):'Ready'):'Always active',btn);
}
function mUseTalent(t){ mCloseSheet(); send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:t}}); }

// ── Spells ───────────────────────────────────────────────────────────────────
function mTapSpell(spellName,char){
  const sp=(char.knownSpells||[]).find(s=>s.name===spellName); if(!sp) return;
  const left=castingsLeftC(char,spellName,sp.rank), maxC=maxCastingsC(char.power,sp.rank);
  const typeLabel=sp.type==='heal'?'Heal spell':sp.type==='utility'?'Utility spell':'Attack spell';
  const inCombat=lastState&&lastState.gs&&lastState.gs.phase==='combat';
  const safe=esc(spellName);
  let primary='';
  if(left>0&&inCombat){
    primary=`<button class="m-btn cast" onclick="mCastSpell('${safe}')">Cast${sp.type==='heal'?' on self':''}</button>`;
    const allies=lastState.players.filter(p=>p.id!==myId&&p.char&&p.char.alive);
    if(sp.type==='heal'&&allies.length) primary+=`<button class="m-btn cast" onclick="mCloseSheet();castAlly('${safe}')">Cast on ally</button>`;
  }
  mSheet(spellName,`Rank ${sp.rank} · ${typeLabel}`,sp.desc||'',[['Castings left (shared by rank)',`${left} / ${maxC}`]],
    left>0?'ok':'off',left>0?'Ready':'No castings left this fight',sheetButtons(primary));
}
function mCastSpell(n){
  mCloseSheet();
  const sp=lastState&&lastState.players.find(p=>p.id===myId);
  const spell=sp&&sp.char&&(sp.char.knownSpells||[]).find(s=>s.name===n);
  send('PLAYER_ACTION',{action:'CAST_SPELL',data:spell&&spell.type==='heal'?{spellName:n,targetId:myId}:{spellName:n}});
}

// ── Items ────────────────────────────────────────────────────────────────────
function mTapItem(idx,char,inCombat){
  const entry=(char.inventory||[])[idx]; if(!entry) return;
  const o=entry.itemObj;
  const desc=(o&&o.desc)||ITEM_DESCS[entry.name]||'';
  const isWpn=entry.type==='weapon', isArm=entry.type==='armor', isCharm=entry.type==='charm';
  const atMerchant=lastState&&lastState.gs&&lastState.gs.phase==='merchant';
  const cursedNote=o&&o.cursed?`<div class="m-sheet-desc">⛓ Cursed — once equipped it can't be removed until you rest or use a Sigmar's Token.</div>`:'';
  if(isCharm){
    const isEq=char.equippedCharm&&o&&o.id===char.equippedCharm.id;
    let primary=isEq?'':`<button class="m-btn use" onclick="mEquip(${idx})">Wear</button>`;
    if(atMerchant&&!isEq) primary+=`<button class="m-btn" onclick="mCloseSheet();sellItem(${idx})">Sell ${entry.sellCost||1} ss</button>`;
    mOpenSheet(`<div class="m-sheet-name">${entry.name}</div><div class="m-sheet-type">Charm</div><div class="m-sheet-desc">${o?o.desc:''}</div>${cursedNote}<div class="m-sheet-status ${isEq?'ok':'warn'}">${isEq?'Worn':'In your pack'}</div>${sheetButtons(primary)}`);
    return;
  }
  if(isWpn||isArm){
    const stat=isWpn&&o?`${o.dice}+${o.bonus||0} · ${(o.stat||'').toUpperCase()} · ${o.dmgType||''}`:isArm&&o?`+${o.defBonus} Defence`:'';
    const isEq=(isWpn&&char.equippedWeapon&&o&&o.id===char.equippedWeapon.id)||(isArm&&char.equippedArmor&&o&&o.id===char.equippedArmor.id);
    let primary=isEq?'':`<button class="m-btn use" onclick="mEquip(${idx})">Equip</button>`;
    if(atMerchant&&!isEq) primary+=`<button class="m-btn" onclick="mCloseSheet();sellItem(${idx})">Sell ${entry.sellCost||1} ss</button>`;
    const special=o&&o.special?`<div class="m-sheet-desc">✦ ${o.special.desc}</div>`:'';
    const traits=traitText(o).replace(/^ · /,'');
    mOpenSheet(`<div class="m-sheet-name">${entry.name}</div><div class="m-sheet-type">${isWpn?'Weapon':'Armour'} · ${stat}</div>${special}${traits?`<div class="m-sheet-desc">Traits: ${traits}</div>`:''}${cursedNote}<div class="m-sheet-status ${isEq?'ok':'warn'}">${isEq?'Equipped':'In your pack'}</div>${sheetButtons(primary)}`);
    return;
  }
  let primary='';
  if(isUsableItem(entry.name)) primary+=`<button class="m-btn use" onclick="mUseItem('${esc(entry.name)}',${inCombat})">Use</button>`;
  if(ALLY_ITEMS.includes(entry.name)&&inCombat) primary+=`<button class="m-btn use" onclick="mCloseSheet();useAlly('${esc(entry.name)}')">Give to ally</button>`;
  if(atMerchant) primary+=`<button class="m-btn" onclick="mCloseSheet();sellItem(${idx})">Sell ${entry.sellCost||1} ss</button>`;
  mSheet(entry.name,'Consumable',desc,[['Quantity','×'+(entry.qty||1)]],'ok','',sheetButtons(primary));
}
function mUseItem(n,inCombat){ mCloseSheet(); useItem(n,inCombat); }
function mEquip(idx){ mCloseSheet(); equipItem(idx); }

// ── Enemies ──────────────────────────────────────────────────────────────────
function mTapEnemy(idx){
  const gs=lastState&&lastState.gs; if(!gs) return;
  const enemy=(gs.enemies||[])[idx]||gs.enemy; if(!enemy) return;
  const rows=[['Health',`${enemy.hp} / ${enemy.maxHp}`],['Defence',enemy.ac],['Attack','d20+'+(enemy.atk||0)],['Damage',enemy.dmgDisplay||'1d6'],['Threat',enemy.threat]];
  if(enemy._poisonStacks>0) rows.push(['Poison',`${enemy._poisonStacks} stacks`]);
  if(enemy.damageReduction>0) rows.push(['Damage reduction','−'+enemy.damageReduction]);
  (enemy.tags||[]).forEach(t=>{ if(ENEMY_WEAKNESS[t]) rows.push(['Weakness',ENEMY_WEAKNESS[t].replace(/^\S+ Weak: /,'')]); });
  if(enemy.mutationLabel) rows.push(['Mutation',`${enemy.mutationLabel} — ${enemy.mutationDesc}`]);
  if(enemy._windup) rows.unshift(['⚠ Next turn',`${TELEGRAPH_NAMES[enemy._windup]||'Big attack'} — stun it to cancel`]);
  const abs=enemyAbilities(enemy).filter(([n])=>n!=='Mutation');
  const absHtml=abs.length?`<div class="m-sheet-sub">Abilities</div>`+abs.map(([n,d])=>`<div class="m-ability"><b>${n}</b><span>${d}</span></div>`).join(''):'';
  const multi=(gs.enemies||[]).filter(e=>e&&e.hp>0).length>1;
  const isTarget=idx===(gs.activeEnemyIdx||0);
  const primary=multi&&!isTarget&&gs.phase==='combat'
    ?`<button class="m-btn use" onclick="mCloseSheet();send('PLAYER_ACTION',{action:'TARGET_ENEMY',data:{idx:${idx}}})">Target this enemy</button>`:'';
  const rowsH=rows.map(r=>`<div class="m-sheet-row">${r[0]}<span>${r[1]}</span></div>`).join('');
  mOpenSheet(`<div class="m-sheet-name foe">${enemy.name}</div><div class="m-sheet-type">${enemy.type||''}${multi&&isTarget?' · Your target':''}</div>${rowsH}${absHtml}${sheetButtons(primary)}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function mEl(tag,cls,html){ const e=document.createElement(tag); if(cls) e.className=cls; if(html!==undefined) e.innerHTML=html; return e; }
function mBar(pct,cls){ return `<div class="m-bar"><div class="m-bar-fill ${cls}" style="width:${Math.max(0,Math.min(100,pct))}%"></div></div>`; }
function currentTurn(gs){ return gs.turnOrder&&gs.turnOrder.length?gs.turnOrder[gs.activeTurnIdx||0]:null; }

let mLogOpen=false;
let mKitTab=null;

// ── Full mobile game view (the desktop main column is hidden in this layout) ─
function mRenderGame(gs,players,me){
  if(!isMobileUI()) return;
  const view=el('m-game-view'); if(!view) return;
  const scrollY=window.scrollY;
  view.innerHTML='';
  if(!me||!me.char) return;
  const char=me.char;
  const inCombat=gs.phase==='combat';
  const inMerchant=gs.phase==='merchant';
  const inLoot=gs.phase==='loot';

  // Status bar
  const phaseLabel=inCombat?'In combat':gs.phase==='aftermath'?'Victory':gs.phase==='choice'?'Encounter':inMerchant?'Merchant':inLoot?'Loot room':gs.phase==='path'?'Crossroads':gs.phase==='relic'?'Relics':'Travelling';
  const phaseCls=inCombat?'s-combat':inMerchant||inLoot?'s-event':'s-explore';
  view.appendChild(mEl('div','m-status',`
    <div class="m-status-top"><div class="m-loc">${LOCS[Math.min(gs.depth,LOCS.length-1)]}</div><span class="state-badge ${phaseCls}">${phaseLabel}</span></div>
    <div class="m-depth"><span>Depth ${gs.depth}${gs.endless?' · Endless':' / 30'}</span>${mBar(gs.endless?(gs.depth%10)/10*100:gs.depth/30*100,'depth')}</div>`));

  // Turn banner
  if(inCombat){
    const t=currentTurn(gs);
    const mine=t&&t.type==='player'&&t.id===myId;
    const text=mine?'Your turn':t&&t.type==='enemy'?`${t.name} is attacking…`:t?`Waiting for ${t.name}…`:'Waiting…';
    view.appendChild(mEl('div','m-turn '+(mine?'mine':t&&t.type==='enemy'?'foe':''),`<span>${text}${turnTimerHtml(gs)}</span><span class="m-round">Round ${gs.roundNumber||1}</span>`));
    if(gs.practice) view.insertAdjacentHTML('beforeend',coachHtml(gs,me));
  }

  // Enemies
  if(inCombat){
    const enemies=(gs.enemies&&gs.enemies.length?gs.enemies:[gs.enemy]).map((e,i)=>[e,i]).filter(([e])=>e&&e.hp>0);
    const multi=enemies.length>1;
    enemies.forEach(([enemy,idx])=>{
      const pct=enemy.hp/enemy.maxHp*100;
      const isTarget=idx===(gs.activeEnemyIdx||0);
      const chips=[];
      if(enemy._windup) chips.push(`<span class="chip chip-alert">⚠ Next turn: ${TELEGRAPH_NAMES[enemy._windup]||'big attack'}</span>`);
      if(enemy._hiding) chips.push('<span class="chip">🫥 Cowering</span>');
      if(enemy._vanished) chips.push('<span class="chip">💨 Vanished</span>');
      if(enemy.mutationLabel) chips.push(`<span class="chip chip-warn">🧬 ${enemy.mutationLabel}</span>`);
      if(enemy._poisonStacks>0) chips.push(`<span class="chip chip-bad">☠ ${enemy._poisonStacks}</span>`);
      (enemy.activeDebuffs||[]).forEach(d=>chips.push(`<span class="chip chip-bad">${d.name} ${d.duration}r</span>`));
      (enemy.tags||[]).forEach(t=>{ if(ENEMY_WEAKNESS[t]) chips.push(`<span class="chip chip-warn">${ENEMY_WEAKNESS[t]}</span>`); });
      const tok=tokenSrc(enemy.name);
      const card=mEl('button','m-enemy-card'+(multi&&isTarget?' targeted':''),`
        ${tok?`<img class="m-tok enemy" src="${tok}" alt="">`:'<span class="m-tok enemy ph">💀</span>'}
        <span class="m-enemy-body">
          <span class="m-enemy-head"><span class="m-enemy-name">${enemy.name}</span><span class="threat-b ${threatClass(enemy.threat)}">${enemy.threat}</span></span>
          <span class="m-hp-row">${mBar(pct,'enemy')}<span class="m-hp-val">${enemy.hp}/${enemy.maxHp}</span></span>
          <span class="m-enemy-stats">Def <b>${enemy.ac}</b> · Atk <b>+${enemy.atk||0}</b> · Dmg <b>${enemy.dmgDisplay||'1d6'}</b>${multi&&isTarget?' · <b class="tgt">Target</b>':''}</span>
          ${(()=>{ const it=enemyIntent(enemy,gs,players); return `<span class="intent ${it.cls}">${it.text}</span>`; })()}
          ${chips.length?`<span class="chip-row">${chips.join('')}</span>`:''}
        </span>`);
      card.dataset.eidx=idx;
      card.setAttribute('aria-label',`${enemy.name}, ${enemy.hp} of ${enemy.maxHp} health. Show details.`);
      card.onclick=()=>mTapEnemy(idx);
      view.appendChild(card);
    });
  }

  // You
  {
    const c=char, pct=c.health/c.maxHealth*100, xp=xpProgress(c);
    const acted=hasActedThisRound(gs,me.id);
    const tok=tokenSrc(me.career);
    const chips=[...(c.conditions||[]).map(cd=>`<span class="chip chip-bad">${cd}</span>`),...(c.activeBuffs||[]).map(b=>`<span class="chip chip-good">${b.name} ${b.duration}r</span>`)];
    const card=mEl('div','m-me'+(c.alive?'':' is-dead'),`
      <div class="m-me-head">
        ${tok?`<img class="m-tok mine${me.frame?' frame-'+me.frame:''}" src="${tok}" alt="">`:''}
        <div class="m-me-id"><div class="m-pname">${me.name}</div><div class="m-psub">${me.title?`<em>${escapeHtml(me.title)}</em> · `:''}${CAREER_LABELS[me.career]||''} · Level ${c.level}${acted?' · <span class="ok">Acted</span>':''}</div></div>
        <div class="m-silver">${c.gold} ss</div>
      </div>
      <div class="m-hp-row"><span class="m-hp-label">HP</span>${mBar(pct,'hp '+hpClass(pct))}<span class="m-hp-val">${c.health}/${c.maxHealth}</span></div>
      <div class="m-hp-row"><span class="m-hp-label">XP</span>${mBar(xp.pct,'xp')}<span class="m-hp-val">${c.level>=10?'Max':`${c.xp}/${xp.next}`}</span></div>
      ${c.equippedCharm?`<div class="m-stats">📿 ${c.equippedCharm.name} <button class="mini-btn" onclick="unequipCharm()">Remove</button></div>`:''}
      <div class="m-stats">${c.row==='back'?'🏹 Back row':'🛡 Front row'} <button class="mini-btn" onclick="setRow('${c.row==='back'?'front':'back'}')">Move ${c.row==='back'?'forward':'back'}</button></div>${c.relics&&c.relics.length?`<div class="m-stats relic-chips">${c.relics.map(k=>{const r=RELICS_C[k]||{name:k,icon:'✨',desc:''};return `<span class="relic-chip" title="${r.name}: ${r.desc}">${r.icon} ${r.name}</span>`;}).join('')}</div>`:''}
      <div class="m-stats">Def <b>${c.defense}</b>${c.power>0?` · Power <b>${c.power}</b>`:''} · STR <b>${c.attrs.str}</b> · AGI <b>${c.attrs.agi}</b> · INT <b>${c.attrs.int}</b> · WIL <b>${c.attrs.wil}</b></div>
      ${chips.length?`<div class="chip-row">${chips.join('')}</div>`:''}
      ${c.alive?'':'<div class="dead-label">Fallen</div>'}`);
    card.dataset.pname=me.name;
    view.appendChild(card);
  }

  // Chronicle (log) — recent lines, expandable
  {
    const log=gs.log||[];
    const wrap=mEl('div','m-log'+(mLogOpen?' open':''));
    const lines=mLogOpen?log.slice(-40):log.slice(-5);
    const body=mEl('div','m-log-body',lines.length?lines.map(e=>`<div class="log-line${e.type?' '+e.type:''}">${e.msg}</div>`).join(''):'<div class="log-line sys">The warband gathers…</div>');
    const tgl=mEl('button','m-log-toggle',mLogOpen?'Show less':'Show full chronicle');
    tgl.onclick=()=>{ mLogOpen=!mLogOpen; if(lastState) renderMobileState(lastState); };
    wrap.appendChild(body); if(log.length>5) wrap.appendChild(tgl);
    view.appendChild(wrap);
    requestAnimationFrame(()=>{ body.scrollTop=body.scrollHeight; });
  }

  // Actions
  const act=mEl('div','m-card m-actions');
  const heading=t=>act.appendChild(mEl('div','m-card-title',t));
  if(gs.phase==='choice'&&gs.choice){
    heading(gs.choice.title);
    act.appendChild(buildChoice(gs,players));
  } else if(gs.phase==='aftermath'&&gs.aftermath){
    heading(gs.aftermath.outcome==='fled'?'You escaped':'Battle won');
    act.appendChild(buildAftermath(gs,players));
  } else if(gs.phase==='event'){
    const btn=mEl('button','btn gold btn-w','Press onward');
    btn.onclick=()=>send('PLAYER_ACTION',{action:'PRESS_ONWARD'});
    act.appendChild(btn);
  } else if(gs.phase==='relic'&&gs.relic){
    heading('Choose a relic');
    act.appendChild(buildRelicPanel(gs,players,me));
  } else if(gs.phase==='path'){
    heading(gs.bossNode?'The path ahead':'Vote your path');
    renderActions(gs,players,me);
    const src=el('g-actions-body'); while(src&&src.firstChild) act.appendChild(src.firstChild);
  } else if(inCombat&&char.alive){
    const t=currentTurn(gs);
    if(t&&!(t.type==='player'&&t.id===myId)){
      act.appendChild(mEl('div','m-wait',t.type==='enemy'?`${t.name} is attacking…`:`Waiting for ${t.name}…`));
    } else {
      heading('Your action');
      renderActions(gs,players,me);
      const src=el('g-actions-body'); while(src&&src.firstChild) act.appendChild(src.firstChild);
    }
  } else if(inCombat){
    act.appendChild(mEl('div','m-wait','You have fallen. Your warband fights on…'));
  } else if(inLoot&&gs.lootRoom){
    heading('Loot room — choose one');
    if(gs.lootPicked&&gs.lootPicked.includes(myId)){
      act.appendChild(mEl('div','m-wait','You have chosen. Waiting for the others…'));
    } else {
      const o=char.lootOptions;
      if(o){
        const grid=mEl('div','m-grid2');
        const consName=o.consumable==='Spell Scroll'&&o.scrollSpell?`Scroll: ${o.scrollSpell.name}`:o.consumable;
        const opt=(icon,name,desc,pick)=>{
          const b=mEl('button','m-choice',`<span class="m-choice-icon">${icon}</span><span class="m-choice-name">${name}</span><span class="m-choice-desc">${desc}</span>`);
          b.onclick=()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick}}); grid.appendChild(b);
        };
        opt('💰',`${gs.lootRoom.coins} silver`,'Coin from the cache.','coins');
        opt('🧪',consName,o.scrollSpell?o.scrollSpell.desc:ITEM_DESCS[o.consumable]||'','consumable');
        opt('⚔',o.weapon.name,`${o.weapon.dice}+${o.weapon.bonus} · ${o.weapon.stat.toUpperCase()}${traitText(o.weapon)}`,'weapon');
        opt('🛡',o.armor.name,`+${o.armor.defBonus} Defence${traitText(o.armor)}`,'armor');
        if(o.charm) opt('📿',o.charm.name,o.charm.desc,'charm');
        act.appendChild(grid);
      }
    }
  } else if(inMerchant&&char.merchantStock){
    const stock=char.merchantStock;
    heading('Merchant');
    act.appendChild(mEl('div','m-sub',`Your silver: <b>${char.gold} ss</b>`));
    [stock.weaponEnhance,stock.statBoost,stock.weapon1,stock.weapon2,stock.weapon3,stock.armor,stock.armor2,stock.charm,stock.charm2,...(stock.consumables||[]),stock.scroll].filter(Boolean).forEach(item=>{
      const desc=(item.itemObj&&item.itemObj.desc)||item.desc||ITEM_DESCS[item.name]||'';
      const afford=char.gold>=item.cost;
      act.appendChild(mEl('div','m-shop-item'+(item.bought?' sold':''),`
        <div class="m-shop-text"><div class="m-shop-name">${item.name}</div><div class="m-shop-desc">${desc}</div></div>
        <button class="m-btn use" onclick="buyItem('${item.id}')" ${item.bought||!afford?'disabled':''}>${item.bought?'Sold':`${item.cost} ss`}</button>`));
    });
    const leave=mEl('button','btn btn-w','Done shopping'); leave.onclick=leaveShop; act.appendChild(leave);
  }
  if(act.children.length) view.appendChild(act);

  // Allies
  const allies=players.filter(p=>p.char&&p.id!==myId);
  if(allies.length){
    const wrap=mEl('div','m-card m-allies');
    wrap.appendChild(mEl('div','m-card-title','Warband'));
    allies.forEach(p=>{
      const c=p.char, pct=c.health/c.maxHealth*100;
      const row=mEl('div','m-ally'+(c.alive?'':' is-dead'),`
        <div class="m-ally-name">${p.name}<small>${CAREER_LABELS[p.career]||''} · Lv ${c.level}${hasActedThisRound(gs,p.id)?' · <span class="ok">Acted</span>':''}${!p.connected?' · Offline':''}</small></div>
        <div class="m-hp-row">${mBar(pct,'hp '+hpClass(pct))}<span class="m-hp-val">${c.alive?`${c.health}/${c.maxHealth}`:'Fallen'}</span></div>`);
      row.dataset.pname=p.name;
      wrap.appendChild(row);
    });
    view.appendChild(wrap);
  }

  // Kit: talents / spells / items
  if(char.alive) view.appendChild(mBuildKit(char,gs));
  window.scrollTo(0,scrollY);
}

function mBuildKit(char,gs){
  const inCombat=gs.phase==='combat';
  const spells=char.knownSpells||[], inv=char.inventory||[];
  const tabs=[['ab','Talents'],...(spells.length?[['sp','Spells']]:[]),['it',`Items (${inv.length})`]];
  let tab=mKitTab;
  if(!tab||!tabs.some(t=>t[0]===tab)) tab=gs.phase==='merchant'?'it':'ab';
  const card=mEl('div','m-card m-kit');
  const bar=mEl('div','m-tabs'); bar.setAttribute('role','tablist');
  tabs.forEach(([id,label])=>{
    const b=mEl('button','m-tab'+(id===tab?' on':''),label);
    b.setAttribute('role','tab'); b.setAttribute('aria-selected',id===tab);
    b.onclick=()=>{ mKitTab=id; if(lastState) renderMobileState(lastState); };
    bar.appendChild(b);
  });
  card.appendChild(bar);
  const wrap=mEl('div','m-pill-wrap');
  if(tab==='ab'){
    const keys=[...ACTIVE_TALENTS.map(a=>a[0]),...EXTRA_ACTIVES.map(e=>e[0]).filter(k=>!ACTIVE_TALENTS.some(a=>a[0]===k))].filter(k=>char[k]).concat(passiveKeys(char));
    if(char.rageBoon){ const r=mEl('button','m-pill armed','Rage armed'); r.onclick=()=>mTapTalent('rage',char); wrap.appendChild(r); }
    keys.forEach(k=>{
      const used=talentUsed(k,char);
      const p=mEl('button','m-pill'+(used===null?' passive':used?' used':' ready'),labelFromKey(k)+(used&&COOLDOWNS_C[k]?` ⏳${cooldownLeft(char,k)}`:''));
      p.onclick=()=>mTapTalent(k,char); wrap.appendChild(p);
    });
    if(!keys.length&&!char.rageBoon) wrap.innerHTML='<span class="empty">No talents yet.</span>';
  } else if(tab==='sp'){
    const ranks=[...new Set(spells.map(sp=>sp.rank))].sort();
    card.appendChild(mEl('div','pools',ranks.map(r=>`<span class="pool">Rank ${r} <b>${castingsLeftC(char,'',r)}/${maxCastingsC(char.power,r)}</b></span>`).join('')));
    spells.forEach(sp=>{
      const left=castingsLeftC(char,sp.name,sp.rank);
      const p=mEl('button','m-pill spell'+(left>0?'':' used'),`${spellIcon(sp.name)} ${sp.name}`);
      p.onclick=()=>mTapSpell(sp.name,char); wrap.appendChild(p);
    });
  } else {
    inv.forEach((item,idx)=>{
      const o=item.itemObj;
      const isEq=(item.type==='weapon'&&char.equippedWeapon&&o&&o.id===char.equippedWeapon.id)||(item.type==='armor'&&char.equippedArmor&&o&&o.id===char.equippedArmor.id)||(item.type==='charm'&&char.equippedCharm&&o&&o.id===char.equippedCharm.id);
      const p=mEl('button','m-pill'+(isEq?' equipped':''),`${item.name}${item.qty>1?` ×${item.qty}`:''}${isEq?' ★':''}`);
      p.onclick=()=>mTapItem(idx,char,inCombat); wrap.appendChild(p);
    });
    if(!inv.length) wrap.innerHTML='<span class="empty">Your pack is empty.</span>';
  }
  card.appendChild(wrap);
  return card;
}

// ── Mobile state render (called from renderState in main.js) ─────────────────
function renderMobileState(st){
  if(!isMobileUI()) return;
  const{gs,players}=st;
  const me=players.find(p=>p.id===myId);
  if(me&&me.char&&gs.phase!=='lobby'&&gs.phase!=='gameover'&&gs.phase!=='victory'&&gs.phase!=='practiceDone') mRenderGame(gs,players,me);
}
