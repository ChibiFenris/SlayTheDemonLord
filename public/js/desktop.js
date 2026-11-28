'use strict';
// ─── PATH PICK ────────────────────────────────────────────────────────────────

function showPathPick(me){
  pathPickPending=true; show('screen-pathpick');
  const tier=me.char.pendingPathTier||'novice';

  if(tier==='tradition'){
    const knownTraditions=me.char.traditions||[];
    const choicesLeft=me.char.pendingSpellChoices||1;
    const grid=el('pp-grid'); grid.innerHTML='';
    const plural=choicesLeft>1?' ('+choicesLeft+' remaining)':'';
    el('pp-heading').textContent='Discover a Tradition'+plural;
    el('pp-sub').textContent='Your path grants a new magical tradition. All spells of rank up to your Power ('+me.char.power+') are granted immediately.';
    _buildTraditionButtons(grid, knownTraditions);
    return;
  }

  const titles={novice:'Your People (Level 1)',expert:'Choose Your Expert Class (Level 3)',master:'Choose Your Master Class (Level 7)'};
  el('pp-heading').textContent=titles[tier]||'Choose Your Path';
  el('pp-sub').textContent=tier==='novice'?'Your career archetype — unlocks talents and abilities.'
    :tier==='expert'?`The classes open to the ${CAREER_LABELS[me.career]||'warband'} — choose how you will fight.`
    :`The heights the ${CAREER_LABELS[me.career]||'warband'} can reach. Masters bring the core of their craft with them.`;
  const grid=el('pp-grid'); grid.innerHTML='';
  const infoMap=tier==='novice'?NOVICE_INFO:tier==='expert'?EXPERT_INFO:MASTER_INFO;
  const allowed=(CAREER_PATHS_C[me.career]||{})[tier];
  const flav=PATH_FLAVOUR[me.career]||{};
  Object.entries(infoMap).filter(([id])=>tier==='novice'||!allowed||allowed[id]).map(([id,info])=>[id,allowed&&allowed[id]?{...info,name:allowed[id],desc:flav[id]||info.desc}:info]).forEach(([id,info])=>{
    const btn=document.createElement('button'); btn.className='pp-btn';
    const hint='';
    const tok=tier!=='novice'&&tokenSrc(me.career+'/'+id);
    btn.innerHTML=`<span class="pp-head">${tok?`<img class="pp-tok" src="${tok}" alt="">`:''}<span><span class="ppn">${info.name}</span><span class="ppd">${info.desc||''}</span></span></span><span class="ppb">${hint}${info.gains}</span>`;
    btn.onclick=()=>confirmPath(id,info.name,`${info.desc||''}<br><br>${info.gains}`);
    grid.appendChild(btn);
  });
}

// Desktop commits on click; on phones a sheet asks first so a stray tap can't pick a path.
function confirmPath(pathId,name,descHtml){
  if(!isMobileUI()){ applyPath(pathId); return; }
  mOpenSheet(`<div class="m-sheet-name">${name}</div><div class="m-sheet-desc">${descHtml}</div><div class="m-act-btns"><button class="m-btn use" onclick="mCloseSheet();applyPath('${esc(pathId)}')">Choose ${name}</button><button class="m-btn sec" onclick="mCloseSheet()">Back</button></div>`);
}
function applyPath(pathId){
  pathPickPending=true;
  send('PLAYER_ACTION',{action:'APPLY_PATH',data:{pathId}});
}

// ── Tradition picker helper ────────────────────────────────────────────────────
function _buildTraditionButtons(grid, knownTraditions){
  grid.innerHTML='';
  const me=lastState&&lastState.players.find(p=>p.id===myId), c=me&&me.char;
  const okLore=id=>{ if(!c) return true; if(id==='chaos') return c.expertPath==='warlock'; const l=TRADITION_ACCESS_C[c.career]; return !l||l.includes(id); };
  Object.entries(TRADITION_INFO).filter(([id])=>okLore(id)).forEach(([id,info])=>{
    const already=knownTraditions.includes(id);
    const btn=document.createElement('button'); btn.className='pp-btn';
    btn.disabled=already;
    btn.innerHTML=`<span class="ppn">${info.label}${already?' ✓':''}</span>
      <span class="ppd">${info.desc}</span>
      <span class="ppb">${already?'Already known — pick a different one.':'Unlock rank 0 spell immediately. Higher ranks unlock as Power grows.'}</span>`;
    if(!already) btn.onclick=()=>confirmPath('tradition:'+id,info.label,info.desc);
    grid.appendChild(btn);
  });
}

// ─── MAIN STATE ───────────────────────────────────────────────────────────────
function renderMainState(st){
  const{gs,players}=st;
  const me=players.find(p=>p.id===myId);
  if(!me){ updateLobbySlots(players); return; }
  if(gs.phase==='lobby'){ show('screen-lobby'); updateLobbySlots(players); updateAudio(gs,players); prevLogLen=0; Object.keys(prevHp).forEach(k=>delete prevHp[k]); return; }
  if(gs.phase==='dying'){
    show('screen-game');
    updateAudio(gs,players);
    renderLog(gs.log);
    renderSidebars(players,gs,me);
    mShowDeathScreen(players,gs.depth,gs);
    return;
  }
  if(gs.phase==='gameover'){ show('screen-end'); el('end-title').className='end-title death'; el('end-title').textContent='The Warband Has Fallen'; const deathInfo=gs.deathCause?`<br><span class="end-cause">${gs.deathCause.replace(/<[^>]+>/g,' ').trim()}</span>`:''; el('end-sub').innerHTML=`Depth: <strong>${gs.depth}${gs.endless?' (Endless)':'/30'}</strong>${deathInfo}`; updateAudio(gs,players); el('share-run').hidden=false; mHideDeathScreen(); showRenown(gs); return; }
  if(gs.phase==='victory'){ show('screen-end'); el('end-title').className='end-title victory'; el('end-title').textContent='Victory!'; el('end-sub').innerHTML=`The warband conquers the depths!<br>Depth: ${gs.depth}/30`; el('share-run').hidden=false; updateAudio(gs,players); showRenown(gs); return; }
  if(gs.phase==='practiceDone'){ show('screen-end'); el('end-title').className='end-title victory'; el('end-title').textContent='Practice Complete'; el('end-sub').innerHTML='You know the basics: attacks, boons and banes, your talents and the warning signs.<br>Return to Altdorf and gather a warband.'; el('end-renown').innerHTML=''; el('share-run').hidden=true; mHideDeathScreen(); updateAudio(gs,players); return; }
  if(me.char&&me.char.pendingLevelUp&&me.char.pendingPathTier&&!pathPickPending&&gs.phase!=='aftermath'&&!gs.practice){ showPathPick(me); return; }
  if(pathPickPending) return;

  show('screen-game');
  updateAudio(gs,players);
  if(me.char&&me.char.pendingStatBoost&&!el('stat-choice-modal')) showStatChoiceModal(me.char.attrs);
  el('g-loc').textContent=placeName(gs);
  { const z=zoneOf(gs); document.body.dataset.zone=(gs.phase!=='lobby'&&z)?z.id:''; const zl=el('g-zone'); if(zl) zl.textContent=z?`${z.icon} ${z.name}`:''; }
  el('g-depth').textContent=gs.depth;
  const dm=el('g-depth-max'); if(dm) dm.textContent=gs.endless?' · Endless':'/30';
  const dt=el('g-depth-track'); dt.innerHTML='';
  // Endless: the track slides along so it always shows the 30 depths around you.
  const start=gs.endless?Math.max(0,Math.floor(gs.depth/10)*10-20):0;
  for(let i=start;i<start+30;i++){ const p=document.createElement('div'); p.className='dpip'+(i<gs.depth?' done':i===gs.depth?' cur':'')+(i%10===9?' boss':''); dt.appendChild(p); }
  const sb=el('g-state');
  const phMap={combat:'s-combat',merchant:'s-event',loot:'s-event',aftermath:'s-event',choice:'s-event',path:'s-explore',event:'s-explore'};
  sb.className='state-badge '+(phMap[gs.phase]||'s-explore');
  sb.textContent=gs.phase==='combat'?'In Combat':gs.phase==='aftermath'?(gs.aftermath&&gs.aftermath.outcome==='fled'?'Escaped':'Victory'):gs.phase==='choice'?'Encounter':gs.phase==='merchant'?'Merchant':gs.phase==='loot'?'Loot Room':gs.phase==='campfire'?'Campfire':gs.phase==='relic'?'Relics':'Travelling';

  renderLog(gs.log);
  renderBattle(gs,players,me);
  checkFloats(gs,players);
  renderSidebars(players,gs,me);
  renderActions(gs,players,me);

  const showShop=gs.phase==='merchant'&&me.char&&me.char.merchantStock;
  const showLoot=gs.phase==='loot'&&gs.lootRoom;
  el('g-shop').hidden=!showShop;
  el('g-loot-panel').hidden=!showLoot;
  el('g-actions-panel').hidden=!!(showShop||showLoot);
  if(showShop){ el('shop-gold').textContent=me.char.gold; renderShop(me.char.merchantStock,me.char.gold); }
  if(showLoot) renderLoot(gs,me);
}

let lastLogLen=0;
function renderLog(log){
  const box=el('g-narrative');
  const lastTs=log.length?log[log.length-1].ts:0;
  if(lastTs===lastLogLen)return; lastLogLen=lastTs;
  box.innerHTML='';
  log.forEach(e=>{ const d=document.createElement('div'); d.className='log-line'+(e.type?' '+e.type:''); d.innerHTML=e.msg; box.appendChild(d); });
  box.scrollTop=box.scrollHeight;
}

