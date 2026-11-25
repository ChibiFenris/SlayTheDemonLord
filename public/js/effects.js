'use strict';
// ─── FLOATING DAMAGE NUMBERS ─────────────────────────────────────────────────
const prevHp = {}; // key: playerId or 'enemy'
let prevLogLen = 0; // track log length to detect new entries

function spawnFloat(anchorEl, text, type='dmg'){
  if(!anchorEl) return;
  const rect=anchorEl.getBoundingClientRect();
  const float=document.createElement('div');
  float.className='float-num '+type;
  float.textContent=text;
  float.style.left=(rect.left+rect.width/2-20+window.scrollX)+'px';
  float.style.top=(rect.top+window.scrollY-10)+'px';
  document.body.appendChild(float);
  float.addEventListener('animationend',()=>float.remove());
}

// Float anchors: the battle tokens on desktop, the cards in the mobile layout.
function getPlayerTok(name){
  if(isMobileUI()) return [...document.querySelectorAll('#m-game-view [data-pname]')].find(n=>n.dataset.pname===name)||null;
  let target=null;
  document.querySelectorAll('#ba-players .token-row').forEach(row=>{
    const n=row.querySelector('.tok-name');
    if(n&&n.textContent.includes(name)) target=row.querySelector('.tok');
  });
  return target;
}
function getActiveEnemyTok(){
  const idx=lastState&&lastState.gs?lastState.gs.activeEnemyIdx||0:0;
  if(isMobileUI()) return document.querySelector(`#m-game-view [data-eidx="${idx}"]`)||document.querySelector('#m-game-view .m-enemy-card');
  const row=document.querySelector(`#ba-enemy .token-row[data-eidx="${idx}"]`)||document.querySelector('#ba-enemy .token-row');
  return row?row.querySelector('.tok,.tok-ph'):null;
}

function checkFloats(gs,players){
  // ── HP-change floats (damage & healing) ──────────────────────────────────
  const enemies=gs.enemies&&gs.enemies.length>0?gs.enemies:[gs.enemy].filter(Boolean);
  enemies.forEach((e,idx)=>{
    if(!e) return;
    const key='enemy_'+idx;
    const prev=prevHp[key];
    if(prev!==undefined&&e.hp<prev){
      const diff=prev-e.hp;
      const eRows=document.querySelectorAll('#ba-enemy .token-row');
      const eEl=eRows[idx]?eRows[idx].querySelector('.tok'):null;
      spawnFloat(eEl,'-'+diff,diff>15?'crit':'dmg');
    }
    prevHp[key]=e.hp;
  });
  Object.keys(prevHp).forEach(k=>{ if(k.startsWith('enemy_')&&!enemies[parseInt(k.split('_')[1])]) delete prevHp[k]; });

  players.forEach(p=>{
    if(!p.char) return;
    const prev=prevHp[p.id];
    if(prev!==undefined&&p.char.health!==prev){
      const diff=p.char.health-prev;
      const targetEl=getPlayerTok(p.name);
      if(diff<0) spawnFloat(targetEl,String(diff),Math.abs(diff)>15?'crit':'dmg');
      else if(diff>0) spawnFloat(targetEl,'+'+diff,'heal');
    }
    prevHp[p.id]=p.char.health;
  });

  // ── Miss floats — scan new log entries ───────────────────────────────────
  const log=gs.log||[];
  const newEntries=log.slice(prevLogLen);
  prevLogLen=log.length;

  newEntries.forEach(entry=>{
    const msg=entry.msg||'';
    const plain=msg.replace(/<[^>]*>/g,'');

    const playerMissMatch=plain.match(/^(\S+)\s+misses\s+—/);
    if(playerMissMatch){
      const nameGuess=playerMissMatch[1];
      const p=players.find(pl=>pl.name===nameGuess||pl.name.startsWith(nameGuess));
      const tok=p?getPlayerTok(p.name):getPlayerTok(nameGuess);
      spawnFloat(tok,'Miss','miss');
      return;
    }

    const enemyMissMatch=plain.match(/misses\s+(\S+)\s+—/);
    if(enemyMissMatch){
      const playerName=enemyMissMatch[1];
      const p=players.find(pl=>pl.name===playerName||pl.name.startsWith(playerName));
      const tok=p?getPlayerTok(p.name):null;
      spawnFloat(tok,'Miss','miss');
      spawnFloat(getActiveEnemyTok(),'Miss','miss');
      return;
    }

    if(plain.includes('fumbles!')){
      const fumbleMatch=plain.match(/^(\S+)\s+fumbles/);
      if(fumbleMatch){
        const p=players.find(pl=>pl.name===fumbleMatch[1]);
        const tok=p?getPlayerTok(p.name):null;
        spawnFloat(tok,'Fumble!','miss');
      }
    }

    if(plain.includes('loses its next action')){
      spawnFloat(getActiveEnemyTok(),'Skipped!','miss');
    }

    // ── DoT float numbers above enemy token ──────────────────────────────────
    // ── DoT float numbers above enemy token ──────────────────────────
    if(plain.includes('burns')){
      const m=plain.match(/−(\d+)\s*dmg/)||plain.match(/-(\d+)\s*dmg/);
      if(m){
        const dmg=m[1];
        if(plain.includes('Poison'))      {spawnFloat(getActiveEnemyTok(),'☠ -'+dmg,'dot');return;}
        if(plain.includes('Major Bleed')) {spawnFloat(getActiveEnemyTok(),'🩸🩸 -'+dmg,'dot');return;}
        if(plain.includes('Bleed'))       {spawnFloat(getActiveEnemyTok(),'🩸 -'+dmg,'dot');return;}
        if(plain.includes('Burn'))        {spawnFloat(getActiveEnemyTok(),'🔥 -'+dmg,'dot');return;}
        if(plain.includes('Chilled'))     {spawnFloat(getActiveEnemyTok(),'❄ -'+dmg,'dot');return;}
        if(plain.includes('Grave'))       {spawnFloat(getActiveEnemyTok(),'💀 -'+dmg,'dot');return;}
      }
    }

    // ── Debuff application floats ─────────────────────────────────────────────
    const debuffLabels={
      'BLINDED':    {text:'👁 Blinded!',  type:'debuff'},
      'STUNNED':    {text:'💫 Stunned!',  type:'debuff'},
      'CHILLED':    {text:'❄ Chilled!',  type:'debuff'},
      'BLEEDING':   {text:'🩸 Bleed!',   type:'debuff'},
      'MAJOR BLEEDING':{text:'🩸🩸 Major Bleed!', type:'debuff'},
      'BURNING':    {text:'🔥 Burn!',    type:'debuff'},
      'FROZEN':     {text:'❄ Frozen!',  type:'debuff'},
      'POISONED':   {text:'☠ Poisoned!',type:'debuff'},
    };
    for(const [keyword, info] of Object.entries(debuffLabels)){
      if(plain.toUpperCase().includes(keyword)&&(plain.includes('is BLINDED')||plain.includes('is CHILLED')||plain.includes('is STUNNED')||plain.includes('BLEEDING')||plain.includes('BURNING')||plain.includes('poisoned'))){
        spawnFloat(getActiveEnemyTok(),info.text,info.type);
        break;
      }
    }
    if(plain.includes('RAGES')){
      const rageTok=getPlayerTok(plain.split(' ')[0]);
      spawnFloat(rageTok,'🔥 RAGE!','crit');
    }
    if(plain.includes('INSTANT KILL')){
      spawnFloat(getActiveEnemyTok(),'💀 DEAD!','crit');
    }
  });
}