// ─── BATTLE ARENA ─────────────────────────────────────────────────────────────
const ENEMY_TAG_LABEL={skaven:'🐀 Skaven',chaos:'☠ Chaos',undead:'💀 Undead',beast:'🐗 Beast',vermin:'🐀 Vermin'};
const ENEMY_WEAKNESS={skaven:'⚡ Weak: Lightning',chaos:'✨ Weak: Holy',undead:'🔥 Weak: Fire',beast:'🌑 Weak: Dark','fire-weak':'🔥 Weak: Fire'};
const TELEGRAPH_NAMES={bigChoppa:'Big Choppa',warpGas:'Warp-Gas Globe',goreCharge:'Gore Charge',leap:'Leaping Maul',slam:'Bonebreaker Slam',stomp:'Primordial Stomp',warpStorm:'Warp Storm',hornCurse:'Curse of Horns',plagueWind:'Plague Wind',trollSmash:'Troll Smash',hellfire:'Hellfire',dragonBreath:'Dragon Breath'};
// Status chips that matter for decisions: winding up, hidden, mutation.
function enemyStateChips(e){
  const out=[];
  if(e._windup) out.push(`<span class="e-status-chip e-chip-alert" title="Stun it to cancel; Taunt redirects most big attacks.">⚠ Next turn: ${TELEGRAPH_NAMES[e._windup]||'big attack'}</span>`);
  if(e._hiding) out.push('<span class="e-status-chip e-chip-tag">🫥 Cowering — can\'t be targeted</span>');
  if(e._vanished) out.push('<span class="e-status-chip e-chip-tag">💨 Vanished</span>');
  if(e.mutationLabel) out.push(`<span class="e-status-chip e-chip-debuff" title="${e.mutationDesc||''}">🧬 ${e.mutationLabel}</span>`);
  if(e.affixLabel) out.push(`<span class="e-status-chip e-chip-debuff" title="Elite: ${e.affixDesc||''}">★ ${e.affixLabel}</span>`);
  if(e.phaseName) out.push(`<span class="e-status-chip e-chip-debuff" title="Phase two">🔥 ${e.phaseName}</span>`);
  if(e.endlessTier) out.push(`<span class="e-status-chip" title="Endless: stronger for every boss past the third">♾ Tier ${e.endlessTier}</span>`);
  return out;
}
function enemyAbilityChips(e){
  return enemyAbilities(e).filter(([n])=>n!=='Mutation').map(([n,d])=>`<span class="e-status-chip e-chip-ability" title="${d.replace(/"/g,'&quot;')}">${n}</span>`);
}
const DEBUFF_ICON={'Blinded':'👁','Stunned':'💫','Slowed':'❄','Figment':'👻','Glamer (miss)':'✨','Vine Snare':'🌿','Enervated':'💔'};
function threatClass(t){ return t==='Boss'?'tb':t==='Elite'||t==='High'?'th':t==='Moderate'?'tm':'tl'; }
function tipChip(cls,name,label,isEnemy){
  return `<span class="e-status-chip ${cls} e-chip-clickable" onmouseenter="showDebuffTip('${esc(name)}',${isEnemy},event)" onmouseleave="hideDebuffTip()">${label}</span>`;
}

// Two lanes per side: the front line next to the VS, the back line behind it.
function makeLanes(host,isFoe,showBack,exposed){
  const mk=(cls,title,hint)=>{ const box=document.createElement('div'); box.className='lane '+cls; box.innerHTML=`<div class="lane-head"><span class="lane-title">${title}</span><span class="lane-hint">${hint}</span></div>`; const body=document.createElement('div'); body.className='lane-body'; box.appendChild(body); host.appendChild(box); return body; };
  const front=mk('lane-front','Front line',isFoe?'':'melee foes reach you here');
  const back=showBack?mk('lane-back'+(exposed?' exposed':''),'Back line',isFoe?'screened while their front line stands':exposed?'⚠ exposed — nobody holds the front':'only archers, gunners and casters reach you'):document.createElement('div');
  return {front,back};
}
function renderBattle(gs,players,me){
  const panel=el('g-battle');
  if(gs.phase!=='combat'||!gs.enemy){ panel.hidden=true; return; }
  panel.hidden=false;
  const enemies=gs.enemies&&gs.enemies.length>0?gs.enemies:[gs.enemy].filter(Boolean);
  const activeIdx=gs.activeEnemyIdx||0;
  const multi=enemies.filter(e=>e&&e.hp>0).length>1;
  const eEl=el('ba-enemy'); eEl.innerHTML='';
  const eLanes=makeLanes(eEl,true,enemies.some(e=>e&&e.hp>0&&e.row==='back'));
  enemies.forEach((e,idx)=>{
    if(!e||e.hp<=0)return;
    const eTok=tokenSrc(e.name);
    const hpPct=Math.max(0,e.hp/e.maxHp*100);
    const isTarget=idx===activeIdx;
    const eRow=document.createElement('div'); eRow.className='token-row er'+(multi&&isTarget?' targeted':''); eRow.dataset.eidx=idx;
    const chips=enemyStateChips(e);
    if(e._poisonStacks>0) chips.push(tipChip('e-chip-dot','Poison',`☠ Poison ×${e._poisonStacks}`,true));
    (e.activeDebuffs||[]).forEach(d=>{
      chips.push(d.dotDmg
        ?tipChip('e-chip-dot',d.name,`${d.name} ${d.dotDmg} dmg · ${d.duration}r`,true)
        :tipChip('e-chip-debuff',d.name,`${DEBUFF_ICON[d.name]||'⚠'} ${d.name} · ${d.duration}r`,true));
    });
    (e.tags||[]).forEach(t=>{ if(ENEMY_TAG_LABEL[t]) chips.push(`<span class="e-status-chip e-chip-tag">${ENEMY_TAG_LABEL[t]}</span>`); });
    if(e.ranged) chips.unshift('<span class="e-status-chip e-chip-line" title="Archers, gunners and casters reach your back line.">🏹 Reaches your back line</span>');
    if(e._screened) chips.unshift('<span class="e-status-chip e-chip-line" title="While their front line stands, melee attacks on this enemy have 1 bane. Spells and ranged weapons hit it normally.">🛡 Screened</span>');
    chips.push(...enemyAbilityChips(e));
    (e.tags||[]).forEach(t=>{ if(ENEMY_WEAKNESS[t]) chips.push(`<span class="e-status-chip e-chip-weak">${ENEMY_WEAKNESS[t]}</span>`); });
    const target=!multi?'':isTarget
      ?'<div class="target-mark">▶ Targeted</div>'
      :`<button class="mini-btn" onclick="send('PLAYER_ACTION',{action:'TARGET_ENEMY',data:{idx:${idx}}})">Target</button>`;
    eRow.innerHTML=`
      <div class="tok-info">
        <div class="e-name">${e.name}</div>
        <div class="e-sub"><span class="threat-b ${threatClass(e.threat)}">${e.threat}</span></div>
        <div class="tok-hp-track"><div class="tok-hp-fill enemy" style="width:${hpPct}%"></div></div>
        <div class="tok-hp-txt">${Math.max(0,e.hp)}/${e.maxHp} HP</div>
        <div class="e-stats">Def<span>${e.ac}</span>ATK<span>${(e.atk>=0?'+':'')+e.atk}</span>DMG<span>${e.dmgDisplay||'1d6'}</span></div>
        ${(()=>{ const it=enemyIntent(e,gs,lastState?lastState.players:[]); return `<div class="intent ${it.cls}">${it.text}</div>`; })()}
        ${chips.length?`<div class="e-status-box">${chips.join('')}</div>`:''}${target}
      </div>
      ${eTok?`<img class="tok enemy" src="${eTok}" alt="${e.name}">`:'<div class="tok-ph">💀</div>'}`;
    (e.row==='back'?eLanes.back:eLanes.front).appendChild(eRow);
  });
  const pEl=el('ba-players'); pEl.innerHTML='';
  const pLanes=makeLanes(pEl,false,true,lineExposed(players));
  const meP=players.find(p=>p.id===myId), mv=meP&&meP.char?rowMoveState(meP.char,gs):{ok:false};
  // Drag your own portrait to the other line.
  [['front',pLanes.front],['back',pLanes.back]].forEach(([r,lane])=>{
    lane.parentNode.addEventListener('dragover',ev=>{ if(mv.ok&&meP.char.row!==r){ ev.preventDefault(); lane.parentNode.classList.add('drop-ok'); } });
    lane.parentNode.addEventListener('dragleave',()=>lane.parentNode.classList.remove('drop-ok'));
    lane.parentNode.addEventListener('drop',ev=>{ ev.preventDefault(); lane.parentNode.classList.remove('drop-ok'); if(mv.ok&&meP.char.row!==r) setRow(r); });
  });
  players.forEach(p=>{
    if(!p.char)return;
    const c=p.char,isMe=p.id===myId;
    const acted=hasActedThisRound(gs,p.id);
    const hp=Math.max(0,c.health/c.maxHealth*100);
    const src=playerToken(p);
    const tokCls=['tok',!c.alive?'fallen':acted?'acted':'',isMe?'mine':'',p.frame?'frame-'+p.frame:''].join(' ').trim();
    const badge=!c.alive?'<span class="tok-badge tb-f">Fallen</span>':acted?'<span class="tok-badge tb-a">Acted ✓</span>':'';
    const row=document.createElement('div'); row.className='token-row';
    const moveBtn=isMe&&c.alive?`<button class="mini-btn line-btn" ${mv.ok?'':'disabled'} title="${mv.ok?(gs.phase==='combat'?'Free, once per turn':''):mv.why}" onclick="setRow('${c.row==='back'?'front':'back'}')">${c.row==='back'?'⇡ Step up':'⇣ Fall back'}</button>`:'';
    row.innerHTML=`
      ${src?`<img class="${tokCls}" src="${src}" alt="${p.name}" ${isMe&&mv.ok?'draggable="true" title="Drag to the other line"':''}>`:'<div class="tok-ph">⚔</div>'}
      <div class="tok-info">
        <div class="tok-name">${p.name}${isMe?' <small>(you)</small>':''}</div>
        <div class="tok-sub">${CAREER_LABELS[p.career]||''}${p.title?` · <em>${escapeHtml(p.title)}</em>`:''}</div>
        <div class="tok-hp-track"><div class="tok-hp-fill ${hpClass(hp)}" style="width:${hp}%"></div></div>
        <div class="tok-hp-txt">${c.health}/${c.maxHealth} HP</div>
        ${battleChips(c)}
        ${isMe&&c.alive?`<div class="line-note">${rowNote(c)} ${moveBtn}</div>`:''}
        ${badge}
      </div>`;
    if(isMe&&mv.ok){ const img=row.querySelector('img.tok'); if(img) img.addEventListener('dragstart',ev=>{ ev.dataTransfer.setData('text/plain','row'); }); }
    (c.row==='back'?pLanes.back:pLanes.front).appendChild(row);
  });
}

// ─── SIDEBARS ─────────────────────────────────────────────────────────────────
// Left: your character sheet + one tabbed panel (Talents / Spells / Items).
// Right: compact cards for allies; their talents fold away behind a toggle.
function modStr(s){ const m=s-10; return(m>=0?'+':'')+m; }
function hpClass(pct){ return pct>60?'hi':pct>25?'mid':'lo'; }
function labelFromKey(k){ return k.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase()); }
function xpProgress(c){
  const lvl=c.level;
  const cur=XP_T[Math.min(lvl,XP_T.length-1)]||0;
  const next=XP_T[Math.min(lvl+1,XP_T.length-1)]||XP_T[XP_T.length-1];
  const pct=lvl>=10?100:Math.max(0,Math.min(100,Math.round(((c.xp-cur)/Math.max(1,next-cur))*100)));
  return {next,pct};
}

let sbTab=null;                 // remembered tab in your panel (null = automatic)
const openAllyDetails=new Set(); // ally ids whose talent list is expanded

function renderSidebars(players,gs,me){
  const L=el('sb-left'),R=el('sb-right');
  L.innerHTML=''; R.innerHTML='';
  players.forEach(p=>{
    if(!p.char)return;
    if(p.id===myId){
      L.appendChild(buildCard(p,gs));
      L.appendChild(buildMyTabs(p.char,gs));
    } else {
      R.appendChild(buildAllyCard(p,gs));
    }
  });
}

function hasActedThisRound(gs,id){ return gs.phase==='combat'&&gs.playersActedThisRound&&gs.playersActedThisRound.includes(id); }

// What a buff does, in a few words, for its tooltip.
function buffEffectText(b){
  const n=(v,l)=>v?`${v>0?'+':''}${v} ${l}`:null;
  const parts=[n(b.defBonus,'Defence'),n(b.dmgBonus,'damage'),n(b.atkBonus,'to hit'),b.atkBoon?`+${b.atkBoon} boon`:null,b.atkBane?`${b.atkBane} bane on your attacks`:null,
    b.bane?`enemies get ${b.bane} bane`:null,b.enemyBane?`enemies get ${b.enemyBane} bane`:null,n(b.damageReduction,'damage reduction'),
    (b.regenHp||b.regenPerRound)?`heals ${b.regenHp||b.regenPerRound} a round`:null,b.dotDmg?`${b.dotDmg} damage a round`:null,b.tempHp?`${b.tempHp} temporary HP`:null,
    b.skipTurn?'loses their turn':null,b.immune||b.immuneThisRound?'immune to attacks':null,b.taunting?'drawing enemy attacks':null].filter(Boolean);
  return parts.join(', ');
}
// A buff is bad news if it costs the warrior something.
function buffIsBad(b){ return (b.defBonus||0)<0||(b.dmgBonus||0)<0||(b.atkBonus||0)<0||b.atkBane||b.dotDmg||b.skipTurn||b.dmgPenalty; }
// Conditions and buffs shown under a warrior's portrait in the battle view.
function battleChips(c){
  if(!c.alive) return '';
  const conds=(c.conditions||[]).map(cd=>`<span class="bchip chip-bad e-chip-clickable" onmouseenter="showDebuffTip('${esc(cd)}',false,event)" onmouseleave="hideDebuffTip()">${iconImg(iconCondition(String(cd).replace(/\s*\(.*$/,'').replace(/\s+\d+$/,'')),'ico-chip')}${cd}</span>`);
  const buffs=(c.activeBuffs||[]).filter(b=>b.name).map(b=>{
    const fx=buffEffectText(b), left=b.duration>=90?'':` · ${b.duration}r`;
    return `<span class="bchip ${buffIsBad(b)?'chip-bad':'chip-good'}" title="${escapeHtml(b.name+(fx?': '+fx:'')+(left?` (${b.duration} round${b.duration===1?'':'s'} left)`:''))}">${escapeHtml(b.name)}${left}</span>`;
  });
  const all=[...conds,...buffs];
  return all.length?`<div class="tok-chips">${all.join('')}</div>`:'';
}
function statusChips(c){
  const conds=(c.conditions||[]).map(cd=>`<span class="chip chip-bad e-chip-clickable" onmouseenter="showDebuffTip('${esc(cd)}',false,event)" onmouseleave="hideDebuffTip()">${iconImg(iconCondition(String(cd).replace(/\s*\(.*$/,'').replace(/\s+\d+$/,'')),'ico-chip')}${cd}</span>`);
  const buffs=(c.activeBuffs||[]).map(b=>`<span class="chip chip-good e-chip-clickable" onmouseenter="showDebuffTip('${esc(b.name)}',false,event)" onmouseleave="hideDebuffTip()">${b.name} · ${b.duration}r</span>`);
  const all=[...conds,...buffs];
  return all.length?`<div class="chip-row">${all.join('')}</div>`:'';
}