function mShowDeathScreen(players,depth,gs){
  const ov=document.getElementById('m-death-overlay');
  if(!ov||ov.classList.contains('active')) return;
  ov.hidden=false;
  requestAnimationFrame(()=>{
    ov.classList.add('active');
    setTimeout(()=>{
      const t=document.getElementById('death-title'); if(t) t.classList.add('show');
    },100);
    setTimeout(()=>{
      const s=document.getElementById('death-sub');
      if(s){s.textContent=`Depth ${depth} / 30`;s.classList.add('show');}
    },400);
    setTimeout(()=>{
      const db=document.getElementById('death-blow');
      if(db && gs && gs.deathCause){
        const raw=gs.deathCause.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
        const dmgMatch=gs.deathCause.match(/[−\-](\d+)\s*dmg/);
        const dmgNum=dmgMatch?dmgMatch[1]:null;
        db.innerHTML=dmgNum
          ? `<span class="death-dmg">−${dmgNum} damage</span>${raw}`
          : raw;
        db.classList.add('show');
      }
    },700);
    setTimeout(()=>{
      const pc=document.getElementById('death-players');
      if(pc){
        pc.innerHTML=players.filter(p=>p.char).map(p=>`
          <div class="death-pcard">
            <div class="dpname">${p.name}</div>
            <div class="dpstat">${p.char.level>0?'Lv '+p.char.level+' · ':''} ${p.char.xp} XP</div>
          </div>`).join('');
        pc.classList.add('show');
      }
    },1100);
  });
}
function mHideDeathScreen(){
  const ov=document.getElementById('m-death-overlay');
  if(!ov) return;
  ov.classList.remove('active');
  setTimeout(()=>{ ov.hidden=true; },500);
  ['death-title','death-sub','death-blow','death-players'].forEach(id=>{
    const el2=document.getElementById(id); if(el2) el2.classList.remove('show');
  });
}

const ATTR_LABELS={str:'Strength',agi:'Agility',int:'Intellect',wil:'Will'};
const ATTR_DESC={str:'Raises melee damage and HP.',agi:'Raises hit chance with AGI weapons and Defence.',int:'Raises spell damage.',wil:'Raises healing and divine spells.'};
function showStatChoiceModal(attrs){
  const ex=el('stat-choice-modal'); if(ex) ex.remove();
  const modal=document.createElement('div');
  modal.id='stat-choice-modal'; modal.className='overlay';
  const btns=Object.entries(attrs).map(([k,v])=>`
    <button class="choice-btn" onclick="chooseStatBoost('${k}')">
      <span class="choice-name">${ATTR_LABELS[k]} <small>currently ${v}</small></span>
      <span class="choice-desc">${ATTR_DESC[k]}</span>
    </button>`).join('');
  modal.innerHTML=`
    <div class="panel overlay-box" role="dialog" aria-label="Apothecary">
      <div class="ph">Apothecary</div>
      <p class="overlay-sub">Choose one attribute to raise by 1.</p>
      <div class="choice-list">${btns}</div>
    </div>`;
  document.body.appendChild(modal);
}
function chooseStatBoost(attr){
  send('PLAYER_ACTION',{action:'CHOOSE_STAT',data:{attr}});
  const modal=document.getElementById('stat-choice-modal'); if(modal) modal.remove();
}