function buildCard(p,gs){
  const c=p.char, div=document.createElement('div');
  div.className='panel pcard'+(c.alive?'':' is-dead');
  const hpPct=Math.max(0,c.health/c.maxHealth*100);
  const {next,pct:xpPct}=xpProgress(c);
  const cp=CAREER_PATHS_C[p.career]||{};
  const paths=[c.expertPath&&((cp.expert||{})[c.expertPath]||labelFromKey(c.expertPath)),c.masterPath&&((cp.master||{})[c.masterPath]||labelFromKey(c.masterPath))].filter(Boolean).join(' › ');
  const dk=darkHtml(c);
  const defBuff=(c.activeBuffs||[]).filter(b=>b.defBonus).reduce((s,b)=>s+b.defBonus,0);
  const w=c.equippedWeapon, a=c.equippedArmor;
  const attr=(k,lbl)=>`<div class="attr"><span class="attr-l">${lbl}</span><span class="attr-v">${c.attrs[k]}</span><span class="attr-m">${modStr(c.attrs[k])}</span></div>`;
  div.innerHTML=`
    <div class="pc-head">
      <div class="pc-name">${p.name}</div>
      ${hasActedThisRound(gs,p.id)?'<span class="badge badge-good">Acted</span>':''}
    </div>
    ${p.title?`<div class="pc-title">${escapeHtml(p.title)}</div>`:''}<div class="pc-career">${CAREER_LABELS[p.career]||''} · Level ${c.level}${paths?` · ${paths}`:''}</div>
    <div class="bar-row"><span>Health</span><span>${c.health} / ${c.maxHealth}</span></div>
    <div class="bar-track"><div class="bar-fill hp ${hpClass(hpPct)}" style="width:${hpPct}%"></div></div>
    <div class="bar-row"><span>Experience</span><span>${c.level>=10?'Max level':`${c.xp} / ${next}`}</span></div>
    <div class="bar-track thin"><div class="bar-fill xp" style="width:${xpPct}%"></div></div>
    <div class="attr-grid">${attr('str','STR')}${attr('agi','AGI')}${attr('int','INT')}${attr('wil','WIL')}</div>
    <dl class="stat-list">
      <div title="Defence is how hard you are to hit: an enemy must roll this or more (d20 + its attack). It comes from AGI, talents and buffs; heavy armour lowers it a little."><dt>Defence</dt><dd>${c.defense}${defBuff?` <small>(+${defBuff})</small>`:''}</dd></div>
      <div><dt>Power</dt><dd>${c.power}</dd></div>
      <div><dt>Silver</dt><dd class="silver">${c.gold} ss</dd></div>
      <div class="wide"><dt>Weapon</dt><dd>${w?`${iconImg(iconItem(w),'ico-inv')}${w.name} ${w.dice}+${w.bonus||0} ${w.dmgType==='blunt'?'🔨':'⚔'}`:'Unarmed'}</dd></div>
      <div class="wide"><dt>Armour</dt><dd title="When a blow lands, your armour takes its DR off the damage — but never more than half of the blow.">${a?`${iconImg(iconItem(a),'ico-inv')}${a.name}<small class="armour-sub">${armourLine(a)}</small>`:'None'}</dd></div>
      <div class="wide"><dt>Line</dt><dd title="${rowNote(c)}">${c.row==='back'?'Back line':'Front line'}${p.id===myId&&c.alive?(()=>{ const mvs=rowMoveState(c,lastState&&lastState.gs); return ` <button class="mini-btn" ${mvs.ok?'':'disabled'} title="${mvs.ok?rowNote(c):mvs.why}" onclick="setRow('${c.row==='back'?'front':'back'}')">${c.row==='back'?'Step up':'Fall back'}</button>`; })():''}</dd></div>${relicChipsHtml(c)}
      <div class="wide"><dt>Taint</dt><dd class="dark-line" title="Corruption brings a mutation every 3 points. Insanity at its limit makes you snap: a short madness and a lasting disorder.">${dk.line}</dd></div>
      ${dk.muts.length||dk.dis.length?`<div class="wide"><dt>Marks</dt><dd class="relic-chips">${dk.muts.join('')}${dk.dis.join('')}</dd></div>`:''}
      <div class="wide"><dt>Charm</dt><dd${c.equippedCharm?` title="${c.equippedCharm.desc.replace(/"/g,'&quot;')}"`:''}>${c.equippedCharm?iconImg(iconItem({type:'charm',...c.equippedCharm}),'ico-inv')+c.equippedCharm.name:'None'}${c.equippedCharm&&p.id===myId?` <button class="mini-btn" onclick="unequipCharm()" title="Take the charm off and put it in your pack">Remove</button>`:''}</dd></div>
    </dl>
    ${statusChips(c)}
    ${!c.alive?'<div class="dead-label">Fallen</div>':''}`;
  return div;
}

function buildAllyCard(p,gs){
  const c=p.char, div=document.createElement('div');
  div.className='panel pcard ally'+(c.alive?'':' is-dead');
  const hpPct=Math.max(0,c.health/c.maxHealth*100);
  const open=openAllyDetails.has(p.id);
  div.innerHTML=`
    <div class="pc-head">
      <div class="pc-name">${p.name}</div>
      ${hasActedThisRound(gs,p.id)?'<span class="badge badge-good">Acted</span>':''}
      ${!p.connected?'<span class="badge">Offline</span>':''}
    </div>
    <div class="pc-career">${CAREER_LABELS[p.career]||''} · Level ${c.level}</div>
    <div class="bar-row"><span>Health</span><span>${c.health} / ${c.maxHealth}</span></div>
    <div class="bar-track"><div class="bar-fill hp ${hpClass(hpPct)}" style="width:${hpPct}%"></div></div>
    <div class="ally-stats">Def <b>${c.defense}</b> · DR <b>${armourDR(c)}</b> · STR <b>${c.attrs.str}</b> · AGI <b>${c.attrs.agi}</b> · INT <b>${c.attrs.int}</b> · WIL <b>${c.attrs.wil}</b></div>
    ${statusChips(c)}
    ${!c.alive?'<div class="dead-label">Fallen</div>':''}
    <button class="fold-btn" aria-expanded="${open}">${open?'Hide':'Show'} talents & spells</button>
    <div class="fold-body"${open?'':' hidden'}>${abilitiesHtml(c)}</div>`;
  div.querySelector('.fold-btn').onclick=()=>{
    if(openAllyDetails.has(p.id)) openAllyDetails.delete(p.id); else openAllyDetails.add(p.id);
    if(lastState) renderSidebars(lastState.players,lastState.gs,null);
  };
  return div;
}

function buildMyTabs(c,gs){
  const hasSpells=(c.knownSpells||[]).length>0;
  const tabs=[['talents','Talents'],...(hasSpells?[['spells','Spells']]:[]),['items',`Items (${(c.inventory||[]).length})`]];
  let tab=sbTab;
  if(!tab||!tabs.some(t=>t[0]===tab)) tab=gs.phase==='merchant'?'items':'talents';
  const wrap=document.createElement('div'); wrap.className='panel tab-panel';
  const bar=document.createElement('div'); bar.className='tab-bar'; bar.setAttribute('role','tablist');
  tabs.forEach(([id,label])=>{
    const b=document.createElement('button'); b.className='tab'+(id===tab?' on':''); b.textContent=label;
    b.setAttribute('role','tab'); b.setAttribute('aria-selected',id===tab);
    b.onclick=()=>{ sbTab=id; if(lastState) renderSidebars(lastState.players,lastState.gs,null); };
    bar.appendChild(b);
  });
  wrap.appendChild(bar);
  const body=document.createElement('div'); body.className='tab-body';
  if(tab==='spells') body.innerHTML=spellsHtml(c);
  else if(tab==='items') body.innerHTML=`<ul class="inv-list">${inventoryHtml(c,gs.phase==='combat',gs.phase==='merchant')}</ul>`;
  else body.innerHTML=talentsHtml(c);
  wrap.appendChild(body);
  return wrap;
}

// ─── TALENTS / SPELLS ─────────────────────────────────────────────────────────
const ACTIVE_TALENTS=[
  ['catchBreath','Catch Your Breath','catchBreathUsed'],['nimbleRecovery','Nimble Recovery','nimbleUsed'],
  ['sharedRecovery','Shared Recovery','sharedUsed'],['spellRecovery','Spell Recovery','spellRecoveryUsed'],
  ['shieldBash','Shield Bash','_shieldBashUsed'],['divineSmite','Divine Smite','divineSmiteUsed'],
  ['massHeal','Mass Heal','massHealUsed'],['resurrection','Resurrection','resurrectionUsed'],
  ['rallyingCry','Rallying Cry','rallyingUsed'],['metamagic','Metamagic','metamagicUsed'],
  ['catastrophe','Catastrophe','catastropheUsed'],['bloodOffering','Blood Offering',null],
];
const PASSIVE_TALENTS=[
  'weaponTraining','trickery','combatProwess','combatExpertise','shieldwall','toughness','quickstrike','evasion',
  'deathblow','shadowstep','burningSoul','firewall','holyFervor','warlordAura','sweepingBlow','phantomStrike',
  'bladestorm','holyAura','rage','quickStep','utilityFocus','elementalAttunement','volatileForm','assassination',
  'swiftFeet','arcaneSurge','spellLeech','pacedStrikes','unstoppable','quickHands','acrobaticRiposte',
  'protectiveBlessing','forceOfWill','overcast','doubleCharge','devastatingCharge',
];
// Every passive the character has: the list above plus any described talent that isn't an active.
function passiveKeys(c){
  const active=new Set([...ACTIVE_TALENTS.map(a=>a[0]),...EXTRA_ACTIVES.map(e=>e[0])]);
  return [...new Set([...PASSIVE_TALENTS,...Object.keys(TALENT_DESCS)])].filter(k=>c[k]===true&&!active.has(k));
}
const SPELL_ELEMENT_ICON={fire:'🔥',holy:'✨',lightning:'⚡',dark:'🌑',arcane:'🔮'};
function spellIcon(name){
  const pic=typeof iconSpell==='function'&&iconSpell(name);
  return pic?iconImg(pic,'ico-sm'):(SPELL_ELEMENT_ICON[SPELL_ELEMENT[name]]||'🔮');
}

function talentRow(name,badgeCls,badge,desc,key){
  return `<div class="ab-item tip"><span class="ab-name">${key?iconImg(iconTalent(key),'ico-sm'):''}${name}</span><span class="badge ${badgeCls}">${badge}</span><span class="tiptext">${desc}</span></div>`;
}
function talentsHtml(c){
  const actives=ACTIVE_TALENTS.filter(([k])=>c[k]).map(([k,label,usedKey])=>{
    const used=usedKey?!!c[usedKey]:false;
    return talentRow(label,used?'badge-bad':'badge-good',used?cooldownText(c,k):'Ready',TALENT_DESCS[k]||label,k);
  });
  EXTRA_ACTIVES.forEach(([k,lbl,sub,used])=>{
    if(!c[k]||ACTIVE_TALENTS.some(t=>t[0]===k)) return;
    const u=used(c,(lastState&&lastState.gs)||{});
    actives.push(talentRow(lbl.replace(/^\S+ /,''),u?'badge-bad':'badge-good',u?(k==='taunt'?'Recharging':cooldownText(c,k)):'Ready',TALENT_DESCS[k]||sub,k));
  });
  const passives=passiveKeys(c).map(k=>talentRow(labelFromKey(k),'badge-dim','Passive',TALENT_DESCS[k]||labelFromKey(k),k));
  let h='';
  if(actives.length) h+=`<div class="ab-section"><div class="ab-title">Active <span class="ab-note">each one uses your turn</span></div>${actives.join('')}</div>`;
  if(passives.length) h+=`<div class="ab-section"><div class="ab-title">Passive <span class="ab-note">always on, no button</span></div>${passives.join('')}</div>`;
  return h||'<div class="empty">No talents yet.</div>';
}
function spellsHtml(c){
  const spells=c.knownSpells||[];
  if(!spells.length) return '<div class="empty">No spells known.</div>';
  const ranks=[...new Set(spells.map(sp=>sp.rank))].sort();
  const pools=ranks.map(r=>`<span class="pool">Rank ${r} <b>${castingsLeftC(c,'',r)}/${maxCastingsC(c.power,r)}</b></span>`).join('');
  const rows=spells.map(sp=>{
    const left=castingsLeftC(c,sp.name,sp.rank);
    const type=sp.type==='heal'?'Heal':sp.type==='utility'?'Utility':'Attack';
    return `<div class="ab-item tip"><span class="ab-name">${spellIcon(sp.name)} ${sp.name}</span><span class="ab-meta">R${sp.rank} ${type}</span><span class="badge ${left>0?'badge-good':'badge-bad'}" title="${escapeHtml(castsTip(c,sp))}">${left}/${castsMax(c,sp)}</span><span class="tiptext">${sp.desc||`Rank ${sp.rank} ${type} spell.`}</span></div>`;
  }).join('');
  const trads=(c.traditions||[]).map(t=>(TRADITION_INFO[t]&&TRADITION_INFO[t].label)||t).join(', ');
  return `<div class="pools" title="Spells of the same rank share castings; all refill at the start of each fight.">${pools}</div>${rows}${trads?`<div class="ab-foot">Traditions: ${trads}</div>`:''}`;
}
function abilitiesHtml(c){
  const sp=(c.knownSpells||[]).length?`<div class="ab-section"><div class="ab-title">Spells</div>${spellsHtml(c)}</div>`:'';
  return talentsHtml(c)+sp;
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────
const USABLE_ITEMS=['Healing Draught','Greater Healing Draught','Flask of Oil','Fire Jar','Incendiary Flask','Daemon Fire','Lucky Pendant',
  'Sharpening Stone','Antitoxin','Smoke Bomb',"Sigmar's Token",'Troll Blood','Dwarf Ale','Warpstone Dust','Black Lotus Oil','Holy Water','Hellfire Bomb','Fly Agaric',
  'Bandages','Smelling Salts','Ironhide Tonic','Throwing Knives','Tar Pot'];
const ALLY_ITEMS=['Healing Draught','Greater Healing Draught'];
function isUsableItem(name){ return USABLE_ITEMS.includes(name)||name.startsWith('Scroll:'); }
function inventoryHtml(c,inCombat,atMerchant){
  let h='';
  (c.inventory||[]).forEach((item,idx)=>{
    const o=item.itemObj;
    const isWpn=item.type==='weapon', isArmor=item.type==='armor', isCharm=item.type==='charm';
    const isEq=(isWpn&&c.equippedWeapon&&o&&o.id===c.equippedWeapon.id)||(isArmor&&c.equippedArmor&&o&&o.id===c.equippedArmor.id)||(isCharm&&c.equippedCharm&&o&&o.id===c.equippedCharm.id);
    const stat=isWpn&&o?` ${o.dice}+${o.bonus}${o.dmgType==='blunt'?' 🔨':' ⚔'}`:isArmor&&o?` ${armourLine(o)}`:'';
    const special=(isWpn||isArmor)&&o&&o.special?'<span class="special-mark" title="Has a special ability">✦</span>':'';
    let btns='';
    if((isWpn||isArmor||isCharm)&&!isEq) btns+=`<button class="mini-btn" onclick="equipItem(${idx})">Equip</button>`;
    if(isUsableItem(item.name)) btns+=`<button class="mini-btn" onclick="useItem('${esc(item.name)}',${inCombat})">Use</button>`;
    if(ALLY_ITEMS.includes(item.name)&&inCombat) btns+=`<button class="mini-btn good" onclick="useAlly('${esc(item.name)}')">Ally</button>`;
    if(atMerchant&&!isEq) btns+=`<button class="mini-btn" onclick="sellItem(${idx})">Sell ${item.sellCost||1} ss</button>`;
    const open=(isWpn||isArmor||isCharm)?` onclick="openItemPopout(${idx},this)" role="button" tabindex="0"`:'';
    const cursed=o&&o.cursed?'<span class="cursed-mark" title="Cursed: once equipped it can\'t be removed until you rest">⛓ Cursed</span>':'';
    const tip=!open&&ITEM_DESCS[item.name]?` title="${ITEM_DESCS[item.name].replace(/"/g,'&quot;')}"`:'';
    h+=`<li class="${isEq?'equipped':''}"><span class="iname${open?' clickable':''}"${open}${tip}>${iconImg(iconItem(item),'ico-inv')}${item.name}${item.qty>1?` ×${item.qty}`:''}<small>${stat}</small>${special}${cursed}${isEq?'<span class="eq-mark">Equipped</span>':''}</span><span class="inv-btns">${btns}</span></li>`;
  });
  return h||'<li class="empty">Your pack is empty.</li>';
}

function openItemPopout(invIdx, triggerEl){
  if(!lastState) return;
  const me=lastState.players.find(p=>p.id===myId); if(!me||!me.char) return;
  const item=me.char.inventory[invIdx]; if(!item) return;
  const obj=item.itemObj;
  const pop=document.getElementById('item-popout');
  const content=document.getElementById('ip-content');
  if(!pop||!content) return;

  const isWpn=item.type==='weapon', isArm=item.type==='armor', isCharm=item.type==='charm';
  const statLine=isCharm?'Charm':isWpn&&obj?`${obj.dice}+${obj.bonus} · ${(obj.stat||'').toUpperCase()} · ${obj.dmgType||''}`:
                 isArm&&obj?armourLine(obj):'';
  const isEqWpn=isWpn&&me.char.equippedWeapon&&obj&&obj.id===me.char.equippedWeapon.id;
  const isEqArm=(isArm&&me.char.equippedArmor&&obj&&obj.id===me.char.equippedArmor.id)||(isCharm&&me.char.equippedCharm&&obj&&obj.id===me.char.equippedCharm.id);
  const inCombat=lastState.gs&&lastState.gs.phase==='combat';
  const atMerchant=lastState.gs&&lastState.gs.phase==='merchant';
  const usable=isUsableItem(item.name);
  const legendary=obj&&obj.legendary;

  let specialHtml='';
  if(obj&&obj.special){
    const spName=obj.special.key
      .replace(/([A-Z])/g,' $1')
      .replace(/^./,s=>s.toUpperCase())
      .replace('Bladeguard','Bladeguard — Passive')
      .replace('Cleave','Cleave — Passive')
      .replace('Reach','Reach — Passive')
      .replace('Riposte','Riposte — Passive')
      .replace('Silver Edge','Silver Edge — Passive')
      .replace('Arcane Focus','Arcane Focus — Passive')
      .replace('Spellblade','Spellblade — Passive')
      .replace('Blessed Strike','Blessed Strike — Passive')
      .replace('Smite The Fallen','Smite the Fallen — Passive')
      .replace('Sunder','Sunder — Passive')
      .replace('Opening Shot','Opening Shot — Passive')
      .replace('Marksmanship','Marksmanship — Passive')
      .replace('Unstable Charge','Unstable Charge — Passive')
      .replace('Rune Strike','Rune Strike — Passive')
      .replace('Channel Faith','Channel Faith — Passive')
      .replace('Holy Smoke','Holy Smoke — Passive');
    specialHtml=`<div class="ip-special"><div class="ip-special-name">${spName}${legendary?' <span class="legendary-tag">✦ Legendary</span>':''}</div><div class="ip-special-desc">${obj.special.desc.replace(/^(Passive|Active|Legendary):\s*/,'')}</div></div>`;
  }

  const descParts=obj&&obj.desc?obj.desc.split(' — '):[];
  const extraDesc=descParts.slice(1).join(' — ').replace(/^(Passive|Active|Legendary):\s*/,'');

  let btnHtml='<div class="ip-btns">';
  if(isWpn&&!isEqWpn) btnHtml+=`<button class="mini-btn" onclick="equipItem(${invIdx});closeItemPopout()">Equip</button>`;
  if((isArm||isCharm)&&!isEqArm) btnHtml+=`<button class="mini-btn" onclick="equipItem(${invIdx});closeItemPopout()">Equip</button>`;
  if(usable) btnHtml+=`<button class="mini-btn" onclick="useItem('${esc(item.name)}',${inCombat});closeItemPopout()">Use</button>`;
  if(atMerchant&&!isEqWpn&&!isEqArm) btnHtml+=`<button class="mini-btn" onclick="sellItem(${invIdx});closeItemPopout()">Sell ${item.sellCost||1} ss</button>`;
  btnHtml+='</div>';

  content.innerHTML=`
    <div class="ip-name">${item.name}${legendary?' <span class="legendary-tag">Legendary</span>':''}</div>
    ${statLine?`<div class="ip-stat">${statLine}${isEqWpn||isEqArm?' · <span class="eq-mark">Equipped</span>':''}</div>`:''}
    ${isCharm&&obj?`<div class="ip-special"><div class="ip-special-desc">${obj.desc}</div></div>`:''}
    ${obj&&obj.cursed?'<div class="ip-stat cursed-mark">⛓ Cursed — once equipped it can\'t be removed until you rest or use a Sigmar\'s Token.</div>':''}
    ${specialHtml}
    ${extraDesc&&!specialHtml?`<div class="ip-special"><div class="ip-special-desc">${extraDesc}</div></div>`:''}
    ${btnHtml}`;

  pop.classList.remove('show');
  const rect=triggerEl.getBoundingClientRect();
  const winW=window.innerWidth, winH=window.innerHeight;
  let left=rect.left, top=rect.bottom+6;
  if(left+340>winW) left=Math.max(4,winW-344);
  if(top+200>winH) top=Math.max(4,rect.top-210);
  pop.style.left=left+'px'; pop.style.top=top+'px';
  pop.classList.toggle('legendary-popout', !!legendary);
  pop.classList.add('show');

  setTimeout(()=>{ document.addEventListener('click',_ipOutside,{once:true,capture:true}); },10);
}
function _ipOutside(e){
  const pop=document.getElementById('item-popout');
  if(pop&&!pop.contains(e.target)) closeItemPopout();
}
function closeItemPopout(){
  const pop=document.getElementById('item-popout');
  if(pop) pop.classList.remove('show');
}
function esc(s){ return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function useItem(name,inCombat){ send('PLAYER_ACTION',{action:inCombat?'USE_ITEM':'USE_ITEM_OOC',data:{itemName:name}}); }
function equipItem(idx){ send('PLAYER_ACTION',{action:'EQUIP_ITEM',data:{inventoryIndex:idx}}); }
function sellItem(idx){ send('PLAYER_ACTION',{action:'SELL_ITEM',data:{invIndex:idx}}); }
function setRow(r){ send('PLAYER_ACTION',{action:'SET_ROW',data:{row:r}}); }
function unequipCharm(){ send('PLAYER_ACTION',{action:'UNEQUIP_CHARM',data:{}}); }

function useAlly(itemName){
  if(!lastState)return;
  const allies=lastState.players.filter(p=>p.id!==myId&&p.char&&p.char.alive);
  if(!allies.length){ useItem(itemName,true); return; }
  showOverlay(allies,tid=>{ send('PLAYER_ACTION',{action:'USE_ITEM_ALLY',data:{itemName,targetId:tid}}); closeOverlay(); });
}
function castAlly(spellName){
  if(!lastState)return;
  const options=[...lastState.players.filter(p=>p.id!==myId&&p.char&&p.char.alive),{id:myId,name:'Yourself'}];
  showOverlay(options,tid=>{ send('PLAYER_ACTION',{action:'CAST_SPELL',data:{spellName,targetId:tid}}); closeOverlay(); });
}
function showOverlay(players,onPick){
  closeOverlay();
  const ov=document.createElement('div'); ov.className='overlay'; ov.id='ov';
  const box=document.createElement('div'); box.className='panel overlay-box';
  box.innerHTML='<div class="ph">Choose Target</div>';
  players.forEach(p=>{
    const b=document.createElement('button'); b.className='btn btn-w';
    b.textContent=p.name; b.onclick=()=>onPick(p.id); box.appendChild(b);
  });
  const c=document.createElement('button'); c.className='btn'; c.textContent='Cancel'; c.onclick=closeOverlay; box.appendChild(c);
  ov.appendChild(box); document.body.appendChild(ov);
}
function closeOverlay(){ const o=el('ov'); if(o)o.remove(); }

// ─── CAMPFIRE ─────────────────────────────────────────────────────────────────
function buildCampfirePanel(gs,players,me){
  const box=document.createElement('div'); box.className='relic-panel';
  const mine=gs.campfire.choices&&gs.campfire.choices[myId], c=me.char;
  if(!c.alive){ box.innerHTML='<div class="acted-msg">You have fallen; the others decide.</div>'; return box; }
  if(mine){
    const left=players.filter(p=>p.char&&p.char.alive&&p.connected&&!gs.campfire.choices[p.id]).map(p=>escapeHtml(p.name));
    box.innerHTML=`<div class="acted-msg">You chose to <strong>${mine.choice==='rest'?'rest':'upgrade your '+(mine.slot==='armor'?'armour':'weapon')}</strong>.${left.length?` Waiting for ${left.join(', ')}…`:''}</div>`;
    return box;
  }
  const grid=document.createElement('div'); grid.className='relic-grid';
  const opt=(icon,name,desc,data)=>{ const b=document.createElement('button'); b.className='relic-opt'; b.innerHTML=`<span class="relic-icon">${icon}</span><span class="relic-name">${name}</span><span class="relic-desc">${desc}</span>`; b.onclick=()=>send('PLAYER_ACTION',{action:'CAMPFIRE',data}); grid.appendChild(b); };
  opt('💤','Rest',`Heal half your HP (${c.health}/${c.maxHealth} now), lose 1 Insanity, loosen curses and get 1 boon in the next fight.`,{choice:'rest'});
  (c.campOptions||[]).forEach(o=>opt(o.slot==='weapon'?'⚔':'🛡',`Upgrade ${escapeHtml(o.name)}`,`Work through the night instead of resting: ${o.what} (upgrade ${o.now+1} of ${o.max||3}). No healing.`,{choice:'upgrade',slot:o.slot}));
  if(!(c.campOptions||[]).length) grid.insertAdjacentHTML('beforeend','<div class="hint">Your gear can\'t be upgraded further (weapons 3 times, armour twice and only up to DR 6).</div>');
  box.appendChild(grid);
  box.insertAdjacentHTML('beforeend','<div class="hint">Everyone gets their abilities and castings back either way.</div>');
  return box;
}
// ─── RELICS ───────────────────────────────────────────────────────────────────
function buildRelicPanel(gs,players,me){
  const box=document.createElement('div'); box.className='relic-panel';
  const rel=gs.relic, char=me.char, picked=(rel.picked||[]).includes(myId);
  if(!picked&&char.relicOptions&&char.relicOptions.length){
    const grid=document.createElement('div'); grid.className='relic-grid';
    char.relicOptions.forEach(k=>{ const r=RELICS_C[k]||{name:k,icon:'✨',desc:''};
      const b=document.createElement('button'); b.className='relic-opt';
      b.innerHTML=`<span class="relic-icon">${r.icon}</span><span class="relic-name">${r.name}</span><span class="relic-desc">${r.desc}</span>`;
      b.onclick=()=>send('PLAYER_ACTION',{action:'PICK_RELIC',data:{key:k}}); grid.appendChild(b); });
    box.appendChild(grid);
  } else box.insertAdjacentHTML('beforeend','<div class="acted-msg">Relic taken. Waiting for the others…</div>');
  if(rel.prize){
    const it=rel.prize.item, mine=rel.prize.votes&&rel.prize.votes[myId];
    const voted=Object.keys(rel.prize.votes||{}).length, here=players.filter(p=>p.char&&p.char.alive&&p.connected).length;
    const pz=document.createElement('div'); pz.className='prize';
    pz.innerHTML=`<div class="prize-h">🏆 Champion's Prize: <strong>${escapeHtml(it.name)}</strong></div><div class="hint">${escapeHtml(it.desc||it.effect||'')} Choose Need to roll a d20 for it, or Pass. If nobody needs it, the warband sells it. ${voted}/${here} decided.</div>`;
    if(!mine){ const row=document.createElement('div'); row.className='prize-row';
      [['need','🎲 Need'],['pass','Pass']].forEach(([c,t])=>{ const b=document.createElement('button'); b.className='btn'+(c==='need'?' btn-gold':''); b.textContent=t; b.onclick=()=>send('PLAYER_ACTION',{action:'VOTE_PRIZE',data:{choice:c}}); row.appendChild(b); });
      pz.appendChild(row);
    } else pz.insertAdjacentHTML('beforeend',`<div class="acted-msg">You chose <strong>${mine==='need'?'Need':'Pass'}</strong>.</div>`);
    box.appendChild(pz);
  }
  return box;
}
function mutatorsHtml(gs){
  if(!(gs.mutators||[]).length) return '';
  return `<div class="road-ahead"><div class="road-h">Endless mutators</div><div class="relic-chips">${gs.mutators.map(k=>{const m=MUTATORS_C[k]||{label:k,desc:''};return `<span class="relic-chip" tabindex="0" title="${m.desc}">♾ ${m.label}</span>`;}).join('')}</div></div>`;
}
function roadAheadHtml(gs){
  const road=(gs.road||[]).filter(r=>r.depth>gs.depth+1); if(!road.length) return mutatorsHtml(gs);
  return `<div class="road-ahead" aria-label="The road ahead"><div class="road-h">The road ahead</div>${road.map(r=>`<div class="road-step"><span class="road-d">Depth ${r.depth}</span>${r.choices.map(t=>`<span class="road-n${t==='cursed'?' cursed':''}${t==='boss'?' boss':''}" title="${PATH_NAMES[t]||t}">${PATH_ICONS[t]||'?'}</span>`).join('')}</div>`).join('')}</div>`+mutatorsHtml(gs);
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────
function renderActions(gs,players,me){
  const body=el('g-actions-body'), heading=el('actions-heading');
  body.innerHTML='';

  if(gs.phase==='path'){
    heading.textContent=gs.bossNode?'The Path Ahead':'Vote Your Path';
    const myVote=gs.pathVotes&&gs.pathVotes[myId];
    const icons=PATH_ICONS, descs=PATH_DESCS;
    const tally={}; if(gs.pathVotes) Object.values(gs.pathVotes).forEach(v=>{tally[v]=(tally[v]||0)+1;});
    const nodes=document.createElement('div'); nodes.className='path-nodes';
    (gs.pathChoices||[]).forEach(t=>{
      const node=document.createElement('div');
      node.className='path-node'+(t==='boss'?' boss':'')+(myVote===t?' voted':'');
      const vc=tally[t]||0;
      node.className+=t==='cursed'?' cursed':'';
      node.innerHTML=`<div class="node-icon">${icons[t]}</div><div class="node-name">${PATH_NAMES[t]||t}</div><div class="node-desc">${descs[t]}</div>${vc?`<div class="vote-tally">${vc} vote${vc>1?'s':''}</div>`:''}`;
      if(myVote!==t) node.onclick=()=>send('PLAYER_ACTION',{action:'VOTE_PATH',data:{nodeType:t}});
      nodes.appendChild(node);
    });
    body.appendChild(nodes);
    if(myVote) body.insertAdjacentHTML('beforeend',`<div class="acted-msg">Voted: <strong>${PATH_NAMES[myVote]||myVote}</strong> — waiting...</div>`);
    body.insertAdjacentHTML('beforeend',roadAheadHtml(gs));
    return;
  }

  if(gs.phase==='campfire'&&gs.campfire){
    heading.textContent='The campfire';
    body.appendChild(buildCampfirePanel(gs,players,me));
    return;
  }

  if(gs.phase==='relic'&&gs.relic){
    heading.textContent='Choose a relic';
    body.appendChild(buildRelicPanel(gs,players,me));
    return;
  }

  if(gs.phase==='choice'&&gs.choice){
    heading.textContent=gs.choice.title;
    body.appendChild(buildChoice(gs,players));
    return;
  }

  if(gs.phase==='aftermath'&&gs.aftermath){
    heading.textContent=gs.aftermath.outcome==='fled'?'You escaped':'Battle won';
    body.appendChild(buildAftermath(gs,players));
    return;
  }

  if(gs.phase==='event'){
    heading.textContent='Actions';
    const g=document.createElement('div'); g.className='action-grid single';
    addBtn(g,'Press Onward','Advance the journey','amv-',()=>send('PLAYER_ACTION',{action:'PRESS_ONWARD'}));
    body.appendChild(g); return;
  }

  if(gs.phase==='combat'){
    heading.innerHTML='Combat'+turnTimerHtml(gs);
    if(gs.practice) body.insertAdjacentHTML('beforeend',coachHtml(gs,me));
    const char=me.char;
    if(!char||!char.alive){ body.innerHTML='<div class="wait-msg">You have fallen...</div>'; return; }
    const hasActed=gs.playersActedThisRound&&gs.playersActedThisRound.includes(myId);
    const _curTurn=gs.turnOrder&&gs.turnOrder.length ? gs.turnOrder[gs.activeTurnIdx||0] : null;
    const _isMyTurn= _curTurn ? (_curTurn.type==='player'&&_curTurn.id===myId) : !hasActed;
    if(!_isMyTurn){
      const waitMsg=_curTurn&&_curTurn.type==='enemy'
        ? `<strong class="foe">${_curTurn.name}</strong> is attacking...`
        : _curTurn&&_curTurn.type==='player'&&!_isMyTurn
        ? `Waiting for <strong>${_curTurn.name}</strong>...`
        : 'Waiting for others...';
      body.innerHTML=`<div class="acted-msg">${waitMsg}</div>`; return;
    }
    const g=document.createElement('div'); g.className='action-grid';
    const wpnStr=wpnLbl(char);
    const _wpn=char.equippedWeapon;
    const _dtype=(_wpn&&_wpn.dmgType)||'slashing';
    const _dtIcon=_dtype==='blunt'?'🔨':'⚔';
    const _te=gs.enemies&&gs.enemies.length>0?gs.enemies[gs.activeEnemyIdx||0]:gs.enemy;
    const _bonus=_dtype==='blunt'&&_te&&_te.ac>=16
      ? ' [×1.5 vs heavy armour!]'
      : _dtype==='slashing'&&_te&&_te.ac<=14
      ? ' [×1.5 vs light armour!]'
      : '';
    const _atkLabel=`${iconImg(_wpn?iconItem(_wpn):ICONS.weaponDefault,'ico-btn')||_dtIcon} Attack${_bonus}`;
    const _atkTip=`${_dtIcon} ${_dtype==='blunt'?'Blunt — ×1.5 dmg vs AC ≥ 16 (heavy armour)':'Slashing — ×1.5 dmg vs AC ≤ 14 (light/no armour)'}. ${wpnStr}.`;
    const _lineNotes=attackLineNotes(char,_te);
    addBtn(g,_atkLabel,_lineNotes.length?`${wpnStr}<br><span class="line-warn">${_lineNotes.join(' · ')}</span>`:wpnStr,'am-',()=>send('PLAYER_ACTION',{action:'ATTACK'}),false,_atkTip+(_lineNotes.length?' '+_lineNotes.join('. ')+'.':''));
    const noSpells=char.equippedCharm&&char.equippedCharm.key==='brassSkull'; // Brass Skull of Khorne forbids spells
    (char.knownSpells||[]).forEach(sp=>{
      const left=castingsLeftC(char,sp.name,sp.rank), avail=!noSpells&&left>0;
      const desc=(sp.desc||`Rank ${sp.rank} spell.`)+` (${castsTip(char,sp)})`;
      const cc=castCount(char,sp);
      const isHeal=(sp.type==='heal'||sp.heal);
      const isUtil=(sp.type==='utility');
      if(isHeal){
        addBtn(g,sp.name+cc,'Heal self','as-',()=>send('PLAYER_ACTION',{action:'CAST_SPELL',data:{spellName:sp.name,targetId:myId}}),!avail,desc);
        if(lastState&&lastState.players.filter(p=>p.id!==myId&&p.char&&p.char.alive).length>0)
          addBtn(g,sp.name+' →'+cc,'Heal ally','as-',()=>castAlly(sp.name),!avail,desc+' (Target an ally.)');
      } else if(isUtil){
        addBtn(g,sp.name+cc,`Utility·R${sp.rank}`,'as-',()=>send('PLAYER_ACTION',{action:'CAST_SPELL',data:{spellName:sp.name}}),!avail,desc);
      } else {
        const elemIcon=spellIcon(sp.name);
        addBtn(g,`${elemIcon} ${sp.name}${cc}`,`Attack·R${sp.rank}`,'as-',()=>send('PLAYER_ACTION',{action:'CAST_SPELL',data:{spellName:sp.name}}),!avail,desc);
      }
    });
    if(char.catchBreath&&!char.catchBreathUsed) addBtn(g,talentLabel('catchBreath','Catch Breath'),'Heal 2d6+best attr','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'catchBreath'}}),false,TALENT_DESCS.catchBreath);
    if(char.shieldBash&&!char._shieldBashUsed) addBtn(g,talentLabel('shieldBash','🛡 Shield Bash'),'Stun enemy','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'shieldBash'}}),false,TALENT_DESCS.shieldBash);
    if(char.nimbleRecovery&&!char.nimbleUsed)   addBtn(g,talentLabel('nimbleRecovery','Nimble Recovery'),'Heal 2d6+best attr','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'nimbleRecovery'}}),false,TALENT_DESCS.nimbleRecovery);
    if(char.sharedRecovery&&!char.sharedUsed)   addBtn(g,talentLabel('sharedRecovery','Shared Recovery'),'You + allies heal 2d6','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'sharedRecovery'}}),false,TALENT_DESCS.sharedRecovery);
    if(char.spellRecovery&&!char.spellRecoveryUsed) addBtn(g,talentLabel('spellRecovery','Spell Recovery'),'Heal+casting','as-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'spellRecovery'}}),false,TALENT_DESCS.spellRecovery);
    if(char.divineSmite&&!char.divineSmiteUsed)  addBtn(g,talentLabel('divineSmite','⚡ Divine Smite'),'+3d6 holy dmg','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'divineSmite'}}),false,TALENT_DESCS.divineSmite);
    if(char.massHeal&&!char.massHealUsed)        addBtn(g,talentLabel('massHeal','✨ Mass Heal'),'All allies 1d6','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'massHeal'}}),false,TALENT_DESCS.massHeal||'Heal all living allies 1d6. Once per combat.');
    if(char.resurrection&&!char.resurrectionUsed)addBtn(g,talentLabel('resurrection','✝ Resurrection'),'Shield weakest ally','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'resurrection'}}),false,TALENT_DESCS.resurrection);
    if(char.rallyingCry&&!char.rallyingUsed)     addBtn(g,talentLabel('rallyingCry','📯 Rallying Cry'),'You + allies heal 2d6','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'rallyingCry'}}),false,TALENT_DESCS.rallyingCry);
    if(char.bloodOffering)                        addBtn(g,talentLabel('bloodOffering','🩸 Blood Offering'),'−1d6 HP → castings','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'bloodOffering'}}),false,TALENT_DESCS.bloodOffering);
    if(char.metamagic&&!char.metamagicUsed)       addBtn(g,talentLabel('metamagic','🔮 Metamagic'),'Next spell free','as-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'metamagic'}}),false,TALENT_DESCS.metamagic);
    if(char.catastrophe&&!char.catastropheUsed)   addBtn(g,talentLabel('catastrophe','💥 Catastrophe'),'10d6 all enemies','at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:'catastrophe'}}),false,TALENT_DESCS.catastrophe);
    EXTRA_ACTIVES.forEach(([k,lbl,sub,used,show])=>{ if(show&&!show(gs,players)) return; if(char[k]&&!used(char,gs)) addBtn(g,talentLabel(k,lbl),sub,'at-',()=>send('PLAYER_ACTION',{action:'USE_TALENT',data:{talent:k}}),false,TALENT_DESCS[k]||sub); });
    // Recharging abilities stay visible, greyed out, with the rounds left.
    ACTIVE_TALENTS.forEach(([k,label,usedKey])=>{ if(char[k]&&usedKey&&char[usedKey]&&COOLDOWNS_C[k]) addBtn(g,'⏳ '+label,cooldownText(char,k),'at-',null,true,TALENT_DESCS[k]||label); });
    EXTRA_ACTIVES.forEach(([k,lbl,sub,used,show])=>{ if(show&&!show(gs,players)) return; if(char[k]&&used(char,gs)&&COOLDOWNS_C[k]) addBtn(g,'⏳ '+lbl.replace(/^\S+ /,''),cooldownText(char,k),'at-',null,true,TALENT_DESCS[k]||sub); });
    const isBoss=gs.enemy&&gs.enemy.threat==='Boss';
    addBtn(g,'⏭ End Turn','Pass your turn','am-',()=>send('PLAYER_ACTION',{action:'PASS_TURN'}),false,'Skip your action this round.');
    addBtn(g,'Flee',isBoss?'No escape':'AGI vs DC10','amv-',()=>send('PLAYER_ACTION',{action:'FLEE'}),isBoss,'Attempt to flee combat. Roll d20+AGI vs DC10. Success costs opportunity damage unless you have Shadowstep.');
    body.appendChild(g);
    const alive=lastState?lastState.players.filter(p=>p.char&&p.char.alive):[];
    const acted=gs.playersActedThisRound?gs.playersActedThisRound.length:0;
    if(gs.turnOrder && gs.turnOrder.length) {
      const curSlot = gs.turnOrder[gs.activeTurnIdx||0];
      const isMyTurn = curSlot && curSlot.type==='player' && curSlot.id===myId;
      const turnLabel = curSlot ? (curSlot.type==='enemy' ? `Enemy turn: ${curSlot.name}` : (isMyTurn ? 'Your turn' : `${curSlot.name}'s turn`)) : '';
      const turnCls = isMyTurn ? 'mine' : curSlot&&curSlot.type==='enemy' ? 'foe' : '';
      const pos = (gs.activeTurnIdx||0)+1;
      body.insertAdjacentHTML('beforeend',`<div class="turn-line ${turnCls}">${turnLabel} (${pos}/${gs.turnOrder.length})</div>`);
    } else if(alive.length>1) {
      body.insertAdjacentHTML('beforeend',`<div class="turn-line">${acted}/${alive.length} warriors acted</div>`);
    }
  }
}

// Castings left for a spell: spells of one rank share a pool that refills each fight.
function castsMax(c,sp){ return Math.max(castingsLeftC(c,sp.name,sp.rank),maxCastingsC(c.power,sp.rank)); }
function castCount(c,sp){ const l=castingsLeftC(c,sp.name,sp.rank); return ` <span class="cast-count${l>0?'':' empty'}" title="${escapeHtml(castsTip(c,sp))}">${l}/${castsMax(c,sp)}</span>`; }
function castsTip(c,sp){ const l=castingsLeftC(c,sp.name,sp.rank); return `${l} of ${castsMax(c,sp)} rank ${sp.rank} castings left this fight — shared by all your rank ${sp.rank} spells`; }
function addBtn(parent,label,sub,cls,onClick,disabled=false,tooltip=''){
  const b=document.createElement('button');
  b.className=`act-btn ${cls}${tooltip?' tip':''}`;
  b.disabled=disabled;
  b.innerHTML=`<span class="abl">${label}</span><span class="abs">${sub}</span>${tooltip?`<span class="tiptext">${tooltip}</span>`:''}`;
  b.onclick=onClick; parent.appendChild(b);
}
function wpnLbl(char){
  const w=char.equippedWeapon;
  if(w) return`${w.name} ${w.dice}+${(w.bonus||0)+(char.weaponDmgBonus||0)}${char.weaponTraining?' +boon':''}`;
  return`Unarmed 1d6${char.weaponTraining?' +boon':''}`;
}

// ─── LOOT ────────────────────────────────────────────────────────────────────
function renderLoot(gs,me){
  const loot=gs.lootRoom; if(!loot)return;
  const hasPicked=gs.lootPicked&&gs.lootPicked.includes(myId);
  el('g-loot-desc').textContent='Choose one:';
  const opts=el('g-loot-opts'); opts.innerHTML='';
  const pm=el('g-loot-picked-msg');
  if(hasPicked){ pm.hidden=false; opts.innerHTML='<div class="empty wide">You have chosen.</div>'; return; }
  pm.hidden=true;
  const o=me.char&&me.char.lootOptions;
  if(!o){ opts.innerHTML='<div class="empty wide">Loading…</div>'; return; }
  const consName=o.consumable==='Spell Scroll'&&o.scrollSpell?`Scroll: ${o.scrollSpell.name}`:o.consumable;
  const consDesc=o.scrollSpell?o.scrollSpell.desc:ITEM_DESCS[o.consumable]||o.consumable;
  lootOpt(opts,'💰',`${loot.coins} Silver`,'Coin from the cache.',()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick:'coins'}}));
  lootOpt(opts,iconImg(iconItem({name:consName}),'ico-loot')||'🧪',consName,consDesc,()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick:'consumable'}}));
  lootOpt(opts,iconImg(iconItem(o.weapon),'ico-loot'),o.weapon.name,`${o.weapon.dice}+${o.weapon.bonus} · ${o.weapon.stat.toUpperCase()}${traitText(o.weapon)}`,()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick:'weapon'}}));
  lootOpt(opts,iconImg(iconItem(o.armor),'ico-loot'),o.armor.name,`${armourLine(o.armor)}${traitText(o.armor)}`,()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick:'armor'}}));
  if(o.charm) lootOpt(opts,iconImg(iconItem({type:'charm',...o.charm}),'ico-loot')||'📿',o.charm.name,o.charm.desc,()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick:'charm'}}));
  if(o.heirloom) lootOpt(opts,iconImg(iconItem(o.heirloom),'ico-loot')||'🏺',o.heirloom.name,o.heirloom.desc,()=>send('PLAYER_ACTION',{action:'PICK_LOOT',data:{pick:'heirloom'}}),'heirloom');
}
// The traits part of an item's description, for compact cards.
function traitText(item){ const d=(item&&item.desc)||''; const i=d.indexOf('Traits: '); return i>=0?` · ${d.slice(i+8)}`:''; }
function lootOpt(parent,icon,name,desc,onClick,extraCls){
  const d=document.createElement('div'); d.className='loot-opt'+(extraCls?' '+extraCls:'');
  d.innerHTML=`<div class="loot-icon">${icon}</div><div class="loot-name">${name}</div><div class="loot-desc">${desc}</div>`;
  d.onclick=onClick; parent.appendChild(d);
}

// ─── MERCHANT ────────────────────────────────────────────────────────────────
function renderShop(stock,myGold){
  const grid=el('g-shop-items'); grid.innerHTML='';
  const L=document.createElement('div'); L.className='shop-col';
  const R=document.createElement('div'); R.className='shop-col';
  [stock.heirloom,stock.weaponEnhance,stock.statBoost,stock.weapon1,stock.weapon2,stock.weapon3,stock.armor,stock.armor2].forEach(it=>{if(it)L.appendChild(shopEl(it,myGold));});
  [stock.charm,stock.charm2,...(stock.consumables||[]),stock.scroll].forEach(it=>{if(it)R.appendChild(shopEl(it,myGold));});
  grid.appendChild(L); grid.appendChild(R);
}
function shopEl(item,gold){
  const d=document.createElement('div'); d.className='shop-item'+(item.bought?' sold':'')+(item.heirloom?' heirloom':'');
  const desc=(item.itemObj&&item.itemObj.desc)||item.desc||ITEM_DESCS[item.name]||'';
  d.innerHTML=`<span class="si-name tip">${iconImg(iconItem(item),'ico-inv')}${item.name}<span class="tiptext">${desc}</span></span><span class="si-desc">${item.desc||''}</span><div class="si-row"><span class="si-cost">${item.cost} ss</span><button class="buy-btn" onclick="buyItem('${item.id}')" ${item.bought||gold<item.cost?'disabled':''}>${item.bought?'Sold':'Buy'}</button></div>`;
  return d;
}
function buyItem(id){ send('PLAYER_ACTION',{action:'BUY_ITEM',data:{itemId:id}}); }
function leaveShop(){ send('PLAYER_ACTION',{action:'LEAVE_SHOP'}); }

// ─── BATTLE AFTERMATH ─────────────────────────────────────────────────────────
// Summary shown after every fight: what fell, and what each warrior took away.
function buildAftermath(gs,players){
  const a=gs.aftermath, wrap=document.createElement('div'); wrap.className='aftermath';
  const slain=a.enemies||[];
  const counts={}; slain.forEach(n=>counts[n]=(counts[n]||0)+1);
  const slainTxt=Object.entries(counts).map(([n,c])=>c>1?`${n} ×${c}`:n).join(', ');
  wrap.insertAdjacentHTML('beforeend',`<p class="am-lead">${a.outcome==='fled'?'You broke away from the fight.':'The field is yours.'}${slainTxt?` Slain: <strong>${slainTxt}</strong>.`:''}</p>`);
  const order=[myId,...players.map(p=>p.id).filter(id=>id!==myId)];
  order.forEach(id=>{
    const r=a.rewards&&a.rewards[id]; if(!r) return;
    const lines=[];
    if(r.xp) lines.push(`<span class="am-xp">+${r.xp} XP</span>`);
    if(r.silver) lines.push(`<span class="am-silver">+${r.silver} silver</span>`);
    r.items.forEach(it=>lines.push(`<span class="am-item">${it}</span>`));
    if(!lines.length) lines.push('<span class="am-none">Nothing this time</span>');
    const lv=r.levelUps.length?`<div class="am-level">🌟 Level ${r.levelUps[r.levelUps.length-1].level}! ${r.choosePath?(id===myId?'Choose your path when you continue.':'Choosing a path.'):''}</div>`:'';
    wrap.insertAdjacentHTML('beforeend',`<div class="am-row${id===myId?' mine':''}"><div class="am-name">${r.name}<small>${r.hp}/${r.maxHp} HP</small></div><div class="am-gains">${lines.join('')}</div>${lv}</div>`);
  });
  const ready=a.ready.includes(myId);
  const waiting=players.filter(p=>p.char&&p.connected&&!a.ready.includes(p.id)).length;
  if(ready){
    wrap.insertAdjacentHTML('beforeend',`<div class="acted-msg">Waiting for ${waiting} other${waiting===1?'':'s'}…</div>`);
  } else {
    const b=document.createElement('button'); b.className='btn gold btn-w'; b.textContent='Continue';
    b.onclick=()=>send('PLAYER_ACTION',{action:'CONTINUE_AFTERMATH'}); wrap.appendChild(b);
  }
  return wrap;
}

// ─── CHOICE EVENTS ────────────────────────────────────────────────────────────
// An Unknown-room event with options; every warrior votes and the majority wins.
function buildChoice(gs,players){
  const ch=gs.choice, wrap=document.createElement('div'); wrap.className='choice-event';
  wrap.insertAdjacentHTML('beforeend',`<p class="ce-text">${ch.icon} ${ch.text}</p>`);
  const mine=ch.votes[myId];
  const tally={}; Object.values(ch.votes).forEach(v=>tally[v]=(tally[v]||0)+1);
  const list=document.createElement('div'); list.className='choice-list';
  ch.options.forEach(o=>{
    const b=document.createElement('button'); b.className='choice-btn'+(mine===o.id?' voted':'');
    b.innerHTML=`<span class="choice-name">${o.label}${tally[o.id]?` <small>${tally[o.id]} vote${tally[o.id]>1?'s':''}</small>`:''}</span><span class="choice-desc">${o.desc}</span>`;
    b.onclick=()=>send('PLAYER_ACTION',{action:'CHOOSE_EVENT',data:{option:o.id}});
    list.appendChild(b);
  });
  wrap.appendChild(list);
  const waiting=players.filter(p=>p.char&&p.char.alive&&p.connected&&!ch.votes[p.id]).length;
  if(mine) wrap.insertAdjacentHTML('beforeend',`<div class="acted-msg">You chose. Waiting for ${waiting} other${waiting===1?'':'s'}… (you can still change your vote)</div>`);
  return wrap;
}

// End screen: renown earned this run and anything it unlocked.
let _renownShown=null;
function showRenown(gs){
  const box=el('end-renown'); if(!box) return;
  if(gs.practice){ box.innerHTML='<div class="er-earned">Practice fights earn no Renown.</div>'; return; }
  const code=el('disp-code').textContent;
  const r=awardRun(gs,code);
  if(r) _renownShown=r;
  const x=_renownShown; if(!x){ box.innerHTML=''; return; }
  box.innerHTML=(gs.chronicle?`<div class="er-chron">${escapeHtml(gs.chronicle)}</div>`:'')+`<div class="er-earned">+${x.earned} Renown <small>(total ${x.total})</small></div>`+
    x.unlocked.map(u=>`<div class="er-unlock">🔓 Unlocked: ${u.label}</div>`).join('')+
    (x.newAch||[]).map(a=>`<div class="er-unlock">🏅 Achievement: <strong>${a.title}</strong> — ${a.desc}</div>`).join('');
}
